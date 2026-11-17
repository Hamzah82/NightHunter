const fs = require('fs');
const path = require('path');

const warningsFilePath = path.join(__dirname, '../data/warnings.json');

function loadWarnings() {
    try {
        const raw = fs.readFileSync(warningsFilePath, 'utf8');
        const data = JSON.parse(raw);
        return data && typeof data === 'object' ? data : {};
    } catch {
        return {};
    }
}

async function warningsCommand(sock, chatId, mentionedJidList, message) {
    const warnings = loadWarnings();

    if (!Array.isArray(mentionedJidList) || mentionedJidList.length === 0) {
        await sock.sendMessage(chatId, { text: 'Please mention a user to check warnings.' }, { quoted: message });
        return;
    }

    const userToCheck = mentionedJidList[0];
    const groupWarnings = warnings[chatId] && typeof warnings[chatId] === 'object' ? warnings[chatId] : {};
    const warningCount = Number(groupWarnings[userToCheck] || 0);

    await sock.sendMessage(chatId, {
        text: `@${userToCheck.split('@')[0]} has ${warningCount} warning(s).`,
        mentions: [userToCheck]
    }, { quoted: message });
}

module.exports = warningsCommand;
