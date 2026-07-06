const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '../data/takeCache.json');
const MEDIA_DIR = path.join(__dirname, '../data/take_media');
const MAX_PER_SENDER = 5;
const ORPHAN_SWEEP_INTERVAL = 30 * 60 * 1000;

if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

function loadCache() {
    try {
        if (!fs.existsSync(DATA_PATH)) return [];
        return JSON.parse(fs.readFileSync(DATA_PATH));
    } catch {
        return [];
    }
}

function writeCache(records) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(records, null, 2));
}

function capture({ kind, mediaType, senderJid, chatId, buffer, ext, caption, text }) {
    const records = loadCache();

    let filePath = null;
    if (buffer) {
        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        filePath = path.join(MEDIA_DIR, fileName);
        fs.writeFileSync(filePath, buffer);
    }

    const record = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind,
        mediaType,
        senderJid,
        chatId,
        filePath,
        caption: caption || '',
        text: text || '',
        timestamp: Date.now()
    };

    records.push(record);

    const senderRecords = records
        .filter(r => r.senderJid === senderJid)
        .sort((a, b) => a.timestamp - b.timestamp);

    while (senderRecords.length > MAX_PER_SENDER) {
        const oldest = senderRecords.shift();
        const idx = records.findIndex(r => r.id === oldest.id);
        if (idx !== -1) records.splice(idx, 1);
        if (oldest.filePath && fs.existsSync(oldest.filePath)) {
            try { fs.unlinkSync(oldest.filePath); } catch {}
        }
    }

    writeCache(records);
    return record;
}

function getLatestBySender(senderJid, kind) {
    const records = loadCache().filter(r => r.senderJid === senderJid && r.kind === kind);
    if (!records.length) return null;
    return records.reduce((latest, r) => (r.timestamp > latest.timestamp ? r : latest));
}

// Captures store senderJid exactly as Baileys delivered it, which for many
// contacts is their opaque @lid identity rather than the @s.whatsapp.net
// phone JID the owner types into `.take vo/status <nomor>` — same JID/LID
// duality documented for isAdmin/isOwner/blocklist elsewhere in this repo.
// Resolve both directions via Baileys' LID<->PN mapping store before matching.
async function getLatestBySenderResolved(sock, phoneJid, kind) {
    const records = loadCache().filter(r => r.kind === kind);
    if (!records.length) return null;

    const phoneDigits = phoneJid.split('@')[0].split(':')[0];
    const candidateJids = new Set([phoneJid]);

    try {
        if (sock.signalRepository?.lidMapping?.getLIDForPN) {
            const lid = await sock.signalRepository.lidMapping.getLIDForPN(phoneJid);
            if (lid) candidateJids.add(lid);
        }
    } catch (err) {
        console.error('getLatestBySenderResolved forward LID lookup error:', err.message);
    }

    const lidSenders = [...new Set(records.filter(r => r.senderJid.endsWith('@lid')).map(r => r.senderJid))];
    if (lidSenders.length && sock.signalRepository?.lidMapping?.getPNsForLIDs) {
        try {
            const pairs = await sock.signalRepository.lidMapping.getPNsForLIDs(lidSenders);
            for (const { lid, pn } of pairs || []) {
                if (pn.split('@')[0].split(':')[0] === phoneDigits) candidateJids.add(lid);
            }
        } catch (err) {
            console.error('getLatestBySenderResolved reverse LID lookup error:', err.message);
        }
    }

    const matches = records.filter(r => candidateJids.has(r.senderJid));
    if (!matches.length) return null;
    return matches.reduce((latest, r) => (r.timestamp > latest.timestamp ? r : latest));
}

function getLatestByChat(chatId, kind) {
    const records = loadCache().filter(r => r.chatId === chatId && r.kind === kind);
    if (!records.length) return null;
    return records.reduce((latest, r) => (r.timestamp > latest.timestamp ? r : latest));
}

function sweepOrphans() {
    try {
        const records = loadCache();
        const referenced = new Set(records.map(r => r.filePath).filter(Boolean));
        const files = fs.readdirSync(MEDIA_DIR);
        for (const file of files) {
            const fullPath = path.join(MEDIA_DIR, file);
            if (!referenced.has(fullPath)) {
                try { fs.unlinkSync(fullPath); } catch {}
            }
        }
    } catch (err) {
        console.error('takeCache sweepOrphans error:', err.message);
    }
}

setInterval(sweepOrphans, ORPHAN_SWEEP_INTERVAL);

module.exports = { capture, getLatestBySender, getLatestBySenderResolved, getLatestByChat };
