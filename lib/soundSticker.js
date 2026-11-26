/**
 * Night Hunter - A WhatsApp Bot
 * Copyright (c) 2024 Hoznyx
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * Sound Sticker (sticker + audio) support.
 *
 * WhatsApp "sound stickers" embed a short audio clip inside the sticker
 * message itself: `Message.StickerMessage.audioMessage` (field 26, oneof audio).
 * The WAProto bundled with Baileys does not know that field yet, so the
 * generated protobuf encoder would silently drop it. We patch the encoder
 * at runtime so the field survives and reaches the recipient.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const webp = require('node-webpmux');
const settings = require('../settings');

const STICKER_SIZE = 512;
const SOUND_MAX_SECONDS = 6; // WhatsApp trims sound stickers to 6 seconds
const SOUND_MIMETYPE = 'audio/ogg; codecs=opus';
const MAX_STICKER_BYTES = 900 * 1024; // keep under WhatsApp's 1 MB sticker limit
const AUDIO_FIELD_NUMBER = 26; // Message.StickerMessage.audioMessage

let protoPatched = null;

function run(bin, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(bin, args, { maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
            if (error) {
                error.stderr = stderr;
                reject(error);
                return;
            }
            resolve(stdout);
        });
    });
}

/**
 * Minimal protobuf scan: return the raw bytes of `fieldNumber` (wire type 2).
 * Dipakai untuk membaca field yang tidak dikenal oleh WAProto bawaan tanpa
 * menambah dependency protobufjs.
 */
function findLengthDelimitedField(buffer, fieldNumber) {
    const bytes = buffer instanceof Uint8Array ? buffer : Uint8Array.from(buffer);
    let pos = 0;

    const readVarint = () => {
        let result = 0;
        let shift = 0;
        let byte;

        do {
            if (pos >= bytes.length) throw new Error('truncated varint');
            byte = bytes[pos++];
            result += (byte & 0x7f) * Math.pow(2, shift);
            shift += 7;
        } while (byte & 0x80);

        return result;
    };

    while (pos < bytes.length) {
        const tag = readVarint();
        const field = tag >>> 3;
        const wire = tag & 7;

        if (field === fieldNumber && wire === 2) {
            const length = readVarint();
            const start = pos;
            pos += length;
            return bytes.subarray(start, pos);
        }

        switch (wire) {
            case 0: readVarint(); break;
            case 1: pos += 8; break;
            case 2: {
                // Jangan `pos += readVarint()`: pos dibaca sebelum varint
                // menggeser pos, sehingga offset jadi salah.
                const skip = readVarint();
                pos += skip;
                break;
            }
            case 5: pos += 4; break;
            default: throw new Error(`unsupported wire type ${wire}`);
        }
    }

    return null;
}

/**
 * Teach the bundled WAProto about StickerMessage.audioMessage (field 26).
 * Safe to call repeatedly; returns false when the patch is not possible.
 */
