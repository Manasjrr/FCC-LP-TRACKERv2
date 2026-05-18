const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { getRankEmoji, getRankOrder } = require('../utils/rankUtils');

const axios = require("axios");

// Cache optimisé avec TTL différenciés
const statsCache = new Map();
const CACHE_DURATION = 10 * 60 * 1000; // 3 minutes pour les stats
const MATCH_CACHE_DURATION = 20 * 60 * 1000; // 10 minutes pour l'historique

module.exports = {
    data: new SlashCommandBuilder()
        .setName("stats")
        .setDescription("Statistiques détaillées d'un joueur avec analyse de performance")
        .addIntegerOption((option) =>
            option
                .setName("rang")
                .setDescription("Position du joueur dans le classement serveur")
                .setRequired(false)
                .setMinValue(1)
        ),

    async execute(interaction) {
        // ⚡ DEFER ULTRA RAPIDE
        try {
            await interaction.deferReply();
        } catch (error) {
            console.log("⚠️ Interaction expirée, on continue...");
            return; // Arrêter si l'interaction est expirée
        }

        if (!global.db) {
            return interaction.editReply("❌ Base de données indisponible").catch(() => { });
        }

        let targetPlayer = null;

        // 🎯 RÉCUPÉRATION DU JOUEUR CIBLE
        if (interaction.options.getInteger("rang")) {
            targetPlayer = await getPlayerByRank(interaction.options.getInteger("rang"), interaction.guildId);  // ← Ajoute guildId
            if (!targetPlayer) {
                return interaction.editReply(`❌ Aucun joueur trouvé à cette position`);
            }

        } else {
            targetPlayer = await getLinkedPlayer(interaction.user.id, interaction.guildId);  // ← Ajoute guildId
            if (!targetPlayer) {
                return interaction.editReply("❌ Aucun compte lié ! Utilise `/link` ou spécifie un rang.");
            }
        }


        try {
            // 🚀 RÉCUPÉRATION OPTIMISÉE DES DONNÉES
            const [playerStats, matchAnalysis, serverPosition] = await Promise.all([
                getPlayerCurrentStats(targetPlayer),
                getMatchAnalysis(targetPlayer),
                getServerPosition(targetPlayer.riot_id, targetPlayer.guild_id) // ← Corrigé !
            ]);

            // 🎨 CRÉATION DE L'EMBED PRINCIPAL
            const embed = await createAdvancedStatsEmbed(
                targetPlayer,
                playerStats,
                matchAnalysis,
                serverPosition,
                interaction
            );

            // 🎛️ BOUTONS INTERACTIFS
            const actionRow = createInteractiveButtons(targetPlayer);

            await interaction.editReply({
                embeds: [embed],
                components: [actionRow]
            });

        } catch (error) {
            console.error("❌ Erreur stats avancées:", error.message);

            // 🔄 FALLBACK AVEC DONNÉES LOCALES
            const fallbackEmbed = createLocalStatsEmbed(targetPlayer);
            await interaction.editReply({ embeds: [fallbackEmbed] });
        }

    }
};

// 📊 RÉCUPÉRATION DU JOUEUR PAR RANG - MÊME TRI QUE LIST.JS
function getPlayerByRank(position, guildId) {
    const rows = global.db.prepare(`SELECT * FROM players WHERE guild_id = ?`).all(guildId);

    if (!rows || rows.length === 0) return null;

    rows.sort((a, b) => {
        const rankA = getRankOrder(a.last_rank, a.last_lp);
        const rankB = getRankOrder(b.last_rank, b.last_lp);

        if (rankB.order !== rankA.order) return rankB.order - rankA.order;
        if (rankB.divisionOrder !== rankA.divisionOrder) return rankB.divisionOrder - rankA.divisionOrder;
        return (rankB.lp || 0) - (rankA.lp || 0);
    });

    return rows[position - 1] || null;
}

// 🔗 RÉCUPÉRATION DU JOUEUR LIÉ
function getLinkedPlayer(userId, guildId) {
    return global.db.prepare(`
        SELECT p.* FROM players p 
        JOIN user_links ul ON p.id = ul.player_id 
        WHERE ul.user_id = ? AND ul.guild_id = ?
    `).get(userId, guildId);
}



