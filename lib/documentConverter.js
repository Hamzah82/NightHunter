/**
 * Pure Node.js document conversion (no external binaries).
 * Supports images, spreadsheets, DOCX, PDF, TXT and HTML.
 */

const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const SPREADSHEET_SOURCES = ['xlsx', 'xls', 'csv', 'ods'];
const SPREADSHEET_OUTPUTS = ['xlsx', 'xls', 'csv', 'html', 'ods'];

function normalizeExt(ext) {
    const value = String(ext || '').toLowerCase().replace(/^\./, '');
    return value === 'jpeg' ? 'jpg' : value;
}

function htmlToText(html) {
    const cheerio = require('cheerio');
    const $ = cheerio.load(String(html || ''));
    $('br').replaceWith('\n');
    $('p, div, li, tr, h1, h2, h3, h4, h5, h6').each((_, el) => {
        $(el).append('\n');
    });
    return $.root().text().replace(/\n{3,}/g, '\n\n').trim();
}

function textToHtml(text) {
    const escaped = String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br/>');
    return `<!DOCTYPE html><html><body><p>${escaped}</p></body></html>`;
}

function textToPdf(text) {
    const PDFDocument = require('pdfkit');
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.fontSize(11).text(String(text || ' '));
        doc.end();
    });
}

async function imageToFormat(buffer, outputFormat) {
    const sharp = require('sharp');
    const image = sharp(buffer, { animated: outputFormat === 'gif', failOn: 'none' });
    if (outputFormat === 'png') return image.png().toBuffer();
    if (outputFormat === 'jpg') return image.jpeg({ quality: 92 }).toBuffer();
    if (outputFormat === 'gif') return image.gif().toBuffer();
    if (outputFormat === 'webp') return image.webp().toBuffer();
    return null;
}

async function imageToPdf(buffer) {
    const sharp = require('sharp');
    const PDFDocument = require('pdfkit');
    const png = await sharp(buffer, { failOn: 'none' }).png().toBuffer();
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.image(png, { fit: [515, 760], align: 'center', valign: 'center' });
        doc.end();
    });
}

function spreadsheetToText(buffer) {
    const XLSX = require('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    return workbook.SheetNames.map(name => {
        const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
        return workbook.SheetNames.length > 1 ? `# ${name}\n${csv}` : csv;
    }).join('\n\n').trim();
}

function spreadsheetToFormat(buffer, outputFormat) {
    if (!SPREADSHEET_OUTPUTS.includes(outputFormat)) return null;
    const XLSX = require('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    if (outputFormat === 'csv' || outputFormat === 'html') {
        const text = XLSX.write(workbook, { type: 'string', bookType: outputFormat });
        return Buffer.from(text, 'utf8');
    }
    const output = XLSX.write(workbook, { type: 'buffer', bookType: outputFormat });
    return Buffer.isBuffer(output) ? output : Buffer.from(output);
}

async function docxToHtml(buffer) {
    const mammoth = require('mammoth');
    const result = await mammoth.convertToHtml({ buffer });
    return result.value || '';
}

async function docxToText(buffer) {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
}

let pdfjs;
function loadPdfjs() {
    if (!pdfjs) {
        if (typeof globalThis.DOMMatrix === 'undefined') globalThis.DOMMatrix = class DOMMatrix {};
        if (typeof globalThis.Path2D === 'undefined') globalThis.Path2D = class Path2D {};
        pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
    }
    return pdfjs;
}

async function pdfToText(buffer) {
    const pdf = await loadPdfjs().getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: true,
        isEvalSupported: false
    }).promise;
    try {
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            pages.push(content.items.map(item => item.str || '').join(' '));
            page.cleanup();
        }
        return pages.join('\n');
    } finally {
        await pdf.destroy();
    }
}

async function htmlToDocx(html) {
    const HTMLtoDOCX = require('html-to-docx');
    const result = await HTMLtoDOCX(html, null, { font: 'Helvetica', fontSize: 12 });
    return Buffer.isBuffer(result) ? result : Buffer.from(result);
}

