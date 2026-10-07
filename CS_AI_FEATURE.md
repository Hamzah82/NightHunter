# 🤖 CS AI Auto-Reply — Fitur Baru

## Deskripsi

Fitur **CS AI** (Customer Service AI) adalah auto-reply berbasis AI untuk setiap pesan masuk di chat pribadi (private chat). Setiap user yang mengirim pesan non-command ke bot akan otomatis dijawab oleh AI menggunakan kredensial dari `jarvis.json`.

---

## Cara Kerja

1. User mengirim pesan private (non-command, tidak diawali `.`)
2. Bot cek apakah nomor user ada di daftar nonaktif (`data/aiDisabled.json`)
3. Jika TIDAK dinonaktifkan → baca konfigurasi Jarvis dari `jarvis.json`
4. Panggil API AI dengan konteks session per-user
5. Balas pesan user secara otomatis
6. Session disimpan terpisah per user agar context window tidak tercampur

---

## Perintah

### `.ai` (Owner Only)

Perintah untuk mengelola CS AI. Hanya owner/sudo yang bisa mengakses.

```
.ai                    → Lihat bantuan lengkap
.ai status             → Daftar nomor yang dinonaktifkan
.ai off <nomor>        → Nonaktifkan CS AI untuk nomor tertentu
.ai on <nomor>         → Aktifkan kembali CS AI untuk nomor tertentu
.ai clear <nomor>      → Hapus session chat user tertentu
.ai clearchat          → Hapus semua session chat
```

Contoh:
```
.ai off 6281234567890   → Nomor ini tidak akan dijawab AI lagi
.ai on 6281234567890    → Aktifkan kembali
.ai status              → Cek daftar nomor yang dinonaktifkan
```

---

## Struktur Data

### `data/aiDisabled.json`

Menyimpan daftar JID/nomor yang menonaktifkan CS AI:

```json
[
  "6281234567890@s.whatsapp.net",
  "6289876543210@s.whatsapp.net"
]
```

### `data/aiSessions.json`

Menyimpan session/context per user agar tidak tercampur:

```json
{
  "6281234567890": {
    "history": [
      { "role": "user", "content": "Halo, apa fitur bot ini?", "timestamp": "..." },
      { "role": "assistant", "content": "Halo! 👋 Night Hunter MD punya banyak fitur...", "timestamp": "..." }
    ],
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

Setiap user menyimpan maksimal 20 pesan terakhir (10 turn) dalam session mereka.

---

## Konfigurasi

Fitur ini menggunakan kredensial dari **`jarvis.json`** yang sama dengan perintah `.jarvis`:

```json
{
  "api_key": "sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "api_url": "https://openrouter.ai/api/v1/chat/completions",
  "model": "gpt-4o-mini",
  "max_tokens": 2048,
  "temperature": 0.7
}
```

Jika `api_key` atau `api_url` belum dikonfigurasi (kosong/placeholder), maka auto-reply **tidak aktif** dan pesan user akan diabaikan tanpa error.

---

## System Prompt AI

AI berperan sebagai CS bot Night Hunter MD dengan panduan:

- Ramah, sopan, dan membantu
- Bahasa Indonesia santai tapi baik
- Tidak mengaku manusia (jelas AI CS bot)
- Arahkan ke owner jika diminta
- Jawaban singkat, padat, jelas (maks 3-4 paragraf)
- Emoji secukupnya

---

## File Terkait

- `commands/csbot.js` — Logika utama CS AI (command handler + auto-reply)
- `data/aiDisabled.json` — Daftar nomor nonaktif
- `data/aiSessions.json` — Session per user
- `main.js` — Integrasi handler (baris ~99, ~340-360, ~1036-1042)
- `jarvis.json` — Kredensial API (sudah ada sebelumnya)

---

## Catatan Penting

- Fitur hanya aktif di **private chat** (bukan grup)
- Pesan command (diawali `.`) tetap diproses normal
- Owner/sudo tidak di-auto-reply (untuk menghindari loop)
- Pesan dari diri sendiri (`fromMe`) diabaikan
- PM Blocker tetap berjalan sebelum CS AI — jika DM diblokir, CS AI tidak aktif