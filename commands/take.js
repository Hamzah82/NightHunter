const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const takeCache = require('../lib/takeCache');
const { findGroupsByName } = require('../lib/groupFinder');
const { setPending } = require('../lib/pendingSelection');

const MAX_GROUP_MATCHES = 20;

async function downloadBuffer(mediaMessage, mediaType) {
    const stream = await downloadContentFromMessage(mediaMessage, mediaType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return buffer;
}

// Reply-mode delivery: downloads straight from the quoted message and
// forwards to the owner's own DM immediately (no cache involved).
async function deliverBufferToOwner(sock, mediaType, buffer, caption, fromJid, label) {
    const contentKey = mediaType === 'image' ? 'image' : 'video';
    try {
        const ownerNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        const fromName = fromJid ? fromJid.split('@')[0] : 'unknown';
        await sock.sendMessage(ownerNumber, {
            [contentKey]: buffer,
            caption: `*🎯 ${label}*\nFrom: @${fromName}${caption ? `\n\n${caption}` : ''}`,
            mentions: fromJid ? [fromJid] : []
        });
    } catch (err) {
        console.error('Error forwarding taken media to owner:', err);
    }
}

// Cache-based delivery: forwards a previously-captured record to the
// owner's own DM. Used by the vo/status + target lookup paths.
async function deliverRecordToOwner(sock, record, label) {
    const ownerNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const fromName = record.senderJid ? record.senderJid.split('@')[0] : 'unknown';
    const mentions = record.senderJid ? [record.senderJid] : [];
    try {
        if (record.mediaType === 'image') {
            await sock.sendMessage(ownerNumber, {
                image: { url: record.filePath },
                caption: `*🎯 ${label}*\nFrom: @${fromName}${record.caption ? `\n\n${record.caption}` : ''}`,
                mentions
            });
        } else if (record.mediaType === 'video') {
            await sock.sendMessage(ownerNumber, {
                video: { url: record.filePath },
                caption: `*🎯 ${label}*\nFrom: @${fromName}${record.caption ? `\n\n${record.caption}` : ''}`,
                mentions
            });
        } else {
            await sock.sendMessage(ownerNumber, {
                text: `*🎯 ${label}*\nFrom: @${fromName}\n\n${record.text || ''}`,
                mentions
            });
        }
        return true;
    } catch (err) {
        console.error('Error forwarding taken record to owner:', err);
        return false;
    }
}

// Only a short, generic confirmation goes back into the invoking chat —
// never the media/content/target details — so the retrieval stays undetected.
async function deliverRecordAndReply(sock, chatId, message, record, label) {
    if (!record) {
        return sock.sendMessage(chatId, {
            text: '❌ Tidak ditemukan capture untuk target itu.'
        }, { quoted: message });
    }

    const delivered = await deliverRecordToOwner(sock, record, label);
    return sock.sendMessage(chatId, {
        text: delivered ? '✅ Terkirim ke DM.' : '❌ Gagal mengirim ke DM.'
    }, { quoted: message });
}

function classifyTarget(target) {
    const stripped = target.replace(/[+\-\s]/g, '');
    if (/^\d{8,}$/.test(stripped)) {
        return { type: 'phone', jid: `${stripped}@s.whatsapp.net` };
    }
    return { type: 'groupname', query: target };
}

async function handleReplyMode(sock, chatId, message) {
    const usageText = '❌ Reply ke foto/video (termasuk view-once/status) dengan *.take*, atau gunakan *.take vo/status <nomor/nama grup>*';
    try {
        const contextInfo = message.message?.extendedTextMessage?.contextInfo;
        const quoted = contextInfo?.quotedMessage;

        if (!quoted) {
            await sock.sendMessage(chatId, { text: usageText }, { quoted: message });
            return;
        }

        // Replying to someone's Status sets contextInfo.remoteJid to 'status@broadcast'
        const isStatusReply = contextInfo.remoteJid === 'status@broadcast';
        const quotedImage = quoted.imageMessage;
        const quotedVideo = quoted.videoMessage;
        const quotedText = quoted.conversation || quoted.extendedTextMessage?.text;
        const fromJid = contextInfo.participant;
        const label = isStatusReply ? 'Taken status' : 'Taken media';

        if (quotedImage) {
            const buffer = await downloadBuffer(quotedImage, 'image');
            await deliverBufferToOwner(sock, 'image', buffer, quotedImage.caption, fromJid, label);
        } else if (quotedVideo) {
            const buffer = await downloadBuffer(quotedVideo, 'video');
            await deliverBufferToOwner(sock, 'video', buffer, quotedVideo.caption, fromJid, label);
        } else if (isStatusReply && quotedText) {
            try {
                const ownerNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const fromName = fromJid ? fromJid.split('@')[0] : 'unknown';
                await sock.sendMessage(ownerNumber, {
                    text: `*🎯 Taken status text*\nFrom: @${fromName}\n\n${quotedText}`,
                    mentions: fromJid ? [fromJid] : []
                });
            } catch (err) {
                console.error('Error forwarding taken status text to owner:', err);
            }
        } else {
            await sock.sendMessage(chatId, { text: usageText }, { quoted: message });
        }
    } catch (error) {
        console.error('Error in take command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to fetch that media/status.' }, { quoted: message });
    }
}

