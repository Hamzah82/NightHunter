const fs = require('fs');
const path = require('path');

function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        const raw = fs.readFileSync(file, 'utf8').trim();
        if (!raw) return fallback;
        return JSON.parse(raw);
    } catch (error) {
        console.error(`[safeJson] Failed to read ${file}:`, error.message);
        return fallback;
    }
}

function writeJson(file, data) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, file);
        return true;
    } catch (error) {
        console.error(`[safeJson] Failed to write ${file}:`, error.message);
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
        return false;
    }
}

module.exports = { readJson, writeJson };
