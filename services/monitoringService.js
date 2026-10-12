const axios = require("axios");
const FormData = require("form-data");
const { getLanePartner, buildDuoLaneThumbnail, buildGroupThumbnail, buildGroupGif, TEAM_COLORS } = require("../utils/thumbnailUtils");
const { getRecentMatchIds, getMatch, getTimeline, getFlexData, getActiveGame } = require("./riotApiService");
const matchCache = require("../cache/matchCache");
const timelineCache = require("../cache/timelineCache");
const { extractMatchStats, extractEarlyDragons, extractLaneDiffs15 } = require("../utils/matchStatsUtils");
const { isFlexEnabled, getGroupThumbnailStyle } = require("../utils/guildSettings");
const { processNewMatch, fetchAndCacheTimeline, retryMissingTimelines } = require("./matchService");
const { isSameTeamGroup, sortEntriesByRole, buildMatchNotifEmbed, buildGroupMatchNotifEmbed, buildFlexMatchEmbed, buildStatsButtonRows, buildRankChangeEmbed, buildRiotIdChangeEmbed } = require("../embeds/matchEmbed");
const { getServerPosition } = require("../utils/playerUtils");
const { computeGameScore } = require("../utils/ratingUtils");
const { getTranslator, t, DEFAULT_LANGUAGE } = require("../utils/i18n");
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
    const embed = buildRankChangeEmbed(player, oldRank, newRank, oldLP, newLP, getTranslator(channel.guildId));
    await channel.send({ embeds: [embed] });
    logger.info("MONITOR", `Changement de rang envoyé pour ${player.riot_id} : ${oldRank} → ${newRank}`, { guild: channel.guildId });
}

// Salon de notification supprimé ou devenu inaccessible : la notification est perdue
function logMissingChannel(channelId, guildId, what) {
    logger.warn("MONITOR", `Salon ${channelId} introuvable (supprimé ou accès perdu) : ${what} non envoyé(e)`, { guild: guildId });
}

// ─── Vérification d'un joueur ─────────────────────────────────────────────────
// player = ligne de la table players (global, unique par puuid)
// guildEntries = liste des player_guilds actifs pour ce joueur
// flexGuildEntries = serveurs de ce joueur qui ont activé les Flex (/flex)
//
// Dans les deux cas : 1 seul appel "liste des matchs" par cycle
//   • sans Flex : liste SoloQ (queue=420)
//   • avec Flex : liste ranked (type=ranked → SoloQ + Flex)
// Retourne la liste des matchs lue (le planning y cherche la game détectée en cours)
async function checkPlayer(player, guildEntries, flexGuildEntries, pending) {
    if (flexGuildEntries.length) {
        return checkPlayerRankedMatches(player, guildEntries, flexGuildEntries, pending);
    }

    const matchIds = await getRecentMatchIds(player.puuid, 10);
    if (!matchIds?.length) return [];

    const newMatchIds = [];
    for (const matchId of matchIds) {
        if (matchId === player.last_match_id) break;
        newMatchIds.push(matchId);
    }
    if (!newMatchIds.length) return matchIds;

    await processSoloQMatches(player, guildEntries, newMatchIds.reverse(), pending);
    return matchIds;
}

// ─── Traitement des nouveaux matchs SoloQ (du plus ancien au plus récent) ─────
// Retourne le joueur à jour (LP, rang, Riot ID)
async function processSoloQMatches(player, guildEntries, newMatchIds, { pendingNotifications, pendingRenames }) {
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
                pendingRenames.push({ channelId: guildEntry.channel_id, guildId: guildEntry.guild_id, ...result.riotIdChange });
            }
        }

        if (!result?.isRecent) continue;

        // Les notifications sont collectées puis envoyées en fin de cycle,
        // groupées par salon + match (plusieurs joueurs suivis dans la même game)
        for (const guildEntry of guildEntries) {
            // Game rattrapée après un /add : enregistrée en BDD mais pas notifiée
            if (endedBeforeTracking(result.match.info, guildEntry)) continue;

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

    return currentPlayer;
}

// ─── Parties Flex (notification uniquement, rien n'est enregistré en BDD) ────
// Seules les parties terminées récemment sont notifiées → pas de rafale de
// vieilles games à l'activation de /flex
const FLEX_MAX_AGE = 6 * 60 * 60 * 1000;
const REMAKE_MAX_DURATION = 5 * 60; // secondes (même seuil que la SoloQ)
// Rôles dont la note utilise la timeline (écarts à 15 min, dragons du support)
const TIMELINE_ROLES = new Set(["TOP", "MIDDLE", "BOTTOM", "UTILITY"]);
const SOLOQ_QUEUE = 420;
const FLEX_QUEUE = 440;

