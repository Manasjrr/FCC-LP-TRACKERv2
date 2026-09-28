const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getRankEmoji, getRankOrder } = require("../utils/rankUtils");
const { getChampionIconUrl } = require("../utils/championUtils");
const { getDpmUrl } = require("../utils/playerUtils");

// ─── Rôles ───────────────────────────────────────────────────────────────────
const ROLE_NAMES = {
    TOP: "Top",
    JUNGLE: "Jungle",
    MIDDLE: "Mid",
    BOTTOM: "ADC",
    UTILITY: "Support",
};

const ROLE_EMOJIS = {
    TOP: "🗡️",
    JUNGLE: "🌿",
    MIDDLE: "🔮",
    BOTTOM: "🏹",
    UTILITY: "🛡️",
};

const QUEUE_NAMES = {
    420: "SoloQ",
    440: "Flex",
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
function getMultiKillText(participant) {
    if (participant.pentaKills > 0) {
        return `🔥 **PENTAKILL x${participant.pentaKills}** 🔥`;
    }
    if (participant.quadraKills > 0) {
        return `⚡ **QUADRA KILL x${participant.quadraKills}**`;
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
function getMatesText(participant, trackedMates = []) {
    const allies = trackedMates.filter((m) => m.participant.teamId === participant.teamId);
    const enemies = trackedMates.filter((m) => m.participant.teamId !== participant.teamId);
    const names = (list) => list.map((m) => `**${m.riot_id}**`).join(", ");

    const lines = [];
    if (allies.length) lines.push(`👥 En duo avec ${names(allies)}`);
    if (enemies.length) lines.push(`⚔️ Contre ${names(enemies)}`);
    return lines.length ? lines.join("\n") : null;
}

// ─── Notification d'un match ─────────────────────────────────────────────────
// entry  = { player, result, positionBefore, positionAfter }
//          (result = valeur de retour de processNewMatch)
// match  = match.info (Riot)
function buildMatchNotifEmbed(entry, match, matchId, patchVersion, trackedMates = []) {
    const { player, result, positionBefore, positionAfter } = entry;
    const { participant, currentRank, currentLP, finalLpChange, oldRank, isRemake } = result;

    const clickablePlayerName = `[**${player.riot_id}**](${getDpmUrl(player.riot_id)})`;
    const lpChangeText = finalLpChange >= 0 ? `+${finalLpChange} LP` : `${finalLpChange} LP`;
    const rankChange = oldRank && oldRank !== currentRank
        ? `\n🏆 **${oldRank}** → **${currentRank}**`
        : "";

    const multiKillText = getMultiKillText(participant);
    const positionText = getPositionChangeText(positionBefore, positionAfter);
    const matesText = getMatesText(participant, trackedMates);

    const title = isRemake ? "⚪ REMAKE" : participant.win ? "🟢 VICTOIRE" : "🔴 DÉFAITE";
    const color = isRemake ? 0x808080 : participant.win ? 0x00ff00 : 0xff0000;
    const description = (isRemake
        ? `${clickablePlayerName} vient de faire un remake !\n*Cette partie ne compte pas dans les statistiques.*`
        : `${clickablePlayerName} vient de finir une partie !` + (multiKillText ? `\n${multiKillText}` : ""))
        + (matesText ? `\n${matesText}` : "");

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        // entry.thumbnail : vignette générée (ADC / support avec leur partenaire de lane)
        .setThumbnail(entry.thumbnail ?? getChampionIconUrl(participant.championName, patchVersion))
        .addFields(
            {
                name: "🎯 Performance",
                value: `**${participant.kills}/${participant.deaths}/${participant.assists}** KDA\n🏆 ${participant.championName} (Niv.${participant.champLevel})`,
                inline: true,
            },
            {
                name: "📊 LP Change",
                value: `**${lpChangeText}**\n${currentRank} (${currentLP} LP)${rankChange}`,
                inline: true,
            },
            {
                name: "⏱️ Durée",
                value: `${Math.floor(match.gameDuration / 60)}min`,
                inline: true,
            }
        );

    // Note de la game (performance selon le rôle joué) — absente pour un remake
    if (entry.gameScore) {
        embed.addFields({
            name: "🧮 Note de la game",
            value: `**${entry.gameScore.score}/100** (${entry.gameScore.tier.grade})`,
            inline: true,
        });
    }

    if (positionText) {
        embed.addFields({
            name: "🏅 Classement serveur",
            value: positionText,
            inline: true,
        });
    }

    embed.setTimestamp().setFooter({ text: `Match ID: ${matchId}` });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`stats|${matchId}|${player.puuid}`)
            .setLabel("📊 Stats détaillées")
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
function buildDuoPlayerBlock(entry) {
    const { player, result, positionBefore, positionAfter } = entry;
    const { participant, currentRank, currentLP, finalLpChange, oldRank, isRemake } = result;

    const role = participant.teamPosition;
    const { kills, deaths, assists } = participant;
    const kdaRatio = deaths === 0 ? "Perfect" : ((kills + assists) / deaths).toFixed(1);
    const lpText = finalLpChange >= 0 ? `+${finalLpChange} LP` : `${finalLpChange} LP`;
    const lpEmoji = finalLpChange >= 0 ? "📈" : "📉";

    const header = `${ROLE_EMOJIS[role] ?? "❓"} **[${player.riot_id}](${getDpmUrl(player.riot_id)})** · ${participant.championName}`;

    const lines = [
        `⚔️ **${kills} / ${deaths} / ${assists}** · ${kdaRatio} KDA`
            + (entry.gameScore ? `  ·  🧮 **${entry.gameScore.score}**/100 (${entry.gameScore.tier.grade})` : ""),
    ];
    if (!isRemake) {
        lines.push(`${lpEmoji} **${lpText}**  ·  ${getRankEmoji(currentRank)} ${currentRank} · ${currentLP} LP`);
    }
    if (oldRank && oldRank !== currentRank) {
        lines.push(`🏆 ${oldRank} → **${currentRank}**`);
    }
    if (positionBefore && positionAfter && positionBefore.total > 0 && positionBefore.position !== positionAfter.position) {
        const arrow = positionAfter.position < positionBefore.position ? "⬆️" : "⬇️";
        lines.push(`🏅 #${positionBefore.position} → **#${positionAfter.position}** sur ${positionAfter.total} ${arrow}`);
    }
    const multiKillText = getMultiKillText(participant);
    if (multiKillText) lines.push(multiKillText);

    return [header, ...lines.map((l) => `> ${l}`)].join("\n");
}

// ─── Embed unique pour un duo / groupe dans la même équipe ───────────────────
// Durée et Match ID affichés une seule fois, vignette = entries[0].thumbnail
// (champion du 1er joueur + champion du duo en petit)
function buildDuoMatchEmbed(entries, match, matchId, patchVersion) {
    const first = entries[0].result;
    const { isRemake } = first;
    const win = first.participant.win;
    const groupLabel = entries.length === 2 ? "EN DUO" : `EN GROUPE DE ${entries.length}`;

    const title = isRemake ? `⚪ REMAKE ${groupLabel}` : win ? `🟢 VICTOIRE ${groupLabel}` : `🔴 DÉFAITE ${groupLabel}`;
    const color = isRemake ? 0x808080 : win ? 0x2ecc71 : 0xe74c3c;

    const subtitle = [QUEUE_NAMES[match.queueId], `⏱️ ${Math.floor(match.gameDuration / 60)} min`]
        .filter(Boolean)
        .join("  ·  ");

    const parts = [`-# ${subtitle}`];
    if (isRemake) parts.push("*Cette partie ne compte pas dans les statistiques.*");
    parts.push(...entries.map(buildDuoPlayerBlock));

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

function buildFlexPlayerBlock({ player, result: { participant }, gameScore }, gameDuration) {
    const { kills, deaths, assists } = participant;
    const kdaRatio = deaths === 0 ? "Perfect" : ((kills + assists) / deaths).toFixed(1);
    const cs = (participant.totalMinionsKilled ?? 0) + (participant.neutralMinionsKilled ?? 0);
    const csPerMin = gameDuration > 0 ? (cs / (gameDuration / 60)).toFixed(1) : "0";
    const role = participant.teamPosition;

    const lines = [
        `⚔️ **${kills} / ${deaths} / ${assists}** · ${kdaRatio} KDA`
            + (gameScore ? `  ·  🧮 **${gameScore.score}**/100 (${gameScore.tier.grade})` : ""),
        `🌾 ${cs} CS (${csPerMin}/min) · 💥 ${formatThousands(participant.totalDamageDealtToChampions ?? 0)} dégâts`,
    ];
    const multiKillText = getMultiKillText(participant);
    if (multiKillText) lines.push(multiKillText);

    const header = `${ROLE_EMOJIS[role] ?? "❓"} **[${player.riot_id}](${getDpmUrl(player.riot_id)})** · ${participant.championName}`;
    return [header, ...lines.map((l) => `> ${l}`)].join("\n");
}

function buildFlexMatchEmbed(entries, match, matchId, patchVersion) {
    const first = entries[0].result.participant;
    const isRemake = match.gameDuration < FLEX_REMAKE_MAX_DURATION;
    const sameTeam = isSameTeamGroup(entries);

    let title, color;
    if (isRemake) {
        title = "⚪ REMAKE EN FLEX";
        color = 0x808080;
    } else if (!sameTeam) {
        title = "⚔️ FACE-À-FACE EN FLEX";
        color = 0xffa500;
    } else {
        title = first.win ? "🟢 VICTOIRE EN FLEX" : "🔴 DÉFAITE EN FLEX";
        color = first.win ? 0x2ecc71 : 0xe74c3c;
    }

    const trackedLabel = entries.length > 1 ? `  ·  👥 ${entries.length} joueurs suivis` : "";
    const parts = [`-# ⏱️ ${Math.floor(match.gameDuration / 60)} min${trackedLabel}`];

    if (sameTeam) {
        parts.push(...entries.map((e) => buildFlexPlayerBlock(e, match.gameDuration)));
    } else {
        // Face-à-face : joueurs regroupés par équipe, avec le résultat de chaque équipe
        for (const teamId of [100, 200]) {
            const team = entries.filter((e) => e.result.participant.teamId === teamId);
            if (!team.length) continue;
            const teamWin = team[0].result.participant.win;
            const teamLabel = isRemake ? "⚪ Remake" : teamWin ? "🟢 Victoire" : "🔴 Défaite";
            parts.push(`__**${teamLabel}**__`);
            parts.push(...team.map((e) => buildFlexPlayerBlock(e, match.gameDuration)));
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
function buildGroupMatchNotifEmbed(entries, match, matchId, patchVersion) {
    const first = entries[0].result;
    const isRemake = first.isRemake;
    const sameTeam = isSameTeamGroup(entries);

    const nameWithRole = (e) => {
        const role = ROLE_NAMES[e.result.participant.teamPosition];
        return `**${e.player.riot_id}**${role ? ` (${role})` : ""}`;
    };
    const joinNames = (list) => list.length > 1
        ? `${list.slice(0, -1).join(", ")} & ${list[list.length - 1]}`
        : list[0];

    let embeds;
    if (sameTeam) {
        embeds = [buildDuoMatchEmbed(entries, match, matchId, patchVersion)];
    } else {
        const namesText = joinNames(entries.map(nameWithRole));
        const description = isRemake
            ? `👥 ${namesText} ont fait un remake ensemble.`
            : `⚔️ ${namesText} se sont affrontés !`;

        // En-tête + embed normal de chaque joueur
        // (Discord limite à 10 embeds par message : en-tête + 9 joueurs)
        embeds = [new EmbedBuilder().setDescription(description).setColor(isRemake ? 0x808080 : 0xffa500)];
        for (const entry of entries.slice(0, 9)) {
            embeds.push(buildMatchNotifEmbed(entry, match, matchId, patchVersion).embed);
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
function buildRankChangeEmbed(player, oldRank, newRank, oldLP, newLP) {
    const oldRankData = getRankOrder(oldRank, oldLP);
    const newRankData = getRankOrder(newRank, newLP);
    const rankUp = newRankData.totalScore > oldRankData.totalScore;

    return new EmbedBuilder()
        .setTitle(rankUp ? "📈 PROMOTION !" : "📉 RÉTROGRADATION")
        .setDescription(`**${player.riot_id}** a changé de rang !`)
        .addFields(
            { name: "Ancien rang", value: `${getRankEmoji(oldRank)} ${oldRank}`, inline: true },
            { name: "Nouveau rang", value: `${getRankEmoji(newRank)} ${newRank}`, inline: true }
        )
        .setColor(rankUp ? 0x00ff00 : 0xff0000)
        .setTimestamp();
}

// ─── Embed changement de pseudo ───────────────────────────────────────────────
function buildRiotIdChangeEmbed(oldRiotId, newRiotId) {
    return new EmbedBuilder()
        .setTitle("✏️ CHANGEMENT DE PSEUDO")
        .setDescription(`**${oldRiotId}** s'appelle désormais [**${newRiotId}**](${getDpmUrl(newRiotId)}) !`)
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