function patchProtoForSoundStickers() {
    if (protoPatched !== null) return protoPatched;

    try {
        const { proto } = require('@whiskeysockets/baileys');
        const StickerMessage = proto?.Message?.StickerMessage;
        const AudioMessage = proto?.Message?.AudioMessage;

        if (!StickerMessage || !AudioMessage
            || typeof StickerMessage.encode !== 'function'
            || typeof StickerMessage.fromObject !== 'function'
            || typeof StickerMessage.decode !== 'function') {
            protoPatched = false;
            return protoPatched;
        }

        // Baileys versi baru mungkin sudah punya field ini; jangan patch dobel.
        if (StickerMessage.$type?.fields?.audioMessage) {
            protoPatched = true;
            return protoPatched;
        }

        const originalEncode = StickerMessage.encode;
        const originalFromObject = StickerMessage.fromObject;
        const originalDecode = StickerMessage.decode;

        // Keep the unknown field when a plain object is converted to a message.
        StickerMessage.fromObject = function (object) {
            const message = originalFromObject.call(this, object);
            if (object && object.audioMessage) {
                message.audioMessage = object.audioMessage instanceof AudioMessage
                    ? object.audioMessage
                    : AudioMessage.fromObject(object.audioMessage);
            }
            return message;
        };

        // Append field 26 (tag 210, wire type 2) after the known sticker fields.
        StickerMessage.encode = function (message, writer) {
            const audioMessage = message && message.audioMessage;
            let base = message;

            if (audioMessage) {
                base = { ...message };
                delete base.audioMessage;
            }

            const result = originalEncode.call(this, base, writer);

            if (audioMessage) {
                AudioMessage.encode(audioMessage, result.uint32(AUDIO_FIELD_NUMBER << 3 | 2).fork()).ldelim();
            }

            return result;
        };

        // Baca field 26 saat menerima pesan, supaya audio ikut terbawa di
        // quotedMessage (dipakai .repack / .steal agar tidak menghapus audio).
        StickerMessage.decode = function (reader, length) {
            const start = reader.pos;
            const end = typeof length === 'number' ? Math.min(start + length, reader.len) : reader.len;
            let raw = null;

            try {
                raw = reader.buf.slice(start, end);
            } catch {
                raw = null;
            }

            const message = originalDecode.call(this, reader, length);

            if (raw && raw.length) {
                try {
                    const audioBytes = findLengthDelimitedField(raw, AUDIO_FIELD_NUMBER);
                    if (audioBytes) {
                        message.audioMessage = AudioMessage.decode(audioBytes);
                    }
                } catch (error) {
                    console.error('[SOUND-STICKER] Failed to read sticker audio:', error.message);
                }
            }

            return message;
        };

        protoPatched = true;
    } catch (error) {
        console.error('[SOUND-STICKER] Failed to patch WAProto:', error.message);
        protoPatched = false;
    }

    return protoPatched;
}

async function hasAudioStream(inputPath) {
    try {
        const output = await run('ffprobe', [
            '-v', 'error',
            '-select_streams', 'a:0',
            '-show_entries', 'stream=codec_type',
            '-of', 'csv=p=0',
            inputPath
        ]);
        return output.trim().length > 0;
    } catch (error) {
        console.error('[SOUND-STICKER] ffprobe failed:', error.message);
        return false;
    }
}

async function probeAudioDuration(inputPath) {
    try {
        const output = await run('ffprobe', [
            '-v', 'error',
            '-select_streams', 'a:0',
            '-show_entries', 'stream=duration',
            '-of', 'csv=p=0',
            inputPath
        ]);
        const duration = parseFloat(output.trim().split('\n')[0]);
        if (Number.isFinite(duration) && duration > 0) {
            return Math.min(SOUND_MAX_SECONDS, Math.max(1, Math.round(duration)));
        }
    } catch {}

    return SOUND_MAX_SECONDS;
}

async function convertVideoToSticker(inputPath, outputPath) {
    const encode = (size, fps, quality) => run('ffmpeg', [
        '-y',
        '-i', inputPath,
        '-t', String(SOUND_MAX_SECONDS),
        '-vf', `scale=${size}:${size}:force_original_aspect_ratio=decrease,format=rgba,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=#00000000,fps=${fps}`,
        '-c:v', 'libwebp', '-preset', 'default', '-loop', '0', '-vsync', '0',
        '-pix_fmt', 'yuva420p', '-quality', String(quality), '-compression_level', '6',
        outputPath
    ]);

    await encode(STICKER_SIZE, 12, 60);

    if (fs.statSync(outputPath).size > MAX_STICKER_BYTES) {
        await encode(320, 10, 45);
    }

    return fs.statSync(outputPath).size;
}

async function extractAudioTrack(inputPath, outputPath) {
    await run('ffmpeg', [
        '-y',
        '-i', inputPath,
        '-t', String(SOUND_MAX_SECONDS),
        '-vn',
        '-ac', '1',
        '-ar', '48000',
        '-c:a', 'libopus',
        '-b:a', '32k',
        '-f', 'ogg',
        outputPath
    ]);
}

async function addStickerExif(webpBuffer) {
    const image = new webp.Image();
    await image.load(webpBuffer);

    const json = {
        'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
        'sticker-pack-name': settings.packname || 'NightHunter',
        'sticker-pack-publisher': settings.author || '',
        'emojis': ['🔊']
    };

    const exifAttr = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
    const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
    const exif = Buffer.concat([exifAttr, jsonBuffer]);
    exif.writeUIntLE(jsonBuffer.length, 14, 4);

    image.exif = exif;
    return image.save(null);
}

