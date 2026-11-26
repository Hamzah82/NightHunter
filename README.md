# Night Hunter

WhatsApp bot multifungsi berbasis [Baileys](https://github.com/adiwajshing/Baileys) (Multi-Device). Dibuat untuk bantu admin ngelola grup WhatsApp.

Dikembangkan oleh [Hoznyx](https://github.com/Hamzah82).

---

## Fitur

- Manajemen grup: tagall, mute/unmute, kick, promote/demote, warn, antilink, antibadword
- AI: CS AI auto-reply (`.ai`), ChatGPT (`.gpt`), Jarvis (`.jarvis`), image generation
- Multimedia: sticker, TTS, YouTube download, TikTok, Instagram, Facebook
- Games: tictactoe, hangman, trivia
- Tools: translate, weather, news, lyrics, github, screenshot web
- Lainnya: welcome/goodbye, antidelete, anticall, autotyping, autoread, autostatus

## Perintah Penting

| Perintah | Fungsi |
|---|---|
| `.menu` / `.help` | Lihat semua perintah |
| `.ai status` | Status CS AI auto-reply |
| `.ai on/off <nomor>` | Aktifkan/nonaktifkan CS AI per nomor |
| `.ai on/off global` | Aktifkan/nonaktifkan CS AI global |
| `.ai stats` | Statistik CS AI |
| `.update` | Git pull + restart (VPS/panel) |
| `.jarvis <pesan>` | Tanya AI via kredensial sendiri |

### Mode Bot

- `.mode public` / `.mode private` — atur mode global (berlaku semua chat).
- `.mode public local` / `.mode private local` — atur mode hanya untuk grup/chat tempat perintah dikirim.
- `.mode reset` — hapus mode lokal chat tersebut, kembali mengikuti mode global.
- `.mode status` — lihat mode global dan mode lokal chat saat ini.

Contoh: bot global public, lalu `.mode private local` di satu grup membuat grup itu private tanpa mengubah grup lain.

## Cara Pasang

### Prasyarat
- Node.js >= 18
- Git
- npm

### Instalasi

```bash
git clone https://github.com/Hamzah82/NightHunter.git
cd NightHunter
npm install
node index.js
```

Scan QR code atau gunakan pair code yang muncul di terminal.

### Konfigurasi AI (Opsional)

Edit `jarvis.json` untuk mengaktifkan `.jarvis` dan CS AI auto-reply:

```json
{
  "api_key": "sk-or-v1-xxxxx",
  "api_url": "https://openrouter.ai/api/v1/chat/completions",
  "model": "gpt-4o-mini",
  "max_tokens": 2048,
  "temperature": 0.7
}
```

CS AI juga bisa dikustom lewat `SYSPROMPT.md`.

### Konfigurasi Environment (Opsional)

Buat file `.env` di root project. Semua nilai bersifat opsional:

```env
OWNER_NUMBER=628xxxxxxxxxx
GIPHY_API_KEY=
TELEGRAM_BOT_TOKEN=
OPENWEATHER_API_KEY=
NEWSAPI_KEY=
MEMORY_LIMIT_MB=450
UPDATE_NOTIFY_JID=
GITHUB_TOKEN=
```

- `TELEGRAM_BOT_TOKEN` wajib untuk fitur `.tgsticker`. Buat bot baru via @BotFather jika token lama pernah bocor.
- Tanpa `OPENWEATHER_API_KEY`, `.weather` memakai Open-Meteo/wttr.in (tanpa API key).
- Tanpa `NEWSAPI_KEY`, `.news` memakai Google News RSS (tanpa API key).
- `UPDATE_NOTIFY_JID` opsional; default notifikasi update dikirim ke `OWNER_NUMBER` dan chat bot sendiri.
- `GITHUB_TOKEN` opsional; hanya perlu untuk repo private atau jika kena rate limit GitHub API.
- `MEMORY_LIMIT_MB` mengaktifkan auto-restart saat pemakaian RAM melewati batas (biarkan kosong untuk menonaktifkan).

### Notifikasi update

- Bot mengecek commit terbaru setiap 2 menit setelah koneksi WhatsApp terbuka.
- Target notifikasi: `UPDATE_NOTIFY_JID` (jika diisi), `OWNER_NUMBER`, dan chat bot sendiri.
- Sumber commit dicoba berurutan: `git fetch` → `git ls-remote` → GitHub API (hanya jika `GITHUB_TOKEN` diisi) → Atom feed `commits/main.atom`. Tanpa token, Atom feed dipakai supaya tidak kena limit API anonim 60 request/jam yang sering habis di IP panel bersama.
- Di instalasi ZIP/panel tanpa `.git`, pengecekan pertama mengirim info commit terbaru satu kali; setelah itu hanya commit baru yang dikirim.
- `.checkupdate` untuk cek manual (owner/sudo), `.checkupdate test` untuk mengirim pesan tes ke target notifikasi.
- `.update` (owner/sudo) menarik versi terbaru, mem-backup `data/`, menjalankan `npm install` otomatis (fallback `--legacy-peer-deps` bila bentrok peer dependency), lalu restart bot. Mode ZIP juga menjalankan `npm install`.

### Catatan Dependensi

- Konversi dokumen (`.convert`), YouTube (`.song`/`.video`), dan TikTok berjalan penuh dengan library npm — tanpa binary eksternal.
- `ffmpeg` sistem hanya dibutuhkan untuk stiker video/GIF animasi (`.sticker` pada video), `.attp`, `.crop`, dan fitur multimedia lama. Stiker dari gambar/GIF statis diproses dengan `sharp`.
- Jalankan `npm test` untuk memeriksa sintaks seluruh file JavaScript.

## Struktur Direktori

```
data/
├── aiDisabled.json     # Daftar nomor nonaktif CS AI
├── messageCount.json   # Mode global (isPublic) + hitungan pesan grup
├── chatMode.json       # Override mode per chat
├── antidelete.json     # Setting antidelete
├── anticall.json       # Setting anticall + riwayat panggilan
├── *.json              # Setting lain (autoread, autotyping, banned, premium, dll)
├── catatan/            # Catatan per pengguna
└── sesiAI/             # Session CS AI per nomor
commands/               # Semua perintah bot
lib/                    # Helper & utilities
assets/                 # Gambar & aset
session/                # Session WhatsApp (jangan di-commit)
```

### Penyimpanan Setting

- Semua setting (`.mode`, `.antidelete`, `.anticall`, `.autoread`, `.autotyping`, `.autostatus`, banned/premium, dll) disimpan permanen di `data/*.json` dan **tidak di-track git**, jadi tidak ikut ter-reset oleh `git pull`, `git reset --hard`, atau `.update`.
- File yang belum ada dibuat otomatis saat boot oleh `lib/runtimeData.js`; file yang korup di-backup ke `<nama>.json.broken-<timestamp>` lalu dibuat ulang dengan nilai default.
- Jangan menghapus folder `data/` saat update/deploy, dan jangan pakai `git clean -fdx` (tanpa `-e data`).

## Catatan

- Bot ini untuk **edukasi**. Bukan official WhatsApp bot.
- Gunakan dengan bijak. Jangan spam.
- Risiko banned tetap ada — tanggung jawab pengguna.

## Lisensi

MIT License — lihat [LICENSE](LICENSE) untuk detail.