const logger = require("../utils/loggers");

const matchCache = new Map();
const TTL = 2880 * 60 * 1000; // 48h

function setMatch(matchId, matchInfo) {
    matchCache.set(matchId, matchInfo);
    logger.info("CACHE", `Match mis en cache : ${matchId}`, {
        size: matchCache.size,
    });

    setTimeout(() => {
        matchCache.delete(matchId);
        logger.info("CACHE", `Match expiré : ${matchId}`);
    }, TTL);
}

function getMatch(matchId) {
    return matchCache.get(matchId) ?? null;
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