/**
 * Upload the sticker + its audio and relay a single sound sticker message.
 */
async function sendSoundSticker(sock, chatId, { stickerBuffer, audioBuffer, seconds, quoted }) {
    const { generateWAMessageFromContent, prepareWAMessageMedia } = require('@whiskeysockets/baileys');

    if (typeof sock?.waUploadToServer !== 'function') {
        throw new Error('socket does not expose waUploadToServer');
    }

    const upload = (filePath, opts) => sock.waUploadToServer(filePath, opts);

    const [stickerMedia, audioMedia] = await Promise.all([
        prepareWAMessageMedia(
            { sticker: stickerBuffer, isAnimated: true },
            { upload }
        ),
        prepareWAMessageMedia(
            { audio: audioBuffer, mimetype: SOUND_MIMETYPE, ptt: true, seconds },
            { upload }
        )
    ]);

    if (!stickerMedia?.stickerMessage || !audioMedia?.audioMessage) {
        throw new Error('media upload did not return sticker/audio payload');
    }

    const content = {
        stickerMessage: {
            ...stickerMedia.stickerMessage,
            isAnimated: true,
            audioMessage: audioMedia.audioMessage
        }
    };

    const waMessage = generateWAMessageFromContent(chatId, content, {
        quoted,
        userJid: sock.user?.id
    });

    await sock.relayMessage(chatId, waMessage.message, { messageId: waMessage.key.id });

    return waMessage;
}

/**
 * Turn a video file into a sound sticker and send it.
 * Returns true when the sound sticker was sent, false when the caller should
 * fall back to a regular (silent) sticker.
 */
async function sendSoundStickerFromVideo(sock, chatId, { videoPath, quoted }) {
    if (!patchProtoForSoundStickers()) return false;
    if (!(await hasAudioStream(videoPath))) return false;

    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const stamp = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const stickerPath = path.join(tmpDir, `sound_sticker_${stamp}.webp`);
    const audioPath = path.join(tmpDir, `sound_sticker_${stamp}.ogg`);

    try {
        const [seconds] = await Promise.all([
            probeAudioDuration(videoPath),
            convertVideoToSticker(videoPath, stickerPath),
            extractAudioTrack(videoPath, audioPath)
        ]);

        const stickerBuffer = await addStickerExif(fs.readFileSync(stickerPath));
        const audioBuffer = fs.readFileSync(audioPath);

        await sendSoundSticker(sock, chatId, {
            stickerBuffer,
            audioBuffer,
            seconds,
            quoted
        });

        return true;
    } catch (error) {
        console.error('[SOUND-STICKER] Falling back to a silent sticker:', error.message);
        return false;
    } finally {
        try { if (fs.existsSync(stickerPath)) fs.unlinkSync(stickerPath); } catch {}
        try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch {}
    }
}

/**
 * Sticker animasi (WebP dengan chunk ANIM) perlu flag isAnimated agar tampil
 * sebagai stiker bergerak, bukan stiker statis.
 */
function isAnimatedWebp(buffer) {
    try {
        return Buffer.isBuffer(buffer) && buffer.indexOf('ANIM') !== -1;
    } catch {
        return false;
    }
}

/**
 * Ambil StickerMessage dari sebuah content, membuka wrapper
 * viewOnce/ephemeral/documentWithCaption bila ada.
 */
function unwrapStickerMessage(content) {
    let current = content;

    for (let i = 0; i < 5 && current; i++) {
        if (current.stickerMessage) return current.stickerMessage;

        current = current.viewOnceMessage?.message
            || current.viewOnceMessageV2?.message
            || current.viewOnceMessageV2Extension?.message
            || current.ephemeralMessage?.message
            || current.documentWithCaptionMessage?.message
            || null;
    }

    return null;
}

function reviveBuffer(value) {
    if (!value) return value;
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    // Hasil JSON.stringify(Buffer) atau protobufjs toJSON.
    if (typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
        return Buffer.from(value.data);
    }
    if (typeof value === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
        return Buffer.from(value, 'base64');
    }
    return value;
}

/**
 * Samakan bentuk audioMessage (Buffer bisa berbentuk {type:'Buffer'} setelah
 * disimpan ke JSON) supaya bisa dipakai ulang / diunduh.
 */