// 🎯 STATS ACTUELLES DU JOUEUR - VERSION CORRECTE
async function getPlayerCurrentStats(player) {
    const cacheKey = `current_${player.puuid}`;
    const cached = statsCache.get(cacheKey);

    // ✅ Vérification du cache
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
        return cached.data;
    }

    try {
        const RIOT_API_KEY = process.env.RIOT_API_KEY;

        // 1️⃣ Récupérer les données summoner avec timeout
        const summonerResponse = await axios.get(
            `https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${player.puuid}`,
            {
                headers: { "X-Riot-Token": RIOT_API_KEY },
                //timeout: 5000
            }

        );

        // 🔧 FIX pour le nom
        const displayName = summonerResponse.data.gameName
            ? `${summonerResponse.data.gameName}#${summonerResponse.data.tagLine}`
            : (summonerResponse.data.name || player.riot_id || "Joueur Inconnu");

        // ✅ CORRIGE CETTE LIGNE pour utiliser displayName
        console.log(`✅ Summoner OK: ${displayName} (Level ${summonerResponse.data.summonerLevel})`);


        // 2️⃣ Récupérer les données ranked avec l'ID obtenu
        const rankedResponse = await axios.get(
            `https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${player.puuid}`,
            {
                headers: { "X-Riot-Token": RIOT_API_KEY },
                //timeout: 5000
            }
        );

        console.log(`📊 Ranked data reçue:`, rankedResponse.data?.length || 0, 'queues');

        const soloQData = rankedResponse.data.find(entry => entry.queueType === "RANKED_SOLO_5x5");

        // 📊 Calcul sécurisé du winrate
        const totalGames = soloQData ? (soloQData.wins + soloQData.losses) : 0;
        const winrate = totalGames > 0 ? Math.round((soloQData.wins / totalGames) * 100) : 0;

        const result = {
            summoner: {
                ...summonerResponse.data,
                displayName
            },
            ranked: soloQData || null,
            currentRank: soloQData ? `${soloQData.tier} ${soloQData.rank}` : "UNRANKED",
            currentLP: soloQData?.leaguePoints || 0,
            wins: soloQData?.wins || 0,
            losses: soloQData?.losses || 0,
            winrate,
            isLocal: false
        };

        // ✅ Mise en cache avec TTL standard
        statsCache.set(cacheKey, {
            data: result,
            timestamp: Date.now()
        });

        return result;

    } catch (error) {
        console.error(`❌ Erreur API Stats pour ${player.riot_id}:`, error.message);

        // 🛡️ Fallback avec données locales ou BDD
        const fallbackData = {
            summoner: null,
            ranked: null,
            currentRank: player.last_rank || "UNRANKED",
            currentLP: player.last_lp || 0,
            wins: 0,
            losses: 0,
            winrate: 0,
            isLocal: true,
            error: error.message
        };

        // Cache les erreurs avec un TTL réduit (1 minute)
        statsCache.set(cacheKey, {
            data: fallbackData,
            timestamp: Date.now() - (CACHE_DURATION - 60000)
        });

        return fallbackData;
    }
}


