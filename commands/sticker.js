const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const webp = require('node-webpmux');
const settings = require('../settings');
const { sendSoundStickerFromVideo } = require('../lib/soundSticker');

const STICKER_SIZE = 512;

function runFfmpeg(inputPath, outputPath) {
    const args = [
        '-y', '-i', inputPath,
        '-vf', `scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease,format=rgba,pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=#00000000`,
        '-c:v', 'libwebp', '-preset', 'default', '-loop', '0', '-vsync', '0',
        '-pix_fmt', 'yuva420p', '-quality', '75', '-compression_level', '6',
        outputPath
    ];
    return new Promise((resolve, reject) => {
        execFile('ffmpeg', args, error => error ? reject(error) : resolve());
    });
}

async function convertWithSharp(buffer, animated) {
    return sharp(buffer, { animated })
        .resize(STICKER_SIZE, STICKER_SIZE, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .webp({ quality: animated ? 70 : 82, loop: 0 })
        .toBuffer();
}

async function addExif(webpBuffer) {
    const image = new webp.Image();
    await image.load(webpBuffer);

    const json = {
        'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
        'sticker-pack-name': settings.packname || 'NightHunter',
        'sticker-pack-publisher': settings.author || '',
        'emojis': ['🤖']
    };

    const exifAttr = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
    const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
    const exif = Buffer.concat([exifAttr, jsonBuffer]);
    exif.writeUIntLE(jsonBuffer.length, 14, 4);

    image.exif = exif;
    return image.save(null);
}

async function stickerCommand(sock, chatId, message) {
    let targetMessage = message;

    if (message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quotedInfo = message.message.extendedTextMessage.contextInfo;
        targetMessage = {
            key: {
                remoteJid: chatId,
                id: quotedInfo.stanzaId,
                participant: quotedInfo.participant
            },
            message: quotedInfo.quotedMessage
        };
    }

    const mediaMessage = targetMessage.message?.imageMessage
        || targetMessage.message?.videoMessage
        || targetMessage.message?.documentMessage;

    if (!mediaMessage) {
        await sock.sendMessage(chatId, {
            text: 'Please reply to an image/video with .sticker, or send an image/video with .sticker as the caption.'
        }, { quoted: message });
        return;
    }

    let tempInput = null;
    let tempOutput = null;

    try {
        const mediaBuffer = await downloadMediaMessage(targetMessage, 'buffer', {}, {
            logger: undefined,
            reuploadRequest: sock.updateMediaMessage
        });

        if (!mediaBuffer) {
            await sock.sendMessage(chatId, { text: 'Failed to download media. Please try again.' }, { quoted: message });
            return;
        }

        const mimetype = mediaMessage.mimetype || '';
        const isGif = mimetype.includes('gif');
        const isVideo = mimetype.startsWith('video/') || (Number(mediaMessage.seconds) > 0 && !isGif);
        const animated = isGif || isVideo;

        const tmpDir = path.join(process.cwd(), 'tmp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        // Videos with an audio track become sound stickers (sticker + audio).
        if (isVideo) {
            tempInput = path.join(tmpDir, `sticker_in_${Date.now()}`);
            fs.writeFileSync(tempInput, mediaBuffer);

            try {
                const sent = await sendSoundStickerFromVideo(sock, chatId, {
                    videoPath: tempInput,
                    quoted: message
                });

                if (sent) return;
            } catch (error) {
                console.error('[STICKER] Sound sticker failed, falling back:', error.message);
            }
        }

        let webpBuffer = null;

        if (!isVideo) {
            try {
                webpBuffer = await convertWithSharp(mediaBuffer, animated);
            } catch (error) {
                console.error('[STICKER] sharp conversion failed:', error.message);
            }
        }

        if (!webpBuffer) {
            if (!tempInput) {
                tempInput = path.join(tmpDir, `sticker_in_${Date.now()}`);
                fs.writeFileSync(tempInput, mediaBuffer);
            }

            tempOutput = path.join(tmpDir, `sticker_out_${Date.now()}.webp`);
            await runFfmpeg(tempInput, tempOutput);
            webpBuffer = fs.readFileSync(tempOutput);
        }

        if (animated && webpBuffer.length > 900 * 1024) {
            try {
                webpBuffer = await sharp(mediaBuffer, { animated: true })
                    .resize(320, 320, {
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 }
                    })
                    .webp({ quality: 55, loop: 0 })
                    .toBuffer();
            } catch {}
        }

        const finalBuffer = await addExif(webpBuffer);
        await sock.sendMessage(chatId, { sticker: finalBuffer }, { quoted: message });
    } catch (error) {
        console.error('Error in sticker command:', error.message);
        await sock.sendMessage(chatId, {
            text: 'Failed to create sticker! Make sure ffmpeg is installed for video stickers, then try again.'
        }, { quoted: message });
    } finally {
        try { if (tempInput && fs.existsSync(tempInput)) fs.unlinkSync(tempInput); } catch {}
        try { if (tempOutput && fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput); } catch {}
    }
}

module.exports = stickerCommand;
