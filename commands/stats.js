const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require("discord.js");
const { getRankEmoji, getRankOrder } = require("../utils/rankUtils");
const axios = require("axios");
const logger = require("../utils/loggers");
const { getSummonerByPuuid, getSoloQData, getChampionMasteries } = require("../services/riotApiService");

// ─────────────────────────────────────────
//  CACHE
// ─────────────────────────────────────────
const statsCache = new Map();
const CACHE_DURATION = 10 * 60 * 1000;
const MASTERY_CACHE_DURATION = 30 * 60 * 1000;
const CACHE_CLEANUP_INTERVAL = 15 * 60 * 1000;

// let cachedPatchVersion = "15.10.1";

// async function fetchLatestPatchVersion() {
//     try {
//         const res = await axios.get(
//             "https://ddragon.leagueoflegends.com/api/versions.json",
//             { timeout: 5_000 }
//         );
//         cachedPatchVersion = res.data[0];
//         logger.info('PATCH', `Version DDragon mise à jour : ${cachedPatchVersion}`);
//     } catch (error) {
//         logger.warn('PATCH', `Impossible de récupérer la version DDragon, fallback : ${cachedPatchVersion}`, {
//             error: error.message
//         });
//     }
// }

// fetchLatestPatchVersion();
// setInterval(fetchLatestPatchVersion, 24 * 60 * 60 * 1000);

// ─────────────────────────────────────────
//  HELPER — URL ICÔNE DE PROFIL
// ─────────────────────────────────────────
function buildProfileIconUrl(profileIconId) {
    if (typeof profileIconId === "number" && profileIconId >= 0) {
        return `https://ddragon.leagueoflegends.com/cdn/${cachedPatchVersion}/img/profileicon/${profileIconId}.png`;
    }
    return `https://ddragon.leagueoflegends.com/cdn/${cachedPatchVersion}/img/profileicon/29.png`;
}

// Nettoyage automatique du cache
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of statsCache.entries()) {
        const ttl = key.startsWith("mastery_") ? MASTERY_CACHE_DURATION : CACHE_DURATION;
        if (now - value.timestamp > ttl) statsCache.delete(key);
    }
}, CACHE_CLEANUP_INTERVAL);

