const logger = require("./loggers");

// ─── Compteur d'appels à l'API Riot ──────────────────────────────────────────
// Chaque appel HTTP réel (retries compris) est compté par jour (heure de Paris)
// et par type dans la table api_usage. Le bilan d'une journée est écrit dans
// logs/api.log à minuit, ou au démarrage suivant si le bot était éteint.
const TIMEZONE = "Europe/Paris";

// Type d'appel d'après l'URL
const ENDPOINTS = [
    ["spectator", /\/spectator\//],
    ["match-ids", /\/matches\/by-puuid\//],
    ["timeline", /\/matches\/[^/]+\/timeline/],
    ["match", /\/matches\/[^/?]+$/],
    ["league", /\/league\//],
    ["account", /\/riot\/account\//],
    ["summoner", /\/summoner\//],
    ["mastery", /\/champion-mastery\//],
];

function getEndpoint(url) {
    const path = url.split("?")[0];
    return ENDPOINTS.find(([, regex]) => regex.test(path))?.[0] ?? "autre";
}

// Jour au format AAAA-MM-JJ, heure de Paris
function getDay(date = new Date()) {
    return date.toLocaleDateString("sv-SE", { timeZone: TIMEZONE });
}

function recordApiCall(url) {
    if (!global.db) return; // scripts lancés hors du bot
    try {
        global.db.prepare(`
            INSERT INTO api_usage (day, endpoint, calls) VALUES (?, ?, 1)
            ON CONFLICT (day, endpoint) DO UPDATE SET calls = calls + 1
        `).run(getDay(), getEndpoint(url));
    } catch (error) {
        logger.warn("API", `Comptage de l'appel impossible`, { error: error.message });
    }
}

// Écrit le bilan de chaque journée terminée, puis l'efface
function reportApiUsage() {
    if (!global.db) return;
    const rows = global.db.prepare(`
        SELECT day, endpoint, calls FROM api_usage WHERE day < ? ORDER BY day, calls DESC
    `).all(getDay());

    const days = new Map();
    for (const { day, endpoint, calls } of rows) {
        if (!days.has(day)) days.set(day, {});
        days.get(day)[endpoint] = calls;
    }

    for (const [day, byEndpoint] of days) {
        const total = Object.values(byEndpoint).reduce((sum, n) => sum + n, 0);
        logger.api("API", `Bilan du ${day} : ${total} appels API`, byEndpoint);
        global.db.prepare(`DELETE FROM api_usage WHERE day = ?`).run(day);
    }
}

module.exports = { recordApiCall, reportApiUsage, getEndpoint, TIMEZONE };
