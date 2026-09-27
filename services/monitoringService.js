const axios = require("axios");
const { getRecentMatchIds } = require("./riotApiService");
const { processNewMatch, fetchAndCacheTimeline } = require("./matchService");
const { buildMatchNotifEmbed, buildGroupMatchNotifEmbed, buildRankChangeEmbed, buildRiotIdChangeEmbed } = require("../embeds/matchEmbed");
const { getServerPosition } = require("../utils/playerUtils");
const logger = require("../utils/loggers");

// ─── Version du patch (Data Dragon) ───────────────────────────────────────────
let patchVersion = "15.10.1"; // fallback

async function updatePatchVersion() {
    try {
        const res = await axios.get("https://ddragon.leagueoflegends.com/api/versions.json", { timeout: 5000 });
        patchVersion = res.data[0];
        logger.info("MONITOR", `Version patch mise à jour : ${patchVersion}`);
    } catch (err) {
        logger.warn("MONITOR", `Échec mise à jour patch, fallback : ${patchVersion}`);
    }
}

function getPatchVersion() {
    return patchVersion;
}

updatePatchVersion();
setInterval(updatePatchVersion, 24 * 60 * 60 * 1000);

// ─── Notification changement de rang ─────────────────────────────────────────
async function sendRankChangeNotification(player, oldRank, newRank, oldLP, newLP, channel) {
    const embed = buildRankChangeEmbed(player, oldRank, newRank, oldLP, newLP);
    await channel.send({ embeds: [embed] });
}

// ─── Vérification d'un joueur ─────────────────────────────────────────────────
async function checkPlayerNewMatches(player, guildEntries, pendingNotifications, pendingRenames) {
    // player = ligne de la table players (global, unique par puuid)
    // guildEntries = liste des player_guilds actifs pour ce joueur

    const matchIds = await getRecentMatchIds(player.puuid, 10);
    if (!matchIds?.length) return;

    const newMatchIds = [];
    for (const matchId of matchIds) {
        if (matchId === player.last_match_id) break;
        newMatchIds.push(matchId);
    }

    if (!newMatchIds.length) return;

    newMatchIds.reverse();

    logger.info("MONITOR", `${newMatchIds.length} nouveau(x) match(s) pour ${player.riot_id}`, {
        matches: newMatchIds,
    });

    let currentPlayer = player;

    for (const [index, matchId] of newMatchIds.entries()) {
        const isLatest = index === newMatchIds.length - 1;

        // Position AVANT le match, par serveur
        const positionsBefore = {};
        for (const guildEntry of guildEntries) {
            positionsBefore[guildEntry.guild_id] = getServerPosition(currentPlayer.riot_id, guildEntry.guild_id);
        }

        const result = await processNewMatch(currentPlayer, matchId, isLatest);
        currentPlayer = global.db.prepare(`SELECT * FROM players WHERE id = ?`).get(player.id);

        // Changement de pseudo : annoncé dans chaque salon qui suit le joueur
        if (result?.riotIdChange) {
            for (const guildEntry of guildEntries) {
                pendingRenames.push({ channelId: guildEntry.channel_id, ...result.riotIdChange });
            }
        }

        if (!result?.isRecent) continue;

        // Les notifications sont collectées puis envoyées en fin de cycle,
        // groupées par salon + match (plusieurs joueurs suivis dans la même game)
        for (const guildEntry of guildEntries) {
            const key = `${guildEntry.channel_id}|${matchId}`;
            if (!pendingNotifications.has(key)) {
                pendingNotifications.set(key, {
                    channelId: guildEntry.channel_id,
                    guildId: guildEntry.guild_id,
                    matchId,
                    match: result.match.info,
                    entries: [],
                });
            }

            pendingNotifications.get(key).entries.push({
                player: currentPlayer,
                result,
                positionBefore: positionsBefore[guildEntry.guild_id],
                // Position APRÈS le match, pour ce même serveur
                positionAfter: getServerPosition(currentPlayer.riot_id, guildEntry.guild_id),
            });
        }
    }
}

