const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    createUpdateChecker,
    parseGitHubRepo,
    parseCommitAtom,
    toWhatsAppJid
} = require('../lib/updateChecker');

const OWNER = '22222222222';
const BOT = '11111111111';
const OWNER_JID = `${OWNER}@s.whatsapp.net`;
const BOT_JID = `${BOT}@s.whatsapp.net`;

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const SHA_D = 'd'.repeat(40);

delete process.env.UPDATE_NOTIFY_JID;
delete process.env.GITHUB_TOKEN;

function atomXml(sha, message) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:github.com,2008:Grit::Commit/${sha}</id>
    <link type="text/html" rel="alternate" href="https://github.com/Hamzah82/NightHunter/commit/${sha}"/>
    <title>
        ${message}
    </title>
    <updated>2026-11-17T03:42:20Z</updated>
  </entry>
</feed>`;
}

function makeFetch(getSha) {
    return async (url) => {
        if (url.endsWith('.atom')) {
            return { ok: true, text: async () => atomXml(getSha(), '🔔 fix: notifikasi &amp; tes') };
        }
        if (url.includes('api.github.com')) {
            return { ok: false, status: 403, text: async () => '{"message":"rate limit"}' };
        }
        return { ok: false, status: 404, text: async () => '' };
    };
}

function makeSock() {
    const sock = {
        user: { id: `${BOT}:5@s.whatsapp.net` },
        sent: [],
        failJids: new Set(),
        async sendMessage(jid, payload) {
            if (sock.failJids.has(jid)) throw new Error(`rejected ${jid}`);
            sock.sent.push({ jid, text: payload.text });
        }
    };
    return sock;
}

function makeChecker(rootDir, getSha, overrides = {}) {
    return createUpdateChecker({
        rootDir,
        settings: {
            ownerNumber: OWNER,
            updateZipUrl: 'https://github.com/Hamzah82/NightHunter'
        },
        logger: { log() {}, info() {}, warn() {}, error() {} },
        fetchImpl: makeFetch(getSha),
        execFileImpl: async () => {
            throw new Error('git not available');
        },
        now: () => new Date('2026-11-17T00:00:00Z'),
        ...overrides
    });
}

function readState(rootDir) {
    return JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'updateState.json'), 'utf8'));
}

async function main() {
    // --- Pure helpers -----------------------------------------------------
    assert.strictEqual(
        parseGitHubRepo('git@github.com:Hamzah82/NightHunter.git'),
        'Hamzah82/NightHunter'
    );
    assert.strictEqual(
        parseGitHubRepo('https://github.com/Hamzah82/NightHunter'),
        'Hamzah82/NightHunter'
    );
    assert.strictEqual(toWhatsAppJid('628123:4@s.whatsapp.net'), '628123@s.whatsapp.net');
    assert.strictEqual(toWhatsAppJid('+62 812-345'), '62812345@s.whatsapp.net');
    console.log('PASS helper parsing');

    const parsed = parseCommitAtom(atomXml(SHA_A, 'hello &amp; world'), 'a/b');
    assert.strictEqual(parsed.sha, SHA_A);
    assert.strictEqual(parsed.commit.message, 'hello & world');
    assert.strictEqual(parsed.html_url, `https://github.com/Hamzah82/NightHunter/commit/${SHA_A}`);
    console.log('PASS atom parsing');

    // --- ZIP/panel style (no .git, no state) ------------------------------
    const zipDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-update-zip-'));
    let currentSha = SHA_A;
    const checker = makeChecker(zipDir, () => currentSha);
    const sock = makeSock();

    let result = await checker.run(sock);
    assert.strictEqual(result.status, 'latest-info');
    assert.strictEqual(sock.sent.length, 2);
    assert.deepStrictEqual(
        new Set(sock.sent.map((m) => m.jid)),
        new Set([OWNER_JID, BOT_JID])
    );
    assert.ok(sock.sent[0].text.includes('Commit Terbaru'));
    assert.ok(sock.sent[0].text.includes(SHA_A.slice(0, 7)));

    let state = readState(zipDir);
    assert.strictEqual(state.lastSeenCommit, SHA_A);
    assert.deepStrictEqual(new Set(state.notifiedJids), new Set([OWNER_JID, BOT_JID]));
    console.log('PASS first run on ZIP/panel install notifies latest commit');

    // Same commit again: no duplicate notification.
    result = await checker.run(sock);
    assert.strictEqual(result.status, 'already-notified');
    assert.strictEqual(sock.sent.length, 2);
    console.log('PASS repeated check does not spam');

    // A new commit sends a new notification.
    currentSha = SHA_B;
    result = await checker.run(sock);
    assert.strictEqual(result.status, 'update');
    assert.strictEqual(sock.sent.length, 4);
    assert.ok(sock.sent[2].text.includes('Update Tersedia'));
    assert.ok(sock.sent[2].text.includes(SHA_B.slice(0, 7)));
    state = readState(zipDir);
    assert.strictEqual(state.lastSeenCommit, SHA_B);
    console.log('PASS new commit notifies');

    // --- Partial delivery is retried only for the failed target -----------
    currentSha = SHA_C;
    sock.failJids.add(OWNER_JID);
    await assert.rejects(() => checker.run(sock), /Gagal kirim notifikasi/);
    state = readState(zipDir);
    assert.strictEqual(state.lastSeenCommit, SHA_C);
    assert.deepStrictEqual(state.notifiedJids, [BOT_JID]);

    sock.failJids.delete(OWNER_JID);
    const beforeRetry = sock.sent.length;
    result = await checker.run(sock);
    assert.strictEqual(result.status, 'update');
    assert.strictEqual(sock.sent.length, beforeRetry + 1);
    assert.strictEqual(sock.sent.at(-1).jid, OWNER_JID);
    assert.strictEqual(
        sock.sent.filter((m) => m.jid === OWNER_JID && m.text.includes(SHA_C.slice(0, 7))).length,
        1
    );
    console.log('PASS partial delivery retry (owner only, no duplicate to bot)');

    // --- Probe message ----------------------------------------------------
    const beforeProbe = sock.sent.length;
    result = await checker.run(sock, { probe: true });
    assert.strictEqual(result.status, 'probe');
    assert.strictEqual(sock.sent.length, beforeProbe + 2);
    assert.ok(sock.sent.at(-1).text.includes('Tes Notifikasi'));
    console.log('PASS probe notification');

    // --- Git checkout already up to date ----------------------------------
    const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-update-git-'));
    fs.mkdirSync(path.join(gitDir, '.git'));
    const gitUpToDate = async (cmd, args) => {
        const key = args.join(' ');
        if (key === 'remote get-url origin') {
            return { stdout: 'git@github.com:Hamzah82/NightHunter.git\n' };
        }
        if (key.startsWith('fetch ')) return { stdout: '' };
        if (key === 'rev-parse origin/main') return { stdout: `${SHA_D}\n` };
        if (key === 'rev-parse HEAD') return { stdout: `${SHA_D}\n` };
        throw new Error(`unexpected git call: ${key}`);
    };
    const gitChecker = makeChecker(gitDir, () => SHA_A, { execFileImpl: gitUpToDate });
    const gitSock = makeSock();
    result = await gitChecker.run(gitSock);
    assert.strictEqual(result.status, 'up-to-date');
    assert.strictEqual(gitSock.sent.length, 0);
    console.log('PASS git checkout already up to date is quiet');

    // --- Git checkout ahead of remote (unpushed local commits) ------------
    const aheadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-update-ahead-'));
    fs.mkdirSync(path.join(aheadDir, '.git'));
    const gitAhead = async (cmd, args) => {
        const key = args.join(' ');
        if (key === 'remote get-url origin') {
            return { stdout: 'https://github.com/Hamzah82/NightHunter.git\n' };
        }
        if (key.startsWith('fetch ')) return { stdout: '' };
        if (key === 'rev-parse origin/main') return { stdout: `${SHA_A}\n` };
        if (key === 'rev-parse HEAD') return { stdout: `${SHA_D}\n` };
        if (key === `merge-base --is-ancestor ${SHA_A} HEAD`) return { stdout: '' };
        throw new Error(`unexpected git call: ${key}`);
    };
    const aheadChecker = makeChecker(aheadDir, () => SHA_A, { execFileImpl: gitAhead });
    const aheadSock = makeSock();
    result = await aheadChecker.run(aheadSock);
    assert.strictEqual(result.status, 'up-to-date');
    assert.strictEqual(aheadSock.sent.length, 0);
    console.log('PASS git checkout ahead of remote does not report a false update');

    // --- Git checkout behind remote ---------------------------------------
    const behindDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-update-behind-'));
    fs.mkdirSync(path.join(behindDir, '.git'));
    const gitBehind = async (cmd, args) => {
        const key = args.join(' ');
        if (key === 'remote get-url origin') {
            return { stdout: 'https://github.com/Hamzah82/NightHunter.git\n' };
        }
        if (key.startsWith('fetch ')) return { stdout: '' };
        if (key === 'rev-parse origin/main') return { stdout: `${SHA_B}\n` };
        if (key === 'rev-parse HEAD') return { stdout: `${SHA_A}\n` };
        if (key.startsWith('log ')) return { stdout: 'abc1234 commit from remote\n' };
        throw new Error(`unexpected git call: ${key}`);
    };
    const behindChecker = makeChecker(behindDir, () => SHA_A, { execFileImpl: gitBehind });
    const behindSock = makeSock();
    result = await behindChecker.run(behindSock);
    assert.strictEqual(result.status, 'update');
    assert.strictEqual(behindSock.sent.length, 2);
    assert.ok(behindSock.sent[0].text.includes('abc1234 commit from remote'));
    console.log('PASS git checkout behind remote notifies with git log summary');

    // Cleanup only after all assertions pass.
    for (const dir of [zipDir, gitDir, aheadDir, behindDir]) {
        fs.rmSync(dir, { recursive: true, force: true });
    }

    console.log('\nAll update-checker tests passed.');
}

main().catch((error) => {
    console.error('FAILED:', error);
    process.exit(1);
});
