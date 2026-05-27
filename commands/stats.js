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

// ─────────────────────────────────────────
//  CACHE
// ─────────────────────────────────────────
const statsCache = new Map();
const CACHE_DURATION         = 10 * 60 * 1000;
const MASTERY_CACHE_DURATION = 30 * 60 * 1000;
const CACHE_CLEANUP_INTERVAL = 15 * 60 * 1000;

let cachedPatchVersion = "15.10.1";

async function fetchLatestPatchVersion() {
    try {
        const res = await axios.get(
            "https://ddragon.leagueoflegends.com/api/versions.json",
            { timeout: 5_000 }
        );
        cachedPatchVersion = res.data[0];
        logger.info('PATCH', `Version DDragon mise à jour : ${cachedPatchVersion}`);
    } catch (error) {
        logger.warn('PATCH', `Impossible de récupérer la version DDragon, fallback : ${cachedPatchVersion}`, {
            error: error.message
        });
    }
}

fetchLatestPatchVersion();
setInterval(fetchLatestPatchVersion, 24 * 60 * 60 * 1000);

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
        .addIntegerOption((option) =>
            option
                .setName("rang")
                .setDescription("Position du joueur dans le classement serveur")
                .setRequired(false)
                .setMinValue(1)
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply();
        } catch {
            return;
        }

        logger.info('COMMAND', `/stats exécuté par ${interaction.user.tag}`, {
            guild: interaction.guildId,
            rang: interaction.options.getInteger("rang") || 'lié'
        });

        if (!global.db) {
            logger.error('DB', `Base de données non disponible pour /stats`, { guild: interaction.guildId });
            return interaction.editReply("❌ Base de données indisponible").catch(() => {});
        }

        let targetPlayer = null;
        const rankOption = interaction.options.getInteger("rang");

        if (rankOption) {
            targetPlayer = getPlayerByRank(rankOption, interaction.guildId);
            if (!targetPlayer) {
                logger.warn('COMMAND', `Position #${rankOption} introuvable dans /stats`, { guild: interaction.guildId });
                return interaction.editReply(`❌ Aucun joueur trouvé à la position **#${rankOption}**`);
            }
        } else {
            targetPlayer = getLinkedPlayer(interaction.user.id, interaction.guildId);
            if (!targetPlayer) {
                logger.info('COMMAND', `Aucun compte lié pour ${interaction.user.tag} dans /stats`, { guild: interaction.guildId });
                return interaction.editReply("❌ Aucun compte lié ! Utilise `/link` ou spécifie un rang.");
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
                getServerPosition(targetPlayer.riot_id, targetPlayer.guild_id),
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
            await interaction.editReply({ embeds: [fallbackEmbed] }).catch(() => {});
        }
    },
};

// ─────────────────────────────────────────
//  RÉCUPÉRATION DES JOUEURS (DB)
// ─────────────────────────────────────────
function getPlayerByRank(position, guildId) {
    const rows = global.db
        .prepare(`SELECT * FROM players WHERE guild_id = ?`)
        .all(guildId);

    if (!rows?.length) return null;

    rows.sort((a, b) => {
        const rA = getRankOrder(a.last_rank, a.last_lp);
        const rB = getRankOrder(b.last_rank, b.last_lp);
        if (rB.order !== rA.order) return rB.order - rA.order;
        if (rB.divisionOrder !== rA.divisionOrder) return rB.divisionOrder - rA.divisionOrder;
        return (rB.lp || 0) - (rA.lp || 0);
    });

    return rows[position - 1] ?? null;
}

function getLinkedPlayer(userId, guildId) {
    return global.db
        .prepare(`
            SELECT p.* FROM players p
            JOIN user_links ul ON p.id = ul.player_id
            WHERE ul.user_id = ? AND ul.guild_id = ?
        `)
        .get(userId, guildId) ?? null;
}

function getServerPosition(targetRiotId, guildId) {
    const rows = global.db
        .prepare(`SELECT riot_id, last_rank, last_lp FROM players WHERE guild_id = ?`)
        .all(guildId);

    if (!rows?.length) return { position: 0, total: 0, percentile: 0 };

    rows.sort((a, b) => {
        const rA = getRankOrder(a.last_rank, a.last_lp);
        const rB = getRankOrder(b.last_rank, b.last_lp);
        if (rB.order !== rA.order) return rB.order - rA.order;
        if (rB.divisionOrder !== rA.divisionOrder) return rB.divisionOrder - rA.divisionOrder;
        return (rB.lp || 0) - (rA.lp || 0);
    });

    const position   = rows.findIndex((p) => p.riot_id === targetRiotId) + 1;
    const total      = rows.length;
    const percentile = total > 0 ? Math.round((position / total) * 100) : 0;

    return { position, total, percentile };
}

