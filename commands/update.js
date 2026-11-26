const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const isOwnerOrSudo = require('../lib/isOwner');

const ROOT = path.join(__dirname, '..');
const SHA_RE = /^[0-9a-f]{7,40}$/i;

function run(cmd, timeout = 180000) {
    return new Promise((resolve, reject) => {
        exec(cmd, { cwd: ROOT, windowsHide: true, timeout }, (err, stdout, stderr) => {
            if (err) return reject(new Error((stderr || stdout || err.message || '').toString().trim()));
            resolve((stdout || '').toString());
        });
    });
}

async function hasGitRepo() {
    const gitDir = path.join(ROOT, '.git');
    if (!fs.existsSync(gitDir)) return false;
    try {
        await run('git --version', 10000);
        return true;
    } catch {
        return false;
    }
}

// Entri di data/ yang menyimpan setting (bukan media sementara).
const RUNTIME_DATA_DIRS = ['catatan', 'sesiAI'];

function copyDirRecursive(srcDir, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const src = path.join(srcDir, entry.name);
        const dest = path.join(destDir, entry.name);
        if (entry.isDirectory()) copyDirRecursive(src, dest);
        else fs.copyFileSync(src, dest);
    }
}

/**
 * Backup setting di data/ sebelum `git reset --hard`. Reset ke commit yang
 * tidak lagi memuat file-file ini akan menghapusnya dari working tree, jadi
 * backup ini yang menyelamatkan mode/antidelete/anticall milik user.
 */
function backupRuntimeData(backupDir) {
    const dataDir = path.join(ROOT, 'data');
    if (!fs.existsSync(dataDir)) return false;

    fs.mkdirSync(backupDir, { recursive: true });
    let copied = 0;

    for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
        const src = path.join(dataDir, entry.name);
        if (entry.isFile() && entry.name.endsWith('.json')) {
            fs.copyFileSync(src, path.join(backupDir, entry.name));
            copied++;
        } else if (entry.isDirectory() && RUNTIME_DATA_DIRS.includes(entry.name)) {
            copyDirRecursive(src, path.join(backupDir, entry.name));
            copied++;
        }
    }

    return copied > 0;
}

function restoreRuntimeData(srcDir, destDir) {
    if (!fs.existsSync(srcDir)) return 0;

    let restored = 0;
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const src = path.join(srcDir, entry.name);
        const dest = path.join(destDir, entry.name);

        if (entry.isDirectory()) {
            restored += restoreRuntimeData(src, dest);
            continue;
        }

        // Selalu tulis ulang: backup diambil tepat sebelum reset, jadi isinya
        // adalah setting user yang paling baru.
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        restored++;
    }

    return restored;
}

async function updateViaGit() {
    const oldRev = (await run('git rev-parse HEAD', 10000).catch(() => 'unknown')).trim();
    await run('git fetch --all --prune', 60000);
    const newRev = (await run('git rev-parse origin/main', 10000)).trim();

    // Jangan pernah memasukkan output git mentah ke shell command berikutnya.
    if (!SHA_RE.test(newRev)) throw new Error(`Ref origin/main tidak valid: ${newRev}`);
    if (oldRev !== 'unknown' && !SHA_RE.test(oldRev)) throw new Error(`HEAD tidak valid: ${oldRev}`);

    const alreadyUpToDate = oldRev === newRev;
    const commits = alreadyUpToDate
        ? ''
        : await run(`git log --pretty=format:"%h %s (%an)" ${oldRev}..${newRev}`, 15000).catch(() => '');
    const files = alreadyUpToDate
        ? ''
        : await run(`git diff --name-status ${oldRev} ${newRev}`, 15000).catch(() => '');

    // Backup setting dulu: reset ke commit yang tidak lagi memuat file state
    // akan menghapus data/*.json dari working tree.
    const backupDir = path.join(ROOT, 'tmp', `data-backup-${Date.now()}`);
    let backedUp = false;
    try {
        backedUp = backupRuntimeData(backupDir);
    } catch (error) {
        console.error('[update] gagal backup data/:', error.message);
    }

    await run(`git reset --hard ${newRev}`, 30000);
    // -e melindungi aset/state runtime yang tidak di-track git: hasil .setmention
    // dan seluruh setting di data/ (mode, antidelete, anticall, dst) tidak boleh
    // ikut terhapus saat update.
    await run("git clean -fd -e 'assets/mention_custom.*' -e 'data'", 30000);

    let restored = 0;
    if (backedUp) {
        try {
            restored = restoreRuntimeData(backupDir, path.join(ROOT, 'data'));
        } catch (error) {
            console.error('[update] gagal restore data/:', error.message);
        }
        try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch {}
    }

    return { oldRev, newRev, alreadyUpToDate, commits, files, restored };
}

