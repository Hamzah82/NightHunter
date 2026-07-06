// Blocklist entries can be @lid JIDs; unblocking needs the exact stored JID
// (converting the bare digits to @s.whatsapp.net fails with "Unable to
// resolve LID for PN JID" when the entry was blocked under its LID), so
// match the typed digits against the live blocklist first.
async function resolveBlockedJid(sock, input) {
    const digits = (input || '').replace(/[^0-9]/g, '');
    if (!digits) return null;
    try {
        const blocked = await sock.fetchBlocklist() || [];
        const match = blocked.find(jid => jid.split('@')[0].split(':')[0] === digits);
        if (match) return match;
    } catch (err) {
        console.error('resolveBlockedJid fetch error:', err);
    }
    return `${digits}@s.whatsapp.net`;
}

// @lid entries show an opaque "linked ID" (not the phone number) unless we
// look up the real PN through Baileys' LID<->PN mapping store - without this
// the blocklist shows unrecognizable numbers for anyone blocked/known via @lid.
async function describeBlockedJids(sock, blocked) {
    const lidJids = blocked.filter(jid => jid.endsWith('@lid'));
    const pnByLid = new Map();
    if (lidJids.length && sock.signalRepository?.lidMapping) {
        try {
            const pairs = await sock.signalRepository.lidMapping.getPNsForLIDs(lidJids);
            for (const { lid, pn } of pairs || []) {
                pnByLid.set(lid, pn.split('@')[0].split(':')[0]);
            }
        } catch (err) {
            console.error('describeBlockedJids LID lookup error:', err);
        }
    }
    return blocked.map(jid => {
        const digits = jid.split('@')[0].split(':')[0];
        if (jid.endsWith('@lid')) {
            const resolvedPn = pnByLid.get(jid);
            return resolvedPn ? resolvedPn : `${digits} (LID, nomor asli tidak diketahui)`;
        }
        return digits;
    });
}

async function blocklistCommand(sock, chatId, message) {
    try {
        const blocked = await sock.fetchBlocklist();
        if (!blocked || !blocked.length) {
            return sock.sendMessage(chatId, { text: '✅ Tidak ada nomor yang diblokir bot.' }, { quoted: message });
        }
        const descriptions = await describeBlockedJids(sock, blocked);
        const list = descriptions.map((desc, i) => `${i + 1}. ${desc}`).join('\n');
        return sock.sendMessage(chatId, {
            text: `🚫 *Daftar Blokir Bot* (${blocked.length}):\n\n${list}\n\nGunakan *.unblock <nomor>* untuk melepas blokir.`
        }, { quoted: message });
    } catch (err) {
        console.error('blocklist command error:', err);
        return sock.sendMessage(chatId, { text: '❌ Gagal mengambil daftar blokir.' }, { quoted: message });
    }
}

async function unblockCommand(sock, chatId, message, arg) {
    const contextInfo = message.message?.extendedTextMessage?.contextInfo;
    const mentioned = contextInfo?.mentionedJid?.[0];
    const quotedParticipant = contextInfo?.participant;

    let targetJid = mentioned || quotedParticipant || await resolveBlockedJid(sock, (arg || '').trim());

    if (!targetJid) {
        return sock.sendMessage(chatId, {
            text: '❌ Gunakan: *.unblock <nomor>* (contoh: .unblock 6281234567890) atau reply/mention orangnya.'
        }, { quoted: message });
    }

    try {
        await sock.updateBlockStatus(targetJid, 'unblock');
        return sock.sendMessage(chatId, {
            text: `✅ Berhasil unblock *${targetJid.split('@')[0]}*.`
        }, { quoted: message });
    } catch (err) {
        console.error('unblock command error:', err);
        return sock.sendMessage(chatId, { text: '❌ Gagal unblock nomor tersebut.' }, { quoted: message });
    }
}

module.exports = { blocklistCommand, unblockCommand };
