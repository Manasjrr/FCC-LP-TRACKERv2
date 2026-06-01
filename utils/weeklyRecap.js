const { EmbedBuilder } = require('discord.js');
const { getRankEmoji } = require('./rankUtils');

// Récupérer les stats d'un joueur pour la semaine (mon code est dégéu gg)
function getPlayerWeeklyStats(player, weekStart, weekEnd) {
    const query = `
        SELECT 
            COUNT(mh.id) as total_games,
            SUM(CASE WHEN mh.win = 1 THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN mh.win = 0 THEN 1 ELSE 0 END) as losses,
            SUM(mh.lp_after - mh.lp_before) as total_lp_change,
            AVG(CAST(mh.kills as REAL)) as avg_kills,
            AVG(CAST(mh.deaths as REAL)) as avg_deaths,
            AVG(CAST(mh.assists as REAL)) as avg_assists,
            (SELECT rank_before FROM match_history WHERE player_id = ? AND datetime(game_creation/1000, 'unixepoch') BETWEEN datetime(?) AND datetime(?) ORDER BY game_creation ASC LIMIT 1) as week_start_rank,
            (SELECT lp_before FROM match_history WHERE player_id = ? AND datetime(game_creation/1000, 'unixepoch') BETWEEN datetime(?) AND datetime(?) ORDER BY game_creation ASC LIMIT 1) as week_start_lp,
            (SELECT rank_after FROM match_history WHERE player_id = ? AND datetime(game_creation/1000, 'unixepoch') BETWEEN datetime(?) AND datetime(?) ORDER BY game_creation DESC LIMIT 1) as week_end_rank,
            (SELECT lp_after FROM match_history WHERE player_id = ? AND datetime(game_creation/1000, 'unixepoch') BETWEEN datetime(?) AND datetime(?) ORDER BY game_creation DESC LIMIT 1) as week_end_lp
        FROM match_history mh
        WHERE mh.player_id = ?
        AND datetime(mh.game_creation/1000, 'unixepoch') BETWEEN datetime(?) AND datetime(?)
    `;

    return global.db.prepare(query).get(
        player.id, weekStart.toISOString(), weekEnd.toISOString(),
        player.id, weekStart.toISOString(), weekEnd.toISOString(),
        player.id, weekStart.toISOString(), weekEnd.toISOString(),
        player.id, weekStart.toISOString(), weekEnd.toISOString(),
        player.id, weekStart.toISOString(), weekEnd.toISOString()
    );
}

// Récupérer le champion le plus joué de la semaine + son winrate
function getPlayerTopChampion(player, weekStart, weekEnd) {
    const query = `
        SELECT 
            champion_name, 
            COUNT(*) as games_count,
            SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) as wins_count
        FROM match_history mh
        WHERE mh.player_id = ? 
        AND datetime(mh.game_creation/1000, 'unixepoch') BETWEEN datetime(?) AND datetime(?)
        GROUP BY champion_name
        ORDER BY games_count DESC
        LIMIT 1
    `;

    const row = global.db.prepare(query).get(player.id, weekStart.toISOString(), weekEnd.toISOString());

    if (!row) {
        return { champion_name: 'Aucun', games_count: 0, wins_count: 0, winrate: 0 };
    }

    return {
        champion_name: row.champion_name,
        games_count: row.games_count,
        wins_count: row.wins_count,
        winrate: row.games_count > 0 ? ((row.wins_count / row.games_count) * 100).toFixed(1) : 0
    };
}

// 🔄 FONCTION HELPER POUR CALCULER LES LP NETS
function calculateNetLP(startRank, startLP, endRank, endLP) {
    const { getRankOrder } = require('./rankUtils');

    if (!startRank || !endRank || startLP === null || endLP === null) {
        return null;
    }

    const startRankData = getRankOrder(startRank, startLP);
    const endRankData = getRankOrder(endRank, endLP);

    return endRankData.totalScore - startRankData.totalScore;
}

