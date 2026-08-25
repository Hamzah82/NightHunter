/**
 * Get Profile Picture Command
 * Usage: .ppget <tag|nomor>
 */

const axios = require('axios');

async function getppCommand(sock, chatId, message) {
    try {
        const rawText = message.message?.extendedTextMessage?.text || '';
        const parts = rawText.split(' ');
        
        let targetJid = null;
        
        // Check quoted message
        const contextInfo = message.message?.extendedTextMessage?.contextInfo;
        if (contextInfo) {
            if (contextInfo.participant) {
                targetJid = contextInfo.participant;
            } else if (contextInfo.mentionedJid && contextInfo.mentionedJid.length > 0) {
                targetJid = contextInfo.mentionedJid[0];
            }
        }
        
        // Check phone number
        if (!targetJid && parts.length > 1) {
            const phoneNumber = parts[1].replace(/[^0-9]/g, '');
            if (phoneNumber) {
                targetJid = phoneNumber + '@s.whatsapp.net';
            }
        }
        
        if (!targetJid) {
            await sock.sendMessage(chatId, { 
                text: '❌ Tag orangnya atau mention @someone atau tulis nomor\nUsage: .ppget <tag|nomor>'
            }, { quoted: message });
            return;
        }
        
        console.log('[GETPP] Target:', targetJid);
        
        // Get profile picture URL
        let ppUrl;
        try {
            ppUrl = await sock.profilePictureUrl(targetJid, 'image');
            console.log('[GETPP] PP URL:', ppUrl);
        } catch (e) {
            ppUrl = 'https://i.imgur.com/2wzGhpF.jpeg';
        }
        
        // Download image
        let imageBuffer;
        try {
            const response = await axios.get(ppUrl, { responseType: 'arraybuffer' });
            imageBuffer = Buffer.from(response.data, 'binary');
            console.log('[GETPP] Image downloaded:', imageBuffer.length, 'bytes');
        } catch (error) {
            console.error('[GETPP] Download error:', error.message);
            await sock.sendMessage(chatId, {
                text: `❌ Gagal ambil foto profil.\nTarget: @${targetJid.split('@')[0]}\nError: ${error.message}`
            }, { quoted: message, mentions: [targetJid] });
            return;
        }
        
        const displayNumber = targetJid.split('@')[0];
        
        // Send image
        await sock.sendMessage(chatId, {
            image: imageBuffer,
            caption: `📸 *Profile Picture*\n\n👤 Number: @${displayNumber}`,
            mentions: [targetJid]
        }, { quoted: message });
        
        console.log('[GETPP] ✅ Image sent successfully!');
        
    } catch (error) {
        console.error('[GETPP] FATAL ERROR:', error);
        console.error(error.stack);
        await sock.sendMessage(chatId, {
            text: '❌ Error dalam command .ppget!'
        }, { quoted: message });
    }
}

module.exports = getppCommand;
