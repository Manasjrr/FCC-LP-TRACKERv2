const { getRankOrder } = require("../utils/rankUtils");
const { getMatch, getSoloQData, getTimeline } = require("./riotApiService");
const timelineCache = require("../cache/timelineCache");
const logger = require("../utils/loggers");

const LIMIT_30J = 30 * 24 * 60 * 60 * 1000;
const LIMIT_7J  =  7 * 24 * 60 * 60 * 1000;

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
    try {
        const timeline = await getTimeline(matchId);
        timelineCache.setTimeline(matchId, timeline);
        logger.info("MATCH", `Timeline cachée pour ${matchId}`);
    } catch (error) {
        logger.warn("MATCH", `Échec cache timeline pour ${matchId}`, { error: error.message });
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
    const match = await getMatch(matchId);

    // ── Filtre SoloQ ──────────────────────────────────────────────────────────
    if (match.info.queueId !== 420) {
        logger.info("MATCH", `Match ${matchId} ignoré (pas soloQ)`);
        global.db.prepare(`UPDATE players SET last_match_id = ? WHERE id = ?`)
                 .run(matchId, player.id);
        return;
    }

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

    const oldLP   = player.last_lp  || 0;
    const oldRank = player.last_rank || "UNRANKED";
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

    // ── Insertion BDD ─────────────────────────────────────────────────────────
    global.db.prepare(`
        INSERT INTO match_history (
            player_id, match_id, champion_id, champion_name,
            kills, deaths, assists, win, lp_change,
            rank_before, rank_after, lp_before, lp_after,
            match_duration, game_creation
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        player.id, matchId,
        participant.championId, participant.championName,
        participant.kills, participant.deaths, participant.assists,
        participant.win ? 1 : 0,
        finalLpChange,
        oldRank, currentRank,
        oldLP, currentLP,
        match.info.gameDuration,
        match.info.gameCreation
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
        gameAge,
        isRecent: gameAge <= LIMIT_7J,
    };
}

module.exports = { processNewMatch, calculateLPChange, fetchAndCacheTimeline, isHighElo };
