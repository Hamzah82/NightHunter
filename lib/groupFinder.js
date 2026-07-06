async function findGroupsByName(sock, query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];

    const groups = await sock.groupFetchAllParticipating();
    return Object.values(groups)
        .filter(g => (g.subject || '').toLowerCase().includes(q))
        .map(g => ({ id: g.id, subject: g.subject || g.id }));
}

module.exports = { findGroupsByName };
