// ─── Système de notation des joueurs (/100) ──────────────────────────────────
// Calculée uniquement depuis match_history (aucun appel API) :
//   • Performance en jeu : 60 pts — chaque game est notée selon le rôle joué
//   • Résultats          : 30 pts — winrate (20) + LP moyen par game (10)
//   • Forme              : 10 pts — 5 dernières games (7) + série en cours (3)

const RATING_MATCH_COUNT = 30;   // games analysées
const CONFIDENT_GAMES = 10;      // en dessous : note provisoire (ramenée vers 50)

const PERFORMANCE_MAX = 60;
const RESULTS_MAX = 30;
const FORM_MAX = 10;

// ─── Paliers ──────────────────────────────────────────────────────────────────
const RATING_TIERS = [
    { min: 85, grade: "S+", label: "🌟 CANNA-MESSI-CR7", color: 0xf0e68c },
    { min: 72, grade: "S",  label: "🔥 EXCELLENT",       color: 0x8500ff },
    { min: 60, grade: "A",  label: "⭐ TRÈS BON",        color: 0x00ff00 },
    { min: 48, grade: "B",  label: "✅ SOLIDE",          color: 0x00bfff },
    { min: 35, grade: "C",  label: "⚡ MOYEN",           color: 0xffd700 },
    { min: 0,  grade: "Z",  label: "❄️ RAZMO TIER",      color: 0xff6b6b },
];

function getRatingTier(score) {
    return RATING_TIERS.find((t) => score >= t.min);
}

// ─── Rôles ────────────────────────────────────────────────────────────────────
const ROLE_LABELS = {
    TOP: "Top",
    JUNGLE: "Jungle",
    MIDDLE: "Mid",
    BOTTOM: "ADC",
    UTILITY: "Support",
    DEFAULT: "Inconnu",
};

const CATEGORY_LABELS = {
    combat: "⚔️ Combat",
    farm: "🌾 Farm",
    lane: "🥊 Lane",
    vision: "👁️ Vision",
    objectives: "🏰 Objectifs",
};

// ─── Métriques (valeur extraite d'une ligne de match_history) ─────────────────
const pct = (v) => `${Math.round(v * 100)}%`;
const dec = (d) => (v) => v.toFixed(d);
const signed = (v) => `${v >= 0 ? "+" : ""}${Math.round(v)}`;

const METRICS = {
    kda:                { label: "KDA",                fmt: dec(1), get: (m) => (m.kills + m.assists) / Math.max(1, m.deaths) },
    kill_participation: { label: "Participation kills", fmt: pct,   get: (m) => m.kill_participation },
    damage_share:       { label: "Part des dégâts",     fmt: pct,   get: (m) => m.damage_share },
    solo_kills:         { label: "Solo kills",          fmt: dec(1), get: (m) => m.solo_kills },
    cs_per_min:         { label: "CS/min",              fmt: dec(1), get: (m) => m.cs_per_min },
    cs_10:              { label: "CS à 10 min",         fmt: dec(0), get: (m) => m.cs_10 },
    vision_per_min:     { label: "Vision/min",          fmt: dec(2), get: (m) => m.vision_per_min },
    control_wards:      { label: "Pinks achetées",      fmt: dec(1), get: (m) => m.control_wards },
    wards_killed:       { label: "Wards détruites",     fmt: dec(1), get: (m) => m.wards_killed },
    turret_takedowns:   { label: "Tours détruites",     fmt: dec(1), get: (m) => m.turret_takedowns },
    team_grubs:         { label: "Void grubs (équipe)", fmt: dec(1), get: (m) => m.team_grubs },
    team_heralds:       { label: "Héraut (équipe)",     fmt: pct,   get: (m) => m.team_heralds },
    early_dragons:      { label: "2 premiers dragons",  fmt: dec(1), get: (m) => m.early_dragons },
    gold_diff_15:       { label: "Gold diff à 15 min",  fmt: signed, get: (m) => m.gold_diff_15 },
    xp_diff_15:         { label: "XP diff à 15 min",    fmt: signed, get: (m) => m.xp_diff_15 },
    cs_diff_15:         { label: "CS diff à 15 min",    fmt: signed, get: (m) => m.cs_diff_15 },
    epic_monsters:      {
        label: "Dragons + Barons",
        fmt: dec(1),
        get: (m) => (m.dragon_kills == null && m.baron_kills == null ? null : (m.dragon_kills ?? 0) + (m.baron_kills ?? 0)),
    },
};