// Générer le récap pour un serveur
async function generateRecapForGuild(guildId, weekStart, weekEnd) {
    const players = global.db.prepare(`SELECT * FROM players WHERE guild_id = ?`).all(guildId);

    if (!players || players.length === 0) {
        console.log(`📊 Pas de joueurs sur le serveur ${guildId}`);
        return null;
    }

    const playerStats = [];

    for (const player of players) {
        try {
            const weekStats = await getPlayerWeeklyStats(player, weekStart, weekEnd);

            if (weekStats.total_games < 3) continue;

            const topChampion = await getPlayerTopChampion(player, weekStart, weekEnd);

            const netLP = calculateNetLP(
                weekStats.week_start_rank,
                weekStats.week_start_lp,
                weekStats.week_end_rank,
                weekStats.week_end_lp
            );

            playerStats.push({
                riot_id: player.riot_id,
                user_id: player.user_id,
                total_games: weekStats.total_games,
                wins: weekStats.wins,
                losses: weekStats.losses,
                total_lp_change: netLP || weekStats.total_lp_change || 0,
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
                current_rank: player.last_rank
            });
        } catch (error) {
            console.error(`❌ Erreur stats pour ${player.riot_id}:`, error);
        }
    }

    playerStats.sort((a, b) => b.total_lp_change - a.total_lp_change);

    if (playerStats.length === 0) {
        console.log(`📊 Pas de données suffisantes pour le serveur ${guildId}`);
        return null;
    }

    return playerStats;
}

