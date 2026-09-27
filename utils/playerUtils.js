const { getRankOrder } = require("./rankUtils");

// ─── Récupération des joueurs (BDD) ───────────────────────────────────────────
function getPlayerById(playerId) {
    return global.db.prepare(`SELECT * FROM players WHERE id = ?`).get(playerId);
}

// Joueurs actifs sur un serveur
function getGuildPlayers(guildId) {
    return global.db.prepare(`
        SELECT p.* FROM players p
        JOIN player_guilds pg ON pg.player_id = p.id
        WHERE pg.guild_id = ? AND pg.active = 1
    `).all(guildId);
}

// Joueur par Riot ID (exact, puis recherche partielle)
function getPlayerByRiotId(riotId, guildId) {
    let player = global.db.prepare(`
        SELECT p.* FROM players p
        JOIN player_guilds pg ON pg.player_id = p.id
        WHERE pg.guild_id = ? AND pg.active = 1 AND p.riot_id = ?
    `).get(guildId, riotId);

    if (player) return player;

    player = global.db.prepare(`
        SELECT p.* FROM players p
        JOIN player_guilds pg ON pg.player_id = p.id
        WHERE pg.guild_id = ? AND pg.active = 1 AND LOWER(p.riot_id) LIKE LOWER(?)
        LIMIT 1
    `).get(guildId, `%${riotId}%`);

    return player ?? null;
}

// ─── Classement ───────────────────────────────────────────────────────────────
// Trie (en place) des joueurs par rang décroissant
function sortPlayersByRank(players) {
    return players.sort((a, b) => {
        const rA = getRankOrder(a.last_rank, a.last_lp);
        const rB = getRankOrder(b.last_rank, b.last_lp);
        if (rB.order !== rA.order) return rB.order - rA.order;
        if (rB.divisionOrder !== rA.divisionOrder) return rB.divisionOrder - rA.divisionOrder;
        return (rB.lp || 0) - (rA.lp || 0);
    });
}

// Position d'un joueur dans le classement du serveur
function getServerPosition(riotId, guildId) {
    const rows = sortPlayersByRank(getGuildPlayers(guildId));
    if (!rows.length) return { position: 0, total: 0, percentile: 0 };

    const position = rows.findIndex((p) => p.riot_id === riotId) + 1;
    const total = rows.length;
    const percentile = Math.round((position / total) * 100);

    return { position, total, percentile };
}

// ─── Liens ────────────────────────────────────────────────────────────────────
// "Pseudo #TAG" → "Pseudo%20-TAG" (format attendu par DPM / OP.GG / U.GG)
function formatRiotIdForUrl(riotId) {
    return riotId.replace("#", "-").replace(/ /g, "%20");
}

function getDpmUrl(riotId) {
    return `https://dpm.lol/${formatRiotIdForUrl(riotId)}`;
}

// ─── Autocomplétion partagée des commandes (option "joueur") ─────────────────
async function autocompletePlayers(interaction) {
    if (!global.db) return interaction.respond([]);

    const focusedValue = interaction.options.getFocused().toLowerCase();
    const rows = global.db.prepare(`
        SELECT DISTINCT p.riot_id FROM players p
        JOIN player_guilds pg ON pg.player_id = p.id
        WHERE pg.guild_id = ? AND pg.active = 1
    `).all(interaction.guildId);

    const filtered = rows
        .filter((r) => r.riot_id.toLowerCase().includes(focusedValue))
        .slice(0, 25);

    await interaction.respond(
        filtered.map((r) => ({ name: r.riot_id, value: r.riot_id }))
    );
}

module.exports = {
    getPlayerById,
    getGuildPlayers,
    getPlayerByRiotId,
    sortPlayersByRank,
    getServerPosition,
    formatRiotIdForUrl,
    getDpmUrl,
    autocompletePlayers,
};