// ─────────────────────────────────────────
//  COMMANDE
// ─────────────────────────────────────────
module.exports = {
    data: new SlashCommandBuilder()
        .setName("stats")
        .setDescription("Statistiques détaillées d'un joueur avec analyse de performance")
        .addStringOption((option) =>
            option
                .setName("joueur")
                .setDescription("Riot ID du joueur")
                .setRequired(false)
                .setAutocomplete(true)
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply();
        } catch {
            return;
        }

        const joueurOption = interaction.options.getString("joueur");

        logger.info('COMMAND', `/stats exécuté par ${interaction.user.tag}`, {
            guild: interaction.guildId,
            joueur: joueurOption || null,
        });

        if (!global.db) {
            logger.error('DB', `Base de données non disponible pour /stats`, { guild: interaction.guildId });
            return interaction.editReply("❌ Base de données indisponible").catch(() => { });
        }

        let targetPlayer = null;

        if (joueurOption) {
            targetPlayer = getPlayerByRiotId(joueurOption, interaction.guildId);
            if (!targetPlayer) {
                logger.warn('COMMAND', `Joueur "${joueurOption}" introuvable dans /stats`, { guild: interaction.guildId });
                return interaction.editReply(
                    `❌ Aucun joueur trouvé pour **${joueurOption}** sur ce serveur.\n` +
                    `*Utilise l'autocomplétion ou vérifie \`/list\`.*`
                );
            }
        } else {
            targetPlayer = getLinkedPlayer(interaction.user.id, interaction.guildId);
            if (!targetPlayer) {
                logger.info('COMMAND', `Aucun compte lié pour ${interaction.user.tag} dans /stats`, { guild: interaction.guildId });
                return interaction.editReply(
                    "❌ Aucun compte lié ! Utilise `/link` ou spécifie un `joueur`."
                );
            }
        }

        logger.info('COMMAND', `/stats → joueur ciblé : ${targetPlayer.riot_id}`, {
            playerId: targetPlayer.id,
            guild: interaction.guildId
        });

        try {
            const [playerStats, matchAnalysis, serverPosition] = await Promise.all([
                getPlayerCurrentStats(targetPlayer),
                getMatchAnalysis(targetPlayer),
                getServerPosition(targetPlayer.riot_id, interaction.guildId),
            ]);

            const embed = await createAdvancedStatsEmbed(
                targetPlayer,
                playerStats,
                matchAnalysis,
                serverPosition,
                interaction
            );

            const actionRow = createInteractiveButtons(targetPlayer);

            logger.success('COMMAND', `/stats affiché pour ${targetPlayer.riot_id}`, {
                isLocal: playerStats.isLocal,
                totalGames: matchAnalysis.totalGames,
                guild: interaction.guildId
            });

            await interaction.editReply({ embeds: [embed], components: [actionRow] });

        } catch (error) {
            logger.error('COMMAND', `Erreur critique /stats pour ${targetPlayer.riot_id}`, {
                error: error.message,
                guild: interaction.guildId
            });
            const fallbackEmbed = createLocalStatsEmbed(targetPlayer);
            await interaction.editReply({ embeds: [fallbackEmbed] }).catch(() => { });
        }
    },

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const guildId = interaction.guildId;

        if (!global.db) return interaction.respond([]);

        const rows = global.db.prepare(`
        SELECT DISTINCT p.riot_id FROM players p
        JOIN player_guilds pg ON pg.player_id = p.id
        WHERE pg.guild_id = ? AND pg.active = 1
    `).all(guildId);

        const filtered = rows
            .filter((r) => r.riot_id.toLowerCase().includes(focusedValue))
            .slice(0, 25); // Discord limite à 25 choix max

        await interaction.respond(
            filtered.map((r) => ({ name: r.riot_id, value: r.riot_id }))
        );
    },

};

// ─────────────────────────────────────────
//  RÉCUPÉRATION DES JOUEURS (DB)
// ─────────────────────────────────────────

function getLinkedPlayer(userId, guildId) {
    return global.db.prepare(`
        SELECT p.* FROM players p
        JOIN user_links ul ON p.id = ul.player_id
        JOIN player_guilds pg ON pg.player_id = p.id
        WHERE ul.user_id = ? AND ul.guild_id = ? AND pg.guild_id = ? AND pg.active = 1
    `).get(userId, guildId, guildId) ?? null;
}

function getServerPosition(targetRiotId, guildId) {
    const rows = global.db.prepare(`
        SELECT p.riot_id, p.last_rank, p.last_lp FROM players p
        JOIN player_guilds pg ON pg.player_id = p.id
        WHERE pg.guild_id = ? AND pg.active = 1
    `).all(guildId);

    if (!rows?.length) return { position: 0, total: 0, percentile: 0 };

    rows.sort((a, b) => {
        const rA = getRankOrder(a.last_rank, a.last_lp);
        const rB = getRankOrder(b.last_rank, b.last_lp);
        if (rB.order !== rA.order) return rB.order - rA.order;
        if (rB.divisionOrder !== rA.divisionOrder) return rB.divisionOrder - rA.divisionOrder;
        return (rB.lp || 0) - (rA.lp || 0);
    });

    const position = rows.findIndex((p) => p.riot_id === targetRiotId) + 1;
    const total = rows.length;
    const percentile = total > 0 ? Math.round((position / total) * 100) : 0;

    return { position, total, percentile };
}

