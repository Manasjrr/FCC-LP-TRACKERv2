const { EmbedBuilder } = require("discord.js");
const { extractFullMatchStats, extractLaneDiffs15, isRemakeMatch } = require("../utils/matchStatsUtils");
const { computeGameScore, getRoleLabel } = require("../utils/ratingUtils");
const { getChampionName } = require("../utils/championUtils");
const { buildScoreboardImage } = require("../utils/scoreboardUtils");
const logger = require("../utils/loggers");

const SCOREBOARD_FILE = "scoreboard.png";

// ─── Stats détaillées d'une game ─────────────────────────────────────────────
// Texte : comparaison face à l'adversaire direct · Image : tableau des 10 joueurs
// (icône, KDA, CS, dégâts, note de la game). Tout vient du match / de la timeline
// déjà récupérés : aucun appel API Riot supplémentaire.
// tr = traducteur i18n (langue du serveur)
// → { embed, file: { name, buffer } | null }
async function buildDetailedStats(matchInfo, puuid, timeline = null, userTag, tr, patchVersion) {
    const participants = matchInfo.participants;
    const player = participants.find((p) => p.puuid === puuid);
    if (!player) return null; // joueur absent de la game → "données introuvables"
    const enemies = participants.filter((p) => p.teamId !== player.teamId);
    const opponent = enemies.find((p) => p.teamPosition === player.teamPosition) || enemies[0];

    const label = (key, vars) => tr(`detailedStats.${key}`, vars);
    const gameMinutes = matchInfo.gameDuration / 60;
    const isRemake = isRemakeMatch(matchInfo);
    const resultLabel = (p) => label(isRemake ? "remake" : p.win ? "victory" : "defeat");

    // ── Note de chaque joueur (même calcul que "Détail de la note") ──────────
    const scores = new Map(participants.map((p) => [
        p.puuid,
        isRemake ? null : computeGameScore(extractFullMatchStats(matchInfo, p, timeline)),
    ]));

    const embed = new EmbedBuilder()
        .setTitle(label("title"))
        .setColor(isRemake ? 0x95a5a6 : player.win ? 0x2ecc71 : 0xe74c3c)
        .setDescription(buildSummary(player, opponent, scores.get(puuid), resultLabel(player), gameMinutes, tr))
        .addFields(buildComparisonFields(matchInfo, player, opponent, timeline, tr))
        .setTimestamp(matchInfo.gameEndTimestamp ?? null);
    if (userTag) embed.setFooter({ text: label("requestedBy", { user: userTag }) });

    // ── Tableau des scores (image) ────────────────────────────────────────────
    let file = null;
    try {
        const buffer = await buildScoreboardImage(buildTeams(participants, player, scores, isRemake, resultLabel, tr), {
            patchVersion,
            gameMinutes,
            columns: {
                kda: "KDA",
                cs: "CS",
                damage: label("columnDamage"),
                score: label("score"),
            },
            fmt: {
                number: (n) => n.toLocaleString(tr.locale),
                perMin: (n) => label("perMin", { value: n.toLocaleString(tr.locale, { maximumFractionDigits: 1 }) }),
            },
        });
        file = { name: SCOREBOARD_FILE, buffer };
        embed.setImage(`attachment://${SCOREBOARD_FILE}`);
    } catch (error) {
        logger.warn("EMBED", "Tableau des scores impossible, embed sans image", { error: error.message });
    }

    return { embed, file };
}

// ─── Résumé : résultat, champion, rôle, durée, note ──────────────────────────
function buildSummary(player, opponent, score, result, gameMinutes, tr) {
    const label = (key, vars) => tr(`detailedStats.${key}`, vars);
    const parts = [
        `**${result}**`,
        getChampionName(player.championId),
        player.teamPosition ? getRoleLabel(player.teamPosition, tr) : null,
        label("duration", { minutes: Math.floor(gameMinutes) }),
    ].filter(Boolean);

    return [
        parts.join(" · "),
        score ? label("yourScore", { score: score.score, grade: score.tier.grade }) : null,
        `### ${label("versus", { champion: getChampionName(opponent.championId) })}`,
    ].filter((line) => line != null).join("\n");
}

