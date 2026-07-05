# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Knight Bot is a WhatsApp bot built on `@whiskeysockets/baileys` (a multi-device WhatsApp Web API library). It's a single-process, plain CommonJS Node.js application — no build step, no bundler, no TypeScript. There is no database; all state is persisted to flat JSON files under `data/`.

## Commands

```bash
npm install                       # standard install
npm install --legacy-peer-deps    # `install:panel` — use on hosting panels that choke on peer deps
npm start                         # node index.js — first run prints a QR code / pairing-code prompt
npm run start:optimized           # start with --max-old-space-size=512 and manual GC flags (low-RAM hosts)
```

- `npm test` is an unimplemented stub (`exit 1`) — there is no test suite.
- No ESLint/Prettier config exists in the repo.
- `npm run cleanup`, `npm run reset-session`, `start:clean`, and `start:fresh` invoke `cleanup.js` / `reset-session.js` at the repo root — **these files do not currently exist** in the tree, so those scripts will fail until they're (re)added.
- `npm run docker:build` is malformed as written (it concatenates a `docker build` and `docker run` invocation into one command) — don't assume it works.
- First run requires WhatsApp auth: scan the terminal QR code, or set a phone number for pairing-code login (see `phoneNumber`/`--pairing-code` in `index.js`). Credentials land in `./session/` (gitignored) via Baileys' `useMultiFileAuthState`; deleting that directory forces re-auth.
- Sticker/video commands shell out to a system `ffmpeg` binary via `fluent-ffmpeg` (no `ffmpeg-static`/`setFfmpegPath` call — `ffmpeg` must already be on `PATH`).

## Architecture

### Startup and message flow

`index.js` is the sole entry point: it opens the Baileys socket (`makeWASocket`), handles QR/pairing-code auth, auto-reconnect, and a memory watchdog (force-restarts the process past 400MB RSS, relying on a host panel/process manager to relaunch it). It then forwards every inbound event to handlers exported by **`main.js`**, which contains essentially all bot logic:

- `handleMessages(sock, messageUpdate)` — regular chat messages
- `handleGroupParticipantUpdate(sock, update)` — join/leave/promote/demote
- `handleStatus(sock, status)` — status/story updates

### Command dispatch (`main.js`)

There is no command registry or plugin loader. `main.js` `require`s every `commands/*.js` module up front and dispatches with one large `switch (true) { case userMessage.startsWith('.xxx'): ... }` inside `handleMessages` (100+ cases). The command prefix (`.`) is hardcoded, not settings-driven.

Things that aren't obvious from any single file:

- **Adding a command touches three places**: the new `commands/<name>.js` module, a `case` in `main.js`'s switch, and a hand-written line in `commands/help.js`'s menu text (the `.help`/`.menu` output is a static template string, not generated from the command list — it will drift from reality if only the switch is updated).
- Admin-only and owner-only commands are gated up front by string-prefix arrays (`adminCommands`, `ownerCommands`) checked *before* the switch, not inside each command's own module — permission logic for a given command may live in `main.js` rather than in `commands/<name>.js`.
- Non-command group messages (no `.` prefix) still trigger moderation/engagement side effects unconditionally: `handleBadwordDetection`, `Antilink`, `handleTagDetection`, `handleMentionDetection`, `handleChatbotResponse`, autotyping/autoread. These are invoked both near the top of `handleMessages` and again in the switch's `default:` case — check both spots when changing group-message behavior.
- Some command modules contain dead exports left over from refactors — e.g. `commands/antilink.js` exports `handleLinkDetection`, which `main.js` imports but never calls; the actual link-filtering path is `lib/antilink.js`'s `Antilink()`. When tracing what really happens for a given feature, follow the `switch` in `main.js` and the event listeners in `index.js` rather than assuming every exported function in a `commands/` file is reachable.

### Shared helpers (`lib/`)

- `lib/isAdmin.js`, `lib/isOwner.js` (`isOwnerOrSudo`), `lib/isBanned.js`, `lib/index.js` (`isSudo` plus most JSON-backed getters/setters) implement permission checks. Expect verbose, defensive JID normalization in each (stripping `:device` suffixes and `@s.whatsapp.net`/`@lid`/`@g.us` domains): WhatsApp identifies the same person by a phone-number JID in some contexts and by an opaque `@lid` "linked ID" in others, so equality checks try several representations before giving up.
- `lib/lightweight_store.js` is a hand-rolled stand-in for Baileys' removed `makeInMemoryStore`. It persists contacts/chats/recent messages to `baileys_store.json` on an interval (`settings.storeWriteInterval`) and caps messages per chat (`settings.maxStoreMessages`) to bound memory/disk growth.
- `lib/myfunc.js` — `smsg()` decorates a raw Baileys message with convenience fields/methods (`.reply()`, `.download()`, `.quoted`, `.sender`, etc.); the rest of the module is generic formatting/HTTP helpers.
- `lib/exif.js`, `lib/sticker.js`, `lib/converter.js` — the ffmpeg + `node-webpmux` image/video → WebP sticker pipeline shared by `.sticker`, `.take`, `.attp`, `.simage`, etc.

### Persistence (`data/*.json`)

No database — plain unsynchronized `fs.readFileSync`/`writeFileSync` on JSON files (no locking). Two patterns coexist:

- **Dedicated file per feature**: `banned.json`, `owner.json`, `premium.json`, `autoStatus.json`, `autoread.json`, `autotyping.json`, `messageCount.json` (also stores the global public/private mode flag as `isPublic`), and `warnings.json` (used only by the manual `.warn`/`.warnings` commands).
- **Namespaced inside `data/userGroupData.json`**: antilink, antibadword, antitag, welcome, goodbye, chatbot config, the sudo-user list, and a *second*, separate warning counter, all accessed through getters/setters in `lib/index.js`. Because of this split, a link posted in a group with antilink's `warn` action and a manual `.warn` from an admin increment two independent counters for the same user rather than sharing state.

### Configuration surfaces

Three top-level files are easy to confuse:

- `settings.js` — bot identity/behavior (owner number, bot name, default command mode, version, store tuning knobs).
- `config.js` — third-party API base URLs/keys (`global.APIs` / `global.APIKeys`), loads `dotenv`.
- `commands/settings.js` — **not configuration**; it's the handler for the `.settings` chat command, which reports current on/off feature states by reading the `data/*.json` files above.

### Other runtime directories

- `session/` — Baileys multi-file auth credentials; deleted and recreated automatically on logout/401.
- `tmp/` / `temp/` — scratch files for media processing; auto-purged on a timer started from `index.js`/`main.js`.
- `assets/` — static images bundled with the bot (README badges, sticker intro images).
