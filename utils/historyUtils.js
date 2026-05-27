// utils/playerUtils.js

function getPlayerById(playerId) {
    return global.db.prepare(`SELECT * FROM players WHERE id = ?`).get(playerId);
}

// Fonction pour récupérer les matchs d'un joueur
function getPlayerMatches(playerId, limit = 20) {
    return global.db.prepare(
        `SELECT * FROM match_history WHERE player_id = ? ORDER BY game_creation DESC LIMIT ?`
    ).all(playerId, limit);
}


// Fonction pour formater le temps
function getTimeAgo(timestamp) {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMinutes < 60) return `il y a ${diffMinutes}min`;
    if (diffHours < 24) return `il y a ${diffHours}h`;
    return `il y a ${diffDays}j`;
}

// Fonction pour créer l'embed avec couleurs dynamiques
function createHistoryEmbedWithColors(player, matches, requestedCount) {
    // CALCUL WINRATE
    const wins = matches.filter(m => m.win).length;
    const winrate = Math.round((wins / matches.length) * 100);

    // COULEUR DYNAMIQUE
    let embedColor;
    if (winrate >= 80) embedColor = 0x00ff00;      // 🟢 Vert brillant
    else if (winrate >= 60) embedColor = 0x32cd32;  // 🟢 Vert
    else if (winrate >= 40) embedColor = 0xffa500;  // 🟠 Orange
    else if (winrate >= 20) embedColor = 0xff4500;  // 🔴 Rouge-orange
    else embedColor = 0xff0000;                     // 🔴 Rouge

    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`📜 Historique de ${player.riot_id}`)
        .setDescription(`**${matches.length} dernier${matches.length > 1 ? 's' : ''} match${matches.length > 1 ? 's' : ''}** ${requestedCount > matches.length ? '(maximum disponible)' : ''}`);

    let historyText = '';

    matches.forEach((match, index) => {
        const winIcon = match.win ? '🟢' : '🔴';
        const kda = `${match.kills}/${match.deaths}/${match.assists}`;
        const kdaRatio = match.deaths > 0 ? ((match.kills + match.assists) / match.deaths).toFixed(1) : '∞';
        const lpChange = match.lp_change > 0 ? `+${match.lp_change}` : `${match.lp_change}`;
        const timeAgo = getTimeAgo(match.game_creation);

        // 🎯 PLUS EXPLICITE POUR LE KDA
        historyText += `${winIcon} **${match.champion_name}** ${kda} \`KDA: ${kdaRatio}\` **${lpChange} LP** • ${timeAgo}\n`;
    });

    embed.addFields({
        name: '🎮 Historique des matchs',
        value: historyText || 'Aucun match trouvé',
        inline: false
    });

    // STATS FINALES DANS UN FIELD AU LIEU DU FOOTER
    const totalLp = matches.reduce((sum, m) => sum + (m.lp_change || 0), 0);
    const lpText = totalLp > 0 ? `+${totalLp}` : `${totalLp}`;
    const lpEmoji = totalLp > 0 ? '📈' : totalLp < 0 ? '📉' : '➖';

    const totalKills = matches.reduce((sum, m) => sum + m.kills, 0);
    const totalDeaths = matches.reduce((sum, m) => sum + m.deaths, 0);
    const totalAssists = matches.reduce((sum, m) => sum + m.assists, 0);
    const avgKDA = totalDeaths > 0 ? ((totalKills + totalAssists) / totalDeaths).toFixed(2) : '∞';

    // FIELD POUR LES STATS AVEC ÉMOJIS
    embed.addFields({
        name: '📊 Statistiques globales',
        value: `⚔️ **KDA moyen:** ${avgKDA}\n${lpEmoji} **LP total:** ${lpText}\n🎯 **Winrate:** ${wins}W-${matches.length - wins}L (${winrate}%)`,
        inline: true
    });

    embed.setTimestamp();
    return embed;
}


module.exports = {
    getPlayerById,
    getPlayerMatches,
    createHistoryEmbedWithColors,
    getTimeAgo
};
