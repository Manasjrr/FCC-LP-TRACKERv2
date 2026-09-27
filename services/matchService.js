const { getRankOrder } = require("../utils/rankUtils");
const { getMatch, getSoloQData, getTimeline } = require("./riotApiService");
const timelineCache = require("../cache/timelineCache");
const matchCache = require("../cache/matchCache");
const logger = require("../utils/loggers");

const LIMIT_30J = 30 * 24 * 60 * 60 * 1000;
const LIMIT_7J  =  7 * 24 * 60 * 60 * 1000;
const REMAKE_MAX_DURATION = 5 * 60; // secondes

// ─── Helper high elo ─────────────────────────────────────────────────────────
function isHighElo(rank) {
    if (!rank) return false;
    const r = rank.toLowerCase();

    // ordre important — grandmaster AVANT master
    // Sinon "grandmaster".includes("master") === true → mauvaise détection
    return r.includes("grandmaster") || r.includes("challenger") || r.includes("master");
}

// ─── Calcul LP change ────────────────────────────────────────────────────────
function calculateLPChange(oldRank, oldLP, newRank, newLP) {
    // Avant : Math.min(LP, 100) coupait les 200+ LP de Master
    const safeOldLP = isHighElo(oldRank)
        ? Math.max(oldLP, 0)
        : Math.min(Math.max(oldLP, 0), 100);

    const safeNewLP = isHighElo(newRank)
        ? Math.max(newLP, 0)
        : Math.min(Math.max(newLP, 0), 100);

    // Même rang → différence simple
    if (oldRank === newRank) return safeNewLP - safeOldLP;

    const oldData = getRankOrder(oldRank, safeOldLP);
    const newData = getRankOrder(newRank, safeNewLP);

    // Avant : (100 - safeOldLP) + safeNewLP donnait un résultat faux
    // si oldRank était high elo (ex: Master 200LP → Diamond I 75LP)
    if (newData.totalScore > oldData.totalScore) {
        // Promotion
        if (isHighElo(oldRank) || isHighElo(newRank)) {
            // High elo : on prend juste la différence de totalScore
            return newData.totalScore - oldData.totalScore;
        }
        // Low elo : LP restants jusqu'à 100 + LP dans le nouveau rang
        return (100 - safeOldLP) + safeNewLP;
    }

    if (newData.totalScore < oldData.totalScore) {
        // Rétrogradation
        if (isHighElo(oldRank) || isHighElo(newRank)) {
            return newData.totalScore - oldData.totalScore; // valeur négative
        }
        // Low elo : LP perdus depuis 0 + LP manquants à 100 dans le nouveau rang
        return -(safeOldLP + (100 - safeNewLP));
    }

    return 0;
}

// ─── Timeline en arrière-plan ────────────────────────────────────────────────
async function fetchAndCacheTimeline(matchId) {
    if (timelineCache.hasTimeline(matchId)) return;
    try {
        const timeline = await getTimeline(matchId);
        timelineCache.setTimeline(matchId, timeline);
        logger.info("MATCH", `Timeline cachée pour ${matchId}`);
    } catch (error) {
        logger.warn("MATCH", `Échec cache timeline pour ${matchId}`, { error: error.message });
    }
}

// ─── Synchronisation du Riot ID ──────────────────────────────────────────────
// Le match contient le Riot ID actuel du joueur (riotIdGameName / riotIdTagline) :
// si le joueur a changé de pseudo, on met à jour la BDD sans appel API.
// Retourne { oldRiotId, newRiotId } si c'est un vrai changement de pseudo,
// null sinon (identique, ou simple correction de majuscules / espaces)
function syncRiotId(player, participant) {
    const { riotIdGameName, riotIdTagline } = participant;
    if (!riotIdGameName || !riotIdTagline) return null;

    const oldRiotId = player.riot_id;
    const newRiotId = `${riotIdGameName}#${riotIdTagline}`;
    if (newRiotId === oldRiotId) return null;

    try {
        global.db.prepare(`UPDATE players SET riot_id = ? WHERE id = ?`).run(newRiotId, player.id);
        logger.info("MATCH", `Riot ID mis à jour : ${oldRiotId} → ${newRiotId}`, { playerId: player.id });
        player.riot_id = newRiotId;

        const normalize = (id) => id.toLowerCase().replace(/\s/g, "");
        return normalize(oldRiotId) === normalize(newRiotId) ? null : { oldRiotId, newRiotId };
    } catch (error) {
        logger.warn("MATCH", `Échec mise à jour Riot ID pour ${player.riot_id}`, {
            newRiotId,
            error: error.message,
        });
        return null;
    }
}

