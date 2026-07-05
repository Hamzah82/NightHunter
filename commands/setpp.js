const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const isOwnerOrSudo = require('../lib/isOwner');

async function setProfilePicture(sock, chatId, msg) {
    try {
        const senderId = msg.key.participant || msg.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
        
        if (!msg.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, { 
                text: '❌ This command is only available for the owner!' 
            });
            return;
        }

        // Check if message is a reply
        const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quotedMessage) {
            await sock.sendMessage(chatId, { 
                text: '⚠️ Please reply to an image with the .setpp command!' 
            });
            return;
        }

        // Check if quoted message contains an image
        const imageMessage = quotedMessage.imageMessage || quotedMessage.stickerMessage;
        if (!imageMessage) {
            await sock.sendMessage(chatId, { 
                text: '❌ The replied message must contain an image!' 
            });
            return;
        }

        // Create tmp directory if it doesn't exist
        const tmpDir = path.join(process.cwd(), 'tmp');
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }

        // Download the image
        const stream = await downloadContentFromMessage(imageMessage, 'image');
        let buffer = Buffer.from([]);
        
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        const imagePath = path.join(tmpDir, `profile_${Date.now()}.jpg`);

        // Pad the image to a square canvas instead of letting WhatsApp/Baileys
        // center-crop it to 1:1, so the full original image stays visible
        const paddedBuffer = await sharp(buffer)
            .resize(640, 640, {
                fit: 'contain',
                background: { r: 255, g: 255, b: 255, alpha: 1 }
            })
            .jpeg()
            .toBuffer();

        // Save the image
        fs.writeFileSync(imagePath, paddedBuffer);

        // Set the profile picture
        await sock.updateProfilePicture(sock.user.id, { url: imagePath });

        // Clean up the temporary file
        fs.unlinkSync(imagePath);

        await sock.sendMessage(chatId, { 
            text: '✅ Successfully updated bot profile picture!' 
        });

    } catch (error) {
        console.error('Error in setpp command:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to update profile picture!' 
        });
    }
}

module.exports = setProfilePicture; 