const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getRankEmoji, getRankOrder } = require("../utils/rankUtils");
const { getChampionIconUrl } = require("../utils/championUtils");
const { getDpmUrl } = require("../utils/playerUtils");

// Tous les builders prennent tr = traducteur i18n (langue du serveur qui reçoit la notification)

// ─── Rôles ───────────────────────────────────────────────────────────────────
const ROLE_EMOJIS = {
    TOP: "🗡️",
    JUNGLE: "🌿",
    MIDDLE: "🔮",
    BOTTOM: "🏹",
    UTILITY: "🛡️",
};

// Ordre d'affichage des joueurs d'un groupe
const ROLE_ORDER = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

function sortEntriesByRole(entries) {
    const rank = (e) => {
        const i = ROLE_ORDER.indexOf(e.result.participant.teamPosition);
        return i === -1 ? ROLE_ORDER.length : i;
    };
    return [...entries].sort((a, b) => rank(a) - rank(b));
}

// ─── Détection multi-kill ──────────────────────────────────────────────────
function getMultiKillText(participant, tr) {
    if (participant.pentaKills > 0) {
        return tr("match.pentakill", { count: participant.pentaKills });
    }
    if (participant.quadraKills > 0) {
        return tr("match.quadrakill", { count: participant.quadraKills });
    }
    return null;
}

function getPositionChangeText(positionBefore, positionAfter) {
    if (!positionBefore || !positionAfter || positionBefore.total === 0) return null;
    if (positionBefore.position === positionAfter.position) return null;

    const arrow = positionAfter.position < positionBefore.position ? "🟢⬆️" : "🔴⬇️";
    return `${arrow} #${positionAfter.position}/${positionAfter.total}`;
}

// ─── Ligne "en duo avec / contre" ──────────────────────────────────────────
// trackedMates = autres joueurs suivis présents dans la game : [{ riot_id, participant }]
function getMatesText(participant, trackedMates = [], tr) {
    const allies = trackedMates.filter((m) => m.participant.teamId === participant.teamId);
    const enemies = trackedMates.filter((m) => m.participant.teamId !== participant.teamId);
    const names = (list) => list.map((m) => `**${m.riot_id}**`).join(", ");

    const lines = [];
    if (allies.length) lines.push(tr("match.duoWith", { names: names(allies) }));
    if (enemies.length) lines.push(tr("match.against", { names: names(enemies) }));
    return lines.length ? lines.join("\n") : null;
}

function getResultTitle(isRemake, win, tr) {
    return tr(isRemake ? "match.remake" : win ? "match.victory" : "match.defeat");
}

// ─── Notification d'un match ─────────────────────────────────────────────────
// entry  = { player, result, positionBefore, positionAfter }
//          (result = valeur de retour de processNewMatch)
// match  = match.info (Riot)
function buildMatchNotifEmbed(entry, match, matchId, patchVersion, trackedMates = [], tr) {
    const { player, result, positionBefore, positionAfter } = entry;
    const { participant, currentRank, currentLP, finalLpChange, oldRank, isRemake } = result;

    const clickablePlayerName = `[**${player.riot_id}**](${getDpmUrl(player.riot_id)})`;
    const lpChangeText = finalLpChange >= 0 ? `+${finalLpChange} LP` : `${finalLpChange} LP`;
    const rankChange = oldRank && oldRank !== currentRank
        ? `\n🏆 **${oldRank}** → **${currentRank}**`
        : "";

    const multiKillText = getMultiKillText(participant, tr);
    const positionText = getPositionChangeText(positionBefore, positionAfter);
    const matesText = getMatesText(participant, trackedMates, tr);

    const title = getResultTitle(isRemake, participant.win, tr);
    const color = isRemake ? 0x808080 : participant.win ? 0x00ff00 : 0xff0000;
    const description = (isRemake
        ? `${tr("match.remakeDescription", { player: clickablePlayerName })}\n${tr("match.notCounted")}`
        : tr("match.finishedDescription", { player: clickablePlayerName }) + (multiKillText ? `\n${multiKillText}` : ""))
        + (matesText ? `\n${matesText}` : "");

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        // entry.thumbnail : vignette générée (ADC / support avec leur partenaire de lane)
        .setThumbnail(entry.thumbnail ?? getChampionIconUrl(participant.championName, patchVersion))
        .addFields(
            {
                name: tr("match.performance"),
                value: `**${participant.kills}/${participant.deaths}/${participant.assists}** KDA\n` +
                    tr("match.championLevel", { champion: participant.championName, level: participant.champLevel }),
                inline: true,
            },
            {
                name: tr("match.lpChange"),
                value: `**${lpChangeText}**\n${currentRank} (${currentLP} LP)${rankChange}`,
                inline: true,
            },
            {
                name: tr("match.duration"),
                value: tr("match.minutes", { n: Math.floor(match.gameDuration / 60) }),
                inline: true,
            }
        );

    // Note de la game (performance selon le rôle joué) — absente pour un remake
    if (entry.gameScore) {
        embed.addFields({
            name: tr("match.gameScore"),
            value: `**${entry.gameScore.score}/100** (${entry.gameScore.tier.grade})`,
            inline: true,
        });
    }

    if (positionText) {
        embed.addFields({
            name: tr("match.serverRank"),
            value: positionText,
            inline: true,
        });
    }

    embed.setTimestamp().setFooter({ text: `Match ID: ${matchId}` });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`stats|${matchId}|${player.puuid}`)
            .setLabel(tr("match.detailedStats"))
            .setStyle(ButtonStyle.Secondary)
    );

    return { embed, row };
}

