/**
 * Night Hunter - A WhatsApp Bot
 * Copyright (c) 2024 Hoznyx
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 * 
 * .convert command - Convert documents between formats locally with Node.js
 * libraries (no external binaries), with online API as fallback
 * Usage: Reply to a document with .convert <format>
 * Example: .convert pdf (converts replied document to PDF)
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { convertLocally } = require('../lib/documentConverter');

// MIME types for output formats
const FORMAT_MIME = {
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'odt': 'application/vnd.oasis.opendocument.text',
    'rtf': 'application/rtf',
    'txt': 'text/plain',
    'html': 'text/html',
    'epub': 'application/epub+zip',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ods': 'application/vnd.oasis.opendocument.spreadsheet',
    'csv': 'text/csv',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'odp': 'application/vnd.oasis.opendocument.presentation',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'gif': 'image/gif',
};

// Supported formats
const SUPPORTED_FORMATS = ['pdf', 'docx', 'html', 'txt', 'xlsx', 'xls', 'ods', 'csv', 'pptx', 'png', 'jpg', 'gif'];

const MIME_EXT = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.oasis.opendocument.spreadsheet': 'ods',
    'application/vnd.oasis.opendocument.text': 'odt',
    'text/csv': 'csv',
    'text/plain': 'txt',
    'text/html': 'html',
    'application/rtf': 'rtf',
    'application/epub+zip': 'epub',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.oasis.opendocument.presentation': 'odp',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
};

function normalizeExtension(ext) {
    const value = String(ext || '').toLowerCase().replace(/^\./, '').trim();
    if (!value || value === 'bin' || value === 'undefined' || value === 'null') return '';
    return value === 'jpeg' ? 'jpg' : value;
}

async function resolveExtension(fileName, mimetype, buffer) {
    const fromName = normalizeExtension(path.extname(fileName || '').slice(1));
    if (fromName) return fromName;

    const mime = String(mimetype || '').toLowerCase().split(';')[0].trim();
    const fromMime = normalizeExtension(MIME_EXT[mime]);
    if (fromMime) return fromMime;

    try {
        const FileType = require('file-type');
        const detected = await FileType.fromBuffer(buffer);
        if (detected?.ext) return normalizeExtension(detected.ext) || detected.ext;
    } catch {}

    return 'bin';
}

const WRAPPER_KEYS = ['documentWithCaptionMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'ephemeralMessage', 'editedMessage'];

function unwrapMessage(message) {
    let current = message || {};
    for (let i = 0; i < 6; i++) {
        const key = WRAPPER_KEYS.find(k => current?.[k]?.message);
        if (!key) break;
        current = current[key].message;
    }
    return current || {};
}

function cleanFileName(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

function findStringFieldDeep(value, field, depth = 0, seen = new Set()) {
    if (!value || typeof value !== 'object' || Buffer.isBuffer(value) || depth > 6) return '';
    if (seen.has(value)) return '';
    seen.add(value);

    const direct = cleanFileName(value[field]);
    if (direct) return direct;

    for (const key of Object.keys(value)) {
        const child = value[key];
        if (!child || typeof child !== 'object') continue;
        const found = findStringFieldDeep(child, field, depth + 1, seen);
        if (found) return found;
    }
    return '';
}

function isGenericFileName(name) {
    const base = String(name || '').toLowerCase().replace(/\.[^.]+$/, '');
    return base === 'file' || base === 'document';
}

function pickFileName(docMsg, rootMessage) {
    let fallback = '';
    for (const candidate of [docMsg?.fileName, docMsg?.title]) {
        const value = cleanFileName(candidate);
        if (!value) continue;
        if (!isGenericFileName(value)) return value;
        if (!fallback) fallback = value;
    }
    const root = rootMessage || docMsg;
    const deepFileName = findStringFieldDeep(root, 'fileName');
    if (deepFileName && !isGenericFileName(deepFileName)) return deepFileName;
    const deepTitle = findStringFieldDeep(root, 'title');
    if (deepTitle && !isGenericFileName(deepTitle)) return deepTitle;
    return fallback || deepFileName || deepTitle;
}

function buildOutputFileName(originalName, extension) {
    const normalized = String(originalName || '').trim().replace(/\\/g, '/');
    const name = path.basename(normalized) || 'file';
    const currentExt = path.extname(name);
    const base = currentExt ? name.slice(0, -currentExt.length) : name;
    return `${base || 'file'}.${extension}`;
}

/**
 * Get media buffer from message (current message)
 */
