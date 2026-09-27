// ─── Statistiques détaillées d'un match (match_history) ──────────────────────
// Toutes ces données proviennent du match déjà récupéré (getMatch) :
// aucun appel API supplémentaire.
//
// Pour ajouter une stat : l'ajouter dans MATCH_STATS_COLUMNS (nom → type SQL)
// et dans extractMatchStats. La colonne est créée automatiquement au démarrage.

const MATCH_STATS_COLUMNS = {
    // ── Partie ────────────────────────────────────────────────────────────────
    queue_id:              "INTEGER",
    game_version:          "TEXT",
    team_id:               "INTEGER",
    team_position:         "TEXT",     // TOP / JUNGLE / MIDDLE / BOTTOM / UTILITY
    opponent_champion:     "TEXT",     // adversaire direct (même rôle)
    surrender:             "INTEGER",
    early_surrender:       "INTEGER",

    // ── Farm & gold ───────────────────────────────────────────────────────────
    champ_level:           "INTEGER",
    cs:                    "INTEGER",
    cs_per_min:            "REAL",
    cs_10:                 "INTEGER",  // CS de lane à 10 min
    gold_earned:           "INTEGER",
    gold_per_min:          "REAL",

    // ── Combat ────────────────────────────────────────────────────────────────
    damage_to_champions:   "INTEGER",
    damage_per_min:        "REAL",
    damage_share:          "REAL",     // part des dégâts de l'équipe (0-1)
    damage_taken:          "INTEGER",
    damage_mitigated:      "INTEGER",
    kill_participation:    "REAL",     // 0-1
    solo_kills:            "INTEGER",
    first_blood:           "INTEGER",
    double_kills:          "INTEGER",
    triple_kills:          "INTEGER",
    quadra_kills:          "INTEGER",
    penta_kills:           "INTEGER",
    largest_killing_spree: "INTEGER",
    time_dead:             "INTEGER",  // secondes
    cc_time:               "INTEGER",  // secondes de contrôle infligées

    // ── Vision ────────────────────────────────────────────────────────────────
    vision_score:          "INTEGER",
    vision_per_min:        "REAL",
    wards_placed:          "INTEGER",
    wards_killed:          "INTEGER",
    control_wards:         "INTEGER",

    // ── Objectifs ─────────────────────────────────────────────────────────────
    turret_takedowns:      "INTEGER",
    turret_plates:         "INTEGER",
    dragon_kills:          "INTEGER",
    baron_kills:           "INTEGER",
    team_kills:            "INTEGER",
    team_dragons:          "INTEGER",
    team_barons:           "INTEGER",
    team_towers:           "INTEGER",
    team_grubs:            "INTEGER",  // void grubs de l'équipe (0-6)
    team_heralds:          "INTEGER",  // Héraut de l'équipe (0-1)
    early_dragons:         "INTEGER",  // parmi les 2 premiers dragons, combien pour l'équipe (0-2)
                                       // → rempli depuis la timeline (déjà téléchargée en arrière-plan)

    // ── Lane (face à l'adversaire direct) ─────────────────────────────────────
    gold_diff_15:          "INTEGER",  // écart de gold à 15:00 (timeline)
    xp_diff_15:            "INTEGER",  // écart d'XP à 15:00 (timeline)
    cs_diff_15:            "INTEGER",  // écart de CS à 15:00 (timeline)
    vision_diff:           "INTEGER",  // écart de vision score en fin de game

    // ── Build ─────────────────────────────────────────────────────────────────
    items:                 "TEXT",     // JSON [item0..item6]
    summoner_spells:       "TEXT",     // JSON [spell1, spell2]
    keystone:              "INTEGER",  // rune principale
    secondary_tree:        "INTEGER",  // arbre de runes secondaire

    // ── Brut ──────────────────────────────────────────────────────────────────
    participant_json:      "TEXT",     // participant complet (toutes les stats Riot)
};

const round = (n, decimals = 2) =>
    typeof n === "number" && Number.isFinite(n) ? Number(n.toFixed(decimals)) : null;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

const bool = (b) => (typeof b === "boolean" ? (b ? 1 : 0) : null);

