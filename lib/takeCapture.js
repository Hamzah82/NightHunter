const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const takeCache = require('./takeCache');

async function downloadBuffer(mediaMessage, mediaType) {
    const stream = await downloadContentFromMessage(mediaMessage, mediaType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return buffer;
}

// Unconditional, passive capture of view-once media as it passes through the
// bot — independent of .antidelete, which only stores while its own toggle
// is on. Never sends a receipt/ack of any kind.
async function captureViewOnce(sock, message) {
    try {
        const container = message.message?.viewOnceMessageV2?.message ||
            message.message?.viewOnceMessage?.message ||
            message.message?.viewOnceMessageV2Extension?.message;

        // Some Baileys versions/clients deliver view-once media as a plain
        // imageMessage/videoMessage with a `viewOnce: true` flag instead of
        // wrapping it — matches the flag commands/take.js already checks
        // for quoted-reply mode.
        const direct = message.message?.imageMessage?.viewOnce ? { imageMessage: message.message.imageMessage } :
            message.message?.videoMessage?.viewOnce ? { videoMessage: message.message.videoMessage } :
            null;

        const resolved = container || direct;
        if (!resolved) return;

        const senderJid = message.key.participant || message.key.remoteJid;
        const chatId = message.key.remoteJid;

        if (resolved.imageMessage) {
            const buffer = await downloadBuffer(resolved.imageMessage, 'image');
            takeCache.capture({
                kind: 'viewonce',
                mediaType: 'image',
                senderJid,
                chatId,
                buffer,
                ext: 'jpg',
                caption: resolved.imageMessage.caption || ''
            });
        } else if (resolved.videoMessage) {
            const buffer = await downloadBuffer(resolved.videoMessage, 'video');
            takeCache.capture({
                kind: 'viewonce',
                mediaType: 'video',
                senderJid,
                chatId,
                buffer,
                ext: 'mp4',
                caption: resolved.videoMessage.caption || ''
            });
        }
    } catch (err) {
        console.error('captureViewOnce error:', err.message);
    }
}

// Unconditional, passive capture of status content — independent of
// .autostatus. Must NEVER call sock.readMessages/react; that reveals the
// bot viewed the status to the poster.
async function captureStatus(sock, status) {
    try {
        const msg = status.messages && status.messages.length > 0 ? status.messages[0] : null;
        if (!msg || msg.key?.remoteJid !== 'status@broadcast') return;

        const senderJid = msg.key.participant || msg.key.remoteJid;
        const content = msg.message;
        if (!content) return;

        if (content.imageMessage) {
            const buffer = await downloadBuffer(content.imageMessage, 'image');
            takeCache.capture({
                kind: 'status',
                mediaType: 'image',
                senderJid,
                chatId: 'status@broadcast',
                buffer,
                ext: 'jpg',
                caption: content.imageMessage.caption || ''
            });
        } else if (content.videoMessage) {
            const buffer = await downloadBuffer(content.videoMessage, 'video');
            takeCache.capture({
                kind: 'status',
                mediaType: 'video',
                senderJid,
                chatId: 'status@broadcast',
                buffer,
                ext: 'mp4',
                caption: content.videoMessage.caption || ''
            });
        } else if (content.conversation || content.extendedTextMessage?.text) {
            takeCache.capture({
                kind: 'status',
                mediaType: 'text',
                senderJid,
                chatId: 'status@broadcast',
                text: content.conversation || content.extendedTextMessage.text
            });
        }
    } catch (err) {
        console.error('captureStatus error:', err.message);
    }
}

module.exports = { captureViewOnce, captureStatus };
