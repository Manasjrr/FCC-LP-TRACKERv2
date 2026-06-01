const logger = require("../utils/loggers");

const timelineCache = new Map();
const TTL = 2880 * 60 * 1000; // 48h

function setTimeline(matchId, timeline) {
    timelineCache.set(matchId, timeline);
    logger.info("CACHE", `Timeline mise en cache : ${matchId}`, {
        size: timelineCache.size,
    });

    setTimeout(() => {
        timelineCache.delete(matchId);
        logger.info("CACHE", `Timeline expirée : ${matchId}`);
    }, TTL);
}

function getTimeline(matchId) {
    return timelineCache.get(matchId) ?? null;
}

function hasTimeline(matchId) {
    return timelineCache.has(matchId);
}

function deleteTimeline(matchId) {
    timelineCache.delete(matchId);
}

function getSize() {
    return timelineCache.size;
}

module.exports = { setTimeline, getTimeline, hasTimeline, deleteTimeline, getSize };
