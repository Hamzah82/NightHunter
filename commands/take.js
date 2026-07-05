const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

async function downloadAndSend(sock, chatId, mediaMessage, mediaType, message, caption) {
    const stream = await downloadContentFromMessage(mediaMessage, mediaType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    const contentKey = mediaType === 'image' ? 'image' : 'video';
    await sock.sendMessage(chatId, { [contentKey]: buffer, caption: caption || '' }, { quoted: message });
}

async function takeCommand(sock, chatId, message) {
    const usageText = '❌ Reply to a view-once photo/video, or reply to a WhatsApp Status (photo/video/text), with .take';
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

        if (quotedImage && (quotedImage.viewOnce || isStatusReply)) {
            await downloadAndSend(sock, chatId, quotedImage, 'image', message, quotedImage.caption);
        } else if (quotedVideo && (quotedVideo.viewOnce || isStatusReply)) {
            await downloadAndSend(sock, chatId, quotedVideo, 'video', message, quotedVideo.caption);
        } else if (isStatusReply && quotedText) {
            await sock.sendMessage(chatId, { text: quotedText }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, { text: usageText }, { quoted: message });
        }
    } catch (error) {
        console.error('Error in take command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to fetch that media/status.' }, { quoted: message });
    }
}

module.exports = takeCommand;
