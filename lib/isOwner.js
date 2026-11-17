const settings = require('../settings');
const { isSudo } = require('./index');

function normalizeJid(jid) {
    return String(jid || '').split('@')[0].split(':')[0];
}

async function isOwnerOrSudo(senderId, sock = null, chatId = null) {
    if (!senderId) return false;

    const ownerJid = settings.ownerNumber + '@s.whatsapp.net';
    const ownerNumberClean = normalizeJid(settings.ownerNumber);
    const senderClean = normalizeJid(senderId);

    if (senderId === ownerJid || senderClean === ownerNumberClean) {
        return true;
    }

    // A LID and a phone-number JID are different identifiers; group metadata
    // is the only place that maps one to the other. Only do that lookup when
    // the sender is actually addressed by LID.
    if (sock && chatId && chatId.endsWith('@g.us') && senderId.includes('@lid')) {
        try {
            const metadata = await sock.groupMetadata(chatId);
            const participants = metadata.participants || [];

            const participant = participants.find(p => {
                const pIdClean = normalizeJid(p.id);
                const pLidClean = normalizeJid(p.lid);
                const pPhoneClean = normalizeJid(p.phoneNumber);
                return (
                    p.id === senderId ||
                    p.lid === senderId ||
                    pLidClean === senderClean ||
                    pIdClean === senderClean ||
                    pPhoneClean === senderClean
                );
            });

            if (participant) {
                const pIdClean = normalizeJid(participant.id);
                const pLidClean = normalizeJid(participant.lid);
                const pPhoneClean = normalizeJid(participant.phoneNumber);

                if (
                    participant.id === ownerJid ||
                    pIdClean === ownerNumberClean ||
                    pPhoneClean === ownerNumberClean ||
                    pLidClean === ownerNumberClean
                ) {
                    return true;
                }

                for (const candidate of [participant.id, participant.lid, participant.phoneNumber]) {
                    if (!candidate) continue;
                    try {
                        if (await isSudo(candidate)) return true;
                    } catch {}
                }
            }
        } catch (error) {
            console.error('❌ [isOwner] Error checking participant data:', error.message);
        }
    }

    try {
        return await isSudo(senderId);
    } catch (error) {
        console.error('❌ [isOwner] Error checking sudo:', error.message);
        return false;
    }
}

module.exports = isOwnerOrSudo;