function decodeXmlEntities(value) {
    return String(value)
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function extractSlideLines(xml) {
    const lines = [];
    let current = '';
    const re = /<\/a:p>|<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let match;
    while ((match = re.exec(xml))) {
        if (match[0] === '</a:p>') {
            lines.push(current);
            current = '';
        } else {
            current += decodeXmlEntities(match[1]);
        }
    }
    if (current) lines.push(current);
    return lines.map(line => line.trim()).filter(Boolean);
}

async function pptxToSlides(buffer) {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(buffer);
    const slideNames = Object.keys(zip.files)
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => {
            const numA = parseInt(a.match(/slide(\d+)\.xml/)[1], 10);
            const numB = parseInt(b.match(/slide(\d+)\.xml/)[1], 10);
            return numA - numB;
        });
    if (!slideNames.length) throw new Error('Tidak ada slide yang dapat dibaca dari PPTX.');

    const slides = [];
    for (const name of slideNames) {
        const xml = await zip.file(name).async('string');
        slides.push(extractSlideLines(xml));
    }
    return slides;
}

function slidesToText(slides) {
    return slides
        .map((lines, index) => `# Slide ${index + 1}\n${lines.join('\n')}`)
        .join('\n\n');
}

function slidesToPdf(slides) {
    const PDFDocument = require('pdfkit');
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        slides.forEach((lines, index) => {
            if (index > 0) doc.addPage();
            doc.fontSize(14).text(`Slide ${index + 1}`);
            doc.moveDown(0.5).fontSize(11);
            if (!lines.length) doc.text('(tidak ada teks)');
            lines.forEach(line => {
                doc.text(line);
                doc.moveDown(0.3);
            });
        });
        if (!slides.length) doc.text('(tidak ada slide)');
        doc.end();
    });
}

async function convertLocally(buffer, inputExt, outputFormat) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) return null;

    const source = normalizeExt(inputExt);
    const target = normalizeExt(outputFormat);
    if (!source || !target || source === target) return null;

    if (IMAGE_FORMATS.includes(source)) {
        if (IMAGE_FORMATS.includes(target)) return imageToFormat(buffer, target);
        if (target === 'pdf') return imageToPdf(buffer);
        return null;
    }

    if (SPREADSHEET_SOURCES.includes(source)) {
        if (SPREADSHEET_OUTPUTS.includes(target)) return spreadsheetToFormat(buffer, target);
        if (target === 'txt' || target === 'pdf' || target === 'docx') {
            const text = spreadsheetToText(buffer);
            if (target === 'txt') return Buffer.from(text, 'utf8');
            if (target === 'pdf') return textToPdf(text);
            return htmlToDocx(textToHtml(text));
        }
        return null;
    }

    if (source === 'docx') {
        if (target === 'txt') return Buffer.from(await docxToText(buffer), 'utf8');
        if (target === 'html') return Buffer.from(await docxToHtml(buffer), 'utf8');
        if (target === 'pdf') return textToPdf(htmlToText(await docxToHtml(buffer)));
        return null;
    }

    if (source === 'pdf') {
        if (target === 'txt') return Buffer.from(await pdfToText(buffer), 'utf8');
        if (target === 'html') return Buffer.from(textToHtml(await pdfToText(buffer)), 'utf8');
        if (target === 'docx') return htmlToDocx(textToHtml(await pdfToText(buffer)));
        return null;
    }

    if (source === 'pptx') {
        const slides = await pptxToSlides(buffer);
        if (target === 'txt') return Buffer.from(slidesToText(slides), 'utf8');
        if (target === 'html') return Buffer.from(textToHtml(slidesToText(slides)), 'utf8');
        if (target === 'pdf') return slidesToPdf(slides);
        if (target === 'docx') return htmlToDocx(textToHtml(slidesToText(slides)));
        return null;
    }

    if (source === 'txt') {
        const text = buffer.toString('utf8');
        if (target === 'html') return Buffer.from(textToHtml(text), 'utf8');
        if (target === 'pdf') return textToPdf(text);
        if (target === 'docx') return htmlToDocx(textToHtml(text));
        return null;
    }

    if (source === 'html' || source === 'htm') {
        const html = buffer.toString('utf8');
        if (target === 'txt') return Buffer.from(htmlToText(html), 'utf8');
        if (target === 'pdf') return textToPdf(htmlToText(html));
        if (target === 'docx') return htmlToDocx(html);
        return null;
    }

    return null;
}

module.exports = { convertLocally, normalizeExt };
