const axios = require('axios');
const { fetchTikTok, downloadMedia } = require('../lib/mediaDownloader');

const processedMessages = new Set();
const TIKTOK_URL = /^https?:\/\/(?:www\.|vm\.|vt\.|m\.)?tiktok\.com\//i;

async function resolveShortUrl(url) {
    try {
        const response = await axios.get(url, {
            timeout: 15000,
            maxRedirects: 10,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const finalUrl = response?.request?.res?.responseUrl;
        return typeof finalUrl === 'string' && finalUrl ? finalUrl : url;
    } catch {
        return url;
    }
}

function buildCaption(title) {
    return title
        ? `𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 𝗡𝗶𝗴𝗵𝘁𝗛𝘂𝗻𝘁𝗲𝗿-𝗕𝗢𝗧\n\n📝 Title: ${title}`
        : '𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 𝗡𝗶𝗴𝗵𝘁𝗛𝘂𝗻𝘁𝗲𝗿-𝗕𝗢𝗧';
}

async function tiktokCommand(sock, chatId, message) {
    try {
        if (processedMessages.has(message.key.id)) return;
        processedMessages.add(message.key.id);
        setTimeout(() => processedMessages.delete(message.key.id), 5 * 60 * 1000);

        const text = message.message?.conversation
            || message.message?.extendedTextMessage?.text
            || message.message?.imageMessage?.caption
            || '';

        const url = text.split(/\s+/).slice(1).join(' ').trim();

        if (!url || !TIKTOK_URL.test(url)) {
            return await sock.sendMessage(chatId, {
                text: 'Please provide a valid TikTok link.\nExample: .tiktok https://www.tiktok.com/@user/video/123'
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });

        const resolvedUrl = await resolveShortUrl(url);
        const media = await fetchTikTok(resolvedUrl);

        if (!media) {
            throw new Error('All download sources failed. The video may be private, deleted, or region-blocked.');
        }

        const caption = buildCaption(media.title);

        if (media.video) {
            let videoBuffer = null;
            try {
                videoBuffer = await downloadMedia(media.video, {
                    timeout: 120000,
                    headers: { Referer: 'https://www.tiktok.com/' }
                });
            } catch (err) {
                console.error('[TIKTOK] buffer download failed:', err.message);
            }

            if (videoBuffer) {
                await sock.sendMessage(chatId, {
                    video: videoBuffer,
                    mimetype: 'video/mp4',
                    caption
                }, { quoted: message });
            } else {
                await sock.sendMessage(chatId, {
                    video: { url: media.video },
                    mimetype: 'video/mp4',
                    caption
                }, { quoted: message });
            }
        } else if (media.images?.length) {
            for (const image of media.images.slice(0, 10)) {
                try {
                    await sock.sendMessage(chatId, {
                        image: { url: image },
                        caption
                    }, { quoted: message });
                } catch {}
            }
        } else {
            throw new Error('No downloadable media found in this TikTok post.');
        }

        if (media.audio) {
            try {
                const audioBuffer = await downloadMedia(media.audio, { timeout: 60000 });
                await sock.sendMessage(chatId, {
                    audio: audioBuffer,
                    mimetype: 'audio/mpeg',
                    fileName: 'tiktok-audio.mp3'
                }, { quoted: message });
            } catch {}
        }
    } catch (error) {
        console.error('[TIKTOK] Error:', error?.message || error);
        await sock.sendMessage(chatId, {
            text: `❌ Failed to download TikTok media.\n${error?.message || 'Please try again later.'}`
        }, { quoted: message });
    }
}

module.exports = tiktokCommand;
