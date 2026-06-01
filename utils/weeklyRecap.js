const { EmbedBuilder } = require('discord.js');
const { getRankEmoji, getRankOrder } = require('./rankUtils');
const logger = require('./loggers');

// ─── Stats hebdomadaires d'un joueur ─────────────────────────────────────────
function getPlayerWeeklyStats(player, weekStart, weekEnd) {
    const iso = [weekStart.toISOString(), weekEnd.toISOString()];

    return global.db.prepare(`
        SELECT 
            COUNT(mh.id)                                          AS total_games,
            SUM(CASE WHEN mh.win = 1 THEN 1 ELSE 0 END)          AS wins,
            SUM(CASE WHEN mh.win = 0 THEN 1 ELSE 0 END)          AS losses,
            AVG(CAST(mh.kills   AS REAL))                         AS avg_kills,
            AVG(CAST(mh.deaths  AS REAL))                         AS avg_deaths,
            AVG(CAST(mh.assists AS REAL))                         AS avg_assists,
            (SELECT rank_before FROM match_history
             WHERE player_id = ? AND datetime(game_creation/1000,'unixepoch') BETWEEN datetime(?) AND datetime(?)
             ORDER BY game_creation ASC  LIMIT 1)                 AS week_start_rank,
            (SELECT lp_before   FROM match_history
             WHERE player_id = ? AND datetime(game_creation/1000,'unixepoch') BETWEEN datetime(?) AND datetime(?)
             ORDER BY game_creation ASC  LIMIT 1)                 AS week_start_lp,
            (SELECT rank_after  FROM match_history
             WHERE player_id = ? AND datetime(game_creation/1000,'unixepoch') BETWEEN datetime(?) AND datetime(?)
             ORDER BY game_creation DESC LIMIT 1)                 AS week_end_rank,
            (SELECT lp_after    FROM match_history
             WHERE player_id = ? AND datetime(game_creation/1000,'unixepoch') BETWEEN datetime(?) AND datetime(?)
             ORDER BY game_creation DESC LIMIT 1)                 AS week_end_lp
        FROM match_history mh
        WHERE mh.player_id = ?
          AND datetime(mh.game_creation/1000,'unixepoch') BETWEEN datetime(?) AND datetime(?)
    `).get(
        player.id, ...iso,   // week_start_rank
        player.id, ...iso,   // week_start_lp
        player.id, ...iso,   // week_end_rank
        player.id, ...iso,   // week_end_lp
        player.id, ...iso    // WHERE principal
    );
}

// ─── Champion le plus joué ────────────────────────────────────────────────────
function getPlayerTopChampion(player, weekStart, weekEnd) {
    const row = global.db.prepare(`
        SELECT
            champion_name,
            COUNT(*)                                         AS games_count,
            SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END)        AS wins_count
        FROM match_history
        WHERE player_id = ?
          AND datetime(game_creation/1000,'unixepoch') BETWEEN datetime(?) AND datetime(?)
        GROUP BY champion_name
        ORDER BY games_count DESC
        LIMIT 1
    `).get(player.id, weekStart.toISOString(), weekEnd.toISOString());

    if (!row) return { champion_name: 'Aucun', games_count: 0, wins_count: 0, winrate: 0 };

    return {
        champion_name: row.champion_name,
        games_count: row.games_count,
        wins_count: row.wins_count,
        winrate: row.games_count > 0
            ? ((row.wins_count / row.games_count) * 100).toFixed(1)
            : 0,
    };
}

// ─── Calcul LP nets ───────────────────────────────────────────────────────────
function calculateNetLP(startRank, startLP, endRank, endLP) {
    if (!startRank || !endRank || startLP === null || endLP === null) return null;

    const startData = getRankOrder(startRank, startLP);
    const endData = getRankOrder(endRank, endLP);
    return endData.totalScore - startData.totalScore;
}