// 📊 ANALYSE DES MATCHS RÉCENTS (MODIFIÉE)
async function getMatchAnalysis(player) {
    const cacheKey = `analysis_${player.id}`;
    const cached = statsCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }

    try {
        console.log(`🐞 DEBUG - Recherche matchs pour player_id: ${player.id}`);

        const matchStats = global.db.prepare(`
            SELECT 
                COUNT(*) as total_games,
                SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) as wins,
                AVG(kills) as avg_kills,
                AVG(deaths) as avg_deaths,
                AVG(assists) as avg_assists,
                SUM(lp_change) as total_lp_change
            FROM match_history 
            WHERE player_id = ? 
            ORDER BY game_creation DESC 
            LIMIT 50
        `).get(player.id) || {};

        const analysis = {
            totalGames: matchStats.total_games || 0,
            wins: matchStats.wins || 0,
            losses: (matchStats.total_games || 0) - (matchStats.wins || 0),
            winrate: matchStats.total_games > 0 ? Math.round((matchStats.wins / matchStats.total_games) * 100) : 0,
            avgKDA: matchStats.avg_deaths > 0 ?
                ((matchStats.avg_kills + matchStats.avg_assists) / matchStats.avg_deaths).toFixed(1) :
                'Perfect',
            avgKills: Math.round(matchStats.avg_kills || 0),
            avgDeaths: Math.round(matchStats.avg_deaths || 0),
            avgAssists: Math.round(matchStats.avg_assists || 0),
            lpChange: Math.round(matchStats.total_lp_change || 0),
            currentStreak: 0,
            streakType: 'none',
            performanceLevel: getPerformanceLevel({
                recentWinrate: matchStats.total_games > 0 ? Math.round((matchStats.wins || 0) / matchStats.total_games * 100) : 0,
                globalWinrate: matchStats.total_games > 0 ? Math.round((matchStats.wins || 0) / matchStats.total_games * 100) : 0,
                avgKDA: matchStats.avg_deaths > 0 ? (matchStats.avg_kills + matchStats.avg_assists) / matchStats.avg_deaths : 0,
                currentStreak: 0,
                streakType: 'none',
                lpTrend: matchStats.total_lp_change || 0,
                totalGames: matchStats.total_games || 0
            })
        };

        statsCache.set(cacheKey, {
            data: analysis,
            timestamp: Date.now()
        });

        return analysis;

    } catch (error) {
        console.error("❌ Erreur analyse matchs:", error.message);
        return getDefaultAnalysis();
    }
}


// 🎯 SYSTÈME DE PERFORMANCE AVEC DEBUG
function getPerformanceLevel(stats) {
    console.log("🐞 DEBUG getPerformanceLevel - Stats reçues:", stats);

    const {
        recentWinrate = 0,
        globalWinrate = 0,
        avgKDA = 0,
        currentStreak = 0,
        streakType = 'none',
        lpTrend = 0,
        totalGames = 0
    } = stats;

    let score = 0;
    let bonusPoints = 0;
    let penalties = 0;

    // 📊 WINRATE RÉCENT (40% du score)
    if (recentWinrate >= 80) score += 3;
    else if (recentWinrate >= 70) score += 2.5;
    else if (recentWinrate >= 60) score += 2;
    else if (recentWinrate >= 50) score += 1;
    else if (recentWinrate >= 40) score -= 1;
    else score += 0;

    console.log(`🐞 DEBUG - Winrate ${recentWinrate}% = +${score > 0 ? score : 0} points`);

    // 📈 WINRATE GLOBAL (25% du score)
    let globalScore = 0;
    if (globalWinrate >= 65) globalScore = 3;
    else if (globalWinrate >= 55) globalScore = 2;
    else if (globalWinrate >= 50) globalScore = 1.5;
    else if (globalWinrate >= 45) globalScore = 1;
    else globalScore = -2;

    score += globalScore;
    console.log(`🐞 DEBUG - Global winrate ${globalWinrate}% = +${globalScore} points`);

    // ⚔️ KDA MOYEN (25% du score)
    let kdaScore = 0;
    if (avgKDA >= 3.5) kdaScore = 2.5;
    else if (avgKDA >= 2.5) kdaScore = 2;
    else if (avgKDA >= 2.0) kdaScore = 1;
    else if (avgKDA >= 1.5) kdaScore = 0;
    else if (avgKDA >= 1.0) kdaScore = -2;
    else kdaScore = 0;

    score += kdaScore;
    console.log(`🐞 DEBUG - KDA ${avgKDA} = +${kdaScore} points`);

    // 🔥 BONUS/MALUS
    if (streakType === 'win') {
        if (currentStreak >= 7) bonusPoints += 1;
        else if (currentStreak >= 5) bonusPoints += 0.5;
        else if (currentStreak >= 3) bonusPoints += 0.25;
    }

    if (streakType === 'loss') {
        if (currentStreak >= 5) penalties += 5;
        else if (currentStreak >= 3) penalties += 1;
    }

    if (lpTrend > 50) bonusPoints += 0.5;
    else if (lpTrend < -50) penalties += 0.5;

    if (totalGames >= 50) bonusPoints += 0.25;
    else if (totalGames < 10) penalties += 0.25;

    const finalScore = Math.max(0, score + bonusPoints - penalties);

    console.log(`🐞 DEBUG - Score: ${score} + Bonus: ${bonusPoints} - Pénalités: ${penalties} = ${finalScore}`);

    // 🏆 DÉTERMINATION DU NIVEAU
    let result;
    if (finalScore >= 8.5) {
        result = { level: "🌟 GOAT", color: 0xF0E68C, description: "Performance légendaire !" };
    } else if (finalScore >= 7.0) {
        result = { level: "🔥 SEMI-GOAT", color: 0x8500FF, description: "Dominance totale" };
    } else if (finalScore >= 5.5) {
        result = { level: "⭐ EXCELLENT", color: 0x00FF00, description: "Très forte performance" };
    } else if (finalScore >= 4.0) {
        result = { level: "✅ SOLIDE", color: 0x00BFFF, description: "Performance constante" };
    } else if (finalScore >= 2.5) {
        result = { level: "⚡ MOYEN", color: 0xFFD700, description: "Peut mieux faire" };
    } else {
        result = { level: "❄️ RAZMO TIER", color: 0xFF6B6B, description: "Période difficile" };
    }

    console.log(`🐞 DEBUG - Niveau final: ${result.level} (Score: ${finalScore})`);
    return result;
}