function getPlayerByRiotId(riotId, guildId) {
    // Recherche exacte d'abord
    let player = global.db.prepare(`
        SELECT p.* FROM players p
        JOIN player_guilds pg ON pg.player_id = p.id
        WHERE pg.guild_id = ? AND pg.active = 1 AND p.riot_id = ?
    `).get(guildId, riotId);

    if (player) return player;

    // Fallback recherche approximative (au cas où l'utilisateur tape sans autocomplete)
    player = global.db.prepare(`
        SELECT p.* FROM players p
        JOIN player_guilds pg ON pg.player_id = p.id
        WHERE pg.guild_id = ? AND pg.active = 1 AND LOWER(p.riot_id) LIKE LOWER(?)
        LIMIT 1
    `).get(guildId, `%${riotId}%`);

    return player ?? null;
}

// ─────────────────────────────────────────
//  API RIOT — STATS RANKED
// ─────────────────────────────────────────
async function getPlayerCurrentStats(player) {
    const cacheKey = `current_${player.puuid}`;
    const cached = statsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        logger.info('CACHE', `Hit cache stats pour ${player.riot_id}`);
        return cached.data;
    }

    try {
        const [summoner, soloQData] = await Promise.all([
            getSummonerByPuuid(player.puuid),
            getSoloQData(player.puuid),
        ]);

        const totalGames = soloQData ? soloQData.wins + soloQData.losses : 0;

        const result = {
            summoner: {
                ...summoner,
                profileIconId: summoner.profileIconId,
                displayName: summoner.gameName
                    ? `${summoner.gameName}#${summoner.tagLine}`
                    : (summoner.name || player.riot_id),
            },
            ranked: soloQData,
            currentRank: soloQData ? `${soloQData.tier} ${soloQData.rank}` : "UNRANKED",
            currentLP: soloQData?.leaguePoints ?? 0,
            wins: soloQData?.wins ?? 0,
            losses: soloQData?.losses ?? 0,
            winrate: totalGames > 0 ? Math.round((soloQData.wins / totalGames) * 100) : 0,
            isLocal: false,
        };

        statsCache.set(cacheKey, { data: result, timestamp: Date.now() });
        logger.info('API', `Stats Riot récupérées pour ${player.riot_id}`, {
            rank: result.currentRank,
            lp: result.currentLP
        });

        return result;

    } catch (error) {
        logger.error('API', `Échec récupération stats Riot pour ${player.riot_id}`, {
            status: error.response?.status,
            error: error.message
        });

        const fallback = {
            summoner: null,
            ranked: null,
            currentRank: player.last_rank ?? "UNRANKED",
            currentLP: player.last_lp ?? 0,
            wins: 0, losses: 0, winrate: 0,
            isLocal: true,
        };

        statsCache.set(cacheKey, {
            data: fallback,
            timestamp: Date.now() - (CACHE_DURATION - 60_000),
        });

        return fallback;
    }
}


