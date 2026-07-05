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

async function blocklistCommand(sock, chatId, message) {
    try {
        const blocked = await sock.fetchBlocklist();
        if (!blocked || !blocked.length) {
            return sock.sendMessage(chatId, { text: '✅ Tidak ada nomor yang diblokir bot.' }, { quoted: message });
        }
        const list = blocked.map((jid, i) => `${i + 1}. ${jid.split('@')[0]}`).join('\n');
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