async function getMediaBufferAndExt(message) {
    const rootMessage = message.message || {};
    const m = unwrapMessage(rootMessage);
    
    if (m.documentMessage) {
        const docMsg = m.documentMessage;
        const stream = await downloadContentFromMessage(docMsg, 'document');
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        const fileName = pickFileName(docMsg, rootMessage);
        const ext = await resolveExtension(fileName, docMsg.mimetype, buffer);
        return { 
            buffer, 
            ext, 
            fileName: fileName || `file.${ext}`,
            mimetype: docMsg.mimetype
        };
    }
    
    if (m.imageMessage) {
        const stream = await downloadContentFromMessage(m.imageMessage, 'image');
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        const ext = await resolveExtension('image', m.imageMessage.mimetype, buffer);
        return { 
            buffer, 
            ext: ext === 'bin' ? 'jpg' : ext, 
            fileName: `image.${ext === 'bin' ? 'jpg' : ext}`,
            mimetype: m.imageMessage.mimetype
        };
    }
    
    if (m.videoMessage) {
        const stream = await downloadContentFromMessage(m.videoMessage, 'video');
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return { 
            buffer: Buffer.concat(chunks), 
            ext: 'mp4', 
            fileName: 'video.mp4',
            mimetype: m.videoMessage.mimetype
        };
    }
    
    if (m.stickerMessage) {
        const stream = await downloadContentFromMessage(m.stickerMessage, 'sticker');
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return { 
            buffer: Buffer.concat(chunks), 
            ext: 'webp', 
            fileName: 'sticker.webp',
            mimetype: m.stickerMessage.mimetype
        };
    }
    
    return null;
}

/**
 * Get media buffer from quoted message
 */
async function getQuotedMediaBufferAndExt(message) {
    const content = unwrapMessage(message.message || {});
    const contextInfo = content.extendedTextMessage?.contextInfo
        || content.documentMessage?.contextInfo
        || content.imageMessage?.contextInfo
        || content.videoMessage?.contextInfo
        || content.audioMessage?.contextInfo
        || content.stickerMessage?.contextInfo;
    const quoted = contextInfo?.quotedMessage || null;
    if (!quoted) return null;
    return getMediaBufferAndExt({ message: quoted });
}

/**
 * Convert document using API
 */
