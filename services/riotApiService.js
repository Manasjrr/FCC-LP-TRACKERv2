const axios = require("axios");
const logger = require("../utils/loggers");

const RIOT_API_KEY = process.env.RIOT_API_KEY;

// ─── Helper retry + rate limit ────────────────────────────────────────────────
async function riotGet(url, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            return await axios.get(url, {
                headers: { "X-Riot-Token": RIOT_API_KEY },
                timeout: 10_000,
            });
        } catch (err) {
            const status = err.response?.status;

            if (status === 429 && i < retries) {
                const retryAfter = (err.response.headers["retry-after"] ?? 5) * 1000;
                logger.warn("API", `Rate limit 429 — retry dans ${retryAfter}ms (tentative ${i + 1}/${retries})`, { url });
                await new Promise((r) => setTimeout(r, retryAfter));
                continue;
            }

            // ✅ FIX : ne pas retry sur les erreurs 4xx (sauf 429)
            // Avant : une 404 ou 403 était retentée 2 fois inutilement
            // → gaspillage de quota API + délai inutile
            if (status >= 400 && status < 500) {
                throw err;
            }

            // Retry sur erreurs réseau / 5xx
            if (i < retries) {
                const delay = 1000 * (i + 1);
                logger.warn("API", `Erreur ${status ?? 'réseau'} — retry dans ${delay}ms (tentative ${i + 1}/${retries})`, { url });
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }

            throw err;
        }
    }
}

// ─── Compte ───────────────────────────────────────────────────────────────────
async function getAccountByRiotId(gameName, tagLine) {
    const res = await riotGet(
        `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${gameName}/${tagLine}`
    );
    return res.data;
}

// ─── Summoner ─────────────────────────────────────────────────────────────────
async function getSummonerByPuuid(puuid) {
    const res = await riotGet(
        `https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`
    );
    return res.data;
}

// ─── Ranked ───────────────────────────────────────────────────────────────────
async function getRankedDataByPuuid(puuid) {
    const res = await riotGet(
        `https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`
    );
    return res.data;
}

async function getSoloQData(puuid) {
    const data = await getRankedDataByPuuid(puuid);
    return data.find((e) => e.queueType === "RANKED_SOLO_5x5") ?? null;
}

// ─── Matchs ───────────────────────────────────────────────────────────────────
async function getRecentMatchIds(puuid, count = 5) {
    const res = await riotGet(
        `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&count=${count}`
    );
    return res.data;
}

async function getLastMatchId(puuid) {
    const ids = await getRecentMatchIds(puuid, 1);
    return ids[0] ?? null;
}

async function getMatch(matchId) {
    const res = await riotGet(
        `https://europe.api.riotgames.com/lol/match/v5/matches/${matchId}`
    );
    return res.data;
}

async function getTimeline(matchId) {
    const res = await riotGet(
        `https://europe.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`
    );
    return res.data;
}

// ─── Maîtrise ─────────────────────────────────────────────────────────────────
async function getChampionMasteries(puuid) {
    const res = await riotGet(
        `https://euw1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}`
    );
    return res.data;
}

// ─── Status API ───────────────────────────────────────────────────────────────
async function checkApiStatus() {
    try {
        // ✅ FIX : utiliser riotGet pour bénéficier du timeout
        // Avant : axios.get direct sans timeout → peut bloquer indéfiniment
        const res = await riotGet(
            "https://euw1.api.riotgames.com/lol/status/v4/platform-data"
        );
        logger.info("API", `Riot API OK`, { status: res.status });
        return true;
    } catch (error) {
        logger.error("API", `Riot API KO`, { status: error.response?.status });
        return false;
    }
}

module.exports = {
    riotGet,
    getAccountByRiotId,
    getSummonerByPuuid,
    getRankedDataByPuuid,
    getSoloQData,
    getRecentMatchIds,
    getLastMatchId,
    getMatch,
    getTimeline,
    getChampionMasteries,
    checkApiStatus,
};