// ─── Traitement d'un match ────────────────────────────────────────────────────
async function processNewMatch(player, matchId, isLatest = false) {

    // ── Doublon BDD ──────────────────────────────────────────────────────────
    const existing = global.db
        .prepare(`SELECT id FROM match_history WHERE match_id = ? AND player_id = ?`)
        .get(matchId, player.id);

    if (existing) {
        logger.info("MATCH", `Match ${matchId} déjà en BDD pour ${player.riot_id}`);
        return;
    }

    // ── Récupération du match ─────────────────────────────────────────────────
    // Si un autre joueur suivi était dans la même game, le match est déjà en cache
    const cachedInfo = matchCache.getMatch(matchId);
    const match = cachedInfo ? { info: cachedInfo } : await getMatch(matchId);

    // ── Filtre SoloQ ──────────────────────────────────────────────────────────
    if (match.info.queueId !== 420) {
        logger.info("MATCH", `Match ${matchId} ignoré (pas soloQ)`);
        global.db.prepare(`UPDATE players SET last_match_id = ? WHERE id = ?`)
                 .run(matchId, player.id);
        return;
    }

    if (!cachedInfo) matchCache.setMatch(matchId, match.info);

    // ── Filtre âge ────────────────────────────────────────────────────────────
    const gameAge = Date.now() - match.info.gameCreation;
    if (gameAge > LIMIT_30J) {
        logger.info("MATCH", `Match ${matchId} ignoré (> 30 jours)`);
        global.db.prepare(`UPDATE players SET last_match_id = ? WHERE id = ?`)
                 .run(matchId, player.id);
        return;
    }

    // ── Participant ───────────────────────────────────────────────────────────
    const participant = match.info.participants.find((p) => p.puuid === player.puuid);
    if (!participant) {
        logger.error("MATCH", `Participant introuvable dans ${matchId}`, { player: player.riot_id });

        // ✅ FIX : mettre à jour last_match_id même si participant introuvable
        // Avant : on retournait sans update → le même match était re-fetché
        // à chaque cycle de monitoring → spam API + boucle infinie
        global.db.prepare(`UPDATE players SET last_match_id = ? WHERE id = ?`)
                 .run(matchId, player.id);
        return;
    }

    // ── Changement de Riot ID (données déjà présentes dans le match) ─────────
    const riotIdChange = syncRiotId(player, participant);

    const oldLP   = player.last_lp  || 0;
    const oldRank = player.last_rank || "UNRANKED";
    const isShortGame = match.info.gameDuration < REMAKE_MAX_DURATION;
    let currentLP, currentRank, finalLpChange;

    // ── LP réels (dernier match uniquement) ───────────────────────────────────
    if (isLatest) {
        const soloQData = await getSoloQData(player.puuid);
        currentLP     = soloQData?.leaguePoints ?? 0;
        currentRank   = soloQData ? `${soloQData.tier} ${soloQData.rank}` : "UNRANKED";
        finalLpChange = calculateLPChange(oldRank, oldLP, currentRank, currentLP);

        logger.info("MATCH", `LP réels pour ${player.riot_id}`, {
            oldRank, oldLP, currentRank, currentLP, finalLpChange,
        });
    } else if (isShortGame) {
        // ── Remake probable (match en retard) ─────────────────────────────────
        // Les LP réels ne sont pas connus ici : une partie < 5 min est un remake,
        // on n'applique donc pas d'estimation ±20 LP
        currentLP     = oldLP;
        currentRank   = oldRank;
        finalLpChange = 0;
    } else {
        // ── LP estimés (matchs en retard) ─────────────────────────────────────
        const ratingChange =
            typeof participant.challenges?.ratingChange === "number"
                ? Math.round(participant.challenges.ratingChange)
                : null;

        const estimatedChange = ratingChange ?? (participant.win ? 20 : -20);
        const rawLP = oldLP + estimatedChange;

        if ((rawLP >= 100 || rawLP < 0) && !isHighElo(oldRank)) {
            // Promotion/rétrogradation probable → on garde les LP actuels
            // les vrais LP seront mis à jour au prochain match (isLatest)
            currentLP     = oldLP;
            currentRank   = oldRank;
            finalLpChange = estimatedChange;
            logger.warn("MATCH", `Promo/rétro probable pour ${player.riot_id} — LP conservés`, {
                matchId, rawLP,
            });
        } else {
            currentLP     = Math.max(0, rawLP);
            currentRank   = oldRank;
            finalLpChange = estimatedChange;
        }
    }

    // ── Détection remake (partie < 5 min et aucune variation de LP) ──────────
    const isRemake = isShortGame && finalLpChange === 0;

    if (isRemake) {
        logger.info("MATCH", `Match ${matchId} détecté comme remake pour ${player.riot_id}`, {
            duration: match.info.gameDuration,
        });
    }

    // ── Insertion BDD ─────────────────────────────────────────────────────────
    global.db.prepare(`
        INSERT INTO match_history (
            player_id, match_id, champion_id, champion_name,
            kills, deaths, assists, win, lp_change,
            rank_before, rank_after, lp_before, lp_after,
            match_duration, game_creation, is_remake
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        player.id, matchId,
        participant.championId, participant.championName,
        participant.kills, participant.deaths, participant.assists,
        participant.win ? 1 : 0,
        finalLpChange,
        oldRank, currentRank,
        oldLP, currentLP,
        match.info.gameDuration,
        match.info.gameCreation,
        isRemake ? 1 : 0
    );

    logger.info("MATCH", `Match ${matchId} stocké pour ${player.riot_id}`);

    // ── Mise à jour joueur ────────────────────────────────────────────────────
    global.db.prepare(`
        UPDATE players SET last_match_id = ?, last_lp = ?, last_rank = ?, last_update = ?
        WHERE id = ?
    `).run(matchId, currentLP, currentRank, Date.now(), player.id);

    logger.success("MATCH", `Traitement complet pour ${player.riot_id}`, {
        match: matchId, rank: currentRank, lp: currentLP, lpChange: finalLpChange,
    });

    return {
        participant,
        match,
        currentRank,
        currentLP,
        finalLpChange,
        oldRank,
        oldLP,
        isRemake,
        riotIdChange,
        gameAge,
        isRecent: gameAge <= LIMIT_7J,
    };
}

module.exports = { processNewMatch, calculateLPChange, fetchAndCacheTimeline, isHighElo };
