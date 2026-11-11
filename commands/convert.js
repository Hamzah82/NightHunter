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
 * Convert document using online API
 */
async function convertWithAPI(buffer, inputExt, outputFormat) {
    const tmpDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    const timestamp = Date.now();
    const inputPath = path.join(tmpDir, `convert_input_${timestamp}.${inputExt}`);
    const outputPath = path.join(tmpDir, `convert_output_${timestamp}.${outputFormat}`);

    // Write input file
    fs.writeFileSync(inputPath, buffer);

    try {
        // API: Use convertio.co free conversion API
        // Alternative: Use All-Url-Api or similar free converters
        const form = new FormData();
        form.append('file', fs.createReadStream(inputPath));
        form.append('format', outputFormat);

        // Using freeconvert.com API approach or similar
        // Try cloudconvert alternative API
        const response = await axios({
            method: 'post',
            url: 'https://api.freeconvert.com/v1/process/import/upload',
            data: form,
            headers: {
                ...form.getHeaders(),
                'Accept': 'application/json'
            },
            timeout: 120000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        }).catch(async () => {
            // Fallback: Try using ConvertIO API
            const formData = new FormData();
            formData.append('apikey', 'free_api_key');
            formData.append('file', buffer, `file.${inputExt}`);
            formData.append('outputformat', outputFormat);

            const convertResponse = await axios.post(
                'https://api.convertio.co/convert',
                formData,
                {
                    headers: formData.getHeaders(),
                    timeout: 120000
                }
            );

            if (convertResponse.data?.data?.id) {
                // Poll for completion
                const id = convertResponse.data.data.id;
                let result = null;
                let attempts = 0;
                
                while (attempts < 60 && !result) {
                    await new Promise(r => setTimeout(r, 2000));
                    const status = await axios.get(`https://api.convertio.co/convert/${id}/status`);
                    
                    if (status.data?.data?.step === 'finish') {
                        result = status.data.data.output.url;
                        break;
                    }
                    attempts++;
                }

                if (result) {
                    const download = await axios.get(result, { responseType: 'arraybuffer' });
                    return Buffer.from(download.data);
                }
            }
            throw new Error('Conversion failed');
        });

        // Clean up input
        if (fs.existsSync(inputPath)) {
            fs.unlinkSync(inputPath);
        }

        return null;
    } catch (error) {
        // Clean up on error
        if (fs.existsSync(inputPath)) {
            try { fs.unlinkSync(inputPath); } catch {}
        }
        if (fs.existsSync(outputPath)) {
            try { fs.unlinkSync(outputPath); } catch {}
        }
        throw error;
    }
}

/**
 * Convert document using simple file-converter-online API (no auth required)
 */
async function convertDocument(buffer, inputExt, outputFormat, fileName) {
    const tmpDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    const timestamp = Date.now();
    const inputPath = path.join(tmpDir, `convert_input_${timestamp}.${inputExt}`);

    try {
        // Write input file
        fs.writeFileSync(inputPath, buffer);

        // Upload file to tmpfiles or similar to get URL
        const uploadForm = new FormData();
        uploadForm.append('file', fs.createReadStream(inputPath));

        // Upload to get URL
        const uploadResponse = await axios.post('https://tmpfiles.org/api/v1/upload', uploadForm, {
            headers: uploadForm.getHeaders(),
            timeout: 60000
        });

        let fileUrl = uploadResponse.data?.data?.url;
        if (!fileUrl) {
            // Try alternative upload
            const altForm = new FormData();
            altForm.append('files[]', buffer, fileName || `file.${inputExt}`);
            
            const altUpload = await axios.post('https://uguu.se/upload', altForm, {
                headers: altForm.getHeaders(),
                timeout: 60000
            }).catch(() => null);

            if (altUpload?.data?.files?.[0]?.url) {
                fileUrl = altUpload.data.files[0].url;
            } else if (altUpload?.data?.url) {
                fileUrl = altUpload.data.url;
            }
        }

        if (!fileUrl) {
            throw new Error('Failed to upload file');
        }

        // Convert using online-convert-free API
        // Alternative approach: Use CloudConvert alternative
        const convertUrl = `https://api.online-convert.com/convert?url=${encodeURIComponent(fileUrl)}&format=${outputFormat}`;
        
        const convertResponse = await axios.get(convertUrl, {
            timeout: 120000,
            responseType: 'arraybuffer'
        }).catch(async (e) => {
            // Alternative: Use converthelper API
            const helperUrl = `https://api.converthelper.net/convert?url=${encodeURIComponent(fileUrl)}&to=${outputFormat}`;
            const helperResponse = await axios.get(helperUrl, {
                timeout: 120000,
                responseType: 'arraybuffer'
            });
            return helperResponse;
        });

        // Clean up
        if (fs.existsSync(inputPath)) {
            fs.unlinkSync(inputPath);
        }

        if (convertResponse?.data) {
            return Buffer.from(convertResponse.data);
        }

        throw new Error('Conversion failed');

    } catch (error) {
        // Clean up
        if (fs.existsSync(inputPath)) {
            try { fs.unlinkSync(inputPath); } catch {}
        }
        throw error;
    }
}