function getServerPosition(targetRiotId, guildId) {
    const rows = global.db.prepare(`SELECT * FROM players WHERE guild_id = ?`).all(guildId);

    if (!rows || rows.length === 0) {
        return { position: 0, total: 0, percentile: 0 };
    }

    rows.sort((a, b) => {
        const rankA = getRankOrder(a.last_rank, a.last_lp);
        const rankB = getRankOrder(b.last_rank, b.last_lp);

        if (rankB.order !== rankA.order) return rankB.order - rankA.order;
        if (rankB.divisionOrder !== rankA.divisionOrder) return rankB.divisionOrder - rankA.divisionOrder;
        return (rankB.lp || 0) - (rankA.lp || 0);
    });

    const position = rows.findIndex(player => player.riot_id === targetRiotId) + 1;
    const total = rows.length;
    const percentile = Math.round((position / total) * 100);

    return { position, total, percentile };
}

// 🎨 CRÉATION DE L'EMBED AVANCÉ
async function createAdvancedStatsEmbed(player, stats, analysis, serverPos, interaction) {
    const rankEmoji = getRankEmoji(stats.currentRank);
    const performance = analysis.performanceLevel;

    // URLs formatées
    const riotIdFormatted = player.riot_id.replace('#', '-').replace(/ /g, '%20');
    const links = [
        `[DPM](https://dpm.lol/${riotIdFormatted})`,
        `[OP.GG](https://www.op.gg/summoners/euw/${riotIdFormatted})`,
        `[U.GG](https://u.gg/lol/profile/euw1/${riotIdFormatted})`
    ].join(' • ');

    // Streak formaté
    const streakText = analysis.currentStreak > 0 ?
        `${analysis.streakType === 'win' ? '🔥' : '💀'} ${analysis.currentStreak} ${analysis.streakType === 'win' ? 'victoires' : 'défaites'}` :
        "➖ Aucune série";

    const embed = new EmbedBuilder()
        .setTitle(`📊 ${player.riot_id}`)
        .setDescription(`${links}\n*Analyse demandée par ${interaction.user.displayName}*`)
        .setColor(performance.color)
        .setThumbnail(stats.summoner?.profileIconId ?
            `https://ddragon.leagueoflegends.com/cdn/14.23.1/img/profileicon/${stats.summoner.profileIconId}.png` :
            null
        )
        .addFields(
            {
                name: '🏆 **RANG & PROGRESSION**',
                value: `${rankEmoji} **${stats.currentRank}** • **${stats.currentLP} LP**\n🎮 ${stats.wins}W/${stats.losses}L (**${stats.winrate}%** WR)\n📈 ${analysis.lpChange >= 0 ? '+' : ''}${analysis.lpChange} LP récents`,
                inline: true
            },
            {
                name: '⚡ **PERFORMANCE RÉCENTE**',
                value: `${performance.level}\n${streakText}\n⚔️ **${analysis.avgKDA}** KDA (${analysis.avgKills}/${analysis.avgDeaths}/${analysis.avgAssists})`,
                inline: true
            },
            {
                name: '🌐 **CLASSEMENT SERVEUR**',
                value: `🏅 **#${serverPos.position}** / ${serverPos.total}\n🎯 ${analysis.totalGames} parties analysées`,
                inline: false
            }
        );

    // 🏆 CHAMPIONS RÉCENTS - Version COMPLÈTE avec Maîtrise
    const topChampions = await getTopChampionsRecent(player, 50);

    if (topChampions?.length > 0) {
        // 🎯 Récupérer les IDs des champions pour la maîtrise
        const championIds = topChampions.map(champ => getChampionIdByName(champ.name)).filter(id => id);
        const masteryData = await getChampionMastery(player, championIds);

        const championsText = topChampions.map((champ, index) => {
            const medals = ['🥇', '🥈', '🥉'];
            const medal = medals[index] || '🏅';
            const kdaText = champ.kda === 'Perfect' ? 'Perfect' : `${champ.kda}`;

            // 🔢 KDA Moyen détaillé
            const avgKDA = `${champ.avgKills}/${champ.avgDeaths}/${champ.avgAssists}`;

            // 🏆 Points de maîtrise
            const championId = getChampionIdByName(champ.name);
            const masteryPoints = masteryData[championId] || 0;
            const masteryText = masteryPoints > 0 ?
                `${masteryPoints.toLocaleString()} pts` :
                '0 pts';

            return `${medal} **${champ.name}** • ${champ.games}G - ${champ.winrate}% WR  •  ${masteryText}\n` +
                `     📊 **${avgKDA}** (${kdaText} KDA)`;
        }).join('\n\n');

        embed.addFields({
            name: "🏆 CHAMPIONS RÉCENTS ",
            value: championsText,
            inline: false
        });
    }

    embed.setTimestamp()
        .setFooter({
            text: `🔄 Mise à jour: ${new Date().toLocaleTimeString('fr-FR')} • Cache: 10min`,
            iconURL: interaction.client.user.displayAvatarURL()
        });

    return embed;
}

