// ─── Rattrapage des stats détaillées des anciens matchs ──────────────────────
// Remplit les colonnes de stats (rôle, CS, dégâts, vision...) et les stats
// timeline (écarts à 15 min, 2 premiers dragons) des matchs déjà en base.
//
// Usage :  node scripts/backfillMatchStats.js [--delay 1500] [--limit 100] [--dry-run] [--db chemin.db]
//   --delay   pause entre deux requêtes Riot en ms (défaut 1500 → ~80 req / 2 min)
//   --limit   nombre max de matchs à traiter (défaut : tous)
//   --dry-run affiche seulement ce qui serait rattrapé
//
// Relançable à tout moment : seuls les matchs encore incomplets sont traités.
// Peut tourner en même temps que le bot (même clé API → rythme volontairement lent).

require("dotenv").config();
const path = require("path");
const Database = require("better-sqlite3");

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const DELAY_MS = getArg("delay", 1500);
const LIMIT = getArg("limit", Infinity);
const DRY_RUN = args.includes("--dry-run");
const RATE_LIMIT_PAUSE_MS = 60_000;
const REMAKE_MAX_DURATION = 5 * 60;

if (!process.env.RIOT_API_KEY) {
    console.error("❌ RIOT_API_KEY manquante dans le .env");
    process.exit(1);
}

// ─── Base de données ──────────────────────────────────────────────────────────
const dbArgIndex = args.indexOf("--db");
const DB_PATH = dbArgIndex >= 0 ? args[dbArgIndex + 1] : path.join(__dirname, "..", "players.db");
const db = new Database(DB_PATH);
db.pragma("busy_timeout = 10000"); // le bot peut écrire en même temps
global.db = db;
require("../database/initDB").initDB(db); // ajoute les colonnes manquantes

const { getMatch, getTimeline } = require("../services/riotApiService");
const { storeMatchStats, storeTimelineStats } = require("../services/matchService");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Appel Riot avec pause entre requêtes et attente prolongée en cas de rate limit
async function riotCall(fn, label) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        await sleep(DELAY_MS);
        try {
            return await fn();
        } catch (error) {
            const status = error.response?.status;
            if (status === 429 && attempt < 3) {
                console.log(`   ⏳ Rate limit sur ${label} — pause de ${RATE_LIMIT_PAUSE_MS / 1000}s`);
                await sleep(RATE_LIMIT_PAUSE_MS);
                continue;
            }
            throw error;
        }
    }
}

// ─── Matchs à rattraper ───────────────────────────────────────────────────────
// needs_stats    : aucune stat détaillée (match enregistré avant la mise à jour)
// needs_timeline : stats timeline jamais calculées (hors remakes)
function getMatchesToBackfill() {
    return db.prepare(`
        SELECT
            match_id,
            MAX(game_creation)                                        AS game_creation,
            MAX(CASE WHEN participant_json IS NULL THEN 1 ELSE 0 END) AS needs_stats,
            MAX(CASE WHEN early_dragons IS NULL AND is_remake = 0
                      AND (match_duration IS NULL OR match_duration >= ?) THEN 1 ELSE 0 END) AS needs_timeline
        FROM match_history
        GROUP BY match_id
        HAVING needs_stats = 1 OR needs_timeline = 1
        ORDER BY game_creation DESC
    `).all(REMAKE_MAX_DURATION);
}

(async () => {
    const matches = getMatchesToBackfill().slice(0, LIMIT);
    const estimatedCalls = matches.reduce((n, m) => n + 1 + m.needs_timeline, 0);

    console.log(`\n📦 ${matches.length} match(s) à rattraper — ~${estimatedCalls} requêtes Riot`);
    console.log(`⏱️  1 requête toutes les ${DELAY_MS / 1000}s → durée estimée ~${Math.ceil((estimatedCalls * DELAY_MS) / 60000)} min\n`);
    if (DRY_RUN || !matches.length) process.exit(0);

    const summary = { stats: 0, timelines: 0, notFound: 0, errors: 0 };

    for (const [index, { match_id: matchId, needs_timeline: needsTimeline }] of matches.entries()) {
        const prefix = `[${index + 1}/${matches.length}] ${matchId}`;

        // ── Match (nécessaire pour les stats ET pour les écarts à 15 min) ─────
        let matchInfo;
        try {
            matchInfo = (await riotCall(() => getMatch(matchId), matchId)).info;
            summary.stats += storeMatchStats(matchId, matchInfo);
        } catch (error) {
            const status = error.response?.status;
            if (status === 404) summary.notFound++;
            else summary.errors++;
            console.log(`${prefix} ❌ match ${status === 404 ? "introuvable chez Riot" : `erreur (${status ?? error.message})`}`);
            continue;
        }

        // ── Timeline (games d'au moins 5 min, hors remakes) ───────────────────
        let timelineText = "timeline inutile (remake)";
        if (needsTimeline && matchInfo.gameDuration >= REMAKE_MAX_DURATION) {
            try {
                const timeline = await riotCall(() => getTimeline(matchId), `${matchId} (timeline)`);
                storeTimelineStats(matchId, timeline, matchInfo);
                summary.timelines++;
                timelineText = "timeline ✓";
            } catch (error) {
                summary.errors++;
                timelineText = `timeline ❌ (${error.response?.status ?? error.message})`;
            }
        }

        console.log(`${prefix} ✓ stats · ${timelineText}`);
    }

    console.log(
        `\n✅ Terminé — ${summary.stats} ligne(s) de stats, ${summary.timelines} timeline(s), ` +
        `${summary.notFound} match(s) introuvable(s), ${summary.errors} erreur(s)` +
        (summary.errors ? "\n   Relance le script pour réessayer les erreurs." : "")
    );
    process.exit(0);
})();
