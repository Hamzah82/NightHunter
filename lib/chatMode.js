const path = require('path');
const { readJson, writeJson } = require('./safeJson');

const MESSAGE_COUNT_PATH = path.join(__dirname, '../data/messageCount.json');
const CHAT_MODE_PATH = path.join(__dirname, '../data/chatMode.json');

function getGlobalMode() {
    const data = readJson(MESSAGE_COUNT_PATH, {});
    if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.isPublic === 'boolean') {
        return data.isPublic;
    }
    return true;
}

function setGlobalMode(isPublic) {
    const current = readJson(MESSAGE_COUNT_PATH, {});
    const data = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
    data.isPublic = Boolean(isPublic);
    return writeJson(MESSAGE_COUNT_PATH, data);
}

function readLocalModes() {
    const data = readJson(CHAT_MODE_PATH, {});
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function getLocalMode(chatId) {
    if (!chatId) return null;
    const entry = readLocalModes()[chatId];
    if (typeof entry === 'boolean') return entry;
    if (entry && typeof entry.isPublic === 'boolean') return entry.isPublic;
    return null;
}

function getChatMode(chatId) {
    const globalIsPublic = getGlobalMode();
    const localIsPublic = getLocalMode(chatId);
    const isPublic = localIsPublic === null ? globalIsPublic : localIsPublic;

    return {
        chatId,
        isPublic,
        mode: isPublic ? 'public' : 'private',
        source: localIsPublic === null ? 'global' : 'local',
        globalIsPublic,
        localIsPublic
    };
}

function setLocalMode(chatId, isPublic) {
    if (!chatId) return false;
    const data = readLocalModes();
    data[chatId] = {
        isPublic: Boolean(isPublic),
        updatedAt: new Date().toISOString()
    };
    return writeJson(CHAT_MODE_PATH, data);
}

function clearLocalMode(chatId) {
    if (!chatId) return false;
    const data = readLocalModes();
    if (!Object.prototype.hasOwnProperty.call(data, chatId)) return true;
    delete data[chatId];
    return writeJson(CHAT_MODE_PATH, data);
}

module.exports = {
    getGlobalMode,
    setGlobalMode,
    getLocalMode,
    getChatMode,
    setLocalMode,
    clearLocalMode
};
