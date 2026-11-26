const settings = require('../settings');
const fs = require('fs');
const path = require('path');

async function helpCommand(sock, chatId, message) {
    const helpMessage = `
╔═══════════════════╗
   *🤖 ${settings.botName || 'NightHunter-MD'}*
   Version: *${settings.version || '3.0.0'}*
   by ${settings.botOwner || 'Hoznyx'}
   YT : ${global.ytch}
╚═══════════════════╝

*Available Commands:*

╔═══════════════════╗
🌐 *General Commands*:
║ ➤ .help / .menu / .list
║ ➤ .ping
║ ➤ .alive
║ ➤ .tts <text>
║ ➤ .owner
║ ➤ .joke
║ ➤ .quote
║ ➤ .fact
║ ➤ .weather <city>
║ ➤ .news
║ ➤ .attp <text>
║ ➤ .lyrics <song_title>
║ ➤ .8ball <question>
║ ➤ .groupinfo / .infogp / .infogrupo
║ ➤ .staff / .admins / .listadmin
║ ➤ .take <reply to media/view-once/status>
║ ➤ .take vo <nomor/nama grup>
║ ➤ .take status <nomor>
║ ➤ .translate / .trt <text> <lang>
║ ➤ .ss / .ssweb / .screenshot <link>
║ ➤ .jid
║ ➤ .ppget <reply/@user>
║ ➤ .topmembers
║ ➤ .url / .tourl (reply media)
║ ➤ .convert <format> (reply to document)
╚═══════════════════╝

╔═══════════════════╗
👮‍♂️ *Admin Commands*:
║ ➤ .ban @user
║ ➤ .unban @user
║ ➤ .promote @user
║ ➤ .demote @user
║ ➤ .mute <minutes>
║ ➤ .unmute
║ ➤ .delete or .del
║ ➤ .kick @user
║ ➤ .warnings @user
║ ➤ .warn @user
║ ➤ .antilink
║ ➤ .antibadword
║ ➤ .clear
║ ➤ .tag <message>
║ ➤ .tagall
║ ➤ .tagnotadmin
║ ➤ .hidetag <message>
║ ➤ .chatbot
║ ➤ .resetlink / .revoke / .anularlink
║ ➤ .antitag <on/off>
║ ➤ .welcome <on/off>
║ ➤ .goodbye <on/off>
║ ➤ .setgdesc <description>
║ ➤ .setgname <new name>
║ ➤ .setgpp (reply to image)
╚═══════════════════╝

╔═══════════════════╗
🔒 *Owner Commands*:
║ ➤ .mode <public/private> [local]
║ ➤ .mode reset (hapus mode lokal chat ini)
║ ➤ .clearsession / .clearsesi
║ ➤ .antidelete
║ ➤ .cleartmp
║ ➤ .update
║ ➤ .settings
║ ➤ .setpp <reply to image>
║ ➤ .clonegb
║ ➤ .autoreact / .areact / .autoreaction <on/off>
║ ➤ .autostatus <on/off>
║ ➤ .autostatus react <on/off>
║ ➤ .autotyping <on/off>
║ ➤ .autoread <on/off>
║ ➤ .anticall on <alasan>
║ ➤ .anticall off
║ ➤ .anticall status
║ ➤ .anticall reset
║ ➤ .pmblocker <on/off/status>
║ ➤ .pmblocker setmsg <text>
║ ➤ .setmention <reply to msg>
║ ➤ .mention <on/off>
║ ➤ .save <judul> <reply pesan>
║ ➤ .get <judul>
║ ➤ .notes list
║ ➤ .notes del <judul>
║ ➤ .notes clear
║ ➤ .blocklist
║ ➤ .unblock <nomor>
║ ➤ .sudo add/del/list <@user|nomor>
║ ➤ .catat masuk/keluar/list/total/export/hapus
╚═══════════════════╝

╔═══════════════════╗
🎨 *Image/Sticker Commands*:
║ ➤ .blur <image>
║ ➤ .simage <reply to sticker>
║ ➤ .sticker <reply to image/video>
║    ↳ video with audio = sound sticker 🔊
║ ➤ .removebg / .rmbg / .nobg
║ ➤ .remini / .enhance / .upscale
║ ➤ .crop <reply to image>
║ ➤ .tgsticker / .stickertelegram / .telesticker <Link>
║ ➤ .meme
║ ➤ .repack / .steal <packname>
║    ↳ audio sound sticker ikut dipertahankan 🔊
║ ➤ .emojimix / .emix <emj1>+<emj2>
║ ➤ .igs <insta link>
║ ➤ .igsc <insta link>
╚═══════════════════╝

╔═══════════════════╗
🖼️ *Pies Commands*:
║ ➤ .pies <country>
║ ➤ .china
║ ➤ .indonesia
║ ➤ .japan
║ ➤ .korea
║ ➤ .hijab
║ ➤ .india
║ ➤ .malaysia
║ ➤ .thailand
╚═══════════════════╝

╔═══════════════════╗
🎮 *Game Commands*:
║ ➤ .tictactoe / .ttt @user
║ ➤ .move <1-9>
║ ➤ .surrender
║ ➤ .hangman
║ ➤ .guess <letter>
║ ➤ .trivia
║ ➤ .answer <answer>
║ ➤ .truth
║ ➤ .dare
╚═══════════════════╝

╔═══════════════════╗
🤖 *AI Commands*:
║ ➤ .gpt <question>
║ ➤ .gemini <question>
║ ➤ .jarvis <question>
║ ➤ .imagine / .dalle <prompt>
║ ➤ .flux <prompt>
║ ➤ .sora <prompt>
║ ➤ .ai <on/off/status/clear>
╚═══════════════════╝

╔═══════════════════╗
🎯 *Fun Commands*:
║ ➤ .compliment @user
║ ➤ .insult @user
║ ➤ .flirt
║ ➤ .shayari / .shayri
║ ➤ .goodnight / .lovenight / .gn
║ ➤ .roseday
║ ➤ .character @user
║ ➤ .wasted @user
║ ➤ .ship @user
║ ➤ .simp @user
║ ➤ .stupid / .iss / .itssostupid @user [text]
╚═══════════════════╝

╔═══════════════════╗
🔤 *Textmaker*:
║ ➤ .metallic <text>
║ ➤ .ice <text>
║ ➤ .snow <text>
║ ➤ .impressive <text>
║ ➤ .matrix <text>
║ ➤ .light <text>
║ ➤ .neon <text>
║ ➤ .devil <text>
║ ➤ .purple <text>
║ ➤ .thunder <text>
║ ➤ .leaves <text>
║ ➤ .1917 <text>
║ ➤ .arena <text>
║ ➤ .hacker <text>
║ ➤ .sand <text>
║ ➤ .blackpink <text>
║ ➤ .glitch <text>
║ ➤ .fire <text>
╚═══════════════════╝

╔═══════════════════╗
📥 *Downloader*:
║ ➤ .play <song_name>
║ ➤ .music <song_name>
║ ➤ .song / .mp3 / .ytmp3 <song_name>
║ ➤ .spotify <query>
║ ➤ .instagram <link>
║ ➤ .facebook / .fb <link>
║ ➤ .tiktok <link>
║ ➤ .video <song name>
║ ➤ .youtube <Link>
╚═══════════════════╝

╔═══════════════════╗
🧩 *MISC*:
║ ➤ .heart
║ ➤ .horny
║ ➤ .circle
║ ➤ .lgbt
║ ➤ .lolice
║ ➤ .its-so-stupid
║ ➤ .namecard
║ ➤ .oogway
║ ➤ .oogway2
║ ➤ .simpcard
║ ➤ .tonikawa
║ ➤ .tweet
║ ➤ .ytcomment
║ ➤ .comrade
║ ➤ .gay
║ ➤ .glass
║ ➤ .jail
║ ➤ .passed
║ ➤ .triggered
╚═══════════════════╝

╔═══════════════════╗
🖼️ *ANIME*:
║ ➤ .nom
║ ➤ .poke
║ ➤ .cry
║ ➤ .kiss
║ ➤ .pat
║ ➤ .hug
║ ➤ .wink
║ ➤ .face-palm / .facepalm
║ ➤ .animu <query>
║ ➤ .animuquote
╚═══════════════════╝

╔═══════════════════╗
💻 *Github Commands:*
║ ➤ .git
║ ➤ .github
║ ➤ .sc
║ ➤ .script
║ ➤ .repo
║ ➤ .checkupdate / .cekupdate
║ ➤ .checkupdate test
╚═══════════════════╝
`;

    try {
        const imagePath = path.join(__dirname, '../assets/bot_image.jpg');

        if (fs.existsSync(imagePath)) {
            const imageBuffer = fs.readFileSync(imagePath);

            await sock.sendMessage(chatId, {
                image: imageBuffer,
                caption: helpMessage,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true
                }
            },{ quoted: message });
        } else {
            console.error('Bot image not found at:', imagePath);
            await sock.sendMessage(chatId, {
                text: helpMessage,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true
                }
            });
        }
    } catch (error) {
        console.error('Error in help command:', error);
        await sock.sendMessage(chatId, { text: helpMessage });
    }
}

module.exports = helpCommand;