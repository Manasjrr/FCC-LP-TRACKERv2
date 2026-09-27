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
        .setThumbnail(getChampionIconUrl(participant.championName, patchVersion))
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

// ─── Message groupé (plusieurs joueurs suivis dans la même game) ─────────────
// En-tête "duo" + l'embed normal de chaque joueur, dans un seul message
// entries = [{ player, result, positionBefore, positionAfter }]
function buildGroupMatchNotifEmbed(entries, match, matchId, patchVersion) {
    const first = entries[0].result;
    const isRemake = first.isRemake;
    const sameTeam = entries.every((e) => e.result.participant.teamId === first.participant.teamId);

    const nameWithRole = (e) => {
        const role = ROLE_NAMES[e.result.participant.teamPosition];
        return `**${e.player.riot_id}**${role ? ` (${role})` : ""}`;
    };
    const joinNames = (list) => list.length > 1
        ? `${list.slice(0, -1).join(", ")} & ${list[list.length - 1]}`
        : list[0];
    const namesText = joinNames(entries.map(nameWithRole));

    let color, description;
    if (isRemake) {
        color = 0x808080;
        description = `👥 ${namesText} ont fait un remake ensemble.`;
    } else if (sameTeam) {
        const win = first.participant.win;
        color = win ? 0x00ff00 : 0xff0000;
        description = win
            ? `👥 ${namesText} ont gagné ensemble !`
            : `👥 ${namesText} ont perdu ensemble...`;
    } else {
        color = 0xffa500;
        description = `⚔️ ${namesText} se sont affrontés !`;
    }

    // En-tête + embed normal de chaque joueur
    // (Discord limite à 10 embeds par message : en-tête + 9 joueurs)
    const embeds = [new EmbedBuilder().setDescription(description).setColor(color)];

    for (const entry of entries.slice(0, 9)) {
        embeds.push(buildMatchNotifEmbed(entry, match, matchId, patchVersion).embed);
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
    buildMatchNotifEmbed,
    buildGroupMatchNotifEmbed,
    buildRankChangeEmbed,
    buildRiotIdChangeEmbed,
};