async function handleTargetMode(sock, chatId, message, sub, target) {
    const senderId = message.key.participant || message.key.remoteJid;
    const classified = classifyTarget(target);

    if (sub === 'status' && classified.type === 'groupname') {
        return sock.sendMessage(chatId, {
            text: '❌ Status milik seseorang, bukan grup. Gunakan nomor targetnya, bukan nama grup.'
        }, { quoted: message });
    }

    const kind = sub === 'vo' ? 'viewonce' : 'status';
    const label = sub === 'vo' ? 'Taken view-once' : 'Taken status';

    if (classified.type === 'phone') {
        const record = await takeCache.getLatestBySenderResolved(sock, classified.jid, kind);
        return deliverRecordAndReply(sock, chatId, message, record, label);
    }

    // vo + group name
    const matches = await findGroupsByName(sock, classified.query);
    if (matches.length === 0) {
        return sock.sendMessage(chatId, {
            text: '❌ Tidak ditemukan grup dengan nama itu.'
        }, { quoted: message });
    }

    if (matches.length === 1) {
        const record = takeCache.getLatestByChat(matches[0].id, kind);
        return deliverRecordAndReply(sock, chatId, message, record, label);
    }

    const shown = matches.slice(0, MAX_GROUP_MATCHES);
    const listText = shown.map((g, i) => `${i + 1}. ${g.subject}`).join('\n');
    const truncatedNote = matches.length > MAX_GROUP_MATCHES
        ? `\n\n(menampilkan ${MAX_GROUP_MATCHES} dari ${matches.length} hasil, perjelas nama grup untuk mempersempit)`
        : '';

    const pendingKey = `${chatId}:${senderId}`;
    setPending(pendingKey, { kind, label, candidates: shown });

    return sock.sendMessage(chatId, {
        text: `🔍 Ditemukan ${matches.length} grup yang cocok, balas dengan angka dalam 60 detik:\n\n${listText}${truncatedNote}`
    }, { quoted: message });
}

async function takeCommand(sock, chatId, message, argsText) {
    const arg = (argsText || '').trim();

    if (!arg) {
        return handleReplyMode(sock, chatId, message);
    }

    const parts = arg.split(/\s+/);
    const sub = parts[0].toLowerCase();
    const target = parts.slice(1).join(' ').trim();

    if (sub !== 'vo' && sub !== 'status') {
        return sock.sendMessage(chatId, {
            text: '❌ Gunakan: *.take*, *.take vo <nomor/nama grup>*, atau *.take status <nomor>*'
        }, { quoted: message });
    }

    if (!target) {
        return sock.sendMessage(chatId, {
            text: `❌ Gunakan: *.take ${sub} <nomor/nama grup>*`
        }, { quoted: message });
    }

    return handleTargetMode(sock, chatId, message, sub, target);
}

async function resolveTakeSelection(sock, chatId, message, pendingData, userMessage) {
    const index = parseInt(userMessage, 10) - 1;
    const candidates = pendingData.candidates || [];
    if (Number.isNaN(index) || index < 0 || index >= candidates.length) {
        return sock.sendMessage(chatId, {
            text: '❌ Nomor tidak valid.'
        }, { quoted: message });
    }

    const group = candidates[index];
    const record = takeCache.getLatestByChat(group.id, pendingData.kind);
    return deliverRecordAndReply(sock, chatId, message, record, pendingData.label);
}

module.exports = { takeCommand, resolveTakeSelection };
