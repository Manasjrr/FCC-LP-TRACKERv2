const { EmbedBuilder } = require("discord.js");

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
        .setTitle(`📜 Historique de ${player.riot_id}`)
        .setDescription(`**${matches.length} dernier${matches.length > 1 ? 's' : ''} match${matches.length > 1 ? 's' : ''}** ${requestedCount > matches.length ? '(maximum disponible)' : ''}`);

    const lines = matches.map(match => {
        const kda = `${match.kills}/${match.deaths}/${match.assists}`;
        const timeAgo = getTimeAgo(match.game_creation);

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
            name: i === 0 ? '🎮 Historique des matchs' : '​',
            value: chunk,
            inline: false
        });
    });

    if (!chunks.length) {
        embed.addFields({ name: '🎮 Historique des matchs', value: 'Aucun match trouvé', inline: false });
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
    const remakeText = remakeCount > 0 ? `\n⚪ **Remake${remakeCount > 1 ? 's' : ''}:** ${remakeCount} (non comptabilisé${remakeCount > 1 ? 's' : ''})` : '';
    embed.addFields({
        name: '📊 Statistiques globales',
        value: `⚔️ **KDA moyen:** ${avgKDA}\n${lpEmoji} **LP total:** ${lpText}\n🎯 **Winrate:** ${wins}W-${countedMatches.length - wins}L (${winrate}%)${remakeText}`,
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