function normalizeAudioMessage(audio) {
    if (!audio) return null;

    const out = { ...audio };
    for (const key of ['mediaKey', 'fileSha256', 'fileEncSha256', 'waveform']) {
        if (out[key]) out[key] = reviveBuffer(out[key]);
    }

    return out;
}

/**
 * Ambil audio dari quoted sticker (sound sticker). Field 26 hanya terbaca
 * setelah patchProtoForSoundStickers() dipasang saat decode pesan masuk.
 */
function getStickerAudio(content) {
    patchProtoForSoundStickers();
    const sticker = unwrapStickerMessage(content);
    return normalizeAudioMessage(sticker?.audioMessage);
}

/**
 * Audio dianggap siap pakai kalau media-nya masih bisa diambil penerima.
 */
function isUsableAudio(audio) {
    return !!(audio && audio.mediaKey && (audio.url || audio.directPath));
}

/**
 * Unduh audio asli lalu upload ulang. Dipakai hanya kalau audio lama tidak
 * lengkap (mis. mediaKey hilang).
 */
async function reuploadAudio(sock, audioMessage, upload) {
    const { downloadContentFromMessage, prepareWAMessageMedia } = require('@whiskeysockets/baileys');

    const stream = await downloadContentFromMessage(audioMessage, 'audio');
    const chunks = [];

    for await (const chunk of stream) chunks.push(chunk);

    const audioBuffer = Buffer.concat(chunks);
    if (!audioBuffer.length) return null;

    const seconds = Number(audioMessage.seconds) || SOUND_MAX_SECONDS;
    const audioMedia = await prepareWAMessageMedia(
        {
            audio: audioBuffer,
            mimetype: audioMessage.mimetype || SOUND_MIMETYPE,
            ptt: true,
            seconds
        },
        { upload }
    );

    return audioMedia?.audioMessage || null;
}

/**
 * Kirim ulang sticker hasil .repack.
 * - Metadata (packname) sudah diganti oleh pemanggil.
 * - Bila sticker aslinya sound sticker, audio asli dipakai kembali apa adanya
 *   (mediaKey/url/directPath sudah valid, sama seperti forward), sehingga
 *   audio tidak hilang. Upload ulang hanya dilakukan bila data audio tidak
 *   lengkap.
 * - Flag isAnimated dipertahankan agar sticker bergerak tetap bergerak.
 */
async function sendRepackedSticker(sock, chatId, { stickerBuffer, audioMessage, quoted }) {
    if (typeof sock?.waUploadToServer !== 'function' || typeof sock?.relayMessage !== 'function') {
        throw new Error('socket cannot relay media');
    }

    const { generateWAMessageFromContent, prepareWAMessageMedia } = require('@whiskeysockets/baileys');

    const upload = (filePath, opts) => sock.waUploadToServer(filePath, opts);
    const animated = isAnimatedWebp(stickerBuffer);
    const keepAudio = !!audioMessage && patchProtoForSoundStickers();

    const stickerMedia = await prepareWAMessageMedia(
        { sticker: stickerBuffer, isAnimated: animated },
        { upload }
    );

    if (!stickerMedia?.stickerMessage) {
        throw new Error('sticker upload did not return sticker payload');
    }

    const stickerMessage = { ...stickerMedia.stickerMessage, isAnimated: animated };

    if (keepAudio) {
        let audioPayload = isUsableAudio(audioMessage) ? audioMessage : null;

        if (!audioPayload) {
            try {
                audioPayload = await reuploadAudio(sock, audioMessage, upload);
            } catch (error) {
                console.error('[SOUND-STICKER] Audio re-upload failed:', error.message);
            }
        }

        stickerMessage.audioMessage = audioPayload || audioMessage;
    }

    const waMessage = generateWAMessageFromContent(chatId, { stickerMessage }, {
        quoted,
        userJid: sock.user?.id
    });

    await sock.relayMessage(chatId, waMessage.message, { messageId: waMessage.key.id });

    return true;
}

module.exports = {
    patchProtoForSoundStickers,
    sendSoundSticker,
    sendSoundStickerFromVideo,
    sendRepackedSticker,
    getStickerAudio,
    isAnimatedWebp,
    hasAudioStream
};
