/**
 * Night Hunter - A WhatsApp Bot
 * Copyright (c) 2024 Hoznyx
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 * 
 * .convert command - Convert documents between formats using online API
 * Usage: Reply to a document with .convert <format>
 * Example: .convert pdf (converts replied document to PDF)
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

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
const SUPPORTED_FORMATS = ['pdf', 'doc', 'docx', 'odt', 'rtf', 'html', 'txt', 'epub', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp', 'png', 'jpg', 'gif'];

/**
 * Get media buffer from message (current message)
 */
async function getMediaBufferAndExt(message) {
    const m = message.message || {};
    
    // Check documentMessage
    if (m.documentMessage) {
        const stream = await downloadContentFromMessage(m.documentMessage, 'document');
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const fileName = m.documentMessage.fileName || 'file.bin';
        const ext = path.extname(fileName).toLowerCase().slice(1) || 'bin';
        return { 
            buffer: Buffer.concat(chunks), 
            ext, 
            fileName,
            mimetype: m.documentMessage.mimetype
        };
    }
    
    // Check documentWithCaptionMessage (new WhatsApp format)
    if (m.documentWithCaptionMessage) {
        // documentWithCaptionMessage contains message property with the actual document
        const innerMsg = m.documentWithCaptionMessage.message;
        if (innerMsg?.documentMessage) {
            const docMsg = innerMsg.documentMessage;
            const stream = await downloadContentFromMessage(docMsg, 'document');
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const fileName = docMsg.fileName || 'file.bin';
            const ext = path.extname(fileName).toLowerCase().slice(1) || 'bin';
            return { 
                buffer: Buffer.concat(chunks), 
                ext, 
                fileName,
                mimetype: docMsg.mimetype
            };
        }
    }
    
    if (m.imageMessage) {
        const stream = await downloadContentFromMessage(m.imageMessage, 'image');
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return { 
            buffer: Buffer.concat(chunks), 
            ext: 'jpg', 
            fileName: 'image.jpg',
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
    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
    if (!quoted) return null;
    return getMediaBufferAndExt({ message: quoted });
}

/**
 * Convert document using API
 */
async function convertDocumentAPI(buffer, inputExt, outputFormat, fileName) {
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

    throw new Error('All conversion services are currently unavailable. Please try again later.');
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
    
    if (!media) {
        await sock.sendMessage(chatId, {
            text: `📋 *Document Converter*

Usage: Reply to a document with .convert <format>

Supported formats:
📄 Documents: pdf, doc, docx, odt, rtf, html, txt, epub
📊 Spreadsheets: xls, xlsx, ods, csv
📊 Presentations: ppt, pptx, odp
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
            text: `Unsupported format: "${targetFormat}"\n\nSupported: pdf, doc, docx, odt, rtf, html, txt, epub, xls, xlsx, ods, csv, ppt, pptx, odp, png, jpg, gif`,
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
        const outputFileName = path.basename(media.fileName, path.extname(media.fileName)) + '.' + targetFormat;

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