// Match depuis le cache, sinon 1 appel API. Mis en cache : réutilisé par les
// autres joueurs de la game, par processNewMatch et par la notification
async function getMatchInfoCached(matchId) {
    let matchInfo = matchCache.getMatch(matchId);
    if (!matchInfo) {
        matchInfo = (await getMatch(matchId)).info;
        matchCache.setMatch(matchId, matchInfo);
    }
    return matchInfo;
}

// ─── Mode "ranked" (serveur avec /flex) : SoloQ + Flex en un seul appel ──────
// Curseur players.last_ranked_match_id = dernier match ranked vu (toutes files).
// Chaque nouveau match coûte 1 seul appel (getMatch), qui sert à la fois à
// connaître sa file et au traitement SoloQ / à la notification Flex.
async function checkPlayerRankedMatches(player, guildEntries, flexGuildEntries, pending) {
    const matchIds = await getRecentMatchIds(player.puuid, 10, { type: "ranked" });
    if (!matchIds?.length) return [];

    const cursorId = player.last_ranked_match_id;
    if (!cursorId || !matchIds.includes(cursorId)) {
        await initRankedCursor(player, guildEntries, matchIds, pending);
        return matchIds;
    }

    const newMatchIds = matchIds.slice(0, matchIds.indexOf(cursorId)).reverse();
    if (!newMatchIds.length) return matchIds;

    const isStored = global.db.prepare(`SELECT 1 FROM match_history WHERE player_id = ? AND match_id = ?`);
    const soloQIds = [];
    const flexMatches = [];
    let lastReadId = null;

    for (const matchId of newMatchIds) {
        // Déjà enregistré → c'est une SoloQ déjà traitée, aucun appel
        if (!isStored.get(player.id, matchId)) {
            let matchInfo;
            try {
                matchInfo = await getMatchInfoCached(matchId);
            } catch (error) {
                // Match illisible pour l'instant : la suite est reprise au prochain cycle
                logger.warn("MONITOR", `Erreur récupération du match ${matchId} pour ${player.riot_id}`, {
                    error: error.message,
                    status: error.response?.status ?? null,
                });
                break;
            }

            if (matchInfo.queueId === SOLOQ_QUEUE) soloQIds.push(matchId);
            else if (matchInfo.queueId === FLEX_QUEUE) flexMatches.push({ matchId, matchInfo });
        }
        lastReadId = matchId;
    }

    // SoloQ : traitement habituel (match déjà en cache → pas d'appel en plus)
    let currentPlayer = player;
    if (soloQIds.length) {
        currentPlayer = await processSoloQMatches(player, guildEntries, soloQIds, pending);
    }

    for (const { matchId, matchInfo } of flexMatches) {
        collectFlexNotification(currentPlayer, flexGuildEntries, matchId, matchInfo, pending.pendingFlexNotifications);
    }

    if (lastReadId) {
        global.db.prepare(`UPDATE players SET last_ranked_match_id = ? WHERE id = ?`).run(lastReadId, player.id);
    }
    // Seulement les matchs traités : un match illisible (repris au prochain cycle)
    // ne doit pas être considéré comme vu
    return matchIds.slice(matchIds.indexOf(lastReadId ?? cursorId));
}

// ─── (Ré)initialisation du curseur ranked ────────────────────────────────────
// 1re vérification après l'activation de /flex (ou curseur trop ancien, ex. /flex
// désactivé puis réactivé) : au lieu de lire chaque match pour connaître sa file
// (jusqu'à 10 appels), 1 seul appel à la liste SoloQ. Les SoloQ en attente sont
// traitées normalement ; les Flex jouées avant l'activation ne sont pas notifiées.
async function initRankedCursor(player, guildEntries, rankedMatchIds, pending) {
    const soloQMatchIds = await getRecentMatchIds(player.puuid, 10);

    const newSoloQIds = [];
    for (const matchId of soloQMatchIds ?? []) {
        if (matchId === player.last_match_id) break;
        newSoloQIds.push(matchId);
    }
    if (newSoloQIds.length) {
        await processSoloQMatches(player, guildEntries, newSoloQIds.reverse(), pending);
    }

    global.db.prepare(`UPDATE players SET last_ranked_match_id = ? WHERE id = ?`).run(rankedMatchIds[0], player.id);
    logger.info("MONITOR", `Curseur ranked initialisé pour ${player.riot_id}`, { cursor: rankedMatchIds[0] });
}

