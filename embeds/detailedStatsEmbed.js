const { EmbedBuilder } = require("discord.js");

function buildDetailedStatsEmbed(matchInfo, puuid, timeline = null, userTag) {
    const participants = matchInfo.participants;
    const player = participants.find((p) => p.puuid === puuid);
    const allyTeamId = player.teamId;
    const allies = participants.filter((p) => p.teamId === allyTeamId);
    const enemies = participants.filter((p) => p.teamId !== allyTeamId);
    const opponent = enemies.find((p) => p.teamPosition === player.teamPosition) || enemies[0];
    const role = player.teamPosition;

    const fmt = (n) => n?.toLocaleString("fr-FR") ?? "N/A";
    const diff = (a, b) => {
        const d = a - b;
        return d > 0 ? `+${fmt(d)}` : `${fmt(d)}`;
    };
    const arrow = (a, b) => (a > b ? "🟢" : a < b ? "🔴" : "⚪");

    const roleEmoji = {
        TOP: "🗡️", JUNGLE: "🌿", MIDDLE: "🔮",
        BOTTOM: "🏹", UTILITY: "🛡️",
    };

    const playerLine = (p) => {
        const kda = p.deaths === 0
            ? "Perfect"
            : ((p.kills + p.assists) / p.deaths).toFixed(2);
        const r = roleEmoji[p.teamPosition] || "❓";
        const cs = p.totalMinionsKilled + p.neutralMinionsKilled;
        const highlight = p.puuid === puuid ? "▶ " : "   ";
        return `${highlight}${r} **${p.championName}** ${p.kills}/${p.deaths}/${p.assists} | ${fmt(cs)} CS | ${fmt(p.totalDamageDealtToChampions)} dmg`;
    };

    const alliesText = allies.map(playerLine).join("\n");
    const enemiesText = enemies.map(playerLine).join("\n");

    const playerCs = player.totalMinionsKilled + player.neutralMinionsKilled;
    const opponentCs = opponent.totalMinionsKilled + opponent.neutralMinionsKilled;

    // ── Timeline @15 ──────────────────────────────────────────────────────────
    let goldDiff15 = null, csDiff15 = null;
    let playerAssists15 = null, opponentAssists15 = null;

    if (timeline) {
        const frame15 = timeline.info.frames[15];
        if (frame15) {
            const playerParticipantId = participants.indexOf(player) + 1;
            const opponentParticipantId = participants.indexOf(opponent) + 1;
            const playerFrame = frame15.participantFrames[playerParticipantId];
            const opponentFrame = frame15.participantFrames[opponentParticipantId];

            goldDiff15 = (playerFrame?.totalGold ?? 0) - (opponentFrame?.totalGold ?? 0);

            const playerCs15 = (playerFrame?.minionsKilled ?? 0) + (playerFrame?.jungleMinionsKilled ?? 0);
            const opponentCs15 = (opponentFrame?.minionsKilled ?? 0) + (opponentFrame?.jungleMinionsKilled ?? 0);
            csDiff15 = playerCs15 - opponentCs15;

            if (role === "UTILITY") {
                let pAssists = 0, oAssists = 0;
                for (let i = 0; i <= 15; i++) {
                    const frame = timeline.info.frames[i];
                    if (!frame) continue;
                    for (const event of frame.events) {
                        if (event.type === "CHAMPION_KILL") {
                            if (event.assistingParticipantIds?.includes(playerParticipantId)) pAssists++;
                            if (event.assistingParticipantIds?.includes(opponentParticipantId)) oAssists++;
                        }
                    }
                }
                playerAssists15 = pAssists;
                opponentAssists15 = oAssists;
            }
        }
    }

    // ── Stats selon le rôle ───────────────────────────────────────────────────
    const stats = [];

    stats.push(`💰 Gold : ${arrow(player.goldEarned, opponent.goldEarned)} **${diff(player.goldEarned, opponent.goldEarned)}**`);
    stats.push(
        goldDiff15 !== null
            ? `⏱️ Gold diff @15 : ${arrow(goldDiff15, 0)} **${goldDiff15 > 0 ? "+" : ""}${fmt(goldDiff15)}**`
            : `⏱️ Gold diff @15 : ⚪ **N/A**`
    );
    stats.push(`💥 Dégâts : ${arrow(player.totalDamageDealtToChampions, opponent.totalDamageDealtToChampions)} **${diff(player.totalDamageDealtToChampions, opponent.totalDamageDealtToChampions)}**`);
    stats.push(`👁️ Vision : ${arrow(player.visionScore, opponent.visionScore)} **${diff(player.visionScore, opponent.visionScore)}** (${player.visionScore} vs ${opponent.visionScore})`);

    if (role === "JUNGLE") {
        stats.push(
            csDiff15 !== null
                ? `🌿 CS diff @15 : ${arrow(csDiff15, 0)} **${csDiff15 > 0 ? "+" : ""}${fmt(csDiff15)}**`
                : `🌿 CS diff @15 : ⚪ **N/A**`
        );
        stats.push(`🗺️ CS total : ${arrow(playerCs, opponentCs)} **${diff(playerCs, opponentCs)}**`);
    } else if (role === "UTILITY") {
        stats.push(
            playerAssists15 !== null
                ? `🛡️ Assists @15 : ${arrow(playerAssists15, opponentAssists15)} **${playerAssists15}** vs **${opponentAssists15}**`
                : `🛡️ Assists @15 : ⚪ **N/A**`
        );
    } else {
        stats.push(`🗺️ CS total : ${arrow(playerCs, opponentCs)} **${diff(playerCs, opponentCs)}**`);
        stats.push(
            csDiff15 !== null
                ? `📈 CS diff @15 : ${arrow(csDiff15, 0)} **${csDiff15 > 0 ? "+" : ""}${fmt(csDiff15)}**`
                : `📈 CS diff @15 : ⚪ **N/A**`
        );
        if (role === "TOP" || role === "MIDDLE") {
            const pSolo = player.challenges?.soloKills ?? 0;
            const oSolo = opponent.challenges?.soloKills ?? 0;
            stats.push(`🗡️ Solo kills : ${arrow(pSolo, oSolo)} **${pSolo}** vs **${oSolo}**`);
        }
    }

    return new EmbedBuilder()
        .setTitle("📊 Stats détaillées de la partie")
        .setColor(player.win ? 0x00ff00 : 0xff0000)
        .addFields(
            { name: "🟦 Équipe alliée", value: alliesText || "N/A", inline: false },
            { name: "🟥 Équipe ennemie", value: enemiesText || "N/A", inline: false },
            { name: `⚖️ Toi vs ${opponent.championName}`, value: stats.join("\n"), inline: false }
        )
        .setFooter({
            text: `Durée : ${Math.floor(matchInfo.gameDuration / 60)}min${userTag ? ` • Demandé par ${userTag}` : ""}`,
        })
        .setTimestamp();
}

module.exports = { buildDetailedStatsEmbed };