async function convertDocumentAPI(buffer, inputExt, outputFormat, fileName) {
    try {
        const local = await convertLocally(buffer, inputExt, outputFormat);
        if (local && local.length) return local;
    } catch (e) {
        console.error('Local conversion error:', e.message);
    }

    const formData = new FormData();
    formData.append('file', buffer, fileName || `file.${inputExt}`);
    formData.append('outputFormat', outputFormat);

    // Try Lalitop API first
    try {
        const response = await axios.post('https://api.lalitop.web.id/convert', formData, {
            headers: {
                ...formData.getHeaders()
            },
            responseType: 'arraybuffer',
            timeout: 180000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        if (response?.data && Buffer.byteLength(response.data) > 0) {
            return Buffer.from(response.data);
        }
    } catch (e) {
        // Continue to next API
    }

    // Try impf.web.id
    try {
        const altForm = new FormData();
        altForm.append('file', buffer, fileName || `file.${inputExt}`);
        
        const altResponse = await axios.post(`https://api.impf.web.id/convert/${outputFormat}`, altForm, {
            headers: {
                ...altForm.getHeaders()
            },
            responseType: 'arraybuffer',
            timeout: 180000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        if (altResponse?.data && Buffer.byteLength(altResponse.data) > 0) {
            return Buffer.from(altResponse.data);
        }
    } catch (e) {
        // Continue to next API
    }

    // Try ufutx.net
    try {
        const upForm = new FormData();
        upForm.append('file', buffer, fileName || `file.${inputExt}`);
        
        const upload = await axios.post('https://api.ufutx.net/upload', upForm, {
            headers: upForm.getHeaders(),
            timeout: 60000
        });

        if (upload?.data?.url) {
            const convRes = await axios.get(`https://api.ufutx.net/convert?url=${encodeURIComponent(upload.data.url)}&format=${outputFormat}`, {
                responseType: 'arraybuffer',
                timeout: 180000
            });

            if (convRes?.data && Buffer.byteLength(convRes.data) > 0) {
                return Buffer.from(convRes.data);
            }
        }
    } catch (e) {
        // Final error
    }

    throw new Error(`Konversi ${inputExt.toUpperCase()} ke ${outputFormat.toUpperCase()} belum didukung secara lokal dan layanan online sedang tidak tersedia.`);
}

async function convertCommand(sock, chatId, message, args) {
    // Debug: Log message structure
    console.log('📥 .convert called - args:', args);
    console.log('📤 Message keys:', Object.keys(message.message || {}));
    
    // Get media from current message OR quoted message
    let media = await getMediaBufferAndExt(message);
    console.log('📁 Media from current message:', media ? 'Found' : 'Not found');
    
    if (!media) media = await getQuotedMediaBufferAndExt(message);
    console.log('📁 Media from quoted message:', media ? 'Found' : 'Not found');
    if (media) console.log('[CONVERT] Detected:', { ext: media.ext, fileName: media.fileName, mimetype: media.mimetype });
    
    if (!media) {
        await sock.sendMessage(chatId, {
            text: `📋 *Document Converter*

Usage: Reply to a document with .convert <format>

Supported formats:
📄 Documents: pdf, docx, html, txt
📊 Spreadsheets: xlsx, xls, ods, csv
📽️ Presentations: pptx
🖼️ Images: png, jpg, gif

Examples:
• .convert pdf
• .convert docx
• .convert xlsx`,
            contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363161513685998@newsletter',
                    newsletterName: 'Night Hunter MD',
                    serverMessageId: -1
                }
            }
        }, { quoted: message });
        return;
    }

    const targetFormat = args?.toLowerCase().trim();
    
    if (!targetFormat) {
        await sock.sendMessage(chatId, {
            text: 'Please specify target format.\nExample: .convert pdf',
            contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363161513685998@newsletter',
                    newsletterName: 'Night Hunter MD',
                    serverMessageId: -1
                }
            }
        }, { quoted: message });
        return;
    }

    if (!SUPPORTED_FORMATS.includes(targetFormat)) {
        await sock.sendMessage(chatId, {
            text: `Unsupported format: "${targetFormat}"\n\nSupported: pdf, docx, html, txt, xlsx, xls, ods, csv, pptx, png, jpg, gif`,
            contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363161513685998@newsletter',
                    newsletterName: 'Night Hunter MD',
                    serverMessageId: -1
                }
            }
        }, { quoted: message });
        return;
    }

    const sourceExt = media.ext.toLowerCase();
    
    if (sourceExt === targetFormat) {
        await sock.sendMessage(chatId, {
            text: `File is already in ${targetFormat.toUpperCase()} format.`
        }, { quoted: message });
        return;
    }

    // Check file size (limit to 20MB)
    const fileSize = media.buffer.length;
    if (fileSize > 20 * 1024 * 1024) {
        await sock.sendMessage(chatId, {
            text: `File too large. Maximum size is 20MB.\nYour file: ${(fileSize / 1024 / 1024).toFixed(2)}MB`
        }, { quoted: message });
        return;
    }

    // Send processing message
    const processingMsg = await sock.sendMessage(chatId, {
        text: `⏳ Converting ${media.fileName} to ${targetFormat.toUpperCase()}...\n\nPlease wait, this may take a moment.`,
        contextInfo: {
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363161513685998@newsletter',
                newsletterName: 'Night Hunter MD',
                serverMessageId: -1
            }
        }
    }, { quoted: message });

    try {
        // Convert using API
        const convertedBuffer = await convertDocumentAPI(
            media.buffer, 
            sourceExt, 
            targetFormat, 
            media.fileName
        );

        // Generate output filename
        const outputFileName = buildOutputFileName(media.fileName, targetFormat);

        // Send the converted file
        await sock.sendMessage(chatId, {
            document: convertedBuffer,
            fileName: outputFileName,
            mimetype: FORMAT_MIME[targetFormat] || 'application/octet-stream',
            caption: `✅ Converted from ${sourceExt.toUpperCase()} to ${targetFormat.toUpperCase()}\n\nOriginal: ${media.fileName}`,
            contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363161513685998@newsletter',
                    newsletterName: 'Night Hunter MD',
                    serverMessageId: -1
                }
            }
        }, { quoted: message });

        // Delete processing message
        try {
            await sock.sendMessage(chatId, { delete: processingMsg.key });
        } catch {}

    } catch (error) {
        console.error('Convert command error:', error);
        
        const errorMsg = error.message || 'Unknown error occurred';

        await sock.sendMessage(chatId, {
            text: `❌ Failed to convert document.\n\n${errorMsg}`,
            contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363161513685998@newsletter',
                    newsletterName: 'Night Hunter MD',
                    serverMessageId: -1
                }
            }
        }, { quoted: message });

        // Try to delete processing message
        try {
            await sock.sendMessage(chatId, { delete: processingMsg.key });
        } catch {}
    }
}

module.exports = convertCommand;
