const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    registerCall,
    resetCall,
    readState,
    writeState,
    buildCallMessage,
    buildProtectedMessage,
    MAX_CALLS,
    CALL_WINDOW_MS
} = require('../commands/anticall');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-anticall-'));
const statePath = path.join(dir, 'anticall.json');
const jid = '628111222333@s.whatsapp.net';
const t0 = Date.now();

// Tiga panggilan berturut-turut menaikkan hitungan 1 -> 2 -> 3.
assert.strictEqual(registerCall(jid, { now: t0, statePath }), 1);
assert.strictEqual(registerCall(jid, { now: t0 + 1000, statePath }), 2);
assert.strictEqual(registerCall(jid, { now: t0 + 2000, statePath }), MAX_CALLS);

let state = readState(statePath);
assert.strictEqual(state.calls[jid].count, MAX_CALLS);
console.log('PASS hitungan spam 1 -> 3');

// Setelah jendela waktu lewat, hitungan kembali ke 1 (tidak langsung blokir).
assert.strictEqual(registerCall(jid, { now: t0 + 2000 + CALL_WINDOW_MS + 1000, statePath }), 1);
console.log('PASS hitungan kedaluwarsa setelah jendela waktu');

// Reset manual menghapus riwayat nomor.
resetCall(jid, statePath);
state = readState(statePath);
assert.strictEqual(state.calls[jid], undefined);
console.log('PASS reset riwayat panggilan');

// Pesan peringatan memuat alasan, counter, dan larangan spam.
const warn = buildCallMessage({ reason: 'lagi ujian', count: 2, max: MAX_CALLS });
assert.ok(warn.includes('lagi ujian'));
assert.ok(warn.includes('2/3'));
assert.ok(warn.includes('Jangan spam telepon'));
assert.ok(warn.includes('memblokir'));
console.log('PASS pesan peringatan');

// Pesan terakhir saat nomor diblokir.
const blocked = buildCallMessage({ reason: 'lagi ujian', count: MAX_CALLS, max: MAX_CALLS, blocked: true });
assert.ok(blocked.includes('diblokir'));
assert.ok(blocked.includes('3 kali'));
console.log('PASS pesan blokir');

// Nomor owner/bot memakai pesan tanpa ancaman blokir.
const protectedMsg = buildProtectedMessage('lagi ujian');
assert.ok(protectedMsg.includes('lagi ujian'));
assert.ok(!protectedMsg.includes('diblokir'));
console.log('PASS pesan untuk nomor terlindungi');

// Reason tersimpan dan terbaca kembali.
writeState({ enabled: true, reason: 'lagi ujian', calls: {} }, statePath);
state = readState(statePath);
assert.strictEqual(state.enabled, true);
assert.strictEqual(state.reason, 'lagi ujian');
console.log('PASS state enabled + reason');

// Alasan kosong tidak boleh mengaktifkan anticall (dicek di level command).
assert.ok(buildCallMessage({ reason: '', count: 1 }).includes('sedang tidak bisa menerima panggilan'));
console.log('PASS fallback alasan default');

fs.rmSync(dir, { recursive: true, force: true });
console.log('\nAll anticall tests passed.');