// ─── Joueurs suivis tous dans la même équipe ? ──────────────────────────────
function isSameTeamGroup(entries) {
    const teamId = entries[0].result.participant.teamId;
    return entries.every((e) => e.result.participant.teamId === teamId);
}

// ─── Bloc d'un joueur dans l'embed duo ───────────────────────────────────────
function buildDuoPlayerBlock(entry, tr) {
    const { player, result, positionBefore, positionAfter } = entry;
    const { participant, currentRank, currentLP, finalLpChange, oldRank, isRemake } = result;

    const role = participant.teamPosition;
    const { kills, deaths, assists } = participant;
    const kdaRatio = deaths === 0 ? "Perfect" : ((kills + assists) / deaths).toFixed(1);
    const lpText = finalLpChange >= 0 ? `+${finalLpChange} LP` : `${finalLpChange} LP`;
    const lpEmoji = finalLpChange >= 0 ? "📈" : "📉";

    const header = `${ROLE_EMOJIS[role] ?? "❓"} **[${player.riot_id}](${getDpmUrl(player.riot_id)})**`;

    // Lignes courtes (une info par ligne) pour éviter les retours à la ligne sur mobile
    const lines = [
        `🎮 ${participant.championName}`,
        `⚔️ **${kills}/${deaths}/${assists}** · ${kdaRatio} KDA`,
    ];
    if (entry.gameScore) {
        lines.push(`🧮 **${entry.gameScore.score}**/100 (${entry.gameScore.tier.grade})`);
    }
    if (!isRemake) {
        lines.push(`${lpEmoji} **${lpText}**`);
        lines.push(`${getRankEmoji(currentRank)} ${currentRank} · ${currentLP} LP`);
    }
    if (oldRank && oldRank !== currentRank) {
        lines.push(`🏆 ${oldRank} → **${currentRank}**`);
    }
    if (positionBefore && positionAfter && positionBefore.total > 0 && positionBefore.position !== positionAfter.position) {
        const arrow = positionAfter.position < positionBefore.position ? "⬆️" : "⬇️";
        lines.push(`🏅 #${positionBefore.position} → **#${positionAfter.position}**/${positionAfter.total} ${arrow}`);
    }
    const multiKillText = getMultiKillText(participant, tr);
    if (multiKillText) lines.push(multiKillText);

    return [header, ...lines.map((l) => `> ${l}`)].join("\n");
}