// ─── Génération récap d'un serveur ────────────────────────────────────────────
async function generateRecapForGuild(guildId, weekStart, weekEnd) {
    const players = global.db.prepare(`SELECT * FROM players WHERE guild_id = ?`).all(guildId);

    if (!players?.length) {
        logger.info('RECAP', `Pas de joueurs sur le serveur ${guildId}`);
        return null;
    }

    const playerStats = [];

    for (const player of players) {
        try {
            const weekStats = getPlayerWeeklyStats(player, weekStart, weekEnd);

            if (!weekStats || weekStats.total_games < 3) continue;

            const topChampion = getPlayerTopChampion(player, weekStart, weekEnd);
            const netLP = calculateNetLP(
                weekStats.week_start_rank, weekStats.week_start_lp,
                weekStats.week_end_rank, weekStats.week_end_lp
            );

            playerStats.push({
                riot_id: player.riot_id,
                user_id: player.user_id,
                total_games: weekStats.total_games,
                wins: weekStats.wins,
                losses: weekStats.losses,
                total_lp_change: netLP ?? weekStats.total_lp_change ?? 0,
                avg_kills: weekStats.avg_kills || 0,
                avg_deaths: weekStats.avg_deaths || 0,
                avg_assists: weekStats.avg_assists || 0,
                winrate: ((weekStats.wins / weekStats.total_games) * 100).toFixed(1),
                most_played_champion: topChampion.champion_name,
                champion_games: topChampion.games_count,
                champion_winrate: topChampion.winrate,
                week_start_rank: weekStats.week_start_rank,
                week_start_lp: weekStats.week_start_lp,
                week_end_rank: weekStats.week_end_rank,
                week_end_lp: weekStats.week_end_lp,
                current_rank: player.last_rank,
            });
        } catch (error) {
            logger.error('RECAP', `Erreur stats pour ${player.riot_id}`, { error: error.message });
        }
    }

    playerStats.sort((a, b) => b.total_lp_change - a.total_lp_change);

    if (!playerStats.length) {
        logger.info('RECAP', `Pas de données suffisantes pour le serveur ${guildId}`);
        return null;
    }

    return playerStats;
}

// ─── Construction de l'embed ──────────────────────────────────────────────────
function createWeeklyRecapEmbed(playerStats, weekStart, weekEnd) {
    const startStr = weekStart.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    const endStr = weekEnd.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

    let description = `📅 **Semaine du ${startStr} au ${endStr}**\n\n`;
    description += `📈 **LES JOUEURS DE LA SEMAINE :**\n\n`;

    playerStats.forEach((player, index) => {
        let medal;
        if (index === 0) medal = '🥇';
        else if (index === 1) medal = '🥈';
        else if (index === 2) medal = '🥉';
        else if (player.total_lp_change >= 75) medal = '🔥';
        else if (player.total_lp_change > 0) medal = '✨';
        else if (player.total_lp_change > -75) medal = '💀';
        else medal = '<:etoilesHLE:1431326676629061854>';

        const lpSign = player.total_lp_change >= 0 ? '+' : '';
        const lpEmoji = player.total_lp_change >= 0 ? '📈' : '📉';

        let rankDisplay;
        if (player.week_start_rank && player.week_end_rank
            && player.week_start_lp !== null && player.week_end_lp !== null) {
            if (player.week_start_rank === player.week_end_rank) {
                rankDisplay = `${getRankEmoji(player.week_end_rank)} ${player.week_end_rank} (${player.week_start_lp} LP → ${player.week_end_lp} LP)`;
            } else {
                rankDisplay = `${getRankEmoji(player.week_start_rank)} ${player.week_start_rank} ${player.week_start_lp} LP → ${getRankEmoji(player.week_end_rank)} ${player.week_end_rank} ${player.week_end_lp} LP`;
            }
        } else {
            rankDisplay = `${getRankEmoji(player.current_rank)} ${player.current_rank}`;
        }

        description += `${medal} **${player.riot_id}**\n`;
        description += `├─ 🎮 **${player.total_games} games** (${player.wins}W • ${player.losses}L - ${player.winrate}% WR)\n`;
        description += `├─ ${lpEmoji} **${lpSign}${player.total_lp_change} LP** • ${rankDisplay}\n`;
        description += `├─ 🦹 **Champion favori :** ${player.most_played_champion} (${player.champion_games} games - ${player.champion_winrate}% WR)\n`;
        description += `└─ ⚔️ **KDA moyen :** ${Number(player.avg_kills).toFixed(1)}/${Number(player.avg_deaths).toFixed(1)}/${Number(player.avg_assists).toFixed(1)}\n\n`;
    });

    const totalGames = playerStats.reduce((s, p) => s + p.total_games, 0);
    const totalWins = playerStats.reduce((s, p) => s + p.wins, 0);
    const totalLP = playerStats.reduce((s, p) => s + p.total_lp_change, 0);
    const groupWR = totalGames > 0 ? ((totalWins / totalGames) * 100).toFixed(1) : '0.0';

    description += `📊 **STATS GLOBALES**\n`;
    description += `• Total games : ${totalGames} • Groupe WR : ${groupWR}%\n`;
    description += `• LP net du groupe : ${totalLP >= 0 ? '+' : ''}${totalLP} LP`;

    return new EmbedBuilder()
        .setTitle('🏆 RÉCAP HEBDOMADAIRE')
        .setDescription(description)
        .setColor(totalLP >= 0 ? 0x00ff88 : 0xff4444)
        .setFooter({ text: `Récap généré le ${new Date().toLocaleDateString('fr-FR')}` });
}

