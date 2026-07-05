const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const isOwnerOrSudo = require('../lib/isOwner');

const SIZE = 640;

// WhatsApp's server rejects non-square profile pictures outright (406
// not-acceptable) — a 1:1 canvas is mandatory, it's not just a Baileys quirk.
// To avoid cropping the original image, fit it fully inside the square and
// fill the leftover space with a blurred, zoomed copy of the same image
// instead of a plain background color.
async function squareWithBlurredBackdrop(buffer) {
    const backdrop = await sharp(buffer)
        .resize(SIZE, SIZE, { fit: 'cover' })
        .blur(20)
        .toBuffer();

    const foreground = await sharp(buffer)
        .resize(SIZE, SIZE, { fit: 'inside' })
        .toBuffer();

    return sharp(backdrop)
        .composite([{ input: foreground, gravity: 'center' }])
        .jpeg({ quality: 90 })
        .toBuffer();
}

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

        const squaredBuffer = await squareWithBlurredBackdrop(buffer);

        const imagePath = path.join(tmpDir, `profile_${Date.now()}.jpg`);
        fs.writeFileSync(imagePath, squaredBuffer);

        // Image is already 640x640, so Baileys' internal crop is a no-op here
        await sock.updateProfilePicture(sock.user.id, { url: imagePath });

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
