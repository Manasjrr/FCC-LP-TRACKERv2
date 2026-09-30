const logger = require("../utils/loggers");
const { createTtlCache } = require("./ttlCache");

const TTL = 2880 * 60 * 1000; // 48h
const MAX_TIMELINES = 300;

const timelineCache = createTtlCache({
    ttl: TTL,
    maxSize: MAX_TIMELINES,
    onExpire: (matchId) => logger.info("CACHE", `Timeline expirée : ${matchId}`),
});

// ─── Timeline allégée ─────────────────────────────────────────────────────────
// Une timeline Riot complète pèse plusieurs Mo en mémoire (des milliers
// d'événements : items, wards, level up, positions...). On ne garde que ce que
// le bot utilise :
//   • CHAMPION_KILL      → assists à 15 min (stats détaillées)
//   • ELITE_MONSTER_KILL → 2 premiers dragons (note)
//   • participantFrames  → écarts de gold / XP / CS à 15 min
// Les frames gardent leur position (le code lit frames.slice(0, 16)).
const KEPT_EVENTS = new Set(["CHAMPION_KILL", "ELITE_MONSTER_KILL"]);

function compactEvent(e) {
    return {
        type: e.type,
        timestamp: e.timestamp,
        killerId: e.killerId,
        killerTeamId: e.killerTeamId,
        victimId: e.victimId,
        monsterType: e.monsterType,
        assistingParticipantIds: e.assistingParticipantIds,
    };
}

function compactParticipantFrames(participantFrames) {
    if (!participantFrames) return participantFrames;
    const result = {};
    for (const [id, pf] of Object.entries(participantFrames)) {
        result[id] = {
            participantId: pf.participantId,
            totalGold: pf.totalGold,
            currentGold: pf.currentGold,
            xp: pf.xp,
            level: pf.level,
            minionsKilled: pf.minionsKilled,
            jungleMinionsKilled: pf.jungleMinionsKilled,
        };
    }
    return result;
}

function compactTimeline(timeline) {
    const frames = timeline?.info?.frames;
    if (!Array.isArray(frames)) return timeline;

    return {
        metadata: timeline.metadata ? { matchId: timeline.metadata.matchId } : undefined,
        info: {
            frameInterval: timeline.info.frameInterval,
            participants: timeline.info.participants,
            frames: frames.map((frame) => ({
                timestamp: frame.timestamp,
                events: (frame.events ?? []).filter((e) => KEPT_EVENTS.has(e.type)).map(compactEvent),
                participantFrames: compactParticipantFrames(frame.participantFrames),
            })),
        },
    };
}

// Retourne la timeline allégée (celle qui est gardée en cache)
function setTimeline(matchId, timeline) {
    const compact = compactTimeline(timeline);
    timelineCache.set(matchId, compact);
    logger.info("CACHE", `Timeline mise en cache : ${matchId}`, {
        size: timelineCache.size,
    });
    return compact;
}

function getTimeline(matchId) {
    return timelineCache.get(matchId);
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

module.exports = { setTimeline, getTimeline, hasTimeline, deleteTimeline, getSize, compactTimeline };
