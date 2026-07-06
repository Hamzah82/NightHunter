const DEFAULT_TTL_MS = 60 * 1000;

const pending = new Map();

function setPending(key, data, ttlMs = DEFAULT_TTL_MS) {
    const existing = pending.get(key);
    if (existing?.timer) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
        pending.delete(key);
    }, ttlMs);
    if (typeof timer.unref === 'function') timer.unref();

    pending.set(key, { data, timer });
}

function getPending(key) {
    const entry = pending.get(key);
    return entry ? entry.data : null;
}

function clearPending(key) {
    const existing = pending.get(key);
    if (existing?.timer) clearTimeout(existing.timer);
    pending.delete(key);
}

module.exports = { setPending, getPending, clearPending };