// ─────────────────────────────────────────
//  API RIOT — STATS RANKED
// ─────────────────────────────────────────
async function getPlayerCurrentStats(player) {
    const cacheKey = `current_${player.puuid}`;
    const cached   = statsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        logger.info('CACHE', `Hit cache stats pour ${player.riot_id}`);
        return cached.data;
    }

    const RIOT_API_KEY = process.env.RIOT_API_KEY;

    try {
        const [summonerRes, rankedRes] = await Promise.all([
            axios.get(
                `https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${player.puuid}`,
                { headers: { "X-Riot-Token": RIOT_API_KEY }, timeout: 10_000 }
            ),
            axios.get(
                `https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${player.puuid}`,
                { headers: { "X-Riot-Token": RIOT_API_KEY }, timeout: 10_000 }
            ),
        ]);

        const summoner   = summonerRes.data;
        const soloQData  = rankedRes.data.find((e) => e.queueType === "RANKED_SOLO_5x5") ?? null;
        const totalGames = soloQData ? soloQData.wins + soloQData.losses : 0;

        const result = {
            summoner: {
                ...summoner,
                profileIconId: summoner.profileIconId,
                displayName: summoner.gameName
                    ? `${summoner.gameName}#${summoner.tagLine}`
                    : (summoner.name || player.riot_id),
            },
            ranked:      soloQData,
            currentRank: soloQData ? `${soloQData.tier} ${soloQData.rank}` : "UNRANKED",
            currentLP:   soloQData?.leaguePoints ?? 0,
            wins:        soloQData?.wins          ?? 0,
            losses:      soloQData?.losses        ?? 0,
            winrate:     totalGames > 0 ? Math.round((soloQData.wins / totalGames) * 100) : 0,
            isLocal:     false,
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
            summoner:    null,
            ranked:      null,
            currentRank: player.last_rank ?? "UNRANKED",
            currentLP:   player.last_lp   ?? 0,
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
    const cached   = statsCache.get(cacheKey);
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
    let streakType    = "none";

    if (recentMatches.length > 0) {
        const firstResult = recentMatches[0].win;
        streakType = firstResult ? "win" : "loss";
        for (const match of recentMatches) {
            if (Boolean(match.win) === Boolean(firstResult)) currentStreak++;
            else break;
        }
    }

    const totalGames = agg.total_games ?? 0;
    const wins       = agg.wins        ?? 0;
    const avgKDANum  = (agg.avg_deaths ?? 0) > 0
        ? ((agg.avg_kills ?? 0) + (agg.avg_assists ?? 0)) / agg.avg_deaths
        : null;

    const analysis = {
        totalGames,
        wins,
        losses:       totalGames - wins,
        winrate:      totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
        avgKDA:       avgKDANum !== null ? Number(avgKDANum.toFixed(1)) : "Perfect",
        avgKills:     Math.round(agg.avg_kills   ?? 0),
        avgDeaths:    Math.round(agg.avg_deaths  ?? 0),
        avgAssists:   Math.round(agg.avg_assists ?? 0),
        lpChange:     Math.round(agg.total_lp_change ?? 0),
        currentStreak,
        streakType,
        performanceLevel: getPerformanceLevel({
            recentWinrate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
            globalWinrate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
            avgKDA:        avgKDANum ?? 0,
            currentStreak,
            streakType,
            lpTrend:    agg.total_lp_change ?? 0,
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
    avgKDA        = 0,
    currentStreak = 0,
    streakType    = "none",
    lpTrend       = 0,
    totalGames    = 0,
} = {}) {
    let score       = 0;
    let bonusPoints = 0;
    let penalties   = 0;

    if      (recentWinrate >= 80) score += 3;
    else if (recentWinrate >= 70) score += 2.5;
    else if (recentWinrate >= 60) score += 2;
    else if (recentWinrate >= 50) score += 1;
    else if (recentWinrate >= 40) score -= 1;

    if      (globalWinrate >= 65) score += 3;
    else if (globalWinrate >= 55) score += 2;
    else if (globalWinrate >= 50) score += 1.5;
    else if (globalWinrate >= 45) score += 1;
    else                          score -= 2;

    const kdaNum = typeof avgKDA === "string" ? 99 : avgKDA;
    if      (kdaNum >= 3.5) score += 2.5;
    else if (kdaNum >= 2.5) score += 2;
    else if (kdaNum >= 2.0) score += 1;
    else if (kdaNum >= 1.5) score += 0;
    else if (kdaNum >= 1.0) score -= 2;

    if (streakType === "win") {
        if      (currentStreak >= 7) bonusPoints += 1;
        else if (currentStreak >= 5) bonusPoints += 0.5;
        else if (currentStreak >= 3) bonusPoints += 0.25;
    } else if (streakType === "loss") {
        if      (currentStreak >= 5) penalties += 5;
        else if (currentStreak >= 3) penalties += 1;
    }

    if      (lpTrend >  100) bonusPoints += 0.75;
    else if (lpTrend < -100) penalties   += 0.5;

    const finalScore = Math.max(0, score + bonusPoints - penalties);

    if      (finalScore >= 8.5) return { level: "🌟 CANNA-MESSI-CR7", color: 0xF0E68C };
    else if (finalScore >= 7.0) return { level: "🔥 EXCELLENT",        color: 0x8500FF };
    else if (finalScore >= 5.5) return { level: "⭐ TRES BON",          color: 0x00FF00 };
    else if (finalScore >= 4.0) return { level: "✅ SOLIDE",             color: 0x00BFFF };
    else if (finalScore >= 2.5) return { level: "⚡ MOYEN",              color: 0xFFD700 };
    else                         return { level: "❄️ RAZMO TIER",        color: 0xFF6B6B };
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
        s.totalKills   += match.kills   ?? 0;
        s.totalDeaths  += match.deaths  ?? 0;
        s.totalAssists += match.assists ?? 0;
    }

    return Object.values(championStats)
        .map((c) => ({
            name:       c.name,
            games:      c.games,
            winrate:    Math.round((c.wins / c.games) * 100),
            kda:        c.totalDeaths > 0
                ? ((c.totalKills + c.totalAssists) / c.totalDeaths).toFixed(1)
                : "Perfect",
            avgKills:   +(c.totalKills   / c.games).toFixed(1),
            avgDeaths:  +(c.totalDeaths  / c.games).toFixed(1),
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
    const cached   = statsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < MASTERY_CACHE_DURATION) {
        logger.info('CACHE', `Hit cache maîtrise pour ${player.riot_id}`);
        return cached.data;
    }

    const RIOT_API_KEY = process.env.RIOT_API_KEY;
    const masteryData  = {};

    if (!player.puuid) return masteryData;

    try {
        const res = await axios.get(
            `https://euw1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${player.puuid}`,
            { headers: { "X-Riot-Token": RIOT_API_KEY }, timeout: 10_000 }
        );

        for (const m of res.data) {
            masteryData[m.championId] = m.championPoints;
        }

        statsCache.set(cacheKey, { data: masteryData, timestamp: Date.now() });
        logger.info('API', `Maîtrise récupérée pour ${player.riot_id}`, {
            championsCount: res.data.length
        });

        return masteryData;

    } catch (error) {
        logger.error('API', `Échec récupération maîtrise pour ${player.riot_id}`, {
            status: error.response?.status,
            error: error.message
        });
        statsCache.set(cacheKey, {
            data: masteryData,
            timestamp: Date.now() - (MASTERY_CACHE_DURATION - 5 * 60_000),
        });
        return masteryData;
    }
}

// ─────────────────────────────────────────
//  CONSTRUCTION DE L'EMBED
// ─────────────────────────────────────────
async function createAdvancedStatsEmbed(player, stats, analysis, serverPos, interaction) {
    const rankEmoji   = getRankEmoji(stats.currentRank);
    const performance = analysis.performanceLevel;

    const riotIdFormatted = player.riot_id.replace("#", "-").replace(/ /g, "%20");
    const links = [
        `[DPM](https://dpm.lol/${riotIdFormatted})`,
        `[OP.GG](https://www.op.gg/summoners/euw/${riotIdFormatted})`,
        `[U.GG](https://u.gg/lol/profile/euw1/${riotIdFormatted})`,
    ].join(" • ");

    const streakText =
        analysis.currentStreak > 0
            ? `${analysis.streakType === "win" ? "🔥" : "💀"} ${analysis.currentStreak} ${
                  analysis.streakType === "win" ? "victoires" : "défaites"
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
        const medals      = ["🥇", "🥈", "🥉"];

        const championsText = topChampions
            .map((champ, i) => {
                const id     = getChampionIdByName(champ.name);
                const pts    = (id && masteryData[id]) ? masteryData[id].toLocaleString() + " pts" : "0 pts";
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
        "Aatrox": 266, "Ahri": 103, "Akali": 84, "Akshan": 166, "Alistar": 12,
        "Ambessa": 799, "Amumu": 32, "Anivia": 34, "Annie": 1, "Aphelios": 523,
        "Ashe": 22, "Aurelion Sol": 136, "Aurora": 893, "Azir": 268,
        "Bard": 432, "Bel'Veth": 200, "Blitzcrank": 53, "Brand": 63, "Braum": 201,
        "Briar": 233,
        "Caitlyn": 51, "Camille": 164, "Cassiopeia": 69, "Cho'Gath": 31, "Corki": 42,
        "Darius": 122, "Diana": 131, "Dr. Mundo": 36, "Draven": 119,
        "Ekko": 245, "Elise": 60, "Evelynn": 28, "Ezreal": 81,
        "Fiddlesticks": 9, "Fiora": 114, "Fizz": 105,
        "Galio": 3, "Gangplank": 41, "Garen": 86, "Gnar": 150, "Gragas": 79,
        "Graves": 104, "Gwen": 887,
        "Hecarim": 120, "Heimerdinger": 74, "Hwei": 910,
        "Illaoi": 420, "Irelia": 39, "Ivern": 427,
        "Janna": 40, "Jarvan IV": 59, "Jax": 24, "Jayce": 126, "Jhin": 202, "Jinx": 222,
        "Kai'Sa": 145, "Kalista": 429, "Karma": 43, "Karthus": 30, "Kassadin": 38,
        "Katarina": 55, "Kayle": 10, "Kayn": 141, "Kennen": 85, "Kha'Zix": 121,
        "Kindred": 203, "Kled": 240, "Kog'Maw": 96, "K'Sante": 897,
        "LeBlanc": 7, "Lee Sin": 64, "Leona": 89, "Lillia": 876, "Lissandra": 127,
        "Lucian": 236, "Lulu": 117, "Lux": 99,
        "Malphite": 54, "Malzahar": 90, "Maokai": 57, "Master Yi": 11, "Milio": 902,
        "Miss Fortune": 21, "Mordekaiser": 82, "Morgana": 25,
        "Naafiri": 950, "Nami": 267, "Nasus": 75, "Nautilus": 111, "Neeko": 518,
        "Nidalee": 76, "Nilah": 895, "Nocturne": 56, "Nunu & Willump": 20,
        "Olaf": 2, "Orianna": 61, "Ornn": 516,
        "Pantheon": 80, "Poppy": 78, "Pyke": 555,
        "Qiyana": 246, "Quinn": 133,
        "Rakan": 497, "Rammus": 33, "Rek'Sai": 421, "Rell": 526,
        "Renata Glasc": 888, "Renekton": 58, "Rengar": 107, "Riven": 92,
        "Rumble": 68, "Ryze": 13,
        "Samira": 360, "Sejuani": 113, "Senna": 235, "Seraphine": 147, "Sett": 875,
        "Shaco": 35, "Shen": 98, "Shyvana": 102, "Singed": 27, "Sion": 14,
        "Sivir": 15, "Skarner": 901, "Smolder": 893, "Sona": 37, "Soraka": 16,
        "Swain": 50, "Sylas": 517, "Syndra": 134,
        "Tahm Kench": 223, "Taliyah": 163, "Talon": 91, "Taric": 44, "Teemo": 17,
        "Thresh": 412, "Tristana": 18, "Trundle": 48, "Tryndamere": 23,
        "Twisted Fate": 4, "Twitch": 29,
        "Udyr": 77, "Urgot": 6,
        "Varus": 110, "Vayne": 67, "Veigar": 45, "Vel'Koz": 161, "Vex": 711,
        "Vi": 254, "Viego": 234, "Viktor": 112, "Vladimir": 8, "Volibear": 106,
        "Warwick": 19, "Wukong": 62,
        "Xayah": 498, "Xerath": 101, "Xin Zhao": 5,
        "Yasuo": 157, "Yone": 777, "Yorick": 83, "Yuumi": 350,
        "Zac": 154, "Zed": 238, "Zeri": 221, "Ziggs": 115, "Zilean": 26,
        "Zoe": 142, "Zyra": 143,
    };
    return CHAMPION_IDS[championName] ?? null;
}
