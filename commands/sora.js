// The only free txt2video API this command ever used (okatsu-rolezapiiz)
// now requires payment (HTTP 402) and no free/keyless replacement exists,
// so this command is disabled rather than silently failing.
async function soraCommand(sock, chatId, message) {
    await sock.sendMessage(chatId, {
        text: '❌ .sora is temporarily unavailable — no free text-to-video API currently exists for this feature.'
    }, { quoted: message });
}

module.exports = soraCommand;


