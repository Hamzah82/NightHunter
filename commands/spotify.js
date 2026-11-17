const songCommand = require('./song');

module.exports = async function spotifyCommand(sock, chatId, message) {
    const rawText = message.message?.conversation?.trim() ||
        message.message?.extendedTextMessage?.text?.trim() ||
        message.message?.imageMessage?.caption?.trim() ||
        message.message?.videoMessage?.caption?.trim() ||
        '';

    const used = (rawText || '').split(/\s+/)[0] || '.spotify';
    const query = rawText.slice(used.length).trim();

    if (!query) {
        await sock.sendMessage(chatId, {
            text: 'Usage: .spotify <song/artist/keywords>\nExample: .spotify con calma'
        }, { quoted: message });
        return;
    }

    try {
        await songCommand(sock, chatId, message);
    } catch (error) {
        console.error('[SPOTIFY] Failed:', error?.message || error);
        await sock.sendMessage(chatId, {
            text: 'Failed to fetch the song. Try another query later.'
        }, { quoted: message });
    }
};
