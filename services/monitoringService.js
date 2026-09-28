const axios = require("axios");
const FormData = require("form-data");
const { getLanePartner, buildDuoLaneThumbnail } = require("../utils/thumbnailUtils");
const { getRecentMatchIds } = require("./riotApiService");
const { processNewMatch, fetchAndCacheTimeline, retryMissingTimelines } = require("./matchService");
const { buildMatchNotifEmbed, buildGroupMatchNotifEmbed, buildRankChangeEmbed, buildRiotIdChangeEmbed } = require("../embeds/matchEmbed");
const { getServerPosition } = require("../utils/playerUtils");
const { computeGameScore } = require("../utils/ratingUtils");
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

// ─── Vignettes "duo lane" ─────────────────────────────────────────────────────
// Pour chaque ADC / support : icône du champion + partenaire de botlane en petit.
// Renseigne entry.thumbnail et retourne les fichiers à joindre au message.
async function buildDuoLaneThumbnails(entries, match) {
    const files = [];
    for (const [index, entry] of entries.slice(0, 9).entries()) {
        const participant = entry.result.participant;
        const partner = getLanePartner(participant, match.participants);
        if (!partner) continue;

        try {
            const buffer = await buildDuoLaneThumbnail(participant.championName, partner.championName, patchVersion);
            const name = `duolane_${index}.png`;
            files.push({ name, buffer });
            entry.thumbnail = `attachment://${name}`;
        } catch (error) {
            logger.warn("MONITOR", `Vignette duo lane impossible pour ${entry.player.riot_id}`, { error: error.message });
        }
    }
    return files;
}

// ─── Envoi d'un message avec fichiers joints ─────────────────────────────────
// Via l'API REST Discord avec axios (même principe que le graphique LP :
// contourne les soucis d'upload de fichiers de discord.js / undici)
async function sendMessageWithFiles(channelId, { embeds, components }, files) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify({
        embeds: embeds.map((e) => e.toJSON()),
        components: components.map((c) => c.toJSON()),
        attachments: files.map((f, id) => ({ id, filename: f.name })),
    }));
    files.forEach((f, i) => form.append(`files[${i}]`, f.buffer, f.name));

    return axios.post(`https://discord.com/api/v10/channels/${channelId}/messages`, form, {
        headers: { ...form.getHeaders(), Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
        timeout: 15000,
    });
}

// ─── Envoi des notifications collectées ──────────────────────────────────────
async function sendPendingNotifications(client, pendingNotifications) {
    const timelinesRequested = new Set();

    for (const { channelId, guildId, matchId, match, entries } of pendingNotifications.values()) {
        try {
            // Timeline récupérée une seule fois par match, AVANT la notification :
            // les stats à 15 min comptent ainsi dans la note de la game
            if (!timelinesRequested.has(matchId)) {
                timelinesRequested.add(matchId);
                await fetchAndCacheTimeline(matchId, match).catch(() => { });
            }

            // Note de la game (/100) de chaque joueur, depuis la ligne match_history
            for (const entry of entries) {
                const row = global.db.prepare(`SELECT * FROM match_history WHERE player_id = ? AND match_id = ?`)
                    .get(entry.player.id, matchId);
                entry.gameScore = computeGameScore(row);
            }

            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel) continue;

            // Coéquipiers / adversaires suivis détectés hors de ce cycle (notification solo)
            const trackedMates = entries.length === 1
                ? getTrackedPlayersInMatch(match, guildId).filter((m) => m.id !== entries[0].player.id)
                : [];

            const buildPayload = () => {
                if (entries.length > 1) {
                    const { embeds, rows } = buildGroupMatchNotifEmbed(entries, match, matchId, patchVersion);
                    return { embeds, components: rows };
                }
                const { embed, row } = buildMatchNotifEmbed(entries[0], match, matchId, patchVersion, trackedMates);
                return { embeds: [embed], components: [row] };
            };

            // Vignettes "duo lane" (ADC / support + partenaire de botlane)
            const files = await buildDuoLaneThumbnails(entries, match);

            try {
                if (files.length) await sendMessageWithFiles(channelId, buildPayload(), files);
                else await channel.send(buildPayload());
            } catch (error) {
                if (!files.length) throw error;
                // Envoi avec image impossible → notification classique (vignette normale)
                logger.warn("MONITOR", `Envoi avec vignette duo lane impossible pour ${matchId}, envoi classique`, {
                    error: error.message,
                    status: error.response?.status,
                });
                for (const entry of entries) delete entry.thumbnail;
                await channel.send(buildPayload());
            }

            if (entries.length > 1) {
                logger.info("MONITOR", `Notification groupée envoyée pour ${matchId}`, {
                    players: entries.map((e) => e.player.riot_id),
                });
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

    // Timelines qui n'ont pas pu être récupérées lors d'un cycle précédent
    await retryMissingTimelines().catch((error) =>
        logger.error("MONITOR", `Erreur réessai timelines`, { error: error.message })
    );

    logger.info("MONITOR", `Vérification terminée`, {
        total: players.length,
        success,
        errors,
    });
}

module.exports = { checkAllPlayers, sendRankChangeNotification, getPatchVersion };
