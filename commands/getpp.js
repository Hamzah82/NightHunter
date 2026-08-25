/**
 * Get Profile Picture Command
 * Usage: .ppget <tag|nomor>
 * Retrieves the profile picture of a user mentioned or specified by number
 */

const { proto } = require('@whiskeysockets/baileys');
const fetch = require('node-fetch');

async function getppCommand(sock, chatId, message) {
    try {
        // Extract the target from message text
        const rawText = message.message?.extendedTextMessage?.text || '';
        const parts = rawText.split(' ');
        
        let targetJid = null;
        
        // Check if there's a quoted message
        const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quotedMsg) {
            const quotedKey = message.message.extendedTextMessage.contextInfo.participant;
            if (quotedKey) {
                targetJid = quotedKey;
            }
        }
        
        // If no quoted message, check for mentions
        if (!targetJid) {
            const mentionedJid = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentionedJid.length > 0) {
                targetJid = mentionedJid[0];
            }
        }
        
        // If still no target, check for phone number in arguments
        if (!targetJid && parts.length > 1) {
            const phoneNumber = parts[1].replace(/[^0-9]/g, '');
            if (phoneNumber) {
                // Convert phone number to WhatsApp JID format
                targetJid = phoneNumber + '@s.whatsapp.net';
            }
        }
        
        // If no target found, reply with usage instructions
        if (!targetJid) {
            await sock.sendMessage(chatId, {
                text: '❌ Please mention someone, quote their message, or write their number\n\nUsage:\n.ppg <tag|nomor>'
            }, { quoted: message });
            return;
        }
        
        // Try to get the profile picture URL
        let ppUrl;
        try {
            ppUrl = await sock.profilePictureUrl(targetJid, 'image');
        } catch (error) {
            console.error('Error getting PP URL:', error);
            ppUrl = 'https://i.imgur.com/2wzGhpF.jpeg';
        }
        
        console.log(`Fetching PP for: ${targetJid}`);
        console.log(`URL: ${ppUrl}`);
        
        // Fetch the image buffer
        let imageBuffer;
        try {
            const response = await fetch(ppUrl);
            if (!response.ok) throw new Error('Failed to fetch image');
            imageBuffer = Buffer.from(await response.arrayBuffer());
            console.log(`Image fetched successfully: ${imageBuffer.length} bytes`);
        } catch (error) {
            console.error('Error fetching image:', error);
            await sock.sendMessage(chatId, {
                text: `❌ Failed to download profile picture.\nMake sure @${targetJid.split('@')[0]} has a profile picture set and privacy settings allow it.`
            }, { quoted: message });
            return;
        }
        
        // Format the JID for display
        const displayNumber = targetJid.split('@')[0];
        
        // Send the profile picture
        await sock.sendMessage(chatId, {
            image: imageBuffer,
            caption: `📸 *Profile Picture*\n\n👤 Number: @${displayNumber}\n🔗 Status: Retrieved successfully`,
            mentions: [targetJid]
        }, { quoted: message });
        
        console.log(`✅ Profile picture sent successfully`);
        
    } catch (error) {
        console.error('Error in getpp command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to get profile picture. The user may have privacy settings enabled.'
        }, { quoted: message });
    }
}

module.exports = getppCommand;
