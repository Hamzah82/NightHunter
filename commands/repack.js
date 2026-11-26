const fs = require('fs');
const path = require('path');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const webp = require('node-webpmux');
const crypto = require('crypto');
const store = require('../lib/lightweight_store');
const { sendRepackedSticker, getStickerAudio } = require('../lib/soundSticker');

async function repackCommand(sock, chatId, message, args) {
    try {
        // Check if message is a reply to a sticker
        const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quotedMessage?.stickerMessage) {
            await sock.sendMessage(chatId, { text: '❌ Reply to a sticker with .repack <packname>' });
            return;
        }

        // Get the packname from args or use default
        const packname = args.join(' ') || 'Night Hunter';

        try {
            const contextInfo = message.message.extendedTextMessage.contextInfo;

            // Download the sticker
            const stickerBuffer = await downloadMediaMessage(
                {
                    key: {
                        remoteJid: chatId,
                        fromMe: false,
                        id: contextInfo.stanzaId,
                        participant: contextInfo.participant
                    },
                    message: quotedMessage,
                    messageType: 'stickerMessage'
                },
                'buffer',
                {},
                {
                    logger: console,
                    reuploadRequest: sock.updateMediaMessage
                }
            );

            if (!stickerBuffer) {
                await sock.sendMessage(chatId, { text: '❌ Failed to download sticker' });
                return;
            }

            // Add metadata using webpmux
            const img = new webp.Image();
            await img.load(stickerBuffer);

            // Create metadata
            const json = {
                'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
                'sticker-pack-name': packname,
                'emojis': ['🤖']
            };

            // Create exif buffer
            const exifAttr = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
            const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
            const exif = Buffer.concat([exifAttr, jsonBuffer]);
            exif.writeUIntLE(jsonBuffer.length, 14, 4);

            // Set the exif data
            img.exif = exif;

            // Get the final buffer with metadata
            const finalBuffer = await img.save(null);

            // Sound sticker: audio ikut dipertahankan (field 26), bukan dihapus.
            // Quoted message dari WhatsApp kadang tidak membawa audio, jadi
            // cadangannya diambil dari store pesan yang diterima bot.
            const audioFromQuote = getStickerAudio(quotedMessage);
            let audioMessage = audioFromQuote;

            if (!audioMessage && contextInfo?.stanzaId) {
                try {
                    const stored = await store.loadMessage(chatId, contextInfo.stanzaId);
                    audioMessage = getStickerAudio(stored?.message);
                    if (audioMessage) {
                        console.log('[REPACK] Audio diambil dari store pesan.');
                    }
                } catch (storeError) {
                    console.error('[REPACK] Gagal baca store:', storeError.message);
                }
            }

            if (!audioMessage) {
                console.log('[REPACK] Sticker tanpa audio. Field stickerMessage:', Object.keys(quotedMessage.stickerMessage || {}).join(', '));
            }

            try {
                await sendRepackedSticker(sock, chatId, {
                    stickerBuffer: finalBuffer,
                    audioMessage,
                    quoted: message
                });
            } catch (sendError) {
                console.error('[REPACK] Gagal kirim lewat relay, fallback sendMessage:', sendError.message);
                await sock.sendMessage(chatId, {
                    sticker: finalBuffer
                }, {
                    quoted: message
                });
            }

        } catch (error) {
            console.error('Sticker processing error:', error);
            await sock.sendMessage(chatId, { text: '❌ Error processing sticker' });
        }

    } catch (error) {
        console.error('Error in repack command:', error);
        await sock.sendMessage(chatId, { text: '❌ Error processing command' });
    }
}

module.exports = repackCommand;