// 🎛️ BOUTONS INTERACTIFS
function createInteractiveButtons(player) { // ← Ajouter le paramètre player
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('refresh_stats')
                .setLabel('🔄 Actualiser')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`lp_chart_${player.id}`) // ← Utiliser player.id
                .setLabel('📈 Graphique LP')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`match_history_${player.id}`)  // ← SOLUTION : player.id
                .setLabel('📜 Match History')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('compare_rank')
                .setLabel('⚖️ Comparer')
                .setStyle(ButtonStyle.Secondary),
        );
}


// 🔄 DONNÉES PAR DÉFAUT
function getDefaultAnalysis() {
    return {
        totalGames: 0,
        wins: 0,
        losses: 0,
        winrate: 0,
        currentStreak: 0,
        streakType: 'none',
        avgKDA: 0,
        avgKills: 0,
        avgDeaths: 0,
        avgAssists: 0,
        lpChange: 0,
        topChampions: [],
        performanceLevel: { level: "📊 DONNÉES INSUFFISANTES", color: 0x666666 }
    };
}

// ⚠️ EMBED DE FALLBACK
function createLocalStatsEmbed(player) {
    const rankEmoji = getRankEmoji(player.last_rank);

    return new EmbedBuilder()
        .setTitle(`📊 ${player.riot_id}`)
        .setDescription(`🔗 Données locales uniquement`)
        .setColor(0x666666)
        .addFields({
            name: '🏆 **DERNIER RANG CONNU**',
            value: `${rankEmoji} **${player.last_rank || 'UNRANKED'}** • **${player.last_lp || 0} LP**\n⚠️ Données sauvegardées localement`,
            inline: false
        })
        .setFooter({ text: '⚠️ API Riot indisponible - Réessaye plus tard' });
}

