const path = require('path');
const { readJson } = require('./safeJson');

function normalizeUserId(jid) {
    return String(jid || '').split('@')[0].split(':')[0];
}

function isBanned(userId) {
    try {
        const bannedUsers = readJson(path.join(process.cwd(), 'data/banned.json'), []);
        if (!Array.isArray(bannedUsers) || bannedUsers.length === 0) return false;

        const targets = (Array.isArray(userId) ? userId : [userId])
            .filter(Boolean)
            .map(normalizeUserId);

        if (targets.length === 0) return false;

        return bannedUsers.some(entry => targets.includes(normalizeUserId(entry)));
    } catch (error) {
        console.error('Error checking banned status:', error);
        return false;
    }
}

module.exports = { isBanned, normalizeUserId };
