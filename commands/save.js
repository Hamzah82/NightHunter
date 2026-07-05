const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const isOwnerOrSudo = require('../lib/isOwner');

const DATA_PATH = path.join(__dirname, '../data/saved.json');
const MEDIA_DIR = path.join(__dirname, '../data/saved_media');

if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

// Old format nested entries under chatId (data[chatId][key]); the flat
// global format stores entries directly (data[key]). Detect the old shape
// and flatten it in place so notes saved before the global rework survive.
function migrateLegacyFormat(raw) {
    const values = Object.values(raw);
    const looksLegacy = values.length > 0 && values.every(v => v && typeof v === 'object' && !('type' in v));
    if (!looksLegacy) return raw;

    const flat = {};
    for (const chatId of Object.keys(raw)) {
        for (const key of Object.keys(raw[chatId])) {
            const entry = raw[chatId][key];
            entry.chatId = entry.chatId || chatId;
            const existing = flat[key];
            if (existing && existing.timestamp > entry.timestamp) continue;
            flat[key] = entry;
        }
    }
    return flat;
}

function loadSaved() {
    try {
        if (!fs.existsSync(DATA_PATH)) return {};
        const raw = JSON.parse(fs.readFileSync(DATA_PATH));
        const migrated = migrateLegacyFormat(raw);
        if (migrated !== raw) writeSaved(migrated);
        return migrated;
    } catch {
        return {};
    }
}

function writeSaved(data) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

