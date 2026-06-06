const { EmbedBuilder } = require("discord.js");
const { getRankEmoji, getRankOrder } = require("../utils/rankUtils");
const { getRecentMatchIds } = require("./riotApiService");
const { processNewMatch, fetchAndCacheTimeline } = require("./matchService");
const { buildMatchNotifEmbed } = require("../embeds/matchEmbed");
const matchCache = require("../cache/matchCache");
const logger = require("../utils/loggers");

// ─── Notification changement de rang ─────────────────────────────────────────
async function sendRankChangeNotification(player, oldRank, newRank, oldLP, newLP, channel) {
    const oldRankData = getRankOrder(oldRank, oldLP);
    const newRankData = getRankOrder(newRank, newLP);
    const rankUp = newRankData.totalScore > oldRankData.totalScore;

    const embed = new EmbedBuilder()
        .setTitle(rankUp ? "📈 PROMOTION !" : "📉 RÉTROGRADATION")
        .setDescription(`**${player.riot_id}** a changé de rang !`)
        .addFields(
            { name: "Ancien rang", value: `${getRankEmoji(oldRank)} ${oldRank}`, inline: true },
            { name: "Nouveau rang", value: `${getRankEmoji(newRank)} ${newRank}`, inline: true }
        )
        .setColor(rankUp ? "#00FF00" : "#FF0000")
        .setTimestamp();

    await channel.send({ embeds: [embed] });
}

// ─── Vérification d'un joueur ─────────────────────────────────────────────────
async function checkPlayerNewMatches(player, guildEntries, client) {
    // player = ligne de la table players (global, unique par puuid)
    // guildEntries = liste des player_guilds actifs pour ce joueur

    const matchIds = await getRecentMatchIds(player.puuid, 5);
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
        const result = await processNewMatch(currentPlayer, matchId, isLatest);

        // Rafraîchir le joueur depuis la BDD
        currentPlayer = global.db.prepare(`SELECT * FROM players WHERE id = ?`).get(player.id);

        if (!result?.isRecent) continue;

        matchCache.setMatch(matchId, result.match.info);
        fetchAndCacheTimeline(matchId).catch(() => {});

        // ── Notifier sur TOUS les serveurs où le joueur est actif ────────────
        for (const guildEntry of guildEntries) {
            const channel = await client.channels.fetch(guildEntry.channel_id).catch(() => null);
            if (!channel) {
                logger.warn("MONITOR", `Channel introuvable pour ${player.riot_id}`, {
                    channelId: guildEntry.channel_id,
                    guild: guildEntry.guild_id,
                });
                continue;
            }

            const { embed, row } = buildMatchNotifEmbed(
                currentPlayer,
                result.participant,
                result.match.info,
                result.currentRank,
                result.currentLP,
                result.finalLpChange,
                matchId
            );

            await channel.send({ embeds: [embed], components: [row] });

            if (result.oldRank && result.oldRank !== result.currentRank) {
                await sendRankChangeNotification(
                    currentPlayer,
                    result.oldRank,
                    result.currentRank,
                    currentPlayer.last_lp,
                    result.currentLP,
                    channel
                );
            }
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

    for (const player of players) {
        try {
            // Récupérer tous les serveurs actifs pour ce joueur
            const guildEntries = global.db.prepare(`
                SELECT * FROM player_guilds
                WHERE player_id = ? AND active = 1
            `).all(player.id);

            await checkPlayerNewMatches(player, guildEntries, client);
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

    logger.info("MONITOR", `Vérification terminée`, {
        total: players.length,
        success,
        errors,
    });
}

module.exports = { checkAllPlayers, sendRankChangeNotification };