// ─── Embed unique pour un duo / groupe dans la même équipe ───────────────────
// Durée et Match ID affichés une seule fois, vignette = entries[0].thumbnail
// (champion du 1er joueur + champion du duo en petit)
function buildDuoMatchEmbed(entries, match, matchId, patchVersion, tr) {
    const first = entries[0].result;
    const { isRemake } = first;
    const win = first.participant.win;
    // Titre court pour qu'il tienne sur une ligne à côté de la vignette (mobile)
    const title = getResultTitle(isRemake, win, tr);
    const color = isRemake ? 0x808080 : win ? 0x2ecc71 : 0xe74c3c;

    const groupLabel = entries.length === 2 ? tr("match.duoQ") : tr("match.groupOf", { count: entries.length });
    const subtitle = `${groupLabel} · ⏱️ ${tr("match.minutes", { n: Math.floor(match.gameDuration / 60) })}`;

    const parts = [`-# ${subtitle}`];
    if (isRemake) parts.push(tr("match.notCounted"));
    parts.push(...entries.map((e) => buildDuoPlayerBlock(e, tr)));

    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(parts.join("\n\n").slice(0, 4096))
        .setColor(color)
        .setThumbnail(entries[0].thumbnail ?? getChampionIconUrl(first.participant.championName, patchVersion))
        .setTimestamp()
        .setFooter({ text: `Match ID: ${matchId}` });
}

// ─── Notification Flex (un seul embed pour tous les joueurs suivis) ──────────
// Pas de LP / note / classement : les Flex ne sont pas enregistrées en BDD
// entries = [{ player, result: { participant } }] (triées par rôle)
const FLEX_REMAKE_MAX_DURATION = 5 * 60; // secondes

function formatThousands(value) {
    return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${value}`;
}

function buildFlexPlayerBlock({ player, result: { participant }, gameScore }, gameDuration, tr) {
    const { kills, deaths, assists } = participant;
    const kdaRatio = deaths === 0 ? "Perfect" : ((kills + assists) / deaths).toFixed(1);
    const cs = (participant.totalMinionsKilled ?? 0) + (participant.neutralMinionsKilled ?? 0);
    const csPerMin = gameDuration > 0 ? (cs / (gameDuration / 60)).toFixed(1) : "0";
    const role = participant.teamPosition;

    const lines = [
        `⚔️ **${kills} / ${deaths} / ${assists}** · ${kdaRatio} KDA`
            + (gameScore ? `  ·  🧮 **${gameScore.score}**/100 (${gameScore.tier.grade})` : ""),
        `🌾 ${cs} CS (${csPerMin}/min) · 💥 ${tr("match.damage", { damage: formatThousands(participant.totalDamageDealtToChampions ?? 0) })}`,
    ];
    const multiKillText = getMultiKillText(participant, tr);
    if (multiKillText) lines.push(multiKillText);

    const header = `${ROLE_EMOJIS[role] ?? "❓"} **[${player.riot_id}](${getDpmUrl(player.riot_id)})** · ${participant.championName}`;
    return [header, ...lines.map((l) => `> ${l}`)].join("\n");
}

function buildFlexMatchEmbed(entries, match, matchId, patchVersion, tr) {
    const first = entries[0].result.participant;
    const isRemake = match.gameDuration < FLEX_REMAKE_MAX_DURATION;
    const sameTeam = isSameTeamGroup(entries);

    let title, color;
    if (isRemake) {
        title = tr("match.flexRemake");
        color = 0x808080;
    } else if (!sameTeam) {
        title = tr("match.flexFaceOff");
        color = 0xffa500;
    } else {
        title = tr(first.win ? "match.flexVictory" : "match.flexDefeat");
        color = first.win ? 0x2ecc71 : 0xe74c3c;
    }

    const trackedLabel = entries.length > 1 ? `  ·  ${tr("match.trackedPlayers", { count: entries.length })}` : "";
    const parts = [`-# ⏱️ ${tr("match.minutes", { n: Math.floor(match.gameDuration / 60) })}${trackedLabel}`];

    if (sameTeam) {
        parts.push(...entries.map((e) => buildFlexPlayerBlock(e, match.gameDuration, tr)));
    } else {
        // Face-à-face : joueurs regroupés par équipe, avec le résultat de chaque équipe
        for (const teamId of [100, 200]) {
            const team = entries.filter((e) => e.result.participant.teamId === teamId);
            if (!team.length) continue;
            const teamWin = team[0].result.participant.win;
            const teamLabel = tr(isRemake ? "match.teamRemake" : teamWin ? "match.teamVictory" : "match.teamDefeat");
            parts.push(`__**${teamLabel}**__`);
            parts.push(...team.map((e) => buildFlexPlayerBlock(e, match.gameDuration, tr)));
        }
    }

    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(parts.join("\n\n").slice(0, 4096))
        .setColor(color)
        .setThumbnail(entries[0].thumbnail ?? getChampionIconUrl(first.championName, patchVersion))
        .setTimestamp()
        .setFooter({ text: `Match ID: ${matchId}` });
}