// Fin de la game (ms)
function getMatchEndTime(matchInfo) {
    return matchInfo.gameEndTimestamp ?? matchInfo.gameCreation + matchInfo.gameDuration * 1000;
}

// Game terminée avant l'ajout (ou la réactivation) du joueur sur ce serveur
function endedBeforeTracking(matchInfo, guildEntry) {
    return guildEntry.tracked_since != null && getMatchEndTime(matchInfo) < guildEntry.tracked_since;
}

function collectFlexNotification(player, flexGuildEntries, matchId, matchInfo, pendingFlexNotifications) {
    if (Date.now() - getMatchEndTime(matchInfo) > FLEX_MAX_AGE) return;

    const participant = matchInfo.participants.find((p) => p.puuid === player.puuid);
    if (!participant) return;

    for (const guildEntry of flexGuildEntries) {
        if (endedBeforeTracking(matchInfo, guildEntry)) continue;

        const key = `${guildEntry.channel_id}|${matchId}`;
        if (!pendingFlexNotifications.has(key)) {
            pendingFlexNotifications.set(key, {
                channelId: guildEntry.channel_id,
                guildId: guildEntry.guild_id,
                matchId,
                match: matchInfo,
                entries: [],
            });
        }
        const pendingFlex = pendingFlexNotifications.get(key);
        if (!pendingFlex.entries.some((e) => e.player.id === player.id)) {
            pendingFlex.entries.push({ player, result: { participant } });
        }
    }
}

// Timeline d'une Flex (cache mémoire uniquement) — null si indisponible :
// la note est alors calculée sans les stats de lane à 15 min / dragons
async function getFlexTimeline(matchId) {
    const cached = timelineCache.getTimeline(matchId);
    if (cached) return cached;
    try {
        return timelineCache.setTimeline(matchId, await getTimeline(matchId));
    } catch (error) {
        logger.warn("MONITOR", `Timeline Flex indisponible pour ${matchId}, note sans stats de lane`, {
            status: error.response?.status,
            error: error.message,
        });
        return null;
    }
}

// Note de la game (même barème que la SoloQ) à partir d'une ligne "match_history"
// construite en mémoire — rien n'est enregistré, la note du /stats n'est pas affectée
function computeFlexGameScore(match, participant, timeline) {
    const row = {
        kills: participant.kills,
        deaths: participant.deaths,
        assists: participant.assists,
        win: participant.win ? 1 : 0,
        match_duration: match.gameDuration,
        is_remake: match.gameDuration < REMAKE_MAX_DURATION ? 1 : 0,
        ...extractMatchStats(match, participant),
    };
    if (timeline) {
        row.early_dragons = extractEarlyDragons(timeline)[participant.teamId] ?? null;
        Object.assign(row, extractLaneDiffs15(timeline, match, participant.puuid) ?? {});
    }
    return computeGameScore(row);
}

// Rang Flex actuel du joueur ("GOLD II", LP) — null si l'appel échoue
// (la notification part alors sans le rang)
async function getFlexRank(player) {
    try {
        const flex = await getFlexData(player.puuid);
        return flex ? { rank: `${flex.tier} ${flex.rank}`, lp: flex.leaguePoints } : { rank: "UNRANKED", lp: 0 };
    } catch (error) {
        logger.warn("MONITOR", `Rang Flex indisponible pour ${player.riot_id}`, {
            status: error.response?.status,
            error: error.message,
        });
        return null;
    }
}