// 🔥 CHAMPIONS RÉCENTS - Version adaptée à ta DB
function getTopChampionsRecent(player, matchCount = 50) {
    const rows = global.db.prepare(`
        SELECT 
            champion_name,
            kills, 
            deaths, 
            assists,
            win
        FROM match_history 
        WHERE player_id = ? 
        ORDER BY game_creation DESC 
        LIMIT ?
    `).all(player.id, matchCount);

    console.log(`📊 Récupéré ${rows.length} matchs récents pour calcul champions`);

    const championStats = {};

    rows.forEach(match => {
        const champion = match.champion_name;

        if (!championStats[champion]) {
            championStats[champion] = {
                name: champion,
                games: 0,
                wins: 0,
                totalKills: 0,
                totalDeaths: 0,
                totalAssists: 0
            };
        }

        const stats = championStats[champion];
        stats.games++;
        stats.wins += match.win ? 1 : 0;
        stats.totalKills += match.kills || 0;
        stats.totalDeaths += match.deaths || 0;
        stats.totalAssists += match.assists || 0;
    });

    const topChampions = Object.values(championStats)
        .map(champ => ({
            name: champ.name,
            games: champ.games,
            winrate: Math.round((champ.wins / champ.games) * 100),
            kda: champ.totalDeaths > 0 ?
                ((champ.totalKills + champ.totalAssists) / champ.totalDeaths).toFixed(1) :
                'Perfect',
            avgKills: Math.round((champ.totalKills / champ.games) * 10) / 10,
            avgDeaths: Math.round((champ.totalDeaths / champ.games) * 10) / 10,
            avgAssists: Math.round((champ.totalAssists / champ.games) * 10) / 10
        }))
        .sort((a, b) => b.games - a.games)
        .slice(0, 3);

    console.log(`✅ Top 3 champions calculés:`, topChampions.map(c => `${c.name}: ${c.games}G, ${c.winrate}%`));

    return topChampions;
}

// 🏆 RÉCUPÉRER LA MAÎTRISE DES CHAMPIONS (VERSION CORRIGÉE AVEC PUUID)
async function getChampionMastery(player) {
    const RIOT_API_KEY = process.env.RIOT_API_KEY; // ← Ajoute ça au début
    const masteryData = {};

    try {
        // Vérifier qu'on a le PUUID
        if (!player.puuid) {
            console.log(`⚠️ Pas de PUUID pour ${player.riot_id}`);
            return masteryData;
        }

        console.log(`🔍 Récupération maîtrise pour ${player.riot_id} (PUUID: ${player.puuid.substring(0, 8)}...)`);

        // Récupérer TOUTES les maîtrises du joueur avec le PUUID
        const masteryResponse = await axios.get(
            `https://euw1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${player.puuid}`,
            {
                headers: { 'X-Riot-Token': RIOT_API_KEY },
                timeout: 15000
            }
        );

        // Créer un map des maîtrises par champion
        masteryResponse.data.forEach(mastery => {
            masteryData[mastery.championId] = mastery.championPoints;
        });

        console.log(`✅ Maîtrise récupérée: ${Object.keys(masteryData).length} champions`);
        return masteryData;

    } catch (error) {
        console.error(`❌ Erreur maîtrise API:`, error.response?.status, error.response?.statusText);

        if (error.response?.status === 404) {
            console.log(`📝 Joueur non trouvé avec ce PUUID`);
        } else if (error.response?.status === 403) {
            console.log(`🔑 Problème de clé API`);
        }

        return masteryData;
    }
}