// ─────────────────────────────────────────
//  ANALYSE DES MATCHS
// ─────────────────────────────────────────
function getMatchAnalysis(player) {
    const cacheKey = `analysis_${player.id}`;
    const cached = statsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        logger.info('CACHE', `Hit cache analyse pour ${player.riot_id}`);
        return cached.data;
    }

    const agg = global.db.prepare(`
        SELECT
            COUNT(*)                                  AS total_games,
            SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS wins,
            AVG(kills)                                AS avg_kills,
            AVG(deaths)                               AS avg_deaths,
            AVG(assists)                              AS avg_assists,
            SUM(lp_change)                            AS total_lp_change
        FROM (
            SELECT win, kills, deaths, assists, lp_change
            FROM match_history
            WHERE player_id = ?
            ORDER BY game_creation DESC
            LIMIT 50
        )
    `).get(player.id) ?? {};

    const recentMatches = global.db.prepare(`
        SELECT win FROM match_history
        WHERE player_id = ?
        ORDER BY game_creation DESC
        LIMIT 20
    `).all(player.id);

    let currentStreak = 0;
    let streakType = "none";

    if (recentMatches.length > 0) {
        const firstResult = recentMatches[0].win;
        streakType = firstResult ? "win" : "loss";
        for (const match of recentMatches) {
            if (Boolean(match.win) === Boolean(firstResult)) currentStreak++;
            else break;
        }
    }

    const totalGames = agg.total_games ?? 0;
    const wins = agg.wins ?? 0;
    const avgKDANum = (agg.avg_deaths ?? 0) > 0
        ? ((agg.avg_kills ?? 0) + (agg.avg_assists ?? 0)) / agg.avg_deaths
        : null;

    const analysis = {
        totalGames,
        wins,
        losses: totalGames - wins,
        winrate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
        avgKDA: avgKDANum !== null ? Number(avgKDANum.toFixed(1)) : "Perfect",
        avgKills: Math.round(agg.avg_kills ?? 0),
        avgDeaths: Math.round(agg.avg_deaths ?? 0),
        avgAssists: Math.round(agg.avg_assists ?? 0),
        lpChange: Math.round(agg.total_lp_change ?? 0),
        currentStreak,
        streakType,
        performanceLevel: getPerformanceLevel({
            recentWinrate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
            globalWinrate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
            avgKDA: avgKDANum ?? 0,
            currentStreak,
            streakType,
            lpTrend: agg.total_lp_change ?? 0,
            totalGames,
        }),
    };

    statsCache.set(cacheKey, { data: analysis, timestamp: Date.now() });
    logger.info('DB', `Analyse matchs calculée pour ${player.riot_id}`, {
        totalGames,
        winrate: analysis.winrate,
        streak: `${currentStreak} ${streakType}`
    });

    return analysis;
}

// ─────────────────────────────────────────
//  NIVEAU DE PERFORMANCE
// ─────────────────────────────────────────
function getPerformanceLevel({
    recentWinrate = 0,
    globalWinrate = 0,
    avgKDA = 0,
    currentStreak = 0,
    streakType = "none",
    lpTrend = 0,
    totalGames = 0,
} = {}) {
    let score = 0;
    let bonusPoints = 0;
    let penalties = 0;

    if (recentWinrate >= 80) score += 3;
    else if (recentWinrate >= 70) score += 2.5;
    else if (recentWinrate >= 60) score += 2;
    else if (recentWinrate >= 50) score += 1;
    else if (recentWinrate >= 40) score -= 1;

    if (globalWinrate >= 65) score += 3;
    else if (globalWinrate >= 55) score += 2;
    else if (globalWinrate >= 50) score += 1.5;
    else if (globalWinrate >= 45) score += 1;
    else score -= 2;

    const kdaNum = typeof avgKDA === "string" ? 99 : avgKDA;
    if (kdaNum >= 3.5) score += 2.5;
    else if (kdaNum >= 2.5) score += 2;
    else if (kdaNum >= 2.0) score += 1;
    else if (kdaNum >= 1.5) score += 0;
    else if (kdaNum >= 1.0) score -= 2;

    if (streakType === "win") {
        if (currentStreak >= 7) bonusPoints += 1;
        else if (currentStreak >= 5) bonusPoints += 0.5;
        else if (currentStreak >= 3) bonusPoints += 0.25;
    } else if (streakType === "loss") {
        if (currentStreak >= 5) penalties += 5;
        else if (currentStreak >= 3) penalties += 1;
    }

    if (lpTrend > 100) bonusPoints += 0.75;
    else if (lpTrend < -100) penalties += 0.5;

    const finalScore = Math.max(0, score + bonusPoints - penalties);

    if (finalScore >= 8.5) return { level: "🌟 CANNA-MESSI-CR7", color: 0xF0E68C };
    else if (finalScore >= 7.0) return { level: "🔥 EXCELLENT", color: 0x8500FF };
    else if (finalScore >= 5.5) return { level: "⭐ TRES BON", color: 0x00FF00 };
    else if (finalScore >= 4.0) return { level: "✅ SOLIDE", color: 0x00BFFF };
    else if (finalScore >= 2.5) return { level: "⚡ MOYEN", color: 0xFFD700 };
    else return { level: "❄️ RAZMO TIER", color: 0xFF6B6B };
}