// ─── Profils par rôle ─────────────────────────────────────────────────────────
// weight = points de la catégorie (total 60 par rôle)
// metrics = { métrique: [valeur "faible" → 0%, valeur "excellente" → 100%] }
// Les intervalles sont centrés sur une stat moyenne (≈ 50%) : un joueur dans la
// moyenne de son rôle obtient environ la moitié des points de performance.
const ROLE_PROFILES = {
    TOP: {
        combat:     { weight: 18, metrics: { kda: [1.0, 4.0], kill_participation: [0.15, 0.30], damage_share: [0.16, 0.25], solo_kills: [0, 2] } },
        farm:       { weight: 12, metrics: { cs_per_min: [5.0, 8.0], cs_10: [45, 75] } },
        lane:       { weight: 14, metrics: { gold_diff_15: [-1000, 1000], xp_diff_15: [-800, 800], cs_diff_15: [-15, 15] } },
        vision:     { weight: 6,  metrics: { vision_per_min: [0.3, 0.9] } },
        objectives: { weight: 10, metrics: { turret_takedowns: [0, 4] } },
    },
    JUNGLE: {
        combat:     { weight: 22, metrics: { kda: [1.2, 4.5], kill_participation: [0.45, 0.75], damage_share: [0.10, 0.24] } },
        farm:       { weight: 10, metrics: { cs_per_min: [4.0, 7.0] } },
        vision:     { weight: 12, metrics: { vision_per_min: [0.6, 1.4], control_wards: [0, 4] } },
        objectives: { weight: 16, metrics: { epic_monsters: [0, 3] } },
    },
    MIDDLE: {
        combat:     { weight: 24, metrics: { kda: [1.0, 4.0], kill_participation: [0.37, 0.60], damage_share: [0.20, 0.30], solo_kills: [0, 2] } },
        farm:       { weight: 14, metrics: { cs_per_min: [5.5, 8.5], cs_10: [50, 80] } },
        lane:       { weight: 14, metrics: { gold_diff_15: [-1000, 1000], xp_diff_15: [-800, 800], cs_diff_15: [-15, 15] } },
        vision:     { weight: 8,  metrics: { vision_per_min: [0.4, 1.0] } },
    },
    BOTTOM: {
        combat:     { weight: 22, metrics: { kda: [1.0, 4.0], kill_participation: [0.37, 0.50], damage_share: [0.20, 0.30] } },
        farm:       { weight: 18, metrics: { cs_per_min: [6.0, 9.0], cs_10: [50, 80] } },
        lane:       { weight: 14, metrics: { gold_diff_15: [-1000, 1000], xp_diff_15: [-800, 800], cs_diff_15: [-15, 15] } },
        vision:     { weight: 6,  metrics: { vision_per_min: [0.3, 0.9] } },
    },
    UTILITY: {
        combat:     { weight: 25, metrics: { kda: [1.5, 4.0], kill_participation: [0.45, 0.75] } },
        vision:     { weight: 25, metrics: { vision_per_min: [1.4, 3.5], control_wards: [1, 6], wards_killed: [0, 8] } },
        objectives: { weight: 10, metrics: { team_grubs: [0, 6], team_heralds: [0, 1], early_dragons: [0, 2] } },
    },
    // Anciens matchs (enregistrés avant les stats détaillées) : KDA uniquement
    DEFAULT: {
        combat:     { weight: 60, metrics: { kda: [1.0, 4.0] } },
    },
};

// Ajustement de la performance en jeu par rôle (1 = neutre)
// Support légèrement pénalisé : -10% sur ses points de performance
const ROLE_PERFORMANCE_MULTIPLIER = {
    UTILITY: 0.9,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const scale = (value, [low, high]) => clamp01((value - low) / (high - low));
const average = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// KDA global d'un ensemble de games : (Σ kills + Σ assists) / Σ morts
function getTotalKda(matches) {
    const sum = (key) => matches.reduce((s, m) => s + (m[key] ?? 0), 0);
    return (sum("kills") + sum("assists")) / Math.max(1, sum("deaths"));
}

function getMatchRole(match) {
    return match.team_position && ROLE_PROFILES[match.team_position] && match.cs != null
        ? match.team_position
        : "DEFAULT";
}

// Note d'une game (0-1) selon le rôle joué + détail par catégorie / métrique
function scoreMatch(match) {
    const role = getMatchRole(match);
    const profile = ROLE_PROFILES[role];

    let weighted = 0;
    let totalWeight = 0;
    const categories = {};
    const metrics = {};

    for (const [category, { weight, metrics: metricBounds }] of Object.entries(profile)) {
        const scores = [];
        for (const [metric, bounds] of Object.entries(metricBounds)) {
            const value = METRICS[metric].get(match);
            if (!isNum(value)) continue;
            const s = scale(value, bounds);
            scores.push(s);
            metrics[metric] = { value, score: s };
        }
        if (!scores.length) continue;

        const categoryScore = average(scores);
        categories[category] = categoryScore;
        weighted += weight * categoryScore;
        totalWeight += weight;
    }

    const multiplier = ROLE_PERFORMANCE_MULTIPLIER[role] ?? 1;

    return {
        match,
        role,
        score: totalWeight ? (weighted / totalWeight) * multiplier : null,
        categories,
        metrics,
    };
}

// ─── Récupération des games ───────────────────────────────────────────────────
function getRatedMatches(playerId) {
    return global.db.prepare(`
        SELECT * FROM match_history
        WHERE player_id = ? AND is_remake = 0
        ORDER BY game_creation DESC
        LIMIT ?
    `).all(playerId, RATING_MATCH_COUNT);
}

// ─── Note complète d'un joueur ────────────────────────────────────────────────
function computePlayerRating(playerId) {
    const matches = getRatedMatches(playerId);
    const games = matches.length;

    if (!games) {
        return { score: 0, games: 0, provisional: true, tier: getRatingTier(0), empty: true };
    }

    // ── Performance en jeu (60) ───────────────────────────────────────────────
    const scored = matches.map(scoreMatch).filter((s) => s.score != null);
    const performanceRatio = average(scored.map((s) => s.score)) ?? 0;
    const performancePoints = performanceRatio * PERFORMANCE_MAX;

    // Rôle principal (hors anciens matchs sans rôle)
    const roleCounts = {};
    for (const s of scored) roleCounts[s.role] = (roleCounts[s.role] ?? 0) + 1;
    const knownRoles = Object.entries(roleCounts).filter(([r]) => r !== "DEFAULT").sort((a, b) => b[1] - a[1]);
    const mainRole = knownRoles[0]?.[0] ?? "DEFAULT";

    // Détail sur le rôle principal : moyenne par catégorie et par métrique
    const mainRoleGames = scored.filter((s) => s.role === mainRole);
    const categoryBreakdown = {};
    for (const category of Object.keys(ROLE_PROFILES[mainRole])) {
        const values = mainRoleGames.map((s) => s.categories[category]).filter(isNum);
        if (values.length) categoryBreakdown[category] = average(values);
    }
    const metricBreakdown = [];
    for (const [category, { metrics }] of Object.entries(ROLE_PROFILES[mainRole])) {
        for (const [metric, bounds] of Object.entries(metrics)) {
            const values = mainRoleGames.map((s) => s.metrics[metric]?.value).filter(isNum);
            if (!values.length) continue;
            // KDA affiché = même calcul que /stats : (kills + assists) / morts sur l'ensemble
            // des games (la moyenne des KDA par game est faussée par les games à 0 mort)
            const value = metric === "kda" ? getTotalKda(mainRoleGames.map((s) => s.match)) : average(values);
            metricBreakdown.push({
                category,
                metric,
                label: METRICS[metric].label,
                value,
                display: METRICS[metric].fmt(value),
                target: METRICS[metric].fmt(bounds[1]),
                score: scale(value, bounds),
            });
        }
    }

    // ── Résultats (30) ────────────────────────────────────────────────────────
    const wins = matches.filter((m) => m.win).length;
    const winrate = wins / games;
    const avgLp = average(matches.map((m) => m.lp_change ?? 0));
    const winratePoints = 20 * scale(winrate, [0.35, 0.65]);
    const lpPoints = 10 * scale(avgLp, [-10, 10]);

    // ── Forme (10) ────────────────────────────────────────────────────────────
    const last5 = matches.slice(0, 5);
    const last5Wins = last5.filter((m) => m.win).length;
    let streak = 0;
    for (const m of matches) {
        if (Boolean(m.win) === Boolean(matches[0].win)) streak++;
        else break;
    }
    const streakType = matches[0].win ? "win" : "loss";
    const streakPoints = streak >= 3 ? (streakType === "win" ? 3 : 0) : 1.5;
    const formPoints = 7 * (last5Wins / last5.length) + streakPoints;

    // ── Total ─────────────────────────────────────────────────────────────────
    const rawScore = performancePoints + winratePoints + lpPoints + formPoints;
    const provisional = games < CONFIDENT_GAMES;
    const confidence = Math.min(1, games / CONFIDENT_GAMES);
    const score = Math.round(50 + (rawScore - 50) * confidence);

    return {
        score,
        rawScore: Math.round(rawScore),
        tier: getRatingTier(score),
        games,
        provisional,
        mainRole,
        roleCounts,
        detailedGames: scored.filter((s) => s.role !== "DEFAULT").length,
        performance: { points: performancePoints, max: PERFORMANCE_MAX, categories: categoryBreakdown, metrics: metricBreakdown },
        results: { points: winratePoints + lpPoints, max: RESULTS_MAX, wins, losses: games - wins, winrate, avgLp, winratePoints, lpPoints },
        form: { points: formPoints, max: FORM_MAX, last5: last5.map((m) => Boolean(m.win)), streak, streakType },
    };
}

// ─── Classement des notes sur un serveur ─────────────────────────────────────
function getGuildRatingRanking(players) {
    return players
        .map((p) => ({ player: p, rating: computePlayerRating(p.id) }))
        .filter((r) => !r.rating.empty)
        .sort((a, b) => b.rating.score - a.rating.score);
}

module.exports = {
    RATING_MATCH_COUNT,
    CONFIDENT_GAMES,
    RATING_TIERS,
    ROLE_PROFILES,
    ROLE_LABELS,
    CATEGORY_LABELS,
    getRatingTier,
    computePlayerRating,
    getGuildRatingRanking,
};
