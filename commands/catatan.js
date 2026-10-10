const fs = require('fs');
const path = require('path');

const CATATAN_DIR = path.join(__dirname, '../data/catatan');

function getMonthFile() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const filename = `${year}-${month}.json`;
    return { filePath: path.join(CATATAN_DIR, filename), filename, month, year };
}

function loadMonth() {
    const { filePath } = getMonthFile();
    if (!fs.existsSync(filePath)) return [];
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return [];
    }
}

function saveMonth(data) {
    const { filePath } = getMonthFile();
    if (!fs.existsSync(CATATAN_DIR)) fs.mkdirSync(CATATAN_DIR, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function formatRupiah(n) {
    return 'Rp' + Number(n).toLocaleString('id-ID');
}

function getSaldo(data) {
    let pemasukan = 0, pengeluaran = 0;
    for (const item of data) {
        if (item.jenis === 'masuk') pemasukan += item.nominal;
        else if (item.jenis === 'keluar') pengeluaran += item.nominal;
    }
    return { pemasukan, pengeluaran, saldo: pemasukan - pengeluaran };
}

async function catatanCommand(sock, chatId, message, args, senderIsOwner) {
    try {
        if (!senderIsOwner) {
            await sock.sendMessage(chatId, {
                text: '❌ *Only bot owner can use this command!*'
            }, { quoted: message });
            return;
        }

        const sub = args[0]?.toLowerCase();
        const data = loadMonth();
        const { filename, month, year } = getMonthFile();

        if (!sub || sub === 'help') {
            let help = `📒 *Catatan Keuangan ${month}/${year}*\n\n`;
            const { pemasukan, pengeluaran, saldo } = getSaldo(data);
            help += `💵 Pemasukan: ${formatRupiah(pemasukan)}\n`;
            help += `💸 Pengeluaran: ${formatRupiah(pengeluaran)}\n`;
            help += `💰 Saldo: ${formatRupiah(saldo)}\n\n`;
            help += `*Perintah:*\n`;
            help += `• \`.catat masuk 50000 jualan pulsa\`\n`;
            help += `• \`.catat keluar 15000 beli kuota\`\n`;
            help += `• \`.catat list\` — lihat semua transaksi bulan ini\n`;
            help += `• \`.catat total\` — ringkasan saldo\n`;
            help += `• \`.catat hapus <nomor>\` — hapus transaksi ke-N\n`;
            help += `• \`.catat export\` — export ke teks\n`;
            help += `• \`.catat help\` — bantuan ini`;
            await sock.sendMessage(chatId, { text: help }, { quoted: message });
            return;
        }

        if (sub === 'list' || sub === 'ls') {
            if (data.length === 0) {
                await sock.sendMessage(chatId, { text: '📭 Belum ada catatan bulan ini.' }, { quoted: message });
                return;
            }
            const { pemasukan, pengeluaran, saldo } = getSaldo(data);
            let msg = `📒 *Catatan ${month}/${year}*\n\n`;
            data.forEach((item, i) => {
                const icon = item.jenis === 'masuk' ? '💵' : '💸';
                msg += `${i + 1}. ${icon} ${formatRupiah(item.nominal)} — ${item.keterangan}\n`;
                if (item.tanggal) msg += `   📅 ${item.tanggal}\n`;
            });
            msg += `\n💵 Masuk: ${formatRupiah(pemasukan)}`;
            msg += `\n💸 Keluar: ${formatRupiah(pengeluaran)}`;
            msg += `\n💰 Saldo: ${formatRupiah(saldo)}`;
            await sock.sendMessage(chatId, { text: msg }, { quoted: message });
            return;
        }

        if (sub === 'total') {
            const { pemasukan, pengeluaran, saldo } = getSaldo(data);
            const msg = `📊 *Ringkasan ${month}/${year}*\n\n💵 Pemasukan: ${formatRupiah(pemasukan)}\n💸 Pengeluaran: ${formatRupiah(pengeluaran)}\n💰 Saldo: ${formatRupiah(saldo)}\n📝 Total transaksi: ${data.length}`;
            await sock.sendMessage(chatId, { text: msg }, { quoted: message });
            return;
        }

        if (sub === 'masuk' || sub === 'keluar') {
            const nominalStr = args[1]?.replace(/[^0-9]/g, '');
            const nominal = parseInt(nominalStr);
            if (!nominal || nominal <= 0) {
                await sock.sendMessage(chatId, {
                    text: '❌ Masukkan nominal yang valid.\n\nContoh: `.catat masuk 50000 jualan pulsa`'
                }, { quoted: message });
                return;
            }
            const keterangan = args.slice(2).join(' ') || '(tanpa keterangan)';
            const now = new Date();
            const tanggal = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
            data.push({
                jenis: sub,
                nominal,
                keterangan,
                tanggal,
                timestamp: now.toISOString()
            });
            saveMonth(data);
            const icon = sub === 'masuk' ? '💵' : '💸';
            await sock.sendMessage(chatId, {
                text: `${icon} *${sub === 'masuk' ? 'Pemasukan' : 'Pengeluaran'} dicatat!*\n\nNominal: ${formatRupiah(nominal)}\nKeterangan: ${keterangan}\nTanggal: ${tanggal}`
            }, { quoted: message });
            return;
        }

        if (sub === 'hapus' || sub === 'delete') {
            const idx = parseInt(args[1]) - 1;
            if (isNaN(idx) || idx < 0 || idx >= data.length) {
                await sock.sendMessage(chatId, {
                    text: `❌ Nomor transaksi tidak valid. Gunakan \`.catat list\` untuk lihat nomor.\n\nContoh: \`.catat hapus 3\``
                }, { quoted: message });
                return;
            }
            const removed = data.splice(idx, 1);
            saveMonth(data);
            await sock.sendMessage(chatId, {
                text: `🗑️ *Transaksi dihapus*\n\n${formatRupiah(removed[0].nominal)} — ${removed[0].keterangan}`
            }, { quoted: message });
            return;
        }

        if (sub === 'export') {
            if (data.length === 0) {
                await sock.sendMessage(chatId, { text: '📭 Belum ada catatan untuk di-export.' }, { quoted: message });
                return;
            }
            const { pemasukan, pengeluaran, saldo } = getSaldo(data);
            let text = `📒 CATATAN KEUANGAN ${month}/${year}\n`;
            text += `=${'='.repeat(40)}\n\n`;
            data.forEach((item, i) => {
                const icon = item.jenis === 'masuk' ? '[+]' : '[-]';
                text += `${i + 1}. ${icon} ${formatRupiah(item.nominal)} — ${item.keterangan} (${item.tanggal})\n`;
            });
            text += `\n${'='.repeat(40)}`;
            text += `\n💵 Pemasukan  : ${formatRupiah(pemasukan)}`;
            text += `\n💸 Pengeluaran: ${formatRupiah(pengeluaran)}`;
            text += `\n💰 Saldo      : ${formatRupiah(saldo)}`;
            await sock.sendMessage(chatId, { text }, { quoted: message });
            return;
        }

        // Unknown subcommand
        await sock.sendMessage(chatId, {
            text: '❌ Subcommand tidak dikenal. Gunakan `.catat help` untuk bantuan.'
        }, { quoted: message });

    } catch (error) {
        console.error('❌ Catatan Error:', error);
        await sock.sendMessage(chatId, { text: '❌ Error processing command.' }, { quoted: message });
    }
}

module.exports = catatanCommand;