// ─────────────────────────────────────────
//  CHAMPIONS RÉCENTS
// ─────────────────────────────────────────
function getTopChampionsRecent(player, matchCount = 50) {
    const rows = global.db.prepare(`
        SELECT champion_name, kills, deaths, assists, win
        FROM match_history
        WHERE player_id = ?
        ORDER BY game_creation DESC
        LIMIT ?
    `).all(player.id, matchCount);

    const championStats = {};

    for (const match of rows) {
        const c = match.champion_name;
        if (!championStats[c]) {
            championStats[c] = { name: c, games: 0, wins: 0, totalKills: 0, totalDeaths: 0, totalAssists: 0 };
        }
        const s = championStats[c];
        s.games++;
        if (match.win) s.wins++;
        s.totalKills += match.kills ?? 0;
        s.totalDeaths += match.deaths ?? 0;
        s.totalAssists += match.assists ?? 0;
    }

    return Object.values(championStats)
        .map((c) => ({
            name: c.name,
            games: c.games,
            winrate: Math.round((c.wins / c.games) * 100),
            kda: c.totalDeaths > 0
                ? ((c.totalKills + c.totalAssists) / c.totalDeaths).toFixed(1)
                : "Perfect",
            avgKills: +(c.totalKills / c.games).toFixed(1),
            avgDeaths: +(c.totalDeaths / c.games).toFixed(1),
            avgAssists: +(c.totalAssists / c.games).toFixed(1),
        }))
        .sort((a, b) => b.games - a.games)
        .slice(0, 3);
}

// ─────────────────────────────────────────
//  MAÎTRISE
// ─────────────────────────────────────────
async function getChampionMastery(player) {
    const cacheKey = `mastery_${player.puuid}`;
    const cached = statsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < MASTERY_CACHE_DURATION) {
        logger.info('CACHE', `Hit cache maîtrise pour ${player.riot_id}`);
        return cached.data;
    }

    if (!player.puuid) return {};

    try {
        const masteries = await getChampionMasteries(player.puuid);
        const masteryData = {};

        for (const m of masteries) {
            masteryData[m.championId] = m.championPoints;
        }

        statsCache.set(cacheKey, { data: masteryData, timestamp: Date.now() });
        logger.info('API', `Maîtrise récupérée pour ${player.riot_id}`, {
            championsCount: masteries.length
        });

        return masteryData;

    } catch (error) {
        logger.error('API', `Échec récupération maîtrise pour ${player.riot_id}`, {
            status: error.response?.status,
            error: error.message
        });

        statsCache.set(cacheKey, {
            data: {},
            timestamp: Date.now() - (MASTERY_CACHE_DURATION - 5 * 60_000),
        });

        return {};
    }
}

