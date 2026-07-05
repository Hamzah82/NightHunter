const sharp = require('sharp');
const { downloadContentFromMessage, jidNormalizedUser, S_WHATSAPP_NET } = require('@whiskeysockets/baileys');
const isOwnerOrSudo = require('../lib/isOwner');

// Baileys' own updateProfilePicture() forces a 1:1 center-crop via
// generateProfilePicture(). Bypass it entirely and send the "w:profile:picture"
// IQ stanza ourselves with the untouched image, so the full aspect ratio is kept.
async function uploadProfilePicture(sock, jid, imgBuffer) {
    const targetJid = jidNormalizedUser(jid) !== jidNormalizedUser(sock.authState.creds.me.id)
        ? jidNormalizedUser(jid)
        : undefined;

    await sock.query({
        tag: 'iq',
        attrs: {
            to: S_WHATSAPP_NET,
            type: 'set',
            xmlns: 'w:profile:picture',
            ...(targetJid ? { target: targetJid } : {})
        },
        content: [
            {
                tag: 'picture',
                attrs: { type: 'image' },
                content: imgBuffer
            }
        ]
    });
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

        // Download the image
        const stream = await downloadContentFromMessage(imageMessage, 'image');
        let buffer = Buffer.from([]);

        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        // Re-encode to JPEG only, no resize/crop, so the full original image
        // (whatever its aspect ratio) is kept intact
        const jpegBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();

        // Upload directly, bypassing Baileys' built-in 1:1 crop
        await uploadProfilePicture(sock, sock.user.id, jpegBuffer);

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