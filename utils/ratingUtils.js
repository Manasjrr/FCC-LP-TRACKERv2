// ─── Système de notation des joueurs (/100) ──────────────────────────────────
// Calculée uniquement depuis match_history (aucun appel API) :
//   • Performance en jeu : 75 pts — chaque game est notée selon le rôle joué
//   • Résultats          : 20 pts — winrate (14) + LP moyen par game (6)
//   • Forme              :  5 pts — winrate sur les 10 dernières games

const RATING_MATCH_COUNT = 30;   // games analysées
const CONFIDENT_GAMES = 10;      // en dessous : note provisoire (ramenée vers 50)

const PERFORMANCE_MAX = 75;
const RESULTS_MAX = 20;
const WINRATE_MAX = 14;
const LP_MAX = RESULTS_MAX - WINRATE_MAX;
const FORM_MAX = 5;
const FORM_GAMES = 10;
// Winrate sur les FORM_GAMES dernières games → points de forme (interpolation entre les paliers)
const FORM_SCALE = [
    [0.30, 0],
    [0.50, FORM_MAX / 2],
    [0.80, FORM_MAX],
];

// ─── Paliers ──────────────────────────────────────────────────────────────────
const RATING_TIERS = [
    { min: 85, grade: "S+", label: "🌟 CANNA-MESSI-CR7", color: 0xf0e68c },
    { min: 69, grade: "S",  label: "🔥 EXCELLENT",       color: 0x8500ff },
    { min: 60, grade: "A",  label: "⭐ TRÈS BON",        color: 0x00ff00 },
    { min: 52, grade: "B",  label: "✅ SOLIDE",          color: 0x00bfff },
    { min: 44, grade: "C",  label: "⚡ MOYEN",           color: 0xffd700 },
    { min: 35, grade: "D",  label: "❌ MAUVAIS",         color: 0xff8c00 },
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
    // aggregate : notée sur la moyenne de toutes les games du rôle (pas game par game)
    team_grubs:         { label: "Void grubs (équipe)", fmt: dec(1), get: (m) => m.team_grubs, aggregate: true },
    team_heralds:       { label: "Héraut (équipe)",     fmt: pct,   get: (m) => m.team_heralds, aggregate: true },
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
// weight = poids relatif de la catégorie (total 60 par rôle, ramené à PERFORMANCE_MAX)
// metrics = { métrique: [valeur "faible" → 0%, valeur "excellente" → 100%, poids (optionnel, 1 par défaut)] }
// Dans une catégorie, chaque stat compte selon son poids (moyenne pondérée)
// Les intervalles sont centrés sur une stat moyenne (≈ 50%) : un joueur dans la
// moyenne de son rôle obtient environ la moitié des points de performance.
const ROLE_PROFILES = {
    TOP: {
        combat:     { weight: 18, metrics: { kda: [1.0, 4.0], kill_participation: [0.15, 0.30], damage_share: [0.10, 0.25], solo_kills: [0, 2] } },
        farm:       { weight: 12, metrics: { cs_per_min: [5.0, 8.5], cs_10: [40, 80] } },
        lane:       { weight: 14, metrics: { gold_diff_15: [-700, 700], xp_diff_15: [-600, 600], cs_diff_15: [-10, 10] } },
        vision:     { weight: 6,  metrics: { vision_per_min: [0.3, 1.0] } },
        objectives: { weight: 10, metrics: { turret_takedowns: [0, 4] } },
    },
    JUNGLE: {
        combat:     { weight: 22, metrics: { kda: [1.2, 4.5], kill_participation: [0.35, 0.70], damage_share: [0.10, 0.24] } },
        farm:       { weight: 10, metrics: { cs_per_min: [4.0, 7.0] } },
        vision:     { weight: 12, metrics: { vision_per_min: [0.6, 1.4, 2], control_wards: [0, 2, 1] } },
        objectives: { weight: 16, metrics: { epic_monsters: [0, 3] } },
    },
    MIDDLE: {
        combat:     { weight: 24, metrics: { kda: [1.0, 4.0], kill_participation: [0.32, 0.60], damage_share: [0.15, 0.33], solo_kills: [0, 2] } },
        farm:       { weight: 14, metrics: { cs_per_min: [5.5, 8.5], cs_10: [50, 80] } },
        lane:       { weight: 14, metrics: { gold_diff_15: [-700, 700], xp_diff_15: [-600, 600], cs_diff_15: [-10, 10] } },
        vision:     { weight: 8,  metrics: { vision_per_min: [0.4, 1.0] } },
    },
    BOTTOM: {
        combat:     { weight: 22, metrics: { kda: [1.0, 4.0], kill_participation: [0.15, 0.40], damage_share: [0.20, 0.30] } },
        farm:       { weight: 18, metrics: { cs_per_min: [6.0, 9.0], cs_10: [50, 80] } },
        lane:       { weight: 14, metrics: { gold_diff_15: [-700, 700], xp_diff_15: [-600, 600], cs_diff_15: [-10, 10] } },
        vision:     { weight: 6,  metrics: { vision_per_min: [0.3, 1.0] } },
    },
    UTILITY: {
        combat:     { weight: 25, metrics: { kda: [1.5, 4.0], kill_participation: [0.35, 0.75] } },
        vision:     { weight: 25, metrics: { vision_per_min: [1.4, 3.5], control_wards: [1, 6], wards_killed: [0, 8] } },
        objectives: { weight: 10, metrics: { team_grubs: [0, 2], team_heralds: [0.20, 0.65], early_dragons: [0, 2] } },
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
// Interpolation linéaire par paliers [[x, y], ...] (bornée aux extrémités)
function interpolate(x, points) {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
        const [x0, y0] = points[i - 1];
        const [x1, y1] = points[i];
        if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
    return points[points.length - 1][1];
}

const average = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
// Poids d'une stat dans sa catégorie : 3e valeur des bornes (1 par défaut)
const metricWeight = (bounds) => bounds[2] ?? 1;

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
// overrides = { métrique: score } calculés sur l'ensemble des games du rôle (stats "aggregate")
function scoreMatch(match, overrides = {}) {
    const role = getMatchRole(match);
    const profile = ROLE_PROFILES[role];

    let weighted = 0;
    let totalWeight = 0;
    const categories = {};
    const metrics = {};

    for (const [category, { weight, metrics: metricBounds }] of Object.entries(profile)) {
        let categoryWeighted = 0;
        let categoryWeight = 0;
        for (const [metric, bounds] of Object.entries(metricBounds)) {
            const value = METRICS[metric].get(match);
            if (!isNum(value)) continue;
            const s = overrides[metric] ?? scale(value, bounds);
            const w = metricWeight(bounds);
            categoryWeighted += w * s;
            categoryWeight += w;
            metrics[metric] = { value, score: s };
        }
        if (!categoryWeight) continue;

        const categoryScore = categoryWeighted / categoryWeight;
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
// before (timestamp ms) : ne prend que les games jouées avant cette date
// → permet de recalculer la note telle qu'elle était dans le passé
function getRatedMatches(playerId, before = Number.MAX_SAFE_INTEGER) {
    return global.db.prepare(`
        SELECT * FROM match_history
        WHERE player_id = ? AND is_remake = 0 AND game_creation < ?
        ORDER BY game_creation DESC
        LIMIT ?
    `).all(playerId, before, RATING_MATCH_COUNT);
}

// ─── Note complète d'un joueur ────────────────────────────────────────────────
// options.before : note telle qu'elle était à cette date (timestamp ms)
function computePlayerRating(playerId, { before } = {}) {
    const matches = getRatedMatches(playerId, before);
    const games = matches.length;

    if (!games) {
        return { score: 0, games: 0, provisional: true, tier: getRatingTier(0), empty: true };
    }

    // ── Performance en jeu (75) ───────────────────────────────────────────────
    // Stats "aggregate" (ex : Héraut) : score = taux sur toutes les games du rôle
    const overridesByRole = {};
    for (const [role, profile] of Object.entries(ROLE_PROFILES)) {
        for (const { metrics } of Object.values(profile)) {
            for (const [metric, bounds] of Object.entries(metrics)) {
                if (!METRICS[metric].aggregate) continue;
                const values = matches
                    .filter((m) => getMatchRole(m) === role)
                    .map((m) => METRICS[metric].get(m))
                    .filter(isNum);
                if (!values.length) continue;
                overridesByRole[role] ??= {};
                overridesByRole[role][metric] = scale(average(values), bounds);
            }
        }
    }

    const scored = matches
        .map((m) => scoreMatch(m, overridesByRole[getMatchRole(m)]))
        .filter((s) => s.score != null);
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

    // ── Résultats (20) ────────────────────────────────────────────────────────
    const wins = matches.filter((m) => m.win).length;
    const winrate = wins / games;
    const avgLp = average(matches.map((m) => m.lp_change ?? 0));
    const winratePoints = WINRATE_MAX * scale(winrate, [0.35, 0.65]);
    const lpPoints = LP_MAX * scale(avgLp, [-10, 10]);

    // ── Forme (5) ────────────────────────────────────────────────────────────
    const lastGames = matches.slice(0, FORM_GAMES);
    const lastWinrate = lastGames.filter((m) => m.win).length / lastGames.length;
    let streak = 0;
    for (const m of matches) {
        if (Boolean(m.win) === Boolean(matches[0].win)) streak++;
        else break;
    }
    const streakType = matches[0].win ? "win" : "loss";
    const formPoints = interpolate(lastWinrate, FORM_SCALE);

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
        results: { points: winratePoints + lpPoints, max: RESULTS_MAX, wins, losses: games - wins, winrate, avgLp, winratePoints, lpPoints, winrateMax: WINRATE_MAX, lpMax: LP_MAX },
        form: { points: formPoints, max: FORM_MAX, lastGames: lastGames.map((m) => Boolean(m.win)), winrate: lastWinrate, streak, streakType },
    };
}

// ─── Note d'une game (/100) ───────────────────────────────────────────────────
// Performance en jeu de la game seule, selon le rôle joué (hors résultats / forme)
// match = ligne match_history → { score, tier, role } ou null (remake, pas de données)
function computeGameScore(match) {
    if (!match || match.is_remake) return null;
    const { score, role } = scoreMatch(match);
    if (score == null) return null;
    const value = Math.round(score * 100);
    return { score: value, tier: getRatingTier(value), role };
}

// ─── Détail de la note d'une game (barème + points gagnés / perdus) ──────────
// Chaque catégorie disponible vaut (poids / total des poids disponibles) × 100 pts,
// répartis entre ses stats disponibles selon leur poids. Le malus de rôle s'applique au total.
function getGameScoreDetails(match) {
    if (!match || match.is_remake) return null;

    const role = getMatchRole(match);
    const result = scoreMatch(match);
    if (result.score == null) return null;

    const profile = ROLE_PROFILES[role];
    const totalWeight = Object.entries(profile)
        .filter(([category]) => result.categories[category] != null)
        .reduce((sum, [, { weight }]) => sum + weight, 0);

    const categories = Object.entries(profile).map(([category, { weight, metrics }]) => {
        const available = result.categories[category] != null;
        const max = available ? (weight / totalWeight) * 100 : 0;

        const metricDetails = Object.entries(metrics).map(([metric, bounds]) => {
            const m = result.metrics[metric];
            const { label, fmt } = METRICS[metric];
            return {
                metric,
                label,
                weight: metricWeight(bounds),
                min: fmt(bounds[0]),
                target: fmt(bounds[1]),
                display: m ? fmt(m.value) : null,
                score: m ? m.score : null,
            };
        });

        const counted = metricDetails.filter((m) => m.score != null);
        const countedWeight = counted.reduce((sum, m) => sum + m.weight, 0);
        for (const m of counted) {
            m.max = (max * m.weight) / countedWeight;
            m.points = m.max * m.score;
        }

        return {
            category,
            label: CATEGORY_LABELS[category],
            weight,
            available,
            max,
            points: counted.reduce((sum, m) => sum + m.points, 0),
            metrics: metricDetails,
        };
    });

    const multiplier = ROLE_PERFORMANCE_MULTIPLIER[role] ?? 1;
    const rawPoints = categories.reduce((sum, c) => sum + c.points, 0);
    const score = Math.round(result.score * 100);

    return {
        role,
        roleLabel: ROLE_LABELS[role],
        score,
        tier: getRatingTier(score),
        rawPoints,
        multiplier,
        categories,
    };
}

// ─── Évolution de la note ─────────────────────────────────────────────────────
// Compare la note actuelle à celle d'il y a `days` jours (recalculée depuis la BDD)
function getRatingEvolution(playerId, days = 7, current = computePlayerRating(playerId)) {
    const past = computePlayerRating(playerId, { before: Date.now() - days * 24 * 60 * 60 * 1000 });
    if (current.empty || past.empty) return null;
    return { days, current: current.score, past: past.score, diff: current.score - past.score };
}

// Texte court : "📈 +4 (7j)" / "📉 -2 (7j)" / "➖ =0 (7j)"
function formatEvolution(evolution) {
    if (!evolution) return null;
    const { diff, days } = evolution;
    const emoji = diff > 0 ? "📈" : diff < 0 ? "📉" : "➖";
    return `${emoji} ${diff > 0 ? "+" : ""}${diff} (${days}j)`;
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
    computeGameScore,
    getGameScoreDetails,
    getRatingEvolution,
    formatEvolution,
    getGuildRatingRanking,
};