// ─────────────────────────────────────────
//  CONSTRUCTION DE L'EMBED
// ─────────────────────────────────────────
async function createAdvancedStatsEmbed(player, stats, analysis, serverPos, interaction) {
    const rankEmoji = getRankEmoji(stats.currentRank);
    const performance = analysis.performanceLevel;

    const riotIdFormatted = player.riot_id.replace("#", "-").replace(/ /g, "%20");
    const links = [
        `[DPM](https://dpm.lol/${riotIdFormatted})`,
        `[OP.GG](https://www.op.gg/summoners/euw/${riotIdFormatted})`,
        `[U.GG](https://u.gg/lol/profile/euw1/${riotIdFormatted})`,
    ].join(" • ");

    const streakText =
        analysis.currentStreak > 0
            ? `${analysis.streakType === "win" ? "🔥" : "💀"} ${analysis.currentStreak} ${analysis.streakType === "win" ? "victoires" : "défaites"
            } consécutives`
            : "➖ Aucune série en cours";

    const profileIconUrl = buildProfileIconUrl(stats.summoner?.profileIconId);

    const embed = new EmbedBuilder()
        .setTitle(`📊 ${player.riot_id}`)
        .setDescription(`${links}\n*Analyse demandée par ${interaction.user.displayName}*`)
        .setColor(performance.color)
        .setThumbnail(profileIconUrl)
        .addFields(
            {
                name: "🏆 **RANG & PROGRESSION**",
                value:
                    `${rankEmoji} **${stats.currentRank}** • **${stats.currentLP} LP**\n` +
                    `🎮 ${stats.wins}W/${stats.losses}L (**${stats.winrate}%** WR)\n` +
                    `📈 ${analysis.lpChange >= 0 ? "+" : ""}${analysis.lpChange} LP (50 dernières)`,
                inline: true,
            },
            {
                name: "⚡ **PERFORMANCE RÉCENTE**",
                value:
                    `${performance.level}\n` +
                    `${streakText}\n` +
                    `⚔️ **${analysis.avgKDA}** KDA (${analysis.avgKills}/${analysis.avgDeaths}/${analysis.avgAssists})`,
                inline: true,
            },
            {
                name: "🌐 **CLASSEMENT SERVEUR**",
                value:
                    `🏅 **#${serverPos.position}** / ${serverPos.total}\n` +
                    `🎯 ${analysis.totalGames} parties analysées`,
                inline: false,
            }
        );

    const topChampions = getTopChampionsRecent(player, 50);

    if (topChampions.length > 0) {
        const masteryData = await getChampionMastery(player);
        const medals = ["🥇", "🥈", "🥉"];

        const championsText = topChampions
            .map((champ, i) => {
                const id = getChampionIdByName(champ.name);
                const pts = (id && masteryData[id]) ? masteryData[id].toLocaleString() + " pts" : "0 pts";
                const avgKDA = `${champ.avgKills}/${champ.avgDeaths}/${champ.avgAssists}`;
                return (
                    `${medals[i] ?? "🏅"} **${champ.name}** • ${champ.games}G - ${champ.winrate}% WR • ${pts}\n` +
                    `     📊 **${avgKDA}** (${champ.kda} KDA)`
                );
            })
            .join("\n\n");

        embed.addFields({ name: "🏆 CHAMPIONS RÉCENTS", value: championsText, inline: false });
    }

    embed
        .setTimestamp()
        .setFooter({
            text: `🔄 ${new Date().toLocaleTimeString("fr-FR")} • Cache 10 min`,
            iconURL: interaction.client.user.displayAvatarURL(),
        });

    return embed;
}

// ─────────────────────────────────────────
//  BOUTONS
// ─────────────────────────────────────────
function createInteractiveButtons(player) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("refresh_stats")
            .setLabel("🔄 Actualiser")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`lp_chart_${player.id}`)
            .setLabel("📈 Graphique LP")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`match_history_${player.id}`)
            .setLabel("📜 Match History")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("compare_rank")
            .setLabel("⚖️ Comparer")
            .setStyle(ButtonStyle.Secondary)
    );
}

// ─────────────────────────────────────────
//  FALLBACK
// ─────────────────────────────────────────
function createLocalStatsEmbed(player) {
    const rankEmoji = getRankEmoji(player.last_rank);
    return new EmbedBuilder()
        .setTitle(`📊 ${player.riot_id}`)
        .setDescription("🔗 Données locales uniquement")
        .setColor(0x666666)
        .addFields({
            name: "🏆 **DERNIER RANG CONNU**",
            value:
                `${rankEmoji} **${player.last_rank ?? "UNRANKED"}** • **${player.last_lp ?? 0} LP**\n` +
                `⚠️ Données sauvegardées localement`,
            inline: false,
        })
        .setFooter({ text: "⚠️ API Riot indisponible – Réessaye plus tard" });
}