async function sendPendingFlexNotifications(client, pendingFlexNotifications) {
    // Rang Flex : 1 appel par joueur et par cycle, partagé entre les serveurs
    const flexRanks = new Map();

    for (const { channelId, guildId, matchId, match, entries: rawEntries } of pendingFlexNotifications.values()) {
        const entries = sortEntriesByRole(rawEntries);
        try {
            for (const entry of entries) {
                if (entry.flexRank !== undefined) continue; // déjà fourni (script de test)
                if (!flexRanks.has(entry.player.id)) flexRanks.set(entry.player.id, await getFlexRank(entry.player));
                entry.flexRank = flexRanks.get(entry.player.id);
            }

            // Timeline (1 appel) seulement si une note en a besoin : pas de note sur
            // un remake, et la note d'un jungler n'utilise aucune stat de la timeline
            const needsTimeline = match.gameDuration >= REMAKE_MAX_DURATION
                && entries.some((e) => TIMELINE_ROLES.has(e.result.participant.teamPosition));
            const timeline = needsTimeline ? await getFlexTimeline(matchId) : null;
            for (const entry of entries) {
                entry.gameScore = computeFlexGameScore(match, entry.result.participant, timeline);
            }

            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel) {
                logMissingChannel(channelId, guildId, `notification Flex ${matchId}`);
                continue;
            }

            // Vignette : duo (même équipe) ou partenaire de lane ; face-à-face → 1er joueur seulement
            const files = await buildDuoLaneThumbnails(entries, match, {
                singleEmbed: true,
                groupStyle: getGroupThumbnailStyle(guildId),
            });

            const buildPayload = () => ({
                embeds: [buildFlexMatchEmbed(entries, match, matchId, patchVersion, getTranslator(guildId))],
                // Même boutons qu'en SoloQ : tableau des 10 joueurs + détail de la note
                components: buildStatsButtonRows(entries, matchId),
            });

            try {
                if (files.length) await sendMessageWithFiles(channelId, buildPayload(), files);
                else await channel.send(buildPayload());
            } catch (error) {
                if (!files.length) throw error;
                logger.warn("MONITOR", `Envoi avec vignette impossible pour la Flex ${matchId}, envoi classique`, {
                    error: error.message,
                    status: error.response?.status,
                });
                for (const entry of entries) delete entry.thumbnail;
                await channel.send(buildPayload());
            }

            logger.info("MONITOR", `Notification Flex envoyée pour ${matchId}`, {
                players: entries.map((e) => e.player.riot_id),
            });
        } catch (error) {
            logger.error("MONITOR", `Erreur envoi notification Flex pour ${matchId}`, {
                channel: channelId,
                error: error.message,
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
    for (const { channelId, guildId, oldRiotId, newRiotId } of pendingRenames) {
        try {
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel) {
                logMissingChannel(channelId, guildId, `changement de pseudo ${oldRiotId} → ${newRiotId}`);
                continue;
            }
            await channel.send({ embeds: [buildRiotIdChangeEmbed(oldRiotId, newRiotId, getTranslator(guildId))] });
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
// singleEmbed : tous les joueurs sont dans un seul embed (Flex) → une seule vignette,
// même en face-à-face (sinon : une vignette "lane" par embed de joueur)
// groupStyle : vignette des groupes choisie par le serveur (/flex vignette) → "gif" ou "mosaique"
async function buildDuoLaneThumbnails(entries, match, { singleEmbed = false, groupStyle = "gif" } = {}) {
    const sameTeam = isSameTeamGroup(entries);

    // Duo dans la même équipe : champion du 1er joueur + champion de son duo en petit
    if (entries.length === 2 && sameTeam) {
        const [main, mate] = entries.map((e) => e.result.participant);
        try {
            const buffer = await buildDuoLaneThumbnail(main.championName, mate.championName, patchVersion);
            entries[0].thumbnail = "attachment://duo.png";
            return [{ name: "duo.png", buffer }];
        } catch (error) {
            logger.warn("MONITOR", `Vignette duo impossible pour ${entries[0].player.riot_id}`, { error: error.message });
            return [];
        }
    }

    // Groupe (3+) ou face-à-face dans un seul embed, selon le réglage du serveur :
    //   • "gif"      : GIF animé qui fait défiler le champion de chaque joueur + son rôle
    //   • "mosaique" : image fixe avec les champions de tous les joueurs
    // (contour bleu / rouge par équipe en face-à-face ; mosaïque = secours du GIF)
    if (entries.length > 1 && (sameTeam || singleEmbed)) {
        const champions = entries.map((e) => ({
            championName: e.result.participant.championName,
            role: e.result.participant.teamPosition,
            teamColor: sameTeam ? null : TEAM_COLORS[e.result.participant.teamId],
        }));
        if (groupStyle === "gif") {
            try {
                const buffer = await buildGroupGif(champions, patchVersion);
                entries[0].thumbnail = "attachment://group.gif";
                return [{ name: "group.gif", buffer }];
            } catch (error) {
                logger.warn("MONITOR", `Vignette GIF impossible pour ${entries[0].player.riot_id}, mosaïque fixe`, { error: error.message });
            }
        }
        try {
            const buffer = await buildGroupThumbnail(champions, patchVersion);
            entries[0].thumbnail = "attachment://group.png";
            return [{ name: "group.png", buffer }];
        } catch (error) {
            logger.warn("MONITOR", `Vignette groupe impossible pour ${entries[0].player.riot_id}`, { error: error.message });
            return [];
        }
    }

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

    for (const { channelId, guildId, matchId, match, entries: rawEntries } of pendingNotifications.values()) {
        // Joueurs d'un groupe affichés dans l'ordre des rôles (top → support)
        const entries = sortEntriesByRole(rawEntries);
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
            if (!channel) {
                logMissingChannel(channelId, guildId, `notification ${matchId}`);
                continue;
            }

            // Coéquipiers / adversaires suivis détectés hors de ce cycle (notification solo)
            const trackedMates = entries.length === 1
                ? getTrackedPlayersInMatch(match, guildId).filter((m) => m.id !== entries[0].player.id)
                : [];

            // Notification dans la langue du serveur
            const tr = getTranslator(guildId);
            const buildPayload = () => {
                if (entries.length > 1) {
                    const { embeds, rows } = buildGroupMatchNotifEmbed(entries, match, matchId, patchVersion, tr);
                    return { embeds, components: rows };
                }
                const { embed, row } = buildMatchNotifEmbed(entries[0], match, matchId, patchVersion, trackedMates, tr);
                return { embeds: [embed], components: [row] };
            };

            // Vignettes "duo lane" (ADC / support + partenaire de botlane)
            const files = await buildDuoLaneThumbnails(entries, match, { groupStyle: getGroupThumbnailStyle(guildId) });

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

            logger.info("MONITOR", `Notification${entries.length > 1 ? " groupée" : ""} envoyée pour ${matchId}`, {
                guild: guildId,
                players: entries.map((e) => e.player.riot_id),
            });

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

// ─── État de l'API Riot (déduit du monitoring, sans appel dédié) ─────────────
// Si tous les appels du monitoring (spectateur + liste des matchs) échouent côté
// Riot (5xx, réseau, clé refusée) pendant plusieurs minutes → un seul MP au
// propriétaire par panne. health = { ok, failed } : appels du cycle
const API_DOWN_DELAY = 6 * 60 * 1000;
let apiDownSince = null;
let apiDownAlerted = false;

function isRiotUnavailable(error) {
    if (!error.isAxiosError) return false; // erreur du bot, pas de Riot
    const status = error.response?.status;
    return !status || status >= 500 || status === 401 || status === 403;
}

async function updateApiHealth(client, health) {
    if (!health.ok && !health.failed) return; // aucun appel ce cycle → rien à conclure

    if (health.ok) {
        if (apiDownAlerted) logger.success("API", `Riot API de nouveau OK`);
        apiDownSince = null;
        apiDownAlerted = false;
        return;
    }

    apiDownSince ??= Date.now();
    const minutes = Math.round((Date.now() - apiDownSince) / 60000);
    logger.error("API", `Riot API KO (depuis ${minutes} min)`);
    if (Date.now() - apiDownSince < API_DOWN_DELAY || apiDownAlerted) return;

    apiDownAlerted = true;
    try {
        const user = await client.users.fetch(process.env.OWNER_ID);
        await user.send(t(DEFAULT_LANGUAGE, "owner.apiDown"));
        logger.info("API", "MP d'alerte envoyé");
    } catch (err) {
        logger.error("API", "Erreur envoi MP alerte", { error: err.message });
    }
}

// ─── Planning des vérifications par joueur ───────────────────────────────────
// Au lieu de lire la liste des matchs de chaque joueur toutes les 2 min, on
// regarde s'il est en partie (API spectateur) : une vraie game dure au moins
// 15 min, donc un contrôle toutes les 5 min (7,5 min pour un joueur inactif)
// la repère forcément. Pendant une partie classée, la liste des matchs est lue
// toutes les 2 min jusqu'à ce que la game y apparaisse → notification aussi
// rapide qu'avant. Les remakes (< 5 min) peuvent passer entre deux contrôles :
// ils sont récupérés à la vérification suivante.
const IN_GAME_INTERVAL = 2 * 60 * 1000;
const SPECTATOR_INTERVAL = 5 * 60 * 1000;
const SPECTATOR_INTERVAL_INACTIVE = 7.5 * 60 * 1000;
const INACTIVE_AFTER = 30 * 24 * 60 * 60 * 1000; // aucune game (ni /add) depuis 30 jours
// Vérification de secours : si l'API spectateur ne voyait pas un joueur en partie
const SAFETY_INTERVAL = 60 * 60 * 1000;
// API spectateur en erreur → liste des matchs lue directement, nouvel essai dans 2 min
const SPECTATOR_RETRY = 2 * 60 * 1000;
// Game détectée qui n'apparaît jamais dans la liste (partie annulée...) → abandon
const IN_GAME_TIMEOUT = 2 * 60 * 60 * 1000;
// Réessai des timelines manquantes : même rythme qu'avant (le cycle tourne toutes les 30 s)
const TIMELINE_RETRY_INTERVAL = 2 * 60 * 1000;

// Mémoire seulement : au redémarrage, tous les joueurs sont vérifiés tout de suite
const schedules = new Map(); // puuid → { nextSpectatorAt, lastMatchCheckAt, inGame }

function getSchedule(puuid) {
    if (!schedules.has(puuid)) {
        schedules.set(puuid, {
            // Contrôles étalés sur 5 min plutôt que tous en même temps
            nextSpectatorAt: Date.now() + Math.random() * SPECTATOR_INTERVAL,
            lastMatchCheckAt: 0, // → vérification de la liste des matchs au démarrage
            inGame: null,        // { matchId, detectedAt } pendant une partie classée
        });
    }
    return schedules.get(puuid);
}

// → true si la liste des matchs du joueur doit être lue maintenant
async function isMatchCheckDue(player, rankedQueues, lastPlayedAt, now, health) {
    const schedule = getSchedule(player.puuid);

    if (schedule.inGame && now - schedule.inGame.detectedAt > IN_GAME_TIMEOUT) {
        logger.warn("MONITOR", `Partie ${schedule.inGame.matchId} de ${player.riot_id} jamais apparue, abandon`);
        schedule.inGame = null;
    }
    if (schedule.inGame) return now - schedule.lastMatchCheckAt >= IN_GAME_INTERVAL;

    let due = now - schedule.lastMatchCheckAt >= SAFETY_INTERVAL;
    if (now < schedule.nextSpectatorAt) return due;

    try {
        const game = await getActiveGame(player.puuid, { silent: true });
        health.ok++;
        schedule.nextSpectatorAt = now + (now - lastPlayedAt > INACTIVE_AFTER ? SPECTATOR_INTERVAL_INACTIVE : SPECTATOR_INTERVAL);

        if (game && rankedQueues.includes(game.gameQueueConfigId)) {
            schedule.inGame = { matchId: `${game.platformId}_${game.gameId}`, detectedAt: now };
            // 1re lecture de la liste 2 min après la détection, puis toutes les 2 min
            schedule.lastMatchCheckAt = now;
            logger.info("MONITOR", `${player.riot_id} en partie classée`, {
                matchId: schedule.inGame.matchId,
                queue: game.gameQueueConfigId,
            });
        }
    } catch (error) {
        logger.warn("MONITOR", `API spectateur indisponible pour ${player.riot_id}, vérification directe`, {
            status: error.response?.status ?? null,
            error: error.message,
        });
        if (isRiotUnavailable(error)) health.failed++;
        schedule.nextSpectatorAt = now + SPECTATOR_RETRY;
        due = true;
    }
    return due;
}

// Après une lecture de la liste des matchs (réussie ou non)
function onMatchesChecked(player, matchIds, now) {
    const schedule = getSchedule(player.puuid);
    schedule.lastMatchCheckAt = now;

    if (schedule.inGame && matchIds?.includes(schedule.inGame.matchId)) {
        logger.info("MONITOR", `Partie ${schedule.inGame.matchId} de ${player.riot_id} terminée et traitée`);
        schedule.inGame = null;
        schedule.nextSpectatorAt = now + SPECTATOR_INTERVAL;
    }
}

// ─── Boucle principale ────────────────────────────────────────────────────────
// Lancée toutes les 30 s : seuls les joueurs dont une vérification est due font
// un appel. Un cycle peut durer plus longtemps (traitement d'une game, rate limit) :
// on ignore le déclenchement suivant plutôt que de traiter deux fois les mêmes matchs
let isChecking = false;
let lastTimelineRetryAt = 0;

async function checkAllPlayers(client) {
    if (isChecking) {
        logger.debug("MONITOR", `Vérification précédente encore en cours, cycle ignoré`);
        return;
    }
    isChecking = true;
    try {
        await runCheckAllPlayers(client);
    } catch (error) {
        logger.error("MONITOR", `Erreur cycle de vérification`, { error: error.message, stack: error.stack });
    } finally {
        isChecking = false;
    }
}

async function runCheckAllPlayers(client) {
    // ── Récupérer tous les joueurs avec au moins un serveur actif ────────────
    // Dédupliqués par puuid → 1 seul appel API par joueur
    const players = global.db.prepare(`
        SELECT DISTINCT p.*
        FROM players p
        JOIN player_guilds pg ON pg.player_id = p.id
        WHERE pg.active = 1
    `).all();

    if (!players?.length) return;

    // Dernière game SoloQ enregistrée par joueur (fréquence des contrôles)
    const lastGames = new Map(global.db.prepare(`
        SELECT player_id, MAX(game_creation) AS last FROM match_history GROUP BY player_id
    `).all().map((r) => [r.player_id, r.last]));

    let attempted = 0;
    let errors = 0;
    const health = { ok: 0, failed: 0 };
    const pendingNotifications = new Map();
    const pendingFlexNotifications = new Map();
    const pendingRenames = [];

    for (const player of players) {
        const now = Date.now();
        let matchIds = null;
        let checked = false;
        try {
            // Récupérer tous les serveurs actifs pour ce joueur
            const guildEntries = global.db.prepare(`
                SELECT * FROM player_guilds
                WHERE player_id = ? AND active = 1
            `).all(player.id);

            // Parties Flex : uniquement pour les serveurs qui les ont activées (/flex)
            const flexGuildEntries = guildEntries.filter((g) => isFlexEnabled(g.guild_id));
            const rankedQueues = flexGuildEntries.length ? [SOLOQ_QUEUE, FLEX_QUEUE] : [SOLOQ_QUEUE];

            // Activité : dernière game, ou ajout récent sur un serveur
            const lastPlayedAt = Math.max(lastGames.get(player.id) ?? 0, ...guildEntries.map((g) => g.tracked_since ?? 0));

            if (!(await isMatchCheckDue(player, rankedQueues, lastPlayedAt, now, health))) continue;

            checked = true;
            attempted++;
            matchIds = await checkPlayer(player, guildEntries, flexGuildEntries, {
                pendingNotifications,
                pendingFlexNotifications,
                pendingRenames,
            });
            health.ok++;
        } catch (error) {
            errors++;
            if (isRiotUnavailable(error)) health.failed++;
            logger.error("MONITOR", `Erreur monitoring pour ${player.riot_id}`, {
                error: error.message,
                status: error.response?.status ?? null,
                stack: error.stack,
            });
        } finally {
            // Échec compris : nouvel essai au prochain intervalle, pas au prochain cycle de 30 s
            if (checked) onMatchesChecked(player, matchIds, now);
        }
    }

    await updateApiHealth(client, health);

    await sendPendingRenames(client, pendingRenames);
    await sendPendingNotifications(client, pendingNotifications);
    await sendPendingFlexNotifications(client, pendingFlexNotifications);

    // Timelines qui n'ont pas pu être récupérées lors d'un cycle précédent
    if (Date.now() - lastTimelineRetryAt >= TIMELINE_RETRY_INTERVAL) {
        lastTimelineRetryAt = Date.now();
        await retryMissingTimelines().catch((error) =>
            logger.error("MONITOR", `Erreur réessai timelines`, { error: error.message })
        );
    }

    // Cycle toutes les 30 s : résumé seulement en cas d'erreur (les nouveaux matchs,
    // parties détectées et notifications ont déjà leur propre ligne)
    if (errors) {
        logger.warn("MONITOR", `Vérification terminée avec erreurs`, {
            total: players.length,
            checked: attempted,
            errors,
        });
    }
}

module.exports = {
    checkAllPlayers,
    sendRankChangeNotification,
    getPatchVersion,
    updatePatchVersion,
    // utilisé par scripts/testFlexNotif.js (fausse notification sur le serveur de test)
    sendPendingFlexNotifications,
};