async function downloadMedia(mediaMessage, mediaType, ext) {
    const stream = await downloadContentFromMessage(mediaMessage, mediaType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = path.join(MEDIA_DIR, fileName);
    fs.writeFileSync(filePath, buffer);
    return filePath;
}

async function saveCommand(sock, chatId, message, senderId, titleArg) {
    const title = (titleArg || '').trim();
    if (!title) {
        return sock.sendMessage(chatId, {
            text: '❌ Gunakan: *.save (namaJudul)* sambil reply pesan/media yang ingin disimpan.\nContoh: .save resep ayam'
        }, { quoted: message });
    }

    const contextInfo = message.message?.extendedTextMessage?.contextInfo;
    const quoted = contextInfo?.quotedMessage;
    if (!quoted) {
        return sock.sendMessage(chatId, {
            text: '❌ Reply ke pesan/media yang ingin disimpan dengan *.save (namaJudul)*'
        }, { quoted: message });
    }

    const key = title.toLowerCase();
    const data = loadSaved();

    const existing = data[key];
    if (existing?.mediaPath && fs.existsSync(existing.mediaPath)) {
        try { fs.unlinkSync(existing.mediaPath); } catch {}
    }

    const entry = {
        title,
        savedBy: senderId,
        chatId,
        timestamp: new Date().toISOString()
    };

    try {
        if (quoted.imageMessage) {
            entry.type = 'image';
            entry.content = quoted.imageMessage.caption || '';
            entry.mediaPath = await downloadMedia(quoted.imageMessage, 'image', 'jpg');
        } else if (quoted.videoMessage) {
            entry.type = 'video';
            entry.content = quoted.videoMessage.caption || '';
            entry.mediaPath = await downloadMedia(quoted.videoMessage, 'video', 'mp4');
        } else if (quoted.stickerMessage) {
            entry.type = 'sticker';
            entry.mediaPath = await downloadMedia(quoted.stickerMessage, 'sticker', 'webp');
        } else if (quoted.audioMessage) {
            entry.type = 'audio';
            entry.ptt = !!quoted.audioMessage.ptt;
            entry.mimetype = quoted.audioMessage.mimetype || 'audio/mpeg';
            const ext = entry.mimetype.includes('ogg') ? 'ogg' : 'mp3';
            entry.mediaPath = await downloadMedia(quoted.audioMessage, 'audio', ext);
        } else if (quoted.documentMessage) {
            entry.type = 'document';
            entry.fileName = quoted.documentMessage.fileName || 'file';
            entry.mimetype = quoted.documentMessage.mimetype || 'application/octet-stream';
            const ext = (path.extname(entry.fileName).replace('.', '') || 'bin');
            entry.mediaPath = await downloadMedia(quoted.documentMessage, 'document', ext);
        } else if (quoted.conversation || quoted.extendedTextMessage?.text) {
            entry.type = 'text';
            entry.content = quoted.conversation || quoted.extendedTextMessage.text;
        } else {
            return sock.sendMessage(chatId, {
                text: '❌ Tipe pesan ini belum didukung untuk disimpan.'
            }, { quoted: message });
        }
    } catch (err) {
        console.error('save command error:', err);
        return sock.sendMessage(chatId, { text: '❌ Gagal menyimpan pesan tersebut.' }, { quoted: message });
    }

    data[key] = entry;
    writeSaved(data);

    return sock.sendMessage(chatId, {
        text: `✅ Tersimpan dengan judul *${title}* (bisa dipanggil dari chat manapun)\nGunakan *.get ${title}* untuk menampilkannya.`
    }, { quoted: message });
}

async function getCommand(sock, chatId, message, titleArg) {
    const title = (titleArg || '').trim();
    const data = loadSaved();

    if (!title) {
        const titles = Object.values(data).map(e => e.title);
        if (!titles.length) {
            return sock.sendMessage(chatId, {
                text: '📭 Belum ada catatan yang disimpan.\nGunakan *.save (namaJudul)* sambil reply pesan.'
            }, { quoted: message });
        }
        return sock.sendMessage(chatId, {
            text: `📋 *Daftar Tersimpan:*\n\n${titles.map(t => `• ${t}`).join('\n')}\n\nGunakan *.get (namaJudul)* untuk menampilkan.`
        }, { quoted: message });
    }

    const key = title.toLowerCase();
    const entry = data[key];
    if (!entry) {
        return sock.sendMessage(chatId, {
            text: `❌ Tidak ditemukan judul *${title}*.\nGunakan *.get* tanpa judul untuk melihat daftar.`
        }, { quoted: message });
    }

    try {
        switch (entry.type) {
            case 'text':
                await sock.sendMessage(chatId, { text: entry.content }, { quoted: message });
                break;
            case 'image':
                await sock.sendMessage(chatId, { image: { url: entry.mediaPath }, caption: entry.content || '' }, { quoted: message });
                break;
            case 'video':
                await sock.sendMessage(chatId, { video: { url: entry.mediaPath }, caption: entry.content || '' }, { quoted: message });
                break;
            case 'sticker':
                await sock.sendMessage(chatId, { sticker: { url: entry.mediaPath } }, { quoted: message });
                break;
            case 'audio':
                await sock.sendMessage(chatId, {
                    audio: { url: entry.mediaPath },
                    mimetype: entry.mimetype || 'audio/mpeg',
                    ptt: !!entry.ptt
                }, { quoted: message });
                break;
            case 'document':
                await sock.sendMessage(chatId, {
                    document: { url: entry.mediaPath },
                    fileName: entry.fileName || 'file',
                    mimetype: entry.mimetype
                }, { quoted: message });
                break;
            default:
                await sock.sendMessage(chatId, { text: '❌ Tipe data tersimpan tidak dikenali.' }, { quoted: message });
        }
    } catch (err) {
        console.error('get command error:', err);
        await sock.sendMessage(chatId, {
            text: '❌ Gagal mengambil data (file media mungkin sudah hilang).'
        }, { quoted: message });
    }
}

async function notesCommand(sock, chatId, message, senderId, argText) {
    const arg = (argText || '').trim();
    const [sub, ...rest] = arg.split(/\s+/);
    const subCmd = (sub || '').toLowerCase();

    if (!subCmd || subCmd === 'list') {
        return getCommand(sock, chatId, message, '');
    }

    if (subCmd === 'del' || subCmd === 'delete' || subCmd === 'hapus') {
        const title = rest.join(' ').trim();
        if (!title) {
            return sock.sendMessage(chatId, {
                text: '❌ Gunakan: *.notes del (namaJudul)*'
            }, { quoted: message });
        }

        const key = title.toLowerCase();
        const data = loadSaved();
        const entry = data[key];
        if (!entry) {
            return sock.sendMessage(chatId, {
                text: `❌ Tidak ditemukan judul *${title}*.`
            }, { quoted: message });
        }

        const isOwner = message.key.fromMe || await isOwnerOrSudo(senderId, sock, chatId);
        const isSaver = entry.savedBy === senderId;

        if (!isOwner && !isSaver) {
            return sock.sendMessage(chatId, {
                text: '❌ Hanya yang menyimpan atau owner yang bisa menghapus catatan ini.'
            }, { quoted: message });
        }

        if (entry.mediaPath && fs.existsSync(entry.mediaPath)) {
            try { fs.unlinkSync(entry.mediaPath); } catch {}
        }
        delete data[key];
        writeSaved(data);

        return sock.sendMessage(chatId, {
            text: `🗑️ Catatan *${entry.title}* berhasil dihapus.`
        }, { quoted: message });
    }

    if (subCmd === 'clear') {
        const data = loadSaved();
        const keys = Object.keys(data);
        if (!keys.length) {
            return sock.sendMessage(chatId, { text: '📭 Tidak ada catatan untuk dihapus.' }, { quoted: message });
        }

        for (const key of keys) {
            const entry = data[key];
            if (entry.mediaPath && fs.existsSync(entry.mediaPath)) {
                try { fs.unlinkSync(entry.mediaPath); } catch {}
            }
        }
        writeSaved({});

        return sock.sendMessage(chatId, {
            text: `🗑️ Semua catatan (${keys.length}) berhasil dihapus.`
        }, { quoted: message });
    }

    return sock.sendMessage(chatId, {
        text: '❌ Gunakan:\n*.notes list* - lihat semua catatan\n*.notes del (namaJudul)* - hapus 1 catatan\n*.notes clear* - hapus semua catatan'
    }, { quoted: message });
}

module.exports = { saveCommand, getCommand, notesCommand };