// ─── Comparaison face à l'adversaire direct (champs en grille) ───────────────
function buildComparisonFields(matchInfo, player, opponent, timeline, tr) {
    const label = (key) => tr(`detailedStats.${key}`);
    const fmt = (n) => n.toLocaleString(tr.locale);
    const signed = (d) => `${d > 0 ? "+" : ""}${fmt(d)}`;
    const trend = (d) => (d > 0 ? "🟢" : d < 0 ? "🔴" : "⚪");
    const na = { value: "—" };

    // Écart sur une stat de fin de game : "🟢 +1 240" + valeurs des deux joueurs
    const compare = (a, b) => ({ value: `**${trend(a - b)} ${signed(a - b)}**\n${fmt(a)} vs ${fmt(b)}` });
    // Écart à 15 min (timeline) : écart seul
    const diffOnly = (d) => (d == null ? na : { value: `**${trend(d)} ${signed(d)}**` });

    const cs = (p) => (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0);
    const lane = timeline ? extractLaneDiffs15(timeline, matchInfo, player.puuid) : null;
    const role = player.teamPosition;

    const stats = [
        ["gold", compare(player.goldEarned, opponent.goldEarned)],
        ["damage", compare(player.totalDamageDealtToChampions, opponent.totalDamageDealtToChampions)],
        ["vision", compare(player.visionScore, opponent.visionScore)],
        ["goldDiff15", diffOnly(lane?.gold_diff_15)],
    ];

    if (role === "UTILITY") {
        const assists = timeline ? countAssists15(timeline, matchInfo, player, opponent) : null;
        stats.push(["assists15", assists ? compare(assists.player, assists.opponent) : na]);
        stats.push(["xpDiff15", diffOnly(lane?.xp_diff_15)]);
    } else {
        stats.push(["csTotal", compare(cs(player), cs(opponent))]);
        stats.push(["csDiff15", diffOnly(lane?.cs_diff_15)]);
    }

    if (role === "TOP" || role === "MIDDLE") {
        stats.push(["soloKills", compare(player.challenges?.soloKills ?? 0, opponent.challenges?.soloKills ?? 0)]);
    }

    // Grille de 3 colonnes : complète la dernière ligne pour garder l'alignement
    const fields = stats.map(([key, { value }]) => ({ name: label(key), value, inline: true }));
    while (fields.length % 3) fields.push({ name: "​", value: "​", inline: true });
    return fields;
}

// Assists des 15 premières minutes (support)
function countAssists15(timeline, matchInfo, player, opponent) {
    const participantId = (p) => p.participantId ?? matchInfo.participants.indexOf(p) + 1;
    const playerId = participantId(player);
    const opponentId = participantId(opponent);
    const result = { player: 0, opponent: 0 };

    for (const frame of timeline.info.frames.slice(0, 16)) {
        for (const event of frame.events ?? []) {
            if (event.type !== "CHAMPION_KILL") continue;
            if (event.assistingParticipantIds?.includes(playerId)) result.player++;
            if (event.assistingParticipantIds?.includes(opponentId)) result.opponent++;
        }
    }
    return result;
}

// ─── Équipes pour le tableau des scores (équipe du joueur en premier) ───────
function buildTeams(participants, player, scores, isRemake, resultLabel, tr) {
    const teamIds = [player.teamId, ...new Set(participants.map((p) => p.teamId).filter((id) => id !== player.teamId))];

    return teamIds.map((teamId) => {
        const members = participants.filter((p) => p.teamId === teamId);
        const rows = members.map((p) => ({
            participant: p,
            score: scores.get(p.puuid),
            highlight: p.puuid === player.puuid,
            badge: null,
        }));

        // MVP : meilleure note de l'équipe gagnante · ACE : meilleure note de l'équipe perdante
        const best = rows.filter((r) => r.score).sort((a, b) => b.score.score - a.score.score)[0];
        if (best && !isRemake) best.badge = members[0].win ? "MVP" : "ACE";

        return {
            teamId,
            label: tr(`detailedStats.${teamId === player.teamId ? "allies" : "enemies"}`),
            result: resultLabel(members[0]),
            players: rows,
        };
    });
}

module.exports = { buildDetailedStats };
