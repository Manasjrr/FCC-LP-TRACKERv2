const logger = require("../utils/loggers");
const { createTtlCache } = require("./ttlCache");

const TTL = 2880 * 60 * 1000; // 48h
// ~150-300 Ko par match en mémoire : au-delà, les plus anciens sont re-téléchargés si besoin
const MAX_MATCHES = 300;

const matchCache = createTtlCache({
    ttl: TTL,
    maxSize: MAX_MATCHES,
    onExpire: (matchId) => logger.info("CACHE", `Match expiré : ${matchId}`),
});

function setMatch(matchId, matchInfo) {
    matchCache.set(matchId, matchInfo);
    logger.info("CACHE", `Match mis en cache : ${matchId}`, {
        size: matchCache.size,
    });
}

function getMatch(matchId) {
    return matchCache.get(matchId);
}

function hasMatch(matchId) {
    return matchCache.has(matchId);
}

function deleteMatch(matchId) {
    matchCache.delete(matchId);
}

function getSize() {
    return matchCache.size;
}

module.exports = { setMatch, getMatch, hasMatch, deleteMatch, getSize };
