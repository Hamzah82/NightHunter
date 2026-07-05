# Engineering Notes — Night Hunter (WhatsApp Bot)

> Dokumen ini adalah dokumentasi teknis internal, ditulis untuk sesi Claude (atau engineer) lain yang belum pernah menyentuh repo ini. Tujuannya: begitu baca file ini, langsung paham alur kerja, di mana logic tertentu hidup, dan jebakan/dead-code yang sudah diketahui — supaya tidak perlu re-discover dari nol.
>
> Dokumen ini melengkapi `CLAUDE.md` (ringkasan arsitektur singkat yang otomatis dibaca setiap sesi). `CLAUDE.md` = ringkasan cepat. File ini = detail lengkap + jebakan + cara kerja.

---

## 1. Apa proyek ini

**Night Hunter** (nama lama: *Knight Bot*) adalah bot WhatsApp berbasis `@whiskeysockets/baileys` (library multi-device WhatsApp Web API, bukan API resmi WhatsApp). Karakteristik penting:

- **Plain CommonJS Node.js**, tanpa build step, tanpa bundler, tanpa TypeScript.
- **Tidak ada database.** Semua state disimpan sebagai file JSON flat di `data/*.json`, dibaca/ditulis langsung via `fs.readFileSync`/`writeFileSync` — **tidak ada locking**, jadi race condition antar write teoretis mungkin terjadi tapi dalam praktik jarang masalah karena volume rendah & Node single-threaded per-event-loop-tick.
- **Single process, single entry point**: `index.js`. Tidak ada worker/cluster.
- **Tidak ada test suite** (`npm test` cuma `exit 1`).
- Repo GitHub: `https://github.com/Hamzah82/NightHunter` (di-rename dari `mruniquehacker/Knightbot-MD` dalam sesi sebelumnya — lihat §11).

---

## 2. Menjalankan proyek

```bash
npm install                       # atau: npm install --legacy-peer-deps (untuk hosting panel)
npm start                         # node index.js
npm run start:optimized           # + --max-old-space-size=512 dan flag GC manual (RAM rendah)
```

Yang **tidak berfungsi** (jangan asumsikan ini bekerja):
- `npm run cleanup`, `reset-session`, `start:clean`, `start:fresh` — memanggil `cleanup.js`/`reset-session.js` di root, **file-file ini tidak ada** di tree.
- `npm run docker:build` — string command-nya malformed (menggabungkan `docker build` dan `docker run` jadi satu perintah tidak valid).

Prasyarat sistem:
- Binary `ffmpeg` harus ada di `PATH` (dipanggil via `fluent-ffmpeg`/`child_process.spawn`, tidak ada `ffmpeg-static`).
- Auth pertama kali: scan QR code di terminal, **atau** pairing code. **PENTING (gotcha):** di `index.js` baris ~73, `phoneNumber` di-hardcode `"911234567890"` (string non-kosong), sehingga `pairingCode = !!phoneNumber || ...` **selalu `true`** apa pun argumen CLI-nya, dan `printQRInTerminal: !pairingCode` jadi **selalu `false`**. Artinya jalur "scan QR code" yang disebut di README **tidak akan pernah aktif** kecuali seseorang mengubah `phoneNumber` di `index.js` jadi string kosong terlebih dulu. Ini bukan di `settings.js` — sengaja dicatat karena mudah salah tebak lokasinya.
- Kredensial auth tersimpan di `./session/` (gitignored). Hapus folder ini untuk paksa re-auth.

---

## 3. Peta struktur direktori

```
index.js            # entry point: koneksi Baileys, auth, reconnect, watchdog
main.js              # ~1270 baris: seluruh logic dispatch command ada di sini
settings.js          # identitas bot (nama, owner, versi, dsb) — lihat §9
config.js            # base URL & API key pihak ketiga (global.APIs/APIKeys), load dotenv
commands/*.js        # ~100+ modul, satu file per command (atau grup command sejenis)
lib/*.js             # helper bersama: permission check, JSON "database", sticker/ffmpeg pipeline, dst
data/*.json          # "database" flat-file — lihat §7
session/             # kredensial Baileys (gitignored, auto-dibuat)
tmp/ , temp/         # file sementara untuk pemrosesan media, auto-dibersihkan
assets/              # gambar statis (badge README, sticker intro)
engineering.md        # <- file ini
CLAUDE.md            # ringkasan arsitektur singkat (auto-loaded tiap sesi Claude)
```

---

## 4. Alur startup (`index.js`, ~400 baris)

Urutan eksekusi saat `node index.js` dijalankan:

