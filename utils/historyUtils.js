const { EmbedBuilder } = require("discord.js");

// Fonction pour récupérer les matchs d'un joueur
function getPlayerMatches(playerId, limit = 20) {
    // Uniquement les colonnes affichées (pas le JSON complet du participant)
    return global.db.prepare(`
        SELECT champion_name, kills, deaths, assists, win, lp_change, is_remake, game_creation
        FROM match_history WHERE player_id = ? ORDER BY game_creation DESC LIMIT ?
    `).all(playerId, limit);
}


// Fonction pour formater le temps (tr = traducteur i18n)
function getTimeAgo(timestamp, tr) {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMinutes < 60) return tr("history.minutesAgo", { n: diffMinutes });
    if (diffHours < 24) return tr("history.hoursAgo", { n: diffHours });
    return tr("history.daysAgo", { n: diffDays });
}

// Fonction pour créer l'embed avec couleurs dynamiques
function createHistoryEmbedWithColors(player, matches, requestedCount, tr) {
    // LES REMAKES SONT AFFICHÉS MAIS NE COMPTENT PAS DANS LES STATS
    const countedMatches = matches.filter(m => !m.is_remake);
    const remakeCount = matches.length - countedMatches.length;

    // CALCUL WINRATE
    const wins = countedMatches.filter(m => m.win).length;
    const winrate = countedMatches.length > 0 ? Math.round((wins / countedMatches.length) * 100) : 0;

    // COULEUR DYNAMIQUE
    let embedColor;
    if (winrate >= 80) embedColor = 0x00ff00;      // 🟢 Vert brillant
    else if (winrate >= 60) embedColor = 0x32cd32;  // 🟢 Vert
    else if (winrate >= 40) embedColor = 0xffa500;  // 🟠 Orange
    else if (winrate >= 20) embedColor = 0xff4500;  // 🔴 Rouge-orange
    else embedColor = 0xff0000;                     // 🔴 Rouge

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(tr("history.title", { riotId: player.riot_id }))
        .setDescription(`${tr("history.lastMatches", { count: matches.length })} ${requestedCount > matches.length ? tr("history.maxAvailable") : ''}`);

    const lines = matches.map(match => {
        const kda = `${match.kills}/${match.deaths}/${match.assists}`;
        const timeAgo = getTimeAgo(match.game_creation, tr);

        if (match.is_remake) {
            return `⚪ **${match.champion_name}** ${kda} \`Remake\` • ${timeAgo}`;
        }

        const winIcon = match.win ? '🟢' : '🔴';
        const kdaRatio = match.deaths > 0 ? ((match.kills + match.assists) / match.deaths).toFixed(1) : '∞';
        const lpChange = match.lp_change > 0 ? `+${match.lp_change}` : `${match.lp_change}`;

        // 🎯 PLUS EXPLICITE POUR LE KDA
        return `${winIcon} **${match.champion_name}** ${kda} \`KDA: ${kdaRatio}\` **${lpChange} LP** • ${timeAgo}`;
    });

    // DÉCOUPAGE EN PLUSIEURS FIELDS (limite Discord : 1024 caractères par field)
    const FIELD_MAX_LENGTH = 1024;
    const chunks = [];
    let current = '';

    for (const line of lines) {
        if (current && current.length + line.length + 1 > FIELD_MAX_LENGTH) {
            chunks.push(current);
            current = '';
        }
        current += (current ? '\n' : '') + line;
    }
    if (current) chunks.push(current);

    chunks.forEach((chunk, i) => {
        embed.addFields({
            name: i === 0 ? tr("history.fieldTitle") : '​',
            value: chunk,
            inline: false
        });
    });

    if (!chunks.length) {
        embed.addFields({ name: tr("history.fieldTitle"), value: tr("history.noMatchesFound"), inline: false });
    }

    // STATS FINALES DANS UN FIELD AU LIEU DU FOOTER
    const totalLp = countedMatches.reduce((sum, m) => sum + (m.lp_change || 0), 0);
    const lpText = totalLp > 0 ? `+${totalLp}` : `${totalLp}`;
    const lpEmoji = totalLp > 0 ? '📈' : totalLp < 0 ? '📉' : '➖';

    const totalKills = countedMatches.reduce((sum, m) => sum + m.kills, 0);
    const totalDeaths = countedMatches.reduce((sum, m) => sum + m.deaths, 0);
    const totalAssists = countedMatches.reduce((sum, m) => sum + m.assists, 0);
    const avgKDA = totalDeaths > 0 ? ((totalKills + totalAssists) / totalDeaths).toFixed(2) : '∞';

    // FIELD POUR LES STATS AVEC ÉMOJIS
    const remakeText = remakeCount > 0 ? `\n${tr("history.remakes", { count: remakeCount })}` : '';
    embed.addFields({
        name: tr("history.statsTitle"),
        value: [
            tr("history.avgKda", { kda: avgKDA }),
            tr("history.totalLp", { emoji: lpEmoji, lp: lpText }),
            tr("history.winrate", { wins, losses: countedMatches.length - wins, winrate }),
        ].join("\n") + remakeText,
        inline: true
    });

    embed.setTimestamp();
    return embed;
}


module.exports = {
    getPlayerMatches,
    createHistoryEmbedWithColors,
    getTimeAgo
};