// ─────────────────────────────────────────
//  MAP CHAMPION NAME → ID
// ─────────────────────────────────────────
function getChampionIdByName(championName) {
    const CHAMPION_IDS = {
        266: "Aatrox", 103: "Ahri", 84: "Akali", 166: "Akshan",
        12: "Alistar", 799: "Ambessa", 32: "Amumu", 34: "Anivia",
        1: "Annie", 523: "Aphelios", 22: "Ashe", 136: "Aurelion Sol",
        893: "Aurora", 268: "Azir", 432: "Bard", 200: "Bel'Veth",
        53: "Blitzcrank", 63: "Brand", 201: "Braum", 233: "Briar",
        51: "Caitlyn", 164: "Camille", 69: "Cassiopeia", 31: "Cho'Gath",
        42: "Corki", 122: "Darius", 131: "Diana", 36: "Dr. Mundo",
        119: "Draven", 245: "Ekko", 60: "Elise", 28: "Evelynn",
        81: "Ezreal", 9: "Fiddlesticks", 114: "Fiora", 105: "Fizz",
        3: "Galio", 41: "Gangplank", 86: "Garen", 150: "Gnar",
        79: "Gragas", 104: "Graves", 887: "Gwen", 120: "Hecarim",
        74: "Heimerdinger", 910: "Hwei", 420: "Illaoi", 39: "Irelia",
        427: "Ivern", 40: "Janna", 59: "Jarvan IV", 24: "Jax",
        126: "Jayce", 202: "Jhin", 222: "Jinx", 145: "Kai'Sa",
        429: "Kalista", 43: "Karma", 30: "Karthus", 38: "Kassadin",
        55: "Katarina", 10: "Kayle", 141: "Kayn", 85: "Kennen",
        121: "Kha'Zix", 203: "Kindred", 240: "Kled", 96: "Kog'Maw",
        897: "K'Sante", 7: "LeBlanc", 64: "Lee Sin", 89: "Leona",
        876: "Lillia", 127: "Lissandra", 236: "Lucian", 117: "Lulu",
        99: "Lux", 54: "Malphite", 90: "Malzahar", 57: "Maokai",
        11: "Master Yi", 902: "Milio", 21: "Miss Fortune", 82: "Mordekaiser",
        25: "Morgana", 950: "Naafiri", 267: "Nami", 75: "Nasus",
        111: "Nautilus", 518: "Neeko", 76: "Nidalee", 895: "Nilah",
        56: "Nocturne", 20: "Nunu & Willump", 2: "Olaf", 61: "Orianna",
        516: "Ornn", 80: "Pantheon", 78: "Poppy", 555: "Pyke",
        246: "Qiyana", 133: "Quinn", 497: "Rakan", 33: "Rammus",
        421: "Rek'Sai", 526: "Rell", 888: "Renata Glasc", 58: "Renekton",
        107: "Rengar", 92: "Riven", 68: "Rumble", 13: "Ryze",
        360: "Samira", 113: "Sejuani", 235: "Senna", 147: "Seraphine",
        875: "Sett", 35: "Shaco", 98: "Shen", 102: "Shyvana",
        27: "Singed", 14: "Sion", 15: "Sivir", 901: "Skarner",
        903: "Smolder", 37: "Sona", 16: "Soraka", 50: "Swain",
        517: "Sylas", 134: "Syndra", 223: "Tahm Kench", 163: "Taliyah",
        91: "Talon", 44: "Taric", 17: "Teemo", 412: "Thresh",
        18: "Tristana", 48: "Trundle", 23: "Tryndamere", 4: "Twisted Fate",
        29: "Twitch", 77: "Udyr", 6: "Urgot", 110: "Varus",
        67: "Vayne", 45: "Veigar", 161: "Vel'Koz", 711: "Vex",
        254: "Vi", 234: "Viego", 112: "Viktor", 8: "Vladimir",
        106: "Volibear", 19: "Warwick", 62: "Wukong", 498: "Xayah",
        101: "Xerath", 5: "Xin Zhao", 157: "Yasuo", 777: "Yone",
        83: "Yorick", 350: "Yuumi", 154: "Zac", 238: "Zed",
        221: "Zeri", 115: "Ziggs", 26: "Zilean", 142: "Zoe",
        143: "Zyra", 804: "Yunara", 904: "Zaahen",
    };
    return CHAMPION_IDS[championName] ?? null;
}