1. `require('./settings')` lalu core requires (`@hapi/boom`, `fs`, `chalk`, `file-type`, `path`, `axios`).
2. Import `{ handleMessages, handleGroupParticipantUpdate, handleStatus }` dari `./main` — **ini satu-satunya titik kontak** antara `index.js` dan seluruh logic bot di `main.js`.
3. Import primitif Baileys (`makeWASocket`, `useMultiFileAuthState`, `DisconnectReason`, dst).
4. Load `lib/lightweight_store.js` sebagai `store` (pengganti `makeInMemoryStore` yang sudah dihapus dari Baileys versi baru). `store.readFromFile()` dipanggil sekali di awal, lalu `setInterval(() => store.writeToFile(), settings.storeWriteInterval)` menulis ulang secara periodik (default 10 detik).
5. **Memory watchdog** — dua timer independen:
   - Tiap 60 detik: paksa `global.gc()` kalau Node dijalankan dengan `--expose-gc`.
   - Tiap 30 detik: cek `process.memoryUsage().rss`; kalau > 400MB, `process.exit(1)`. **Tidak ada restart internal** — ini mengandalkan process manager eksternal (PM2, panel hosting, systemd) untuk auto-relaunch. Kalau dijalankan `node index.js` polos tanpa supervisor, bot akan mati total dan tidak nyala lagi begitu RAM naik di atas 400MB.
6. `global.botname = "NIGHT HUNTER"`, `global.themeemoji = "•"` — variabel global yang dipakai lagi di banner console saat connect.
7. `data/owner.json` dibaca sekali ke variabel `owner` — **hanya dipakai untuk console.log kosmetik saat connect**, bukan untuk permission check apa pun (lihat §7 & §10 poin dead-code).
8. `startXeonBotInc()` (nama fungsi historis dari fork asal, jangan bingung dengan nama bot) — bagian inti:
   - `fetchLatestBaileysVersion()`, `useMultiFileAuthState('./session')`.
   - `makeWASocket({...})` — opsi penting: `printQRInTerminal: !pairingCode` (lihat gotcha di §2), `msgRetryCounterCache`, `getMessage` di-backing oleh `store.loadMessage` (dibutuhkan Baileys untuk retry pengiriman pesan gagal).
   - `XeonBotInc.ev.on('creds.update', saveCreds)` dan `store.bind(XeonBotInc.ev)`.

### Event listener yang didaftarkan