// info = match.info (Riot), participant = entrée du joueur dans info.participants
function extractMatchStats(info, participant) {
    const p = participant;
    const c = p.challenges ?? {};
    const minutes = info.gameDuration > 0 ? info.gameDuration / 60 : null;
    const perMin = (value) => (minutes && typeof value === "number" ? round(value / minutes) : null);

    const cs = (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0);
    const team = info.teams?.find((t) => t.teamId === p.teamId);
    const opponent = p.teamPosition
        ? info.participants.find((o) => o.teamId !== p.teamId && o.teamPosition === p.teamPosition)
        : null;

    return {
        queue_id:              info.queueId ?? null,
        game_version:          info.gameVersion ?? null,
        team_id:               p.teamId ?? null,
        team_position:         p.teamPosition || null,
        opponent_champion:     opponent?.championName ?? null,
        surrender:             bool(p.gameEndedInSurrender),
        early_surrender:       bool(p.gameEndedInEarlySurrender),

        champ_level:           p.champLevel ?? null,
        cs,
        cs_per_min:            perMin(cs),
        cs_10:                 c.laneMinionsFirst10Minutes ?? null,
        gold_earned:           p.goldEarned ?? null,
        gold_per_min:          round(c.goldPerMinute) ?? perMin(p.goldEarned),

        damage_to_champions:   p.totalDamageDealtToChampions ?? null,
        damage_per_min:        round(c.damagePerMinute) ?? perMin(p.totalDamageDealtToChampions),
        damage_share:          round(c.teamDamagePercentage, 4),
        damage_taken:          p.totalDamageTaken ?? null,
        damage_mitigated:      p.damageSelfMitigated ?? null,
        kill_participation:    round(c.killParticipation, 4),
        solo_kills:            c.soloKills ?? null,
        first_blood:           bool(p.firstBloodKill),
        double_kills:          p.doubleKills ?? null,
        triple_kills:          p.tripleKills ?? null,
        quadra_kills:          p.quadraKills ?? null,
        penta_kills:           p.pentaKills ?? null,
        largest_killing_spree: p.largestKillingSpree ?? null,
        time_dead:             p.totalTimeSpentDead ?? null,
        cc_time:               p.timeCCingOthers ?? null,

        vision_score:          p.visionScore ?? null,
        vision_per_min:        round(c.visionScorePerMinute) ?? perMin(p.visionScore),
        wards_placed:          p.wardsPlaced ?? null,
        wards_killed:          p.wardsKilled ?? null,
        control_wards:         p.visionWardsBoughtInGame ?? null,

        turret_takedowns:      p.turretTakedowns ?? null,
        turret_plates:         c.turretPlatesTaken ?? null,
        dragon_kills:          p.dragonKills ?? null,
        baron_kills:           p.baronKills ?? null,
        team_kills:            team?.objectives?.champion?.kills ?? null,
        team_dragons:          team?.objectives?.dragon?.kills ?? null,
        team_barons:           team?.objectives?.baron?.kills ?? null,
        team_towers:           team?.objectives?.tower?.kills ?? null,
        team_grubs:            team?.objectives?.horde?.kills ?? null,
        team_heralds:          team?.objectives?.riftHerald?.kills ?? null,
        early_dragons:         null,

        gold_diff_15:          null,   // rempli depuis la timeline
        xp_diff_15:            null,
        cs_diff_15:            null,
        vision_diff:           opponent && isNum(p.visionScore) && isNum(opponent.visionScore)
            ? p.visionScore - opponent.visionScore
            : null,

        items:                 JSON.stringify([p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6]),
        summoner_spells:       JSON.stringify([p.summoner1Id, p.summoner2Id]),
        keystone:              p.perks?.styles?.[0]?.selections?.[0]?.perk ?? null,
        secondary_tree:        p.perks?.styles?.[1]?.style ?? null,

        participant_json:      JSON.stringify(p),
    };
}

// ─── Stats issues de la timeline ─────────────────────────────────────────────
// Nombre de dragons obtenus par chaque équipe parmi les 2 premiers de la partie
// → { 100: n, 200: m }
function extractEarlyDragons(timeline) {
    const dragonKills = (timeline?.info?.frames ?? [])
        .flatMap((frame) => frame.events ?? [])
        .filter((e) => e.type === "ELITE_MONSTER_KILL" && e.monsterType === "DRAGON")
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(0, 2);

    const result = { 100: 0, 200: 0 };
    for (const event of dragonKills) {
        // killerTeamId absent sur certains events → déduit du killerId (1-5 = bleu, 6-10 = rouge)
        const teamId = event.killerTeamId
            ?? (event.killerId >= 1 && event.killerId <= 5 ? 100 : event.killerId >= 6 && event.killerId <= 10 ? 200 : null);
        if (teamId in result) result[teamId]++;
    }
    return result;
}

// Écarts à 15:00 entre un joueur et son adversaire direct (même rôle)
// info = match.info, puuid = joueur → { gold_diff_15, xp_diff_15, cs_diff_15 } ou null
const LANE_DIFF_TIMESTAMP = 15 * 60 * 1000;

function extractLaneDiffs15(timeline, info, puuid) {
    const player = info?.participants?.find((p) => p.puuid === puuid);
    if (!player?.teamPosition) return null;

    const opponent = info.participants.find((o) => o.teamId !== player.teamId && o.teamPosition === player.teamPosition);
    if (!opponent) return null;

    // Première frame à 15:00 ou après (absente si la game a fini avant 15 min)
    const frame = (timeline?.info?.frames ?? []).find((f) => f.timestamp >= LANE_DIFF_TIMESTAMP);
    if (!frame) return null;

    const participantId = (p) => p.participantId ?? info.participants.indexOf(p) + 1;
    const pf = frame.participantFrames?.[participantId(player)];
    const of = frame.participantFrames?.[participantId(opponent)];
    if (!pf || !of) return null;

    const cs = (f) => (f.minionsKilled ?? 0) + (f.jungleMinionsKilled ?? 0);
    return {
        gold_diff_15: (pf.totalGold ?? 0) - (of.totalGold ?? 0),
        xp_diff_15:   (pf.xp ?? 0) - (of.xp ?? 0),
        cs_diff_15:   cs(pf) - cs(of),
    };
}

module.exports = { MATCH_STATS_COLUMNS, extractMatchStats, extractEarlyDragons, extractLaneDiffs15 };