function downloadFile(url, dest, visited = new Set()) {
    return new Promise((resolve, reject) => {
        try {
            // Avoid infinite redirect loops
            if (visited.has(url) || visited.size > 5) {
                return reject(new Error('Too many redirects'));
            }
            visited.add(url);

            const useHttps = url.startsWith('https://');
            const client = useHttps ? require('https') : require('http');
            const req = client.get(url, {
                headers: {
                    'User-Agent': 'NightHunter-Updater/1.0',
                    'Accept': '*/*'
                }
            }, res => {
                // Handle redirects
                if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
                    const location = res.headers.location;
                    if (!location) return reject(new Error(`HTTP ${res.statusCode} without Location`));
                    const nextUrl = new URL(location, url).toString();
                    res.resume();
                    return downloadFile(nextUrl, dest, visited).then(resolve).catch(reject);
                }

                if (res.statusCode !== 200) {
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }

                const file = fs.createWriteStream(dest);
                res.pipe(file);
                file.on('finish', () => file.close(resolve));
                file.on('error', err => {
                    try { file.close(() => {}); } catch {}
                    fs.unlink(dest, () => reject(err));
                });
            });

            // Jangan menggantung selamanya kalau koneksi panel macet.
            req.setTimeout(60000, () => req.destroy(new Error('Download timeout (60s)')));
            req.on('error', err => {
                fs.unlink(dest, () => reject(err));
            });
        } catch (e) {
            reject(e);
        }
    });
}

async function extractZip(zipPath, outDir) {
    // Try to use platform tools; no extra npm modules required
    if (process.platform === 'win32') {
        const cmd = `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${outDir.replace(/\\/g, '/')}' -Force"`;
        await run(cmd);
        return;
    }
    // Linux/mac: try unzip, else 7z, else busybox unzip
    try {
        await run('command -v unzip', 10000);
        await run(`unzip -o '${zipPath}' -d '${outDir}'`, 120000);
        return;
    } catch {}
    try {
        await run('command -v 7z', 10000);
        await run(`7z x -y '${zipPath}' -o'${outDir}'`, 120000);
        return;
    } catch {}
    try {
        await run('busybox unzip -h', 10000);
        await run(`busybox unzip -o '${zipPath}' -d '${outDir}'`, 120000);
        return;
    } catch {}
    throw new Error('No system unzip tool found (unzip/7z/busybox). Git mode is recommended on this panel.');
}

function copyRecursive(src, dest, ignore = [], relative = '', outList = []) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
        if (ignore.includes(entry)) continue;
        const s = path.join(src, entry);
        const d = path.join(dest, entry);
        const stat = fs.lstatSync(s);
        if (stat.isDirectory()) {
            copyRecursive(s, d, ignore, path.join(relative, entry), outList);
        } else {
            fs.copyFileSync(s, d);
            if (outList) outList.push(path.join(relative, entry).replace(/\\/g, '/'));
        }
    }
}