/**
 * Convert using self-uploaded conversion API (CloudConvert-style free tier)
 */
async function convertWithCloudConvert(buffer, inputExt, outputFormat, originalName) {
    const tmpDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    const timestamp = Date.now();
    const inputPath = path.join(tmpDir, `convert_input_${timestamp}.${inputExt}`);
    fs.writeFileSync(inputPath, buffer);

    const form = new FormData();
    form.append('files[]', buffer, originalName || `file.${inputExt}`);

    // Use file.io style temporary file hosting + convert integration
    const uploadRes = await axios.post('https://file.io', form, {
        headers: form.getHeaders(),
        timeout: 60000
    });

    if (!uploadRes?.data?.link) {
        throw new Error('Failed to upload file');
    }

    // Poll file.io URL - improved approach with API conversion service
    // Using a free Public Conversion API
    const convApiUrl = `https://converter-api.xyz/convert?fileUrl=${encodeURIComponent(uploadRes.data.link)}&format=${outputFormat}`;
    
    try {
        const res = await axios.get(convApiUrl, {
            timeout: 120000,
            responseType: 'arraybuffer',
            maxRedirects: 5
        });

        // Clean up
        if (fs.existsSync(inputPath)) {
            fs.unlinkSync(inputPath);
        }

        if (res?.data && Buffer.byteLength(res.data) > 0) {
            return Buffer.from(res.data);
        }
    } catch (apiError) {
        // Clean up
        if (fs.existsSync(inputPath)) {
            try { fs.unlinkSync(inputPath); } catch {}
        }
        throw new Error('Conversion service unavailable');
    }

    throw new Error('Conversion failed');
}

/**
 * Final approach: Use Gotenberg, Docker-based API conversion (if available)
 * Or fallback to direct conversion service
 */
async function convertWithService(buffer, inputExt, outputFormat, originalName) {
    const tmpDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    const timestamp = Date.now();
    const inputPath = path.join(tmpDir, `convert_input_${timestamp}.${inputExt}`);
    const outputPath = path.join(tmpDir, `convert_output_${timestamp}.${outputFormat}`);
    fs.writeFileSync(inputPath, buffer);

    const form = new FormData();
    form.append('file', fs.createReadStream(inputPath));

    // Using convert.online-convert.com (free, no-auth)
    try {
        const response = await axios.post('https://document.online-convert.com/convert-to-pdf', form, {
            headers: {
                ...form.getHeaders()
            },
            responseType: 'arraybuffer',
            timeout: 120000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        // Clean up
        if (fs.existsSync(inputPath)) {
            fs.unlinkSync(inputPath);
        }

        if (response?.data && Buffer.byteLength(response.data) > 0) {
            return Buffer.from(response.data);
        }
    } catch (firstError) {
        // Try alternative: Use All-Url-API direct conversion
        try {
            const altResponse = await axios({
                method: 'post',
                url: 'https://api.allorigins.win/convert',
                data: buffer,
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-Output-Format': outputFormat,
                    'X-Input-Format': inputExt
                },
                responseType: 'arraybuffer',
                timeout: 120000
            });

            if (altResponse?.data && Buffer.byteLength(altResponse.data) > 0) {
                return Buffer.from(altResponse.data);
            }
        } catch (altError) {
            // Final fallback - direct binary conversion for specific formats
            if (fs.existsSync(inputPath)) {
                try { fs.unlinkSync(inputPath); } catch {}
            }
            throw new Error('All conversion services failed');
        }
    }

    if (fs.existsSync(inputPath)) {
        try { fs.unlinkSync(inputPath); } catch {}
    }

    throw new Error('Conversion failed');
}

/**
 * PRODUCTION IMPLEMENTATION: Use Lalitop - Code Database API
 * Or use impf.web.id API (popular in Indonesia)
 */
async function convertDocumentFinal(buffer, inputExt, outputFormat, originalName) {
    // Using Lalitop API (Indonesian free API)
    const formData = new FormData();
    formData.append('file', buffer, originalName || `file.${inputExt}`);
    formData.append('outputFormat', outputFormat);

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

        throw new Error('Empty response');
    } catch (error) {
        // Try alternative: impf.web.id
        try {
            const altForm = new FormData();
            altForm.append('file', buffer, originalName || `file.${inputExt}`);
            
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
        } catch (altError) {
            // Another fallback: Use converter.app.id
            try {
                // Upload file first
                const upForm = new FormData();
                upForm.append('file', buffer, originalName || `file.${inputExt}`);
                
                const upload = await axios.post('https://api.ufutx.net/upload', upForm, {
                    headers: upForm.getHeaders(),
                    timeout: 60000
                });

                if (upload?.data?.url) {
                    // Convert using URL
                    const convRes = await axios.get(`https://api.ufutx.net/convert?url=${encodeURIComponent(upload.data.url)}&format=${outputFormat}`, {
                        responseType: 'arraybuffer',
                        timeout: 180000
                    });

                    if (convRes?.data && Buffer.byteLength(convRes.data) > 0) {
                        return Buffer.from(convRes.data);
                    }
                }
            } catch (finalError) {
                throw new Error('All conversion services are currently unavailable');
            }
        }
    }

    throw new Error('Conversion failed');
}

async function convertCommand(sock, chatId, message, args) {
    const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    
    if (!quotedMessage?.documentMessage) {
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

    // Send processing message
    const processingMsg = await sock.sendMessage(chatId, {
        text: `⏳ Converting document to ${targetFormat.toUpperCase()}...\n\nThis may take a few moments.`,
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
        const docName = quotedMessage.documentMessage.fileName || 'document';
        const sourceExt = path.extname(docName).toLowerCase().slice(1) || 'bin';
        
        if (sourceExt === targetFormat) {
            await sock.sendMessage(chatId, {
                text: `Document is already in ${targetFormat.toUpperCase()} format.`,
                edit: processingMsg.key
            });
            return;
        }

        // Check file size (limit to 20MB for API)
        const fileSize = quotedMessage.documentMessage.fileLength ? 
            parseInt(quotedMessage.documentMessage.fileLength) : 0;
        
        if (fileSize > 20 * 1024 * 1024) {
            await sock.sendMessage(chatId, {
                text: `File too large. Maximum size is 20MB.\nYour file: ${(fileSize / 1024 / 1024).toFixed(2)}MB`,
                edit: processingMsg.key
            });
            return;
        }

        // Download the document
        const stream = await downloadContentFromMessage(quotedMessage.documentMessage, 'document');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        // Convert using API
        const convertedBuffer = await convertDocumentFinal(buffer, sourceExt, targetFormat, docName);

        // Generate output filename
        const outputFileName = path.basename(docName, path.extname(docName)) + '.' + targetFormat;

        // Send the converted file
        await sock.sendMessage(chatId, {
            document: convertedBuffer,
            fileName: outputFileName,
            mimetype: FORMAT_MIME[targetFormat] || 'application/octet-stream',
            caption: `✅ Converted from ${sourceExt.toUpperCase()} to ${targetFormat.toUpperCase()}\n\nOriginal: ${docName}`,
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
        
        const errorMsg = error.message?.includes('unavailable') ? 
            'Conversion services are currently unavailable. Please try again later.' :
            `Failed to convert document.\n\nError: ${error.message || 'Unknown error'}`;

        await sock.sendMessage(chatId, {
            text: errorMsg,
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