// ─── Joueurs suivis du serveur présents dans une game (BDD uniquement) ───────
function getTrackedPlayersInMatch(match, guildId) {
    const puuids = match.participants.map((p) => p.puuid);
    const rows = global.db.prepare(`
        SELECT p.id, p.riot_id, p.puuid FROM players p
        JOIN player_guilds pg ON pg.player_id = p.id
        WHERE pg.guild_id = ? AND pg.active = 1
          AND p.puuid IN (${puuids.map(() => "?").join(",")})
    `).all(guildId, ...puuids);

    return rows.map((r) => ({
        ...r,
        participant: match.participants.find((p) => p.puuid === r.puuid),
    }));
}

// ─── Envoi des changements de pseudo collectés ───────────────────────────────
async function sendPendingRenames(client, pendingRenames) {
    for (const { channelId, oldRiotId, newRiotId } of pendingRenames) {
        try {
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel) continue;
            await channel.send({ embeds: [buildRiotIdChangeEmbed(oldRiotId, newRiotId)] });
        } catch (error) {
            logger.error("MONITOR", `Erreur envoi changement de pseudo ${oldRiotId} → ${newRiotId}`, {
                channel: channelId,
                error: error.message,
            });
        }
    }
}

// ─── Envoi des notifications collectées ──────────────────────────────────────
async function sendPendingNotifications(client, pendingNotifications) {
    const timelinesRequested = new Set();

    for (const { channelId, guildId, matchId, match, entries } of pendingNotifications.values()) {
        try {
            // Timeline récupérée une seule fois par match
            if (!timelinesRequested.has(matchId)) {
                timelinesRequested.add(matchId);
                fetchAndCacheTimeline(matchId).catch(() => { });
            }

            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel) continue;

            if (entries.length > 1) {
                const { embeds, rows } = buildGroupMatchNotifEmbed(entries, match, matchId, patchVersion);
                await channel.send({ embeds, components: rows });
                logger.info("MONITOR", `Notification groupée envoyée pour ${matchId}`, {
                    players: entries.map((e) => e.player.riot_id),
                });
            } else {
                const entry = entries[0];

                // Coéquipiers / adversaires suivis détectés hors de ce cycle
                const trackedMates = getTrackedPlayersInMatch(match, guildId)
                    .filter((m) => m.id !== entry.player.id);

                const { embed, row } = buildMatchNotifEmbed(entry, match, matchId, patchVersion, trackedMates);
                await channel.send({ embeds: [embed], components: [row] });
            }

            for (const { player, result } of entries) {
                if (result.oldRank && result.oldRank !== result.currentRank) {
                    await sendRankChangeNotification(
                        player,
                        result.oldRank,
                        result.currentRank,
                        result.oldLP,
                        result.currentLP,
                        channel
                    );
                }
            }
        } catch (error) {
            logger.error("MONITOR", `Erreur envoi notification pour ${matchId}`, {
                channel: channelId,
                error: error.message,
            });
        }
    }
}

// ─── Boucle principale ────────────────────────────────────────────────────────
async function checkAllPlayers(client) {
    logger.info("MONITOR", `Début de la vérification`, {
        timestamp: new Date().toISOString(),
    });

    // ── Récupérer tous les joueurs avec au moins un serveur actif ────────────
    // Dédupliqués par puuid → 1 seul appel API par joueur
    const players = global.db.prepare(`
        SELECT DISTINCT p.*
        FROM players p
        JOIN player_guilds pg ON pg.player_id = p.id
        WHERE pg.active = 1
    `).all();

    if (!players?.length) {
        logger.info("MONITOR", `Aucun joueur à surveiller`);
        return;
    }

    let success = 0;
    let errors = 0;
    const pendingNotifications = new Map();
    const pendingRenames = [];

    for (const player of players) {
        try {
            // Récupérer tous les serveurs actifs pour ce joueur
            const guildEntries = global.db.prepare(`
                SELECT * FROM player_guilds
                WHERE player_id = ? AND active = 1
            `).all(player.id);

            await checkPlayerNewMatches(player, guildEntries, pendingNotifications, pendingRenames);
            success++;
        } catch (error) {
            errors++;
            logger.error("MONITOR", `Erreur monitoring pour ${player.riot_id}`, {
                error: error.message,
                status: error.response?.status ?? null,
                stack: error.stack,
            });
        }
    }

    await sendPendingRenames(client, pendingRenames);
    await sendPendingNotifications(client, pendingNotifications);

    logger.info("MONITOR", `Vérification terminée`, {
        total: players.length,
        success,
        errors,
    });
}

module.exports = { checkAllPlayers, sendRankChangeNotification, getPatchVersion };