// Créer l'embed du récap (MISE À JOUR AVEC LP DÉTAILLÉS)
async function createWeeklyRecapEmbed(playerStats, weekStart, weekEnd) {
    const startStr = weekStart.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    const endStr = weekEnd.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

    let description = `📅 **Semaine du ${startStr} au ${endStr}**\n\n`;
    description += `📈 **LES JOUEURS DE LA SEMAINE : **\n\n`;

    const medals = ['🥇', '🥈', '🥉'];

    playerStats.forEach((player, index) => {
        let medal = '';

        // 🏆 Top 3 : Médailles du podium (priorité absolue)
        if (index === 0) {
            medal = '🥇';
        } else if (index === 1) {
            medal = '🥈';
        } else if (index === 2) {
            medal = '🥉';
        }
        // 🎯 Hors podium : selon performance LP
        else {
            if (player.total_lp_change >= 50) {
                medal = '🔥'; // Semaine de feu (gros gains)
            }
            else if (player.total_lp_change > 0) {
                medal = '✨'; // Semaine correcte (petits gains)
            }
            else if (player.total_lp_change > -50) {
                medal = '💀'; // Légère baisse
            }
            else {
                medal = '<:etoilesHLE:1431326676629061854> '; // Semaine catastrophique (grosses pertes) viva israeli
            }
        }

        const lpSign = player.total_lp_change >= 0 ? '+' : '';
        const lpEmoji = player.total_lp_change >= 0 ? '📈' : '📉';

        // 🎯 AFFICHAGE DU CHANGEMENT DE RANG AVEC LP DÉTAILLÉS
        let rankDisplay = '';
        if (player.week_start_rank && player.week_end_rank &&
            player.week_start_lp !== null && player.week_end_lp !== null) {

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
        description += `├─ 🦹 **Champion favori**: ${player.most_played_champion} (${player.champion_games} games - ${player.champion_winrate}% WR)\n`;
        description += `└─ ⚔️ **KDA moyen**: ${player.avg_kills.toFixed(1)}/${player.avg_deaths.toFixed(1)}/${player.avg_assists.toFixed(1)}\n\n`;
    });


    const totalGames = playerStats.reduce((sum, p) => sum + p.total_games, 0);
    const totalWins = playerStats.reduce((sum, p) => sum + p.wins, 0);
    const totalLP = playerStats.reduce((sum, p) => sum + p.total_lp_change, 0);
    const groupWR = ((totalWins / totalGames) * 100).toFixed(1);

    description += `📊 **STATS GLOBALES**\n`;
    description += `• Total games: ${totalGames} • Groupe WR: ${groupWR}%\n`;
    description += `• LP net du groupe: ${totalLP >= 0 ? '+' : ''}${totalLP} LP`;

    return new EmbedBuilder()
        .setTitle('🏆 RÉCAP HEBDOMADAIRE')
        .setDescription(description)
        .setColor(totalLP >= 0 ? 0x00ff88 : 0xff4444)
        .setFooter({ text: `Récap généré le ${new Date().toLocaleDateString('fr-FR')}` });
}


// Envoyer le récap dans tous les serveurs
async function sendWeeklyRecap(client) {
    console.log("📊 Génération du récap hebdomadaire...");

    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setDate(now.getDate() - 1);
    weekEnd.setHours(23, 59, 59, 999);

    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekEnd.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    console.log(`📅 Période analysée: ${weekStart.toLocaleDateString('fr-FR')} → ${weekEnd.toLocaleDateString('fr-FR')}`);

    const guilds = global.db.prepare(`SELECT DISTINCT guild_id FROM players`).all();

    if (!guilds || guilds.length === 0) {
        console.error("❌ Erreur récupération serveurs");
        return;
    }

    console.log(`🎯 Traitement de ${guilds.length} serveur(s)`);

    for (const guild of guilds) {
        try {
            const playerStats = await generateRecapForGuild(guild.guild_id, weekStart, weekEnd);

            if (!playerStats) {
                console.log(`⏭️ Pas de récap pour ${guild.guild_id}`);
                continue;
            }

            const embed = await createWeeklyRecapEmbed(playerStats, weekStart, weekEnd);

            const discordGuild = client.guilds.cache.get(guild.guild_id);
            if (!discordGuild) {
                console.log(`Serveur Discord introuvable pour ${guild.guild_id}`);
                continue;
            }

            console.log(` DEBUG serveur ${discordGuild.name} (${guild.guild_id})`);

            const channelUsage = global.db.prepare(`
                SELECT channel_id, COUNT(*) as usage_count 
                FROM players 
                WHERE guild_id = ? AND channel_id IS NOT NULL 
                GROUP BY channel_id 
                ORDER BY usage_count DESC
            `).all(guild.guild_id);

            const allPlayers = global.db.prepare(
                `SELECT riot_id, channel_id FROM players WHERE guild_id = ?`
            ).all(guild.guild_id);

            console.log(`👥 Joueurs sur ${discordGuild.name}:`, allPlayers.map(p => `${p.riot_id} -> ${p.channel_id}`));
            console.log(`🔍 Canaux trouvés pour ${discordGuild.name}:`, channelUsage);

            let targetChannel = null;

            if (channelUsage.length > 0) {
                for (const channelData of channelUsage) {
                    const channel = discordGuild.channels.cache.get(channelData.channel_id);

                    if (channel && channel.permissionsFor(discordGuild.members.me).has(['SendMessages', 'EmbedLinks'])) {
                        targetChannel = channel;
                        console.log(`✅ Canal de monitoring trouvé: #${channel.name} (${channelData.usage_count} joueur(s))`);
                        break;
                    } else {
                        console.log(`⚠️ Canal ${channelData.channel_id} introuvable ou pas de permissions`);
                    }
                }
            }

            if (!targetChannel) {
                console.log(`⚠️ Canal de monitoring introuvable pour ${discordGuild.name}, recherche d'un canal alternatif...`);

                targetChannel = discordGuild.channels.cache.find(ch =>
                    ch.type === 0 &&
                    ['lol', 'league', 'league-of-legends', 'gaming'].includes(ch.name.toLowerCase()) &&
                    ch.permissionsFor(discordGuild.members.me).has(['SendMessages', 'EmbedLinks'])
                );

                if (!targetChannel) {
                    targetChannel = discordGuild.channels.cache.find(ch =>
                        ch.type === 0 &&
                        ['general', 'général', 'main'].includes(ch.name.toLowerCase()) &&
                        ch.permissionsFor(discordGuild.members.me).has(['SendMessages', 'EmbedLinks'])
                    );
                }

                if (!targetChannel) {
                    targetChannel = discordGuild.channels.cache.find(ch =>
                        ch.type === 0 &&
                        ch.permissionsFor(discordGuild.members.me).has(['SendMessages', 'EmbedLinks'])
                    );
                }
            }

            if (targetChannel) {
                await targetChannel.send({ embeds: [embed] });
                console.log(`✅ Récap envoyé sur ${discordGuild.name} (#${targetChannel.name})`);
            } else {
                console.log(`❌ Pas de canal disponible sur ${discordGuild.name}`);
            }

        } catch (error) {
            console.error(`❌ Erreur récap pour ${guild.guild_id}:`, error);
        }
    }
}


module.exports = {
    sendWeeklyRecap
};