async function updateViaZip(zipOverride) {
    const zipUrl = (zipOverride || settings.updateZipUrl || process.env.UPDATE_ZIP_URL || '').trim();
    if (!zipUrl) {
        throw new Error('No ZIP URL configured. Set settings.updateZipUrl or UPDATE_ZIP_URL env.');
    }
    const tmpDir = path.join(ROOT, 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const zipPath = path.join(tmpDir, 'update.zip');
    await downloadFile(zipUrl, zipPath);
    const extractTo = path.join(tmpDir, 'update_extract');
    if (fs.existsSync(extractTo)) fs.rmSync(extractTo, { recursive: true, force: true });
    await extractZip(zipPath, extractTo);

    // GitHub zips create a REPO-branch folder. Pick the entry that really
    // contains package.json so a wrong/partial archive cannot overwrite the bot.
    const entries = fs.readdirSync(extractTo).map(n => path.join(extractTo, n));
    const srcRoot = entries.find(p => fs.existsSync(path.join(p, 'package.json'))) || extractTo;
    if (!fs.existsSync(path.join(srcRoot, 'package.json'))) {
        fs.rmSync(extractTo, { recursive: true, force: true });
        fs.rmSync(zipPath, { force: true });
        throw new Error('Isi ZIP tidak valid: package.json tidak ditemukan.');
    }

    // Copy over while preserving runtime dirs/files
    const ignore = ['node_modules', '.git', 'session', 'tmp', 'tmp/', 'temp', 'data', 'baileys_store.json', '.env'];
    const copied = [];

    // Preserve ownerNumber/botOwner from existing settings.js if present
    let preservedOwner = null;
    let preservedBotOwner = null;
    try {
        const currentSettings = require('../settings');
        preservedOwner = currentSettings && currentSettings.ownerNumber ? String(currentSettings.ownerNumber) : null;
        preservedBotOwner = currentSettings && currentSettings.botOwner ? String(currentSettings.botOwner) : null;
    } catch {}

    copyRecursive(srcRoot, ROOT, ignore, '', copied);

    if (preservedOwner) {
        try {
            const settingsPath = path.join(ROOT, 'settings.js');
            if (fs.existsSync(settingsPath)) {
                let text = fs.readFileSync(settingsPath, 'utf8');
                text = text.replace(/ownerNumber:\s*'[^']*'/, `ownerNumber: '${preservedOwner}'`);
                if (preservedBotOwner) {
                    text = text.replace(/botOwner:\s*'[^']*'/, `botOwner: '${preservedBotOwner}'`);
                }
                fs.writeFileSync(settingsPath, text);
            }
        } catch {}
    }

    // Cleanup extracted directory
    try { fs.rmSync(extractTo, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(zipPath, { force: true }); } catch {}
    return { copiedFiles: copied };
}

const NPM_INSTALL_TIMEOUT = 300000;

/**
 * Sinkronkan dependency setelah update.
 * Percobaan pertama pakai `npm install` biasa; kalau gagal karena konflik peer
 * dependency (umum pada Baileys rc + override jimp), ulangi dengan
 * `--legacy-peer-deps` seperti script `npm run install:panel`.
 */
async function installDependencies() {
    try {
        await run('npm install --no-audit --no-fund', NPM_INSTALL_TIMEOUT);
        return { ok: true, legacyPeerDeps: false };
    } catch (error) {
        console.error('[update] npm install gagal:', String(error.message || error).split('\n')[0]);
    }

    try {
        await run('npm install --no-audit --no-fund --legacy-peer-deps', NPM_INSTALL_TIMEOUT);
        return { ok: true, legacyPeerDeps: true };
    } catch (error) {
        console.error('[update] npm install --legacy-peer-deps gagal:', String(error.message || error).split('\n')[0]);
        return { ok: false, legacyPeerDeps: false };
    }
}

async function restartProcess() {    // Restart only this process when PM2 exposes its id; `pm2 restart all`
    // would also bounce unrelated apps hosted on the same panel.
    if (process.env.pm_id) {
        try {
            await run(`pm2 restart ${process.env.pm_id}`, 20000);
            return;
        } catch {}
    }
    try {
        await run('pm2 restart all', 20000);
        return;
    } catch {}
    // Panels usually auto-restart when the process exits.
    setTimeout(() => {
        process.exit(0);
    }, 500);
}

async function updateCommand(sock, chatId, message, zipOverride) {
    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

    if (!message.key.fromMe && !isOwner) {
        await sock.sendMessage(chatId, { text: 'Only bot owner or sudo can use .update' }, { quoted: message });
        return;
    }

    try {
        await sock.sendMessage(chatId, { text: '🔄 *Update bot dimulai...*' }, { quoted: message });

        let summary;
        let updateCodeChanged = false;

        if (await hasGitRepo()) {
            const { newRev, alreadyUpToDate, commits, files, restored } = await updateViaGit();
            updateCodeChanged = !alreadyUpToDate && /commands\/update\.js/.test(files || '');
            summary = alreadyUpToDate
                ? `✅ Sudah versi terbaru (${newRev.slice(0, 7)}).`
                : `✅ Diperbarui ke ${newRev.slice(0, 7)}.\n\n${commits || '(tanpa ringkasan commit)'}`;
            if (restored > 0) {
                summary += `\n\n💾 ${restored} file setting di data/ dipulihkan.`;
            }
        } else {
            const { copiedFiles } = await updateViaZip(zipOverride);
            summary = `✅ Update ZIP selesai (${copiedFiles.length} file).`;
            updateCodeChanged = copiedFiles.includes('commands/update.js');
        }

        // npm install selalu dijalankan (git & ZIP) supaya dependency baru
        // langsung terpasang tanpa perlu perintah tambahan di panel.
        await sock.sendMessage(chatId, {
            text: '📦 Menjalankan npm install... (bisa 1-3 menit)'
        }, { quoted: message });

        const install = await installDependencies();
        if (!install.ok) {
            summary += '\n\n⚠️ npm install gagal — jalankan manual di panel (`npm install --legacy-peer-deps`).';
        } else if (install.legacyPeerDeps) {
            summary += '\n\n📦 Dependency terpasang (`--legacy-peer-deps`).';
        } else {
            summary += '\n\n📦 Dependency terpasang.';
        }

        if (updateCodeChanged) {
            summary += '\n\nℹ️ Perubahan pada perintah .update baru aktif setelah restart ini.';
        }

        await sock.sendMessage(chatId, { text: `${summary}\n\n♻️ Restart bot...` }, { quoted: message });
        await restartProcess();
    } catch (error) {
        console.error('[update] gagal:', error);
        await sock.sendMessage(chatId, {
            text: `❌ Update gagal:\n${String(error.message || error).slice(0, 500)}`
        }, { quoted: message });
    }
}

module.exports = updateCommand;
