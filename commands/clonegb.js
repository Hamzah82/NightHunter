const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Normalize a JID down to a comparable phone-number form so the bot's own id
// (which may carry a :device suffix or an @lid domain) can be excluded reliably.
function baseNumber(jid) {
    if (!jid) return '';
    return String(jid).split('@')[0].split(':')[0];
}

// .clonegb — create a brand new group that mirrors the current group:
// same name, description, profile picture and members. Owner/sudo only
// (gated in main.js via ownerCommands). Uses only the normal Baileys group
// API, so members whose privacy blocks direct-add simply won't be added.
async function cloneGroupCommand(sock, chatId, senderId, message) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: '❌ This command can only be used inside a group.' }, { quoted: message });
        return;
    }

    let ppPath = null;
    try {
        await sock.sendMessage(chatId, { text: '⏳ Cloning this group, please wait...' }, { quoted: message });

        // 1. Read source group metadata.
        const meta = await sock.groupMetadata(chatId);
        const sourceName = (meta.subject || 'Cloned Group').trim();
        const sourceDesc = (meta.desc || '').trim();
        const botBase = baseNumber(sock.user?.id);
        const members = (meta.participants || [])
            .map(p => p.id)
            .filter(id => baseNumber(id) !== botBase); // bot is already the creator

        // 2. Create the new group. The bot becomes creator + admin automatically.
        const created = await sock.groupCreate(sourceName, []);
        const newId = created.id;

        // 3. Copy the description.
        if (sourceDesc) {
            try { await sock.groupUpdateDescription(newId, sourceDesc); } catch (_) {}
        }

        // 4. Copy the profile picture (download to tmp first — most reliable path,
        //    mirroring commands/groupmanage.js). Groups without a photo just skip.
        try {
            const ppUrl = await sock.profilePictureUrl(chatId, 'image');
            if (ppUrl) {
                const tmpDir = path.join(process.cwd(), 'tmp');
                if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
                const res = await axios.get(ppUrl, { responseType: 'arraybuffer' });
                ppPath = path.join(tmpDir, `clonegb_${newId.split('@')[0]}.jpg`);
                fs.writeFileSync(ppPath, Buffer.from(res.data));
                await sock.updateProfilePicture(newId, { url: ppPath });
            }
        } catch (_) { /* no pfp / not accessible — ignore */ }

        // 5. Add members in chunks. Baileys returns per-participant status codes;
        //    '200' means added, anything else (privacy, not-on-whatsapp, etc.) fails.
        let added = 0;
        let failed = 0;
        const chunkSize = 8;
        for (let i = 0; i < members.length; i += chunkSize) {
            const chunk = members.slice(i, i + chunkSize);
            try {
                const results = await sock.groupParticipantsUpdate(newId, chunk, 'add');
                for (const r of results) {
                    if (String(r.status) === '200') added++;
                    else failed++;
                }
            } catch (_) {
                failed += chunk.length;
            }
        }

        // 6. Fetch an invite link for the new group.
        let inviteLink = '';
        try {
            const code = await sock.groupInviteCode(newId);
            if (code) inviteLink = `https://chat.whatsapp.com/${code}`;
        } catch (_) {}

        // 7. Report back to the source group.
        let report = `✅ *Group cloned successfully!*\n\n` +
            `📛 *Name:* ${sourceName}\n` +
            `👥 *Members added:* ${added}/${members.length}\n`;
        if (failed > 0) {
            report += `⚠️ *Not added:* ${failed} (private "who can add me" settings or not on WhatsApp)\n`;
        }
        if (inviteLink) {
            report += `\n🔗 *Invite link:*\n${inviteLink}`;
        }
        await sock.sendMessage(chatId, { text: report }, { quoted: message });

        // Greet the new group.
        try {
            await sock.sendMessage(newId, { text: `🐺 This group is a clone of *${sourceName}*, created by the bot.` });
        } catch (_) {}
    } catch (error) {
        console.error('Error in clonegb command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to clone the group. Make sure the bot can create groups and try again.' }, { quoted: message });
    } finally {
        if (ppPath) { try { fs.unlinkSync(ppPath); } catch (_) {} }
    }
}

module.exports = cloneGroupCommand;
