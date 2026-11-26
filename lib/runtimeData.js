/**
 * Night Hunter - A WhatsApp Bot
 * Copyright (c) 2024 Hoznyx
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * Bootstrap file state runtime (mode public/private, antidelete, anticall, dll).
 *
 * File-file di data/*.json TIDAK di-track git (lihat .gitignore), supaya
 * `git pull` / `git reset --hard` / `.update` tidak mengembalikan setting ke
 * default. Karena itu file yang belum ada harus dibuat di sini saat boot.
 */
const fs = require('fs');
const path = require('path');
const settings = require('../settings');

const DATA_DIR = path.join(__dirname, '..', 'data');

const SUB_DIRS = ['catatan', 'sesiAI'];

const DEFAULT_OWNER = String(settings.ownerNumber || '').replace(/\D/g, '');

const DEFAULTS = {
    // Daftar owner (dipakai index.js saat pairing). Di-seed dari settings.ownerNumber.
    'owner.json': DEFAULT_OWNER ? [DEFAULT_OWNER] : [],
    // Mode global (public/private) + hitungan pesan grup
    'messageCount.json': { isPublic: true, messageCount: {} },
    // Override mode per chat: { "<chatId>": { isPublic, updatedAt } }
    'chatMode.json': {},
    'antidelete.json': { enabled: false },
    'anticall.json': { enabled: false, reason: '', calls: {} },
    'autoread.json': { enabled: false },
    'autotyping.json': { enabled: false },
    'autoStatus.json': { enabled: false },
    'banned.json': [],
    'premium.json': [],
    'warnings.json': {},
    'aiDisabled.json': { globalEnabled: true, disabledList: [] },
    'mention.json': { enabled: false, assetPath: '', type: 'text' },
    'takeCache.json': [],
    'userGroupData.json': {
        users: [],
        groups: [],
        antilink: {},
        antibadword: {},
        warnings: {},
        sudo: [],
        welcome: {},
        goodbye: {},
        chatbot: {},
        autoReaction: false
    }
};

let ensured = false;

function writeDefault(filePath, defaultValue) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
}

/**
 * Pastikan satu file JSON ada dan isinya valid.
 * File yang korup di-rename ke `<nama>.broken-<timestamp>` supaya tidak
 * membuat bot crash berulang, lalu dibuat ulang dengan nilai default.
 */
function ensureFile(name, defaultValue) {
    const filePath = path.join(DATA_DIR, name);

    if (fs.existsSync(filePath)) {
        try {
            const raw = fs.readFileSync(filePath, 'utf8').trim();
            if (raw) {
                JSON.parse(raw);
                return false;
            }
            // File kosong: tulis ulang default.
        } catch (error) {
            const backup = `${filePath}.broken-${Date.now()}`;
            try {
                fs.renameSync(filePath, backup);
                console.error(`[runtimeData] ${name} rusak (${error.message}), disimpan sebagai ${path.basename(backup)}`);
            } catch (renameError) {
                console.error(`[runtimeData] ${name} rusak dan gagal di-backup: ${renameError.message}`);
            }
        }
    }

    writeDefault(filePath, defaultValue);
    return true;
}

/**
 * Buat folder data/ dan semua file state yang belum ada.
 * Aman dipanggil berkali-kali; file yang sudah ada tidak disentuh.
 */
function ensureRuntimeData() {
    if (ensured) return [];

    ensured = true;

    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

        for (const dir of SUB_DIRS) {
            const dirPath = path.join(DATA_DIR, dir);
            if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
        }

        const created = [];
        for (const [name, defaultValue] of Object.entries(DEFAULTS)) {
            try {
                if (ensureFile(name, defaultValue)) created.push(name);
            } catch (error) {
                console.error(`[runtimeData] gagal membuat ${name}: ${error.message}`);
            }
        }

        if (created.length > 0) {
            console.log(`[runtimeData] file state dibuat: ${created.join(', ')}`);
        }

        return created;
    } catch (error) {
        console.error('[runtimeData] gagal menyiapkan folder data:', error.message);
        return [];
    }
}

module.exports = { ensureRuntimeData, DEFAULTS };