| Event | Handler | Catatan |
|---|---|---|
| `messages.upsert` (listener #1, ~baris 128) | Unwrap `ephemeralMessage` → route `status@broadcast` ke `handleStatus` → cek mode privat (lihat catatan di bawah) → skip ID buatan Baileys sendiri (`BAE5`, length 16) → clear `msgRetryCounterCache` → panggil `handleMessages(sock, chatUpdate, true)` dibungkus try/catch (fallback: kirim pesan error generik + `contextInfo` newsletter). | Cek `!XeonBotInc.public` di sini **tidak benar-benar efektif** — `XeonBotInc.public` di-set `true` sekali dan tidak pernah disinkron ulang; mode publik/privat yang *sungguhan* dicek di dalam `main.js` lewat `data/messageCount.json`. |
| `messages.upsert` (listener #2, ~baris 360) | Cek ulang `status@broadcast` → `handleStatus`. | **Duplikat** — logic yang sama persis sudah ada di listener #1. Kalau mengubah alur status, ubah di kedua tempat atau konsolidasikan. |
| `status.update`, `messages.reaction` | Keduanya juga panggil `handleStatus`. | Total `handleStatus` terpasang ke **4 titik event** berbeda. |
| `group-participants.update` | `handleGroupParticipantUpdate(sock, update)` | Join/leave/promote/demote. |
| `call` | Anticall logic inline (~baris 320): baca state dari `commands/anticall.js`, kalau enabled → reject call, kirim DM sekali (dedupe pakai in-memory `Set` + `setTimeout` 60 detik), lalu block nomor penelepon setelah 800ms. | Logic anticall aktual (bukan cuma toggle state) ada **di `index.js`**, bukan di `commands/anticall.js` (yang cuma simpan/baca state on/off). |

### Auth flow

- **Pairing code** (jalur yang aktif secara default — lihat gotcha §2): bersihkan nomor dari karakter non-digit → validasi via `awesome-phonenumber` → `setTimeout` 3 detik → `XeonBotInc.requestPairingCode(phoneNumber)` → format kode jadi `XXXX-XXXX`.
- **QR code**: secara teknis ada di kode (`connection.update` log "QR Code generated" + opsi `printQRInTerminal`), tapi **tidak reachable** dengan konfigurasi default karena `pairingCode` selalu truthy.

### Reconnect logic

- `connection.update`: `connecting` → log; `open` → log info user, kirim pesan self "Bot Connected Successfully", print banner ASCII pakai `global.botname`; `close` → hitung `shouldReconnect = statusCode !== DisconnectReason.loggedOut`. Kalau `loggedOut`/`401` → hapus `./session` (paksa re-auth). Kalau `shouldReconnect` → tunggu 5 detik → panggil ulang `startXeonBotInc()` (rekursif).
- Seluruh isi `startXeonBotInc` dibungkus try/catch — error apa pun → tunggu 5 detik → retry (rekursif juga). Jadi ada **dua loop restart bersarang** (outer catch + connection-close handler) yang bisa saling tumpang tindih kalau error terjadi berulang cepat.

### Hal aneh lain di `index.js`

- Baris ~396-401: `fs.watchFile` mengawasi `index.js` sendiri — kalau file berubah, clear require-cache lalu `require(file)` ulang. Ini semacam hot-reload manual era lama; **tidak berguna di production** karena `require()` ulang cuma menjalankan ulang top-level code di process yang sama (bukan mengganti proses berjalan), efeknya malah bisa menumpuk instance kedua bot berjalan bersamaan. Jangan andalkan ini untuk reload — restart proses manual/via panel jauh lebih aman.
- `process.on('uncaughtException')` dan `process.on('unhandledRejection')` hanya `console.error`, tidak exit/restart.

---

## 5. Alur pesan masuk (`main.js` → `handleMessages`)

`main.js` (~1270 baris) adalah **satu-satunya tempat** semua logic command hidup. Tidak ada command registry/plugin loader — semua `commands/*.js` di-`require` di atas file (baris ~28-144, campuran default export `const x = require(...)` dan named export `const { x } = require(...)` tergantung cara masing-masing modul mengekspor), lalu di-dispatch lewat satu `switch (true) { case ...: }` raksasa di dalam `handleMessages`.

### Sebelum require: dua timer duplikat

Baris 1-27 (sebelum require pertama) sudah mendaftarkan `setInterval` untuk membersihkan file `./temp` lebih tua dari 3 jam (redirect `TMPDIR`/`TEMP`/`TMP` env ke `./temp` juga). **`lib/tempCleanup.js` melakukan hal yang nyaris identik** (interval 1 jam, threshold sama 3 jam) — kalau file itu ke-require di suatu tempat, ada dua timer independen yang mengecek folder yang sama. Kalau mau ubah kebijakan cleanup, ubah **kedua tempat**.

### Urutan `handleMessages(sock, messageUpdate, printLog)` step-by-step

1. Guard awal: `type !== 'notify'` atau tidak ada `message.message` → return.
2. `handleAutoread` (auto-read pesan kalau fitur aktif).
3. `storeMessage()` untuk fitur antidelete → kalau `protocolMessage.type === 0` (pesan dihapus pengirim) → `handleMessageRevocation` → return.
4. Hitung `chatId`, `senderId`, `isGroup`, `senderIsSudo` (`isSudo` dari `lib/index.js`), `senderIsOwnerOrSudo` (`isOwnerOrSudo` dari `lib/isOwner.js`).
5. Shortcut tombol interaktif (button response untuk channel/owner/support quick reply).
6. Bangun **dua** representasi teks pesan:
   - `userMessage` — huruf kecil semua, dipakai untuk *matching* command di switch.
   - `rawText` — case asli, dipakai command yang butuh casing asli (`.tag`, `.hidetag`, `.setgdesc`/`.setgname`, `.repack`/`.steal`).
7. Log command usage kalau `userMessage` diawali `.`.
8. Baca `isPublic` dari `data/messageCount.json` — **tidak early-return di sini**, karena moderasi (antilink dkk) tetap harus jalan walau mode privat.
9. **Cek banned**: `isBanned(senderId)` dan bukan `.unban` → (10% kemungkinan) balas "kamu banned" → return.
10. Shortcut permainan Tic-Tac-Toe: input digit tunggal atau `"surrender"` → `handleTicTacToeMove` → return.
11. `incrementMessageCount` untuk statistik `.topmembers` (skip kalau `fromMe`).
12. **Moderasi grup (urutan penting, jalan untuk SEMUA pesan grup, termasuk yang tanpa prefix `.`):**
    - `handleBadwordDetection` (kalau `userMessage` truthy)
    - `Antilink(message, sock)` dari **`lib/antilink.js`** — ini jalur nyata anti-link, **bukan** `commands/antilink.js` (lihat §10 poin dead-code).
13. **PM blocker**: kalau chat privat, bukan `fromMe`, bukan sudo, dan fitur `pmblocker` aktif → kirim pesan, block nomor, return.
14. **Cabang non-command** (pesan tanpa prefix `.`): `handleAutotypingForMessage`, lalu di grup: `handleTagDetection` (antitag) + `handleMentionDetection` **selalu**, dan `handleChatbotResponse` **hanya** kalau `isPublic || isOwnerOrSudoCheck` → return.
15. **Gerbang mode privat**: kalau `!isPublic && !isOwnerOrSudoCheck` → return (command tidak jalan untuk non-owner/sudo saat mode privat).
16. **Array permission** (dicek SEBELUM masuk switch, bukan di dalam masing-masing modul command):
    ```js
    const adminCommands = ['.mute', '.unmute', '.ban', '.unban', '.promote', '.demote', '.kick',
                            '.tagnotadmin', '.antilink', '.antitag', '.setgdesc', '.setgname', '.setgpp'];
    const ownerCommands = ['.mode', '.autostatus', '.antidelete', '.cleartmp', '.setpp', '.clearsession',
                            '.areact', '.autoreact', '.autotyping', '.autoread', '.pmblocker'];
    ```
    **PENTING:** `.tagall` dan `.hidetag` **sengaja tidak lagi ada** di `adminCommands` (diubah dalam sesi ini — lihat §12). Permission untuk keduanya sekarang murni ditangani di dalam `commands/tagall.js`/`commands/hidetag.js` sendiri, bukan lewat gate di sini.
17. **Gating admin** (hanya jalan kalau `isGroup && isAdminCommand`): panggil `isAdmin(sock, chatId, senderId)` dari `lib/isAdmin.js` → kalau bot bukan admin, tolak semua command di `adminCommands`. Untuk subset `.mute/.unmute/.ban/.unban/.promote/.demote` spesifik, tambahan cek `isSenderAdmin || message.key.fromMe`.
18. **Gating owner**: kalau `isOwnerCommand` dan bukan `fromMe`/`senderIsOwnerOrSudo` → tolak.
19. **`switch (true) { case userMessage === '.x': ... }`** — 100+ case. Beberapa command punya cek permission **tambahan** inline di dalam case-nya sendiri (bukan cuma di step 16-18), misalnya `.ban`/`.unban` cek ulang `senderIsSudo` untuk chat privat, `.antilink`/`.antitag` cek ulang `isGroup`/`isBotAdmin`, `.welcome`/`.goodbye` cek admin status inline padahal keduanya **tidak** ada di `adminCommands`. **Kesimpulan penting**: jangan asumsikan permission sebuah command hanya ditentukan oleh dua array di step 16 — selalu cek juga isi case-nya di switch dan isi modul `commands/<nama>.js`-nya.
20. **`default:`** case: untuk pesan grup yang diawali `.` tapi tidak cocok case manapun → jalankan ulang `handleChatbotResponse`, `handleTagDetection`, `handleMentionDetection` (trio yang sama seperti step 14). Ini **tidak** dobel-eksekusi untuk pesan yang sama (step 14 hanya untuk pesan tanpa `.`, `default:` hanya untuk pesan ber-`.` yang tak dikenali) — tapi logic-nya tetap duplikat secara verbatim di source. Kalau mengubah trio moderasi ini, **ubah di kedua tempat**.
21. Setelah switch: `showTypingAfterCommand` jalan kalau `commandExecuted !== false`. **Banyak case tidak set `commandExecuted = true`** (defaultnya `false`) — jadi indikator "sedang mengetik" setelah command muncul secara tidak konsisten antar command. Jangan heran kalau menambah command baru dan lupa set flag ini, perilakunya tetap fungsional (cuma UX indikator ngetik yang beda).
22. `addCommandReaction` dipanggil di akhir untuk semua pesan ber-prefix `.` (reaksi ⏳ otomatis kalau fitur `.areact` aktif).
23. Seluruh `handleMessages` dibungkus try/catch terluar → fallback "Failed to process command".

### `handleGroupParticipantUpdate(sock, update)`

Guard non-grup → baca ulang `isPublic` (baca independen, tidak reuse dari `handleMessages`) → `promote`/`demote` (hanya diumumkan kalau `isPublic`) → `handlePromotionEvent`/`handleDemotionEvent`; `add`/`remove` (selalu diumumkan) → `handleJoinEvent`/`handleLeaveEvent`.

### Export `main.js`

```js
module.exports = {
  handleMessages,
  handleGroupParticipantUpdate,
  handleStatus: async (sock, status) => await handleStatusUpdate(sock, status) // wrapper tipis ke commands/autostatus.js
};
```

---

## 6. Cara menambah command baru (checklist wajib)

Menambah command **selalu** menyentuh 3 tempat (tidak ada auto-registration):

1. **`commands/<nama>.js`** — modul baru, export function handler.
2. **`main.js`**:
   - Tambah `require('./commands/<nama>')` di block require atas.
   - Tambah `case userMessage === '.xxx':` atau `case userMessage.startsWith('.xxx'):` di dalam switch `handleMessages`.
   - Kalau command butuh gating admin/owner, tambahkan prefix-nya ke `adminCommands`/`ownerCommands` array (step 16 di §5) **ATAU** implementasikan cek permission di dalam modul command itu sendiri (pola yang dipakai `.tagall`/`.hidetag` sekarang) — pilih salah satu, jangan campur dua-duanya tanpa alasan jelas supaya tidak membingungkan di kemudian hari.
3. **`commands/help.js`** — tambahkan baris baru di *static template string* menu `.help`/`.menu`. **Ini bukan generated dari command list** — kalau lupa update di sini, command baru jalan tapi tidak muncul di `.help`.

Prefix command **hardcoded** `.` — bukan settings-driven, tidak bisa diubah dari `settings.js`.

---

## 7. Lapisan persistensi (`data/*.json`)

| File | Bentuk | Dipakai oleh | Catatan |
|---|---|---|---|
| `banned.json` | `["<jid>", ...]` | `lib/isBanned.js` | Array flat. |
| `owner.json` | `["<jid>", ...]` | `index.js` (baca sekali) | **Hanya untuk console.log kosmetik saat connect.** Bukan permission check — owner asli dari `settings.ownerNumber` (`lib/isOwner.js`). |
| `premium.json` | `["<jid>", ...]` | **Tidak ada** (grep seluruh repo = 0 match) | **Dead file.** Tidak ada fitur premium yang diimplementasikan. Kemungkinan sisa copy-paste dari fork upstream. |
| `messageCount.json` | `{ isPublic: bool, messageCount: {}, "<chatJid>": { "<userJid>": count } }` | Dibaca/ditulis di banyak tempat di `main.js` | **File dwifungsi**: `isPublic` = flag mode publik/privat global (dicek/di-set lewat `.mode`), sementara key lain (per-JID grup) = counter pesan untuk `.topmembers`. `messageCount: {}` di level atas tampak jadi sisa/tidak terpakai. |
| `autoStatus.json`, `autoread.json`, `autotyping.json`, `antidelete.json` | `{ "enabled": bool, ... }` | Modul `commands/` masing-masing | Toggle global sederhana. |
| `warnings.json` | `{ "<groupJid>": { "<userJid>": count } }` | `commands/warn.js` (`.warn`/`.warnings`) | Counter manual saja. |
| `userGroupData.json` | `{ users, groups, antilink: {<gid>:{enabled,action}}, antibadword: {}, warnings: {<gid>:{<uid>:count}}, sudo: [...], welcome: {<gid>:{...}}, goodbye: {...}, chatbot: {}, autoReaction: bool }` | Semua CRUD lewat `lib/index.js` | Store namespaced untuk banyak fitur. **`warnings` di sini adalah counter KEDUA yang terpisah dari `warnings.json`** — auto-moderasi (antilink/antibadword) increment di sini lewat `incrementWarningCount`, sementara `.warn` manual increment di `warnings.json`. **Keduanya TIDAK saling akumulasi** — 3x kena antilink + 2x `.warn` manual tidak akan mencapai threshold kick manapun karena dihitung terpisah. |

File yang **belum ada** di tree tapi dibuat otomatis saat command terkait pertama kali dipakai: `data/pmblocker.json`, `data/anticall.json`.

---

## 8. Referensi cepat `lib/*.js`

| File | Isi / fungsi utama |
|---|---|
| `lib/isAdmin.js` | `isAdmin(sock, chatId, senderId)` → `{isSenderAdmin, isBotAdmin}`. Normalisasi JID/LID berlapis (strip `:device`, coba beberapa representasi domain) karena WhatsApp bisa identifikasi orang yang sama lewat JID nomor di satu konteks dan `@lid` di konteks lain. |
| `lib/isOwner.js` | `isOwnerOrSudo(senderId, sock, chatId)` — cek `settings.ownerNumber` dulu, lalu LID bot sendiri (kalau owner pakai akun yang sama dengan bot), fallback ke `isSudo`. |
| `lib/isBanned.js` | `isBanned(userId)` — baca sync `data/banned.json`. |
| `lib/index.js` (~460 baris) | "Database" JSON untuk `data/userGroupData.json`: get/set/remove antilink, antitag, antibadword; counter warning; CRUD sudo list (`isSudo`, `addSudo`, `removeSudo`, `getSudoList`); CRUD welcome/goodbye; CRUD config chatbot. |
| `lib/antilink.js` | Export `{ Antilink }` — **logic anti-link yang benar-benar jalan**, dipanggil unconditional di `main.js` untuk tiap pesan grup. |
| `lib/antilinkHelper.js` | **Dead module** — `setAntilinkSetting`/`getAntilinkSetting` untuk file `data/antilinkSettings.json` yang **tidak pernah ada**. Satu-satunya pemanggil (`commands/antilink.js::handleLinkDetection`) juga tidak pernah dipanggil dan malah broken (lihat §10). |
| `lib/antibadword.js` | `handleAntiBadwordCommand` (toggle/set) + `handleBadwordDetection` (deteksi + hapus pesan + warn/kick/delete sesuai config grup). |
| `lib/lightweight_store.js` | Pengganti `makeInMemoryStore` Baileys (sudah dihapus dari versi terbaru). Persist contacts/chats/pesan ke `baileys_store.json`, dibatasi `settings.maxStoreMessages` per chat. |
| `lib/myfunc.js` | `smsg()` (dekorasi pesan mentah Baileys: `.reply()`, `.quoted`, `.download()`, dst), `getBuffer`, `isUrl`, `parseMention`, `getGroupAdmins`, formatter tanggal. Juga self-reload via `fs.watchFile` (pola sama seperti di `index.js`, sama-sama nyaris tak berguna di production). |
| `lib/myfunc2.js` | HTTP/upload helper yang **tumpang tindih** dengan `lib/uploader.js` (`fetchBuffer`, `fetchJson`, `TelegraPh`, `webp2mp4File`). Ada referensi path `./XeonMedia/...` yang tidak ada — kemungkinan fungsi terkait itu dead/broken. |
| `lib/uploader.js` | `TelegraPh`, `UploadFileUgu`, `webp2mp4File`, `floNime` — helper upload lain, sebagian duplikat `myfunc2.js`. |
| `lib/uploadImage.js` | `uploadImage(buffer)` — upload ke qu.ax, fallback ke telegra.ph. |
| `lib/exif.js`, `lib/sticker.js`, `lib/converter.js` | Pipeline ffmpeg + `node-webpmux` untuk sticker/video, dipakai `.sticker`, `.take` (view-once/status — lihat §12), `.attp`, `.simage`, `.repack`, dst. **`lib/sticker.js` punya beberapa implementasi alternatif (`sticker2`...`sticker6`) yang sebagian dead/broken** (`sticker2` referensi `conn`/`module.exports.support` yang belum di-assign; `sticker5` dynamic-import `wa-sticker-formatter` yang tidak ada di `package.json`). |
| `lib/tempCleanup.js` | `cleanupTempFiles()` — hapus file `./temp` lebih tua 3 jam, jalan saat load + tiap 1 jam. **Duplikat** logic yang sudah ada inline di awal `main.js` (lihat §5). |
| `lib/tictactoe.js` | Class `TicTacToe`, deteksi menang berbasis bitboard. |
| `lib/reactions.js` | `addCommandReaction` (auto-react ⏳) + `handleAreactCommand` (`.areact`/`.autoreact` toggle). State di `userGroupData.json` key `autoReaction`. |
| `lib/messageConfig.js` | Export satu object `channelInfo` (context newsletter forwarding) — **duplikat verbatim** dengan const lokal bernama sama di `main.js` dan objek inline di `index.js`. `main.js` tidak reuse export ini, punya copy sendiri. |
| `lib/welcome.js` | `handleWelcome`/`handleGoodbye` (command on/off/set) — **kemungkinan superseded/dead**: `main.js` ambil fungsi welcome/goodbye dari `commands/welcome.js`/`commands/goodbye.js`, bukan dari sini. Jangan bingung keduanya kalau sedang debug fitur welcome/goodbye — cek dulu `main.js` require mana yang benar-benar dipakai. |
| `lib/ytdl2.js` | `YTDownloader` (singleton class) — search/download YouTube (mp3/mp4) pakai `@distube/ytdl-core` (⚠️ **tidak ada di `package.json`** — hanya transitive dependency) + `node-youtube-music`. **Ada dua definisi `mp3`** (static class field vs instance method) — karena yang diekspor adalah instance singleton, method instance yang menang; versi static field (lebih lengkap, dukung tag) jadi unreachable lewat pemakaian normal. |

---

## 9. Konfigurasi — 3 file yang gampang tertukar

| File | Isi | Contoh isi saat ini |
|---|---|---|
| `settings.js` | Identitas bot & behavior default | `packname`, `botName: "Night Hunter"`, `botOwner: 'Hoznyx'`, `ownerNumber`, `giphyApiKey` (hardcoded), `commandMode: "public"` (**dead, tidak pernah dibaca** — mode publik/privat asli dari `data/messageCount.json.isPublic` via `.mode`), `maxStoreMessages`, `storeWriteInterval`, `version`, `updateZipUrl` (dipakai `.update`, sekarang mengarah ke `github.com/Hamzah82/NightHunter`). |
| `config.js` | Base URL & API key pihak ketiga | `dotenv` di-load; `global.APIs` (xteam/dzx/lol/violetics/neoxr/zenzapis/akuari/dst); `global.APIKeys` (beberapa hardcoded, dua di antaranya literal `'yourkey'` placeholder yang harus diisi manual); export `WARN_COUNT: 3` — **catatan:** `lib/antibadword.js` punya angka `3` hardcoded terpisah untuk threshold kick, tidak mereferensikan `WARN_COUNT` ini, jadi ubah salah satu tidak otomatis ubah yang lain. |
| `commands/settings.js` | **Bukan file konfigurasi** — ini handler untuk chat command `.settings`, yang melaporkan status on/off fitur dengan membaca `data/*.json`. | — |

---

## 10. Dead code & jebakan yang sudah diketahui (baca sebelum debug!)

Supaya sesi berikutnya tidak buang waktu re-discover:

1. **`commands/antilink.js::handleLinkDetection` tidak pernah dipanggil** — di-`require` di `main.js` tapi tak ada call site. Jalur anti-link yang beneran jalan: `lib/antilink.js::Antilink()`, dipanggil unconditional per pesan grup di `main.js`. **Lebih parah:** kalau `handleLinkDetection` sampai dipanggil, dia akan **crash** (`ReferenceError: getAntilinkSetting is not defined`) karena fungsi itu tidak di-import di file tersebut — fungsi aslinya ada di modul lain (`lib/antilinkHelper.js`), yang juga dead karena file `data/antilinkSettings.json` yang dia baca/tulis tidak pernah ada.
2. `commands/antilink.js` baris 1: `const { bots } = require('../lib/antilink')` — tapi `lib/antilink.js` cuma export `{ Antilink }`. `bots` selalu `undefined`, tidak dipakai lagi di file itu → inert, tidak crash, tapi membingungkan kalau dibaca sekilas.
3. `commands/antilink.js` dan `commands/antitag.js` require `lib/isAdmin` tapi tidak pernah pakai identifier-nya — nilai `isSenderAdmin`/`isBotAdmin` datang sebagai parameter dari `main.js`, bukan dihitung ulang di modul.
4. `data/premium.json` **fully dead** — tidak ada fitur premium di seluruh repo.
5. `data/owner.json` **hampir dead** — cuma dipakai console.log kosmetik di `index.js`.
6. Logic cleanup temp file **duplikat 2x** (`main.js` inline vs `lib/tempCleanup.js`).
7. Object `channelInfo` (context newsletter) **duplikat 3x** (`main.js`, `index.js` inline, `lib/messageConfig.js` export yang tidak dipakai `main.js`).
8. **Dua counter warning independen** untuk konsep yang sama — `data/warnings.json` (manual `.warn`) vs `userGroupData.json.warnings` (auto-moderasi antilink/antibadword). Tidak saling akumulasi.
9. `lib/welcome.js` vs `commands/welcome.js`/`commands/goodbye.js` — `main.js` pakai yang di `commands/`, `lib/welcome.js` tampak superseded.
10. `lib/ytdl2.js` — `mp3` didefinisikan dua kali (static field vs instance method), versi static tidak ter-reach lewat singleton yang di-export.
11. `settings.js`'s `commandMode` — dead, tidak pernah dibaca.
12. Script `npm run cleanup/reset-session/start:clean/start:fresh` — referensi file yang tidak ada, akan gagal.
13. `npm run docker:build` — command string malformed.
14. Dua fork `ytdl-core` dipakai bersamaan: `ytdl-core` (di `package.json` & `main.js`) dan `@distube/ytdl-core` (di `lib/ytdl2.js`, **tidak** ada di `package.json`).
15. Pairing-code hardcoded selalu aktif di `index.js` (lihat §2/§4) — jalur QR code di README tidak reachable dengan kode default.
16. `commandExecuted` flag di `main.js` tidak konsisten di-set `true` di semua case switch — cuma memengaruhi indikator "sedang mengetik" pasca-command, bukan fungsionalitas command itu sendiri.

---

## 11. Riwayat perubahan penting (konteks project, bukan bagian dari kode)

Beberapa perubahan besar yang sudah dilakukan lewat sesi Claude sebelumnya (dicatat di sini supaya sesi berikutnya tidak bingung kenapa nama-nama tertentu terlihat "baru diganti"):

- **Rebrand nama bot**: *Knight Bot* / *KnightBot* → **Night Hunter**, di seluruh `settings.js`, `commands/*.js`, `lib/*.js`, `index.js`, `main.js`, `README.md`. Package npm: `knightbot` → `nighthunter`.
- **Rebrand nama pembuat**: *Professor* / *Mr Unique Hacker* → **Hoznyx** (`settings.js botOwner`, copyright header di beberapa `lib/*.js`, console banner di `index.js`, `commands/help.js`, `commands/github.js`).
- **URL GitHub**: `github.com/mruniquehacker/Knightbot-MD` → `github.com/Hamzah82/NightHunter` (dipakai di `settings.js updateZipUrl`, `commands/github.js`, `lib/exif.js` sticker-pack-id, `README.md`). **Catatan**: link YouTube (`youtube.com/@mr_unique_hacker`) dan BuyMeACoffee (`buymeacoffee.com/mruniquehacker`) di `README.md` **sengaja tidak diubah** (masih mengarah ke akun pembuat asli, atas permintaan eksplisit saat itu).
- **`.tagall` & `.hidetag` — permission diubah**: sebelumnya wajib bot admin + sender admin (dicek 2 lapis: `main.js` blok `adminCommands` generik + cek internal di `commands/tagall.js`/`commands/hidetag.js`). Sekarang:
  - Dihapus dari `adminCommands` array di `main.js` (tidak lagi kena blok "bot harus admin" generik).
  - Requirement `isBotAdmin` dihapus total dari `commands/tagall.js` & `commands/hidetag.js` (mengirim mention tidak butuh bot jadi admin secara teknis).
  - Sender check diubah dari "harus admin" menjadi **"admin ATAU `message.key.fromMe`"** (bot owner yang menjalankan dari device sendiri selalu bisa pakai, meniru pola yang sudah dipakai `.mute`/`.ban`/dkk).
- **Command baru `.clonegb`** (`commands/clonegb.js`): membuat grup baru yang meniru grup tempat command dijalankan — nama, deskripsi, foto profil, dan member yang sama. Detail teknis:
  - **Owner/sudo only** — ditambahkan ke array `ownerCommands` di `main.js` (bukan `adminCommands`), jadi digating oleh cek `fromMe || senderIsOwnerOrSudo` di step 18 §5. Tidak butuh bot jadi admin di grup asal (cuma perlu bisa baca metadata + bikin grup baru).
  - **Hanya pakai API Baileys normal** — `groupCreate` (bot otomatis jadi creator+admin grup baru), `groupUpdateDescription`, `updateProfilePicture`, `groupParticipantsUpdate(...,'add')`, `groupInviteCode`. Tidak ada exploit/celah — murni copy metadata lewat jalur resmi.
  - **Member yang gagal ditambahkan tidak dipaksa**: `groupParticipantsUpdate` mengembalikan status per-participant; hanya `'200'` yang dihitung sukses. Member dengan privacy "who can add me to groups" dibatasi atau nomor yang tidak di WhatsApp akan masuk hitungan `failed` dan dilaporkan, bukan di-bypass.
  - **Foto profil**: di-download dulu ke `tmp/` via `axios` (arraybuffer) lalu `updateProfilePicture({ url: <path lokal> })` — meniru pola `commands/groupmanage.js` (lebih andal daripada passing URL remote langsung). File tmp dihapus di `finally`.
  - **JID bot di-exclude** dari daftar member yang ditambahkan (bot sudah jadi creator) lewat helper `baseNumber()` yang menormalkan JID (strip `:device` & domain) — karena `sock.user.id` bisa bawa suffix device/`@lid`.
  - ⚠️ **Belum di-test end-to-end ke WhatsApp asli** dalam sesi ini (tidak ada akses WA real). Titik yang paling perlu diverifikasi kalau ada laporan bug: (a) format `meta.desc` di versi Baileys terpasang, (b) perilaku `groupParticipantsUpdate('add')` untuk member yang butuh invite (status non-200), (c) apakah `updateProfilePicture` menerima path lokal untuk grup yang baru dibuat.
- **`.vv` → `.take`, dan `.take` lama → `.repack`**: command `.vv` (ambil media view-once) di-rename jadi `.take`, sekaligus fungsinya diperluas untuk bisa ambil **WhatsApp Status** (reply ke status yang di-forward — dideteksi lewat `contextInfo.remoteJid === 'status@broadcast'` — baik foto, video, maupun teks). Karena nama `.take` sebelumnya sudah dipakai untuk fitur "ganti nama pack stiker" (reply ke stiker + `.take <namapack>`), fitur itu dipindah ke command baru **`.repack`** (`commands/repack.js`), alias `.steal` tetap menunjuk ke fitur yang sama seperti sebelumnya. File `commands/viewonce.js` (implementasi lama `.vv`) **dihapus**, logic-nya digabung ke `commands/take.js`.
  - ⚠️ Deteksi status-reply (`contextInfo.remoteJid === 'status@broadcast'`) adalah pola umum di banyak bot WhatsApp berbasis Baileys, tapi **belum di-test langsung ke WhatsApp asli** dalam sesi implementasinya — kalau ada laporan `.take` tidak mendeteksi status dengan benar, ini titik pertama yang perlu diverifikasi.

---

## 12. Cara verifikasi manual (karena tidak ada test suite)

Tidak ada unit test, jadi verifikasi harus manual:

1. `node --check <file>` untuk tiap file yang diubah — cek syntax error minimal.
2. `node -e "require('./settings.js')"` / `require('./main.js')` dst untuk memastikan module ter-load tanpa throw di top-level.
3. Untuk perubahan yang menyentuh alur pesan sungguhan (permission, dispatch command baru, format pesan), **jalankan bot beneran** (`npm start`), scan/pairing dengan nomor uji, lalu trigger command dari WhatsApp asli — terutama untuk apa pun yang melibatkan `contextInfo`/`quotedMessage` (bentuk payload Baileys untuk reply-ke-status, reply-ke-view-once, dll seringkali tidak terduga dan beda-beda tergantung versi client WhatsApp pengirim).
4. Kalau tidak bisa akses WhatsApp real untuk testing, **katakan secara eksplisit ke user** bahwa perubahan belum diverifikasi end-to-end — jangan klaim "sudah berfungsi" hanya berdasarkan syntax check.
