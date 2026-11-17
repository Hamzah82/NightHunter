/**
 * Media downloader helpers (YouTube & TikTok) using multiple public APIs.
 */

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const api = axios.create({
    timeout: 30000,
    headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*'
    },
    validateStatus: status => status >= 200 && status < 400
});

function firstUrl(...values) {
    for (const value of values) {
        if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
    }
    return null;
}

async function fetchYouTubeAudio(url) {
    try {
        const { data } = await api.get('https://api-faa.my.id/faa/ytmp3', { params: { url } });
        const result = data?.result;
        const download = firstUrl(result?.mp3, result?.download_url, result?.url);
        if (data?.status && download) {
            return { url: download, title: result.title, thumbnail: result.thumbnail };
        }
    } catch {}

    try {
        const { data } = await api.get('https://apis.davidcyriltech.my.id/download/ytmp3', { params: { url } });
        const result = data?.result;
        const download = firstUrl(result?.download_url, result?.url);
        if (data?.success && download) {
            return { url: download, title: result.title, thumbnail: result.thumbnail };
        }
    } catch {}

    return null;
}

async function getYouTubeVideoSources(url) {
    const sources = [];

    try {
        const { data } = await api.get('https://apis.davidcyriltech.my.id/download/ytmp4', { params: { url } });
        const result = data?.result;
        const download = firstUrl(result?.download_url, result?.url);
        if (data?.success && download) {
            sources.push({ url: download, title: result.title, thumbnail: result.thumbnail });
        }
    } catch {}

    try {
        const { data } = await api.get('https://api-faa.my.id/faa/ytmp4', { params: { url } });
        const result = data?.result;
        const download = firstUrl(result?.download_url, result?.url, result?.mp4);
        if (data?.status && download) {
            sources.push({ url: download, title: result.title, thumbnail: result.thumbnail });
        }
    } catch {}

    return sources;
}

async function fetchYouTubeVideo(url) {
    const sources = await getYouTubeVideoSources(url);
    return sources[0] || null;
}

async function downloadYouTubeVideo(url, options = {}) {
    const { maxBytes = 64 * 1024 * 1024, timeout = 180000 } = options;
    const sources = await getYouTubeVideoSources(url);

    for (const source of sources) {
        try {
            const buffer = await downloadMedia(source.url, {
                timeout,
                maxBytes,
                headers: {
                    Referer: 'https://www.youtube.com/',
                    Origin: 'https://www.youtube.com'
                }
            });
            if (buffer.length > 1024) {
                return { ...source, buffer };
            }
        } catch (error) {
            console.error('[YT VIDEO] source failed:', error?.message || error);
        }
    }

    return null;
}

async function fetchTikTok(url) {
    try {
        const { data } = await api.get('https://www.tikwm.com/api/', {
            params: { url, hd: 1 },
            headers: { Referer: 'https://www.tikwm.com/' }
        });
        const media = data?.data;
        const video = firstUrl(media?.hdplay, media?.play, media?.wmplay);
        if (data?.code === 0 && video) {
            return {
                video,
                images: Array.isArray(media.images) ? media.images : [],
                audio: firstUrl(media.music),
                title: media.title,
                cover: media.cover
            };
        }
    } catch {}

    try {
        const { data } = await api.get('https://api-faa.my.id/faa/tiktok', { params: { url } });
        const result = data?.result;
        const video = firstUrl(result?.alternatives?.hd, result?.data, result?.alternatives?.sd, result?.alternatives?.wm);
        if (data?.status && video) {
            return {
                video,
                audio: firstUrl(result.music_info?.url),
                title: result.title,
                cover: result.cover
            };
        }
    } catch {}

    try {
        const { data } = await api.get('https://api.siputzx.my.id/api/d/tiktok', { params: { url } });
        const media = data?.data?.media;
        if (data?.status && Array.isArray(media) && media.length) {
            const hd = media.find(item => item.quality === 'HD');
            const sd = media.find(item => item.quality === 'SD');
            const video = firstUrl(hd?.backup, hd?.url, sd?.backup, sd?.url, media[0]?.backup, media[0]?.url);
            if (video) {
                return { video, audio: null, title: data.data.title, cover: data.data.cover };
            }
        }
    } catch {}

    try {
        const { ttdl } = require('ruhend-scraper');
        const result = await ttdl(url);
        const list = result?.data;
        if (Array.isArray(list)) {
            const entry = list.find(item => item?.type === 'video' || /\.(mp4|mov|webm)(\?|$)/i.test(item?.url || ''));
            if (entry?.url) {
                return { video: entry.url, audio: null, title: result.title || null };
            }
        }
    } catch {}

    return null;
}

function looksLikeErrorPage(buffer) {
    const head = buffer.slice(0, 512).toString('utf8').trim().toLowerCase();
    if (head.startsWith('<!doctype') || head.startsWith('<html')) return true;
    if (head.startsWith('{') && /"(error|message)"\s*:/.test(head)) return true;
    return false;
}

async function downloadMedia(url, options = {}) {
    const {
        timeout = 120000,
        maxBytes = 150 * 1024 * 1024,
        headers = {}
    } = options;

    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout,
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes,
        decompress: true,
        validateStatus: status => status >= 200 && status < 400,
        headers: {
            'User-Agent': UA,
            'Accept': '*/*',
            'Accept-Encoding': 'identity',
            ...headers
        }
    });

    const buffer = Buffer.from(response.data);
    if (!buffer.length) throw new Error('Empty media response');
    if (looksLikeErrorPage(buffer)) throw new Error('Download link returned an error page');
    return buffer;
}

module.exports = {
    fetchYouTubeAudio,
    fetchYouTubeVideo,
    downloadYouTubeVideo,
    fetchTikTok,
    downloadMedia
};
