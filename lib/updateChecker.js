const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const util = require('util');
const { readJson, writeJson } = require('./safeJson');

const execFileAsync = util.promisify(execFile);

const GITHUB_API = 'https://api.github.com';
const CHECK_INTERVAL_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;

function firstLine(error) {
    return String(error?.message || error).split('\n')[0];
}

function networkError(message) {
    return /fetch|network|timeout|ENOTFOUND|EAI_AGAIN|ECONN|ETIMEDOUT/i.test(String(message || ''));
}

function rateLimitError(message) {
    return /HTTP 403|rate limit/i.test(String(message || ''));
}

function parseGitHubRepo(value) {
    const match = String(value || '').match(
        /github\.com[:\/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git|\/|$)/i
    );
    return match ? `${match[1]}/${match[2]}` : null;
}

function toWhatsAppJid(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    if (raw.includes('@')) {
        const [userPart, domain = 's.whatsapp.net'] = raw.split('@');
        const number = userPart.split(':')[0].replace(/\D/g, '');
        return number ? `${number}@${domain}` : null;
    }

    const number = raw.split(':')[0].replace(/\D/g, '');
    return number ? `${number}@s.whatsapp.net` : null;
}

function decodeXmlEntities(value) {
    return String(value || '')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

/**
 * Parse the newest commit from GitHub's public Atom feed
 * (https://github.com/<owner>/<repo>/commits/<branch>.atom).
 * The feed is not part of the REST API, so it is not affected by the
 * anonymous 60 requests/hour limit that panels with shared IPs hit.
 */
function parseCommitAtom(xml, slug) {
    const entry = String(xml || '').match(/<entry>([\s\S]*?)<\/entry>/i);
    if (!entry) throw new Error('Atom feed has no commit entries');

    const body = entry[1];
    const sha =
        body.match(/Grit::Commit\/([0-9a-f]{7,40})/i)?.[1] ||
        body.match(/\/commit\/([0-9a-f]{7,40})/i)?.[1];
    if (!sha) throw new Error('Atom feed has no commit SHA');

    const title = decodeXmlEntities(
        (body.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim()
    );
    const htmlUrl = decodeXmlEntities(body.match(/<link[^>]+href="([^"]+)"/i)?.[1] || '');

    return {
        sha,
        commit: { message: title || '(tanpa pesan)' },
        html_url: htmlUrl,
        slug
    };
}

function createUpdateChecker({
    rootDir,
    settings = {},
    logger = console,
    fetchImpl = globalThis.fetch,
    execFileImpl = execFileAsync,
    now = () => new Date()
} = {}) {
    if (!rootDir) throw new Error('createUpdateChecker: rootDir is required');

    const statePath = path.join(rootDir, 'data', 'updateState.json');
    const gitDir = path.join(rootDir, '.git');

    const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    if (!gitEnv.GIT_SSH_COMMAND) {
        gitEnv.GIT_SSH_COMMAND = 'ssh -oBatchMode=yes -oConnectTimeout=10';
    }

    let interval = null;

    const logInfo = (...args) => (logger.info || logger.log || (() => {})).apply(logger, args);
    const logWarn = (...args) => (logger.warn || logger.log || (() => {})).apply(logger, args);
    const logError = (...args) => (logger.error || logger.log || (() => {})).apply(logger, args);

    function readState() {
        const data = readJson(statePath, {});
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    }

    function saveState(patch) {
        return writeJson(statePath, { ...readState(), ...patch });
    }

    function getNotificationJids(sock) {
        const jids = new Set();

        const ownerJid =
            toWhatsAppJid(process.env.UPDATE_NOTIFY_JID) || toWhatsAppJid(settings.ownerNumber);
        if (ownerJid) jids.add(ownerJid);

        const selfJid = toWhatsAppJid(sock?.user?.id);
        if (selfJid) jids.add(selfJid);

        return [...jids];
    }

    async function resolveRepoSlug() {
        if (fs.existsSync(gitDir)) {
            try {
                const { stdout } = await execFileImpl('git', ['remote', 'get-url', 'origin'], {
                    cwd: rootDir,
                    timeout: 5000
                });
                const slug = parseGitHubRepo(stdout);
                if (slug) return slug;
            } catch {}
        }

        return (
            parseGitHubRepo(settings.updateZipUrl) ||
            parseGitHubRepo(process.env.UPDATE_ZIP_URL) ||
            'Hamzah82/NightHunter'
        );
    }

    async function fetchText(url, headers) {
        if (typeof fetchImpl !== 'function') {
            throw new Error('fetch tidak tersedia (butuh Node.js >= 18)');
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetchImpl(url, { headers, signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status} (${url})`);
            return await response.text();
        } finally {
            clearTimeout(timer);
        }
    }

    async function fetchLatestCommitFromApi(slug) {
        const headers = {
            'User-Agent': 'NightHunter-Updater',
            Accept: 'application/vnd.github+json'
        };
        if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

        const body = await fetchText(`${GITHUB_API}/repos/${slug}/commits/main`, headers);
        let data;
        try {
            data = JSON.parse(body);
        } catch {
            throw new Error('GitHub API returned invalid JSON');
        }
        if (!data?.sha) throw new Error('GitHub API returned no commit');
        return data;
    }

    async function fetchLatestCommitFromAtom(slug) {
        const xml = await fetchText(`https://github.com/${slug}/commits/main.atom`, {
            'User-Agent': 'NightHunter-Updater',
            Accept: 'application/atom+xml, application/xml, text/xml'
        });
        return parseCommitAtom(xml, slug);
    }

    async function fetchLatestGitHubCommit(slug) {
        // Use REST only when a token is configured. Without a token the public
        // Atom feed avoids the anonymous API rate limit (60 req/hour per IP).
        if (process.env.GITHUB_TOKEN) {
            try {
                return { commit: await fetchLatestCommitFromApi(slug), source: 'api' };
            } catch (error) {
                logWarn('Auto-update: GitHub API gagal, mencoba Atom feed:', firstLine(error));
            }
        }

        try {
            return { commit: await fetchLatestCommitFromAtom(slug), source: 'atom' };
        } catch (atomError) {
            if (!process.env.GITHUB_TOKEN) {
                try {
                    // Last resort: unauthenticated REST API.
                    return { commit: await fetchLatestCommitFromApi(slug), source: 'api' };
                } catch (apiError) {
                    throw new Error(`Atom: ${firstLine(atomError)} | API: ${firstLine(apiError)}`);
                }
            }
            throw atomError;
        }
    }

    async function fetchRemoteUpdate(slug) {
        if (fs.existsSync(gitDir)) {
            try {
                await execFileImpl(
                    'git',
                    ['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main'],
                    { cwd: rootDir, timeout: 20000, env: gitEnv }
                );
                const { stdout } = await execFileImpl('git', ['rev-parse', 'origin/main'], {
                    cwd: rootDir,
                    timeout: 10000
                });
                const sha = String(stdout || '').trim();
                if (/^[0-9a-f]{40}$/i.test(sha)) return { sha, source: 'git', slug };
            } catch (error) {
                logWarn('Auto-update: git fetch gagal, mencoba git ls-remote:', firstLine(error));
            }
        }

        // Works even without .git or SSH credentials, as long as git is installed.
        try {
            const { stdout } = await execFileImpl(
                'git',
                ['ls-remote', `https://github.com/${slug}.git`, 'refs/heads/main'],
                { cwd: rootDir, timeout: 20000, env: gitEnv }
            );
            const sha = String(stdout || '').trim().split(/\s+/)[0] || '';
            if (/^[0-9a-f]{40}$/i.test(sha)) return { sha, source: 'ls-remote', slug };
            throw new Error('git ls-remote returned no SHA');
        } catch (error) {
            logWarn('Auto-update: git ls-remote gagal, memakai GitHub:', firstLine(error));
        }

        const { commit, source } = await fetchLatestGitHubCommit(slug);
        return { sha: commit.sha, source, slug, commit };
    }

    async function getLocalRev() {
        if (!fs.existsSync(gitDir)) return '';
        try {
            const { stdout } = await execFileImpl('git', ['rev-parse', 'HEAD'], {
                cwd: rootDir,
                timeout: 10000
            });
            return String(stdout || '').trim();
        } catch {
            return '';
        }
    }

    // True when the local checkout already contains the remote commit
    // (local is equal to or ahead of origin/main). Prevents a false
    // "update available" notification for unpushed local commits.
    async function localContains(remoteSha) {
        if (!fs.existsSync(gitDir)) return false;
        try {
            await execFileImpl('git', ['merge-base', '--is-ancestor', remoteSha, 'HEAD'], {
                cwd: rootDir,
                timeout: 10000
            });
            return true;
        } catch {
            return false;
        }
    }

    async function buildCommitSummary(remote, baseline) {
        const shaPattern = /^[0-9a-f]{7,40}$/i;

        if (remote.source === 'git' && shaPattern.test(baseline) && shaPattern.test(remote.sha)) {
            try {
                const { stdout } = await execFileImpl(
                    'git',
                    ['log', '--pretty=format:%h %s', `${baseline}..${remote.sha}`],
                    { cwd: rootDir, timeout: 10000 }
                );
                const lines = String(stdout || '').trim().split('\n').filter(Boolean);
                if (lines.length) return lines.map((line) => `• ${line}`).join('\n');
            } catch {}
        }

        // ls-remote only gives us the SHA; fetch the commit message once when
        // there is actually something to notify about.
        let commit = remote.commit;
        if (!commit && remote.source === 'ls-remote') {
            try {
                commit = await fetchLatestCommitFromAtom(remote.slug);
            } catch {}
        }

        if (commit) {
            const shortSha = String(commit.sha || remote.sha || '').slice(0, 7);
            const message =
                String(commit.commit?.message || '').split('\n')[0].trim() || '(tanpa pesan)';
            const link = commit.html_url || '';
            return `• ${shortSha} ${message}${link ? `\n${link}` : ''}`;
        }

        return `• ${String(remote.sha || '').slice(0, 7)}`;
    }

    async function sendUpdateNotification(sock, text, targets) {
        if (!targets.length) {
            throw new Error('Tidak ada target notifikasi. Set OWNER_NUMBER atau UPDATE_NOTIFY_JID.');
        }

        const sent = [];
        const failures = [];

        for (const jid of targets) {
            try {
                await sock.sendMessage(jid, { text });
                sent.push(jid);
                logInfo(`📬 Auto-update notification sent to ${jid}`);
            } catch (error) {
                failures.push(`${jid}: ${firstLine(error)}`);
            }
        }

        return { sent, failures };
    }

    async function run(sock, options = {}) {
        const { force = false, probe = false } = options;

        if (probe) {
            const targets = getNotificationJids(sock);
            const { sent, failures } = await sendUpdateNotification(
                sock,
                '✅ *Tes Notifikasi Update*\n\n' +
                    'Kalau pesan ini muncul, jalur notifikasi update bekerja.\n\n' +
                    'Bot akan mengirim notifikasi otomatis saat ada commit baru di GitHub.',
                targets
            );
            if (failures.length) {
                throw new Error(`Gagal kirim tes ke ${failures.join('; ')}`);
            }
            return { status: 'probe', sent, sha: '', repo: null };
        }

        const repoSlug = await resolveRepoSlug();
        const remote = await fetchRemoteUpdate(repoSlug);
        const state = readState();
        const localRev = await getLocalRev();
        const targets = getNotificationJids(sock);

        // The running code is already at (or ahead of) the latest commit:
        // remember it, but don't announce an update that is already installed.
        if (remote.sha === localRev || (await localContains(remote.sha))) {
            if (state.lastSeenCommit !== remote.sha) {
                saveState({ lastSeenCommit: remote.sha, repo: repoSlug, notifiedJids: [] });
            }
            return { status: 'up-to-date', sha: remote.sha, repo: repoSlug };
        }

        const repeat = state.lastSeenCommit === remote.sha;
        const alreadyNotified = new Set(
            !force && repeat && Array.isArray(state.notifiedJids) ? state.notifiedJids : []
        );
        const pending = targets.filter((jid) => !alreadyNotified.has(jid));

        if (repeat && !pending.length) {
            return { status: 'already-notified', sha: remote.sha, repo: repoSlug };
        }

        // No local git and no saved state (e.g. fresh ZIP/panel install):
        // announce the latest commit instead of silently recording a baseline.
        const baseline = state.lastSeenCommit || localRev || '';
        const firstRun = !baseline;
        const summary = await buildCommitSummary(remote, baseline);
        const text = firstRun
            ? `📦 *Commit Terbaru*\n\n` +
              `Commit terbaru di *${repoSlug}*:\n\n` +
              `${summary}\n\n` +
              `Ketik *.update* untuk menarik versi terbaru.`
            : `🔔 *Update Tersedia!*\n\n` +
              `Ada commit baru di *${repoSlug}*.\n\n` +
              `${summary}\n\n` +
              `Ketik *.update* untuk menarik versi terbaru.`;

        if (!pending.length) {
            return { status: 'no-target', sha: remote.sha, repo: repoSlug };
        }

        const { sent, failures } = await sendUpdateNotification(sock, text, pending);

        if (sent.length) {
            saveState({
                lastSeenCommit: remote.sha,
                repo: repoSlug,
                notifiedJids: [...new Set([...alreadyNotified, ...sent])],
                notifiedAt: now().toISOString()
            });
        }

        if (failures.length) {
            const error = new Error(`Gagal kirim notifikasi: ${failures.join('; ')}`);
            error.sha = remote.sha;
            error.sent = sent;
            throw error;
        }

        return {
            status: firstRun ? 'latest-info' : 'update',
            sha: remote.sha,
            repo: repoSlug,
            sent
        };
    }

    function start(sock) {
        if (interval) {
            clearInterval(interval);
            interval = null;
        }

        let checking = false;
        const check = async () => {
            if (checking) return;
            checking = true;
            try {
                await run(sock);
            } catch (error) {
                const message = firstLine(error);
                if (rateLimitError(message)) {
                    logError(
                        '❌ Auto-update: GitHub API kena rate limit. ' +
                            'Set GITHUB_TOKEN di .env agar cek update tetap andal.'
                    );
                } else if (!networkError(message)) {
                    logError('❌ Auto-update check error:', message);
                }
            } finally {
                checking = false;
            }
        };

        check();
        interval = setInterval(check, CHECK_INTERVAL_MS);
        logInfo('📡 Auto-update checker started (every 2 minutes)');
    }

    function stop() {
        if (interval) {
            clearInterval(interval);
            interval = null;
            logInfo('📡 Auto-update checker stopped');
        }
    }

    return { start, stop, run, getNotificationJids, resolveRepoSlug, statePath };
}

module.exports = {
    createUpdateChecker,
    parseGitHubRepo,
    parseCommitAtom,
    toWhatsAppJid,
    decodeXmlEntities
};