// ─── Message groupé (plusieurs joueurs suivis dans la même game) ─────────────
// Même équipe → un seul embed "duo"
// Équipes opposées → en-tête "face-à-face" + l'embed normal de chaque joueur
// entries = [{ player, result, positionBefore, positionAfter }]
function buildGroupMatchNotifEmbed(entries, match, matchId, patchVersion, tr) {
    const first = entries[0].result;
    const isRemake = first.isRemake;
    const sameTeam = isSameTeamGroup(entries);

    const nameWithRole = (e) => {
        const role = e.result.participant.teamPosition;
        return `**${e.player.riot_id}**${ROLE_EMOJIS[role] ? ` (${tr(`roles.${role}`)})` : ""}`;
    };
    const joinNames = (list) => list.length > 1
        ? `${list.slice(0, -1).join(", ")} ${tr("match.and")} ${list[list.length - 1]}`
        : list[0];

    let embeds;
    if (sameTeam) {
        embeds = [buildDuoMatchEmbed(entries, match, matchId, patchVersion, tr)];
    } else {
        const names = joinNames(entries.map(nameWithRole));
        const description = tr(isRemake ? "match.groupRemake" : "match.groupFaceOff", { names });

        // En-tête + embed normal de chaque joueur
        // (Discord limite à 10 embeds par message : en-tête + 9 joueurs)
        embeds = [new EmbedBuilder().setDescription(description).setColor(isRemake ? 0x808080 : 0xffa500)];
        for (const entry of entries.slice(0, 9)) {
            embeds.push(buildMatchNotifEmbed(entry, match, matchId, patchVersion, [], tr).embed);
        }
    }

    // Un bouton "Stats détaillées" par joueur (5 max par ligne)
    const buttons = entries.map(({ player }) =>
        new ButtonBuilder()
            .setCustomId(`stats|${matchId}|${player.puuid}`)
            .setLabel(`📊 ${player.riot_id}`.slice(0, 80))
            .setStyle(ButtonStyle.Secondary)
    );
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }

    return { embeds, rows };
}

// ─── Embed changement de rang ─────────────────────────────────────────────────
function buildRankChangeEmbed(player, oldRank, newRank, oldLP, newLP, tr) {
    const oldRankData = getRankOrder(oldRank, oldLP);
    const newRankData = getRankOrder(newRank, newLP);
    const rankUp = newRankData.totalScore > oldRankData.totalScore;

    return new EmbedBuilder()
        .setTitle(tr(rankUp ? "match.promotion" : "match.demotion"))
        .setDescription(tr("match.rankChanged", { riotId: player.riot_id }))
        .addFields(
            { name: tr("match.oldRank"), value: `${getRankEmoji(oldRank)} ${oldRank}`, inline: true },
            { name: tr("match.newRank"), value: `${getRankEmoji(newRank)} ${newRank}`, inline: true }
        )
        .setColor(rankUp ? 0x00ff00 : 0xff0000)
        .setTimestamp();
}

// ─── Embed changement de pseudo ───────────────────────────────────────────────
function buildRiotIdChangeEmbed(oldRiotId, newRiotId, tr) {
    return new EmbedBuilder()
        .setTitle(tr("match.renameTitle"))
        .setDescription(tr("match.renameDescription", { oldRiotId, newRiotId, url: getDpmUrl(newRiotId) }))
        .setColor(0x5865f2)
        .setTimestamp();
}

module.exports = {
    isSameTeamGroup,
    sortEntriesByRole,
    buildMatchNotifEmbed,
    buildGroupMatchNotifEmbed,
    buildFlexMatchEmbed,
    buildRankChangeEmbed,
    buildRiotIdChangeEmbed,
};