// 🔍 UTILITAIRE COMPLET : Récupérer l'ID d'un champion par son nom (MAJ 2024)
function getChampionIdByName(championName) {
    const championMap = {
        // A
        'Aatrox': 266, 'Ahri': 103, 'Akali': 84, 'Akshan': 166, 'Alistar': 12,
        'Ambessa': 799, 'Ammu': 32, 'Anivia': 34, 'Annie': 1, 'Aphelios': 523,
        'Ashe': 22, 'Aurelion Sol': 136, 'Aurora': 893, 'Azir': 268,

        // B
        'Bard': 432, 'Bel\'Veth': 200, 'Blitzcrank': 53, 'Brand': 63, 'Braum': 201,
        'Briar': 233,

        // C
        'Caitlyn': 51, 'Camille': 164, 'Cassiopeia': 69, 'Cho\'Gath': 31, 'Corki': 42,

        // D
        'Darius': 122, 'Diana': 131, 'Dr. Mundo': 36, 'Draven': 119,

        // E
        'Ekko': 245, 'Elise': 60, 'Evelynn': 28, 'Ezreal': 81,

        // F
        'Fiddlesticks': 9, 'Fiora': 114, 'Fizz': 105,

        // G
        'Galio': 3, 'Gangplank': 41, 'Garen': 86, 'Gnar': 150, 'Gragas': 79,
        'Graves': 104, 'Gwen': 887,

        // H
        'Hecarim': 120, 'Heimerdinger': 74, 'Hwei': 910,

        // I
        'Illaoi': 420, 'Irelia': 39, 'Ivern': 427,

        // J
        'Janna': 40, 'Jarvan IV': 59, 'Jax': 24, 'Jayce': 126, 'Jhin': 202,
        'Jinx': 222,

        // K
        'Kai\'Sa': 145, 'Kalista': 429, 'Karma': 43, 'Karthus': 30, 'Kassadin': 38,
        'Katarina': 55, 'Kayle': 10, 'Kayn': 141, 'Kennen': 85, 'Kha\'Zix': 121,
        'Kindred': 203, 'Kled': 240, 'Kog\'Maw': 96, 'K\'Sante': 897,

        // L
        'LeBlanc': 7, 'Lee Sin': 64, 'Leona': 89, 'Lillia': 876, 'Lissandra': 127,
        'Lucian': 236, 'Lulu': 117, 'Lux': 99,

        // M
        'Malphite': 54, 'Malzahar': 90, 'Maokai': 57, 'Master Yi': 11, 'Milio': 902,
        'Miss Fortune': 21, 'Mordekaiser': 82, 'Morgana': 25,

        // N
        'Naafiri': 950, 'Nami': 267, 'Nasus': 75, 'Nautilus': 111, 'Neeko': 518,
        'Nidalee': 76, 'Nilah': 895, 'Nocturne': 56, 'Nunu & Willump': 20,

        // O
        'Olaf': 2, 'Orianna': 61, 'Ornn': 516,

        // P
        'Pantheon': 80, 'Poppy': 78, 'Pyke': 555,

        // Q
        'Qiyana': 246, 'Quinn': 133,

        // R
        'Rakan': 497, 'Rammus': 33, 'Rek\'Sai': 421, 'Rell': 526, 'Renata Glasc': 888,
        'Renekton': 58, 'Rengar': 107, 'Riven': 92, 'Rumble': 68, 'Ryze': 13,

        // S
        'Samira': 360, 'Sejuani': 113, 'Senna': 235, 'Seraphine': 147, 'Sett': 875,
        'Shaco': 35, 'Shen': 98, 'Shyvana': 102, 'Singed': 27, 'Sion': 14,
        'Sivir': 15, 'Skarner': 901, 'Smolder': 901, 'Sona': 37, 'Soraka': 16,
        'Swain': 50, 'Sylas': 517, 'Syndra': 134,

        // T
        'Tahm Kench': 223, 'Taliyah': 163, 'Talon': 91, 'Taric': 44, 'Teemo': 17,
        'Thresh': 412, 'Tristana': 18, 'Trundle': 48, 'Tryndamere': 23,
        'Twisted Fate': 4, 'Twitch': 29,

        // U
        'Udyr': 77, 'Urgot': 6,

        // V
        'Varus': 110, 'Vayne': 67, 'Veigar': 45, 'Vel\'Koz': 161, 'Vex': 711,
        'Vi': 254, 'Viego': 234, 'Viktor': 112, 'Vladimir': 8, 'Volibear': 106,
        'Voidgrub': 999, // Boss Jungle

        // W
        'Warwick': 19, 'Wukong': 62,

        // X
        'Xayah': 498, 'Xerath': 101, 'Xin Zhao': 5,

        // Y
        'Yasuo': 157, 'Yone': 777, 'Yorick': 83, 'Yuumi': 350,

        // Z
        'Zac': 154, 'Zed': 238, 'Zeri': 221, 'Ziggs': 115, 'Zilean': 26,
        'Zoe': 142, 'Zyra': 143
    };

    return championMap[championName] || null;
}

// ===============================
//    FONCTIONS POUR L'HISTORIQUE  
// ===============================


// 🧹 NETTOYAGE AUTOMATIQUE DU CACHE
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of statsCache.entries()) {
        if (now - value.timestamp > MATCH_CACHE_DURATION) {
            statsCache.delete(key);
        }
    }
}, 15 * 60 * 1000); // Nettoyage toutes les 15 minutes

// Compteur de requêtes
//let requestCount = 0;
//const originalGet = axios.get;
//axios.get = function(...args) {
//    requestCount++;
//    console.log(`📊 Requête #${requestCount}: ${args[0]}`);
//    return originalGet.apply(this, args);
//};


