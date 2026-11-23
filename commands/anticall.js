const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ANTICALL_PATH = path.join(DATA_DIR, 'anticall.json');

// Blokir hanya setelah panggilan ke-3 dalam jendela waktu di bawah.
const MAX_CALLS = 3;
const CALL_WINDOW_MS = 60 * 60 * 1000; // 1 jam
const MAX_TRACKED_CALLERS = 500;

function emptyState() {
    return { enabled: false, reason: '', calls: {} };
}

function sanitizeCalls(calls, now = Date.now()) {
    const out = {};
    if (!calls || typeof calls !== 'object') return out;

    for (const [jid, entry] of Object.entries(calls)) {
        const lastAt = Number(entry && entry.lastAt) || 0;
        const count = Number(entry && entry.count) || 0;
        if (count > 0 && lastAt > 0 && now - lastAt <= CALL_WINDOW_MS) {
            out[jid] = { count, lastAt };
        }
    }
    return out;
}

function readState(statePath = ANTICALL_PATH) {
    try {
        if (!fs.existsSync(statePath)) return emptyState();
        const data = JSON.parse(fs.readFileSync(statePath, 'utf8') || '{}');
        return {
            enabled: !!data.enabled,
            reason: typeof data.reason === 'string' ? data.reason : '',
            calls: sanitizeCalls(data.calls)
        };
    } catch (error) {
        console.error('[anticall] gagal membaca state:', error.message);
        return emptyState();
    }
}

function writeState(state, statePath = ANTICALL_PATH) {
    try {
        const dir = path.dirname(statePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(statePath, JSON.stringify({
            enabled: !!state.enabled,
            reason: String(state.reason || ''),
            calls: state.calls && typeof state.calls === 'object' ? state.calls : {}
        }, null, 2));
        return true;
    } catch (error) {
        console.error('[anticall] gagal menyimpan state:', error.message);
        return false;
    }
}

/**
 * Catat satu panggilan masuk. Hitungan lama otomatis kedaluwarsa setelah
 * CALL_WINDOW_MS agar orang yang menelepon sekali-sekali tidak ikut diblokir.
 */
function registerCall(callerJid, { now = Date.now(), statePath = ANTICALL_PATH } = {}) {
    const state = readState(statePath);
    const calls = sanitizeCalls(state.calls, now);
    const entry = calls[callerJid] || { count: 0, lastAt: 0 };
    const count = entry.count + 1;
    calls[callerJid] = { count, lastAt: now };

    const keys = Object.keys(calls);
    if (keys.length > MAX_TRACKED_CALLERS) {
        keys.sort((a, b) => calls[a].lastAt - calls[b].lastAt);
        for (const jid of keys.slice(0, keys.length - MAX_TRACKED_CALLERS)) {
            delete calls[jid];
        }
    }

    writeState({ ...state, calls }, statePath);
    return count;
}

function resetCall(callerJid, statePath = ANTICALL_PATH) {
    const state = readState(statePath);
    if (state.calls[callerJid]) {
        delete state.calls[callerJid];
        writeState(state, statePath);
    }
}

function buildCallMessage({ reason, count, max = MAX_CALLS, blocked = false }) {
    const alasan = String(reason || '').trim() || 'sedang tidak bisa menerima panggilan';

    if (blocked) {
        return `📵 *Panggilan ditolak*\n\n` +
            `Alasan: ${alasan}\n\n` +
            `Kamu sudah menelepon ${count} kali. Nomor ini diblokir.\n` +
            `Silakan hubungi lewat chat setelah situasi memungkinkan.`;
    }

    return `📵 *Panggilan ditolak*\n\n` +
        `Alasan: ${alasan}\n\n` +
        `Jangan spam telepon. Cukup tinggalkan pesan chat, nanti dibalas.\n` +
        `Peringatan ${count}/${max} — panggilan ke-${max} akan memblokir nomor ini.`;
}

function buildProtectedMessage(reason) {
    const alasan = String(reason || '').trim() || 'sedang tidak bisa menerima panggilan';
    return `📵 *Panggilan ditolak*\n\nAlasan: ${alasan}\n\nSilakan tinggalkan pesan chat.`;
}

async function anticallCommand(sock, chatId, message, args) {
    const raw = String(args || '').trim();
    const [subRaw, ...rest] = raw.split(/\s+/);
    const sub = (subRaw || '').toLowerCase();
    const reason = rest.join(' ').trim();

    if (!sub || !['on', 'off', 'status', 'reset'].includes(sub)) {
        await sock.sendMessage(chatId, {
            text: `*ANTICALL*\n\n` +
                `⚙️ *.anticall on <alasan>* — aktifkan (alasan wajib)\n` +
                `🔕 *.anticall off* — nonaktifkan\n` +
                `📊 *.anticall status* — status & alasan\n` +
                `🧹 *.anticall reset* — hapus riwayat panggilan\n\n` +
                `Panggilan ditolak + pemanggil diberi tahu alasannya.\n` +
                `Nomor baru diblokir setelah ${MAX_CALLS}x panggilan dalam ${Math.round(CALL_WINDOW_MS / 60000)} menit.`
        }, { quoted: message });
        return;
    }

    if (sub === 'status') {
        const state = readState();
        const lines = [`📵 Anticall: *${state.enabled ? 'ON' : 'OFF'}*`];
        if (state.reason) lines.push(`Alasan: ${state.reason}`);
        if (state.enabled) {
            lines.push(`Batas spam: ${MAX_CALLS}x / ${Math.round(CALL_WINDOW_MS / 60000)} menit`);
            lines.push(`Nomor terlacak: ${Object.keys(state.calls).length}`);
        }
        await sock.sendMessage(chatId, { text: lines.join('\n') }, { quoted: message });
        return;
    }

    if (sub === 'reset') {
        const state = readState();
        writeState({ ...state, calls: {} });
        await sock.sendMessage(chatId, { text: '🧹 Riwayat panggilan anticall direset.' }, { quoted: message });
        return;
    }

    if (sub === 'on') {
        if (!reason) {
            await sock.sendMessage(chatId, {
                text: `❌ Alasan wajib diisi.\n\nContoh:\n.anticall on lagi ujian\n.anticall on sedang tidur, tinggalkan pesan`
            }, { quoted: message });
            return;
        }

        writeState({ enabled: true, reason, calls: {} });
        await sock.sendMessage(chatId, {
            text: `✅ Anticall *ON*\n\n` +
                `Alasan: ${reason}\n\n` +
                `Panggilan akan ditolak dan pemanggil menerima pesan alasan ini.\n` +
                `Nomor diblokir hanya jika menelepon ${MAX_CALLS}x dalam ${Math.round(CALL_WINDOW_MS / 60000)} menit.`
        }, { quoted: message });
        return;
    }

    // off
    writeState({ enabled: false, reason: '', calls: {} });
    await sock.sendMessage(chatId, { text: '🔕 Anticall *OFF*.' }, { quoted: message });
}

module.exports = {
    anticallCommand,
    readState,
    writeState,
    registerCall,
    resetCall,
    buildCallMessage,
    buildProtectedMessage,
    MAX_CALLS,
    CALL_WINDOW_MS
};