// ─── Envoi dans tous les serveurs ─────────────────────────────────────────────
async function sendWeeklyRecap(client) {
    logger.info('RECAP', 'Génération du récap hebdomadaire...');

    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setDate(now.getDate() - 1);
    weekEnd.setHours(23, 59, 59, 999);

    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekEnd.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    logger.info('RECAP', `Période analysée : ${weekStart.toLocaleDateString('fr-FR')} → ${weekEnd.toLocaleDateString('fr-FR')}`);

    const guilds = global.db.prepare(`SELECT DISTINCT guild_id FROM players`).all();

    if (!guilds?.length) {
        logger.warn('RECAP', 'Aucun serveur trouvé');
        return;
    }

    logger.info('RECAP', `Traitement de ${guilds.length} serveur(s)`);

    for (const { guild_id } of guilds) {
        try {
            const playerStats = await generateRecapForGuild(guild_id, weekStart, weekEnd);
            if (!playerStats) {
                logger.info('RECAP', `Pas de récap pour ${guild_id}`);
                continue;
            }

            const embed = createWeeklyRecapEmbed(playerStats, weekStart, weekEnd);
            const discordGuild = client.guilds.cache.get(guild_id);

            if (!discordGuild) {
                logger.warn('RECAP', `Serveur Discord introuvable : ${guild_id}`);
                continue;
            }

            // Cherche le canal le plus utilisé pour le monitoring
            const channelUsage = global.db.prepare(`
                SELECT channel_id, COUNT(*) AS usage_count
                FROM players
                WHERE guild_id = ? AND channel_id IS NOT NULL
                GROUP BY channel_id
                ORDER BY usage_count DESC
            `).all(guild_id);

            let targetChannel = null;

            for (const { channel_id } of channelUsage) {
                const ch = discordGuild.channels.cache.get(channel_id);
                if (ch?.permissionsFor(discordGuild.members.me).has(['SendMessages', 'EmbedLinks'])) {
                    targetChannel = ch;
                    break;
                }
            }

            // Fallbacks si aucun canal de monitoring trouvé
            if (!targetChannel) {
                const fallbackNames = ['lol', 'league', 'league-of-legends', 'gaming', 'general', 'général', 'main'];
                targetChannel = discordGuild.channels.cache.find(ch =>
                    ch.type === 0
                    && fallbackNames.includes(ch.name.toLowerCase())
                    && ch.permissionsFor(discordGuild.members.me).has(['SendMessages', 'EmbedLinks'])
                ) ?? discordGuild.channels.cache.find(ch =>
                    ch.type === 0
                    && ch.permissionsFor(discordGuild.members.me).has(['SendMessages', 'EmbedLinks'])
                ) ?? null;
            }

            if (targetChannel) {
                await targetChannel.send({ embeds: [embed] });
                logger.success('RECAP', `Récap envoyé sur ${discordGuild.name} (#${targetChannel.name})`);
            } else {
                logger.warn('RECAP', `Pas de canal disponible sur ${discordGuild.name}`);
            }

        } catch (error) {
            logger.error('RECAP', `Erreur récap pour ${guild_id}`, { error: error.message });
        }
    }
}

module.exports = { sendWeeklyRecap };
