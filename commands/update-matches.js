// commands/update-matches.js
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const { getRankEmoji, getRankOrder } = require('../utils/rankUtils');

const RIOT_API_KEY = process.env.RIOT_API_KEY;
const OWNER_ID = process.env.OWNER_ID;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update-matches')
        .setDescription('⚙️ [ADMIN] Synchronise l\'historique de matchs d\'un joueur')
        .addIntegerOption(option =>
            option.setName('position')
                .setDescription('Position du joueur dans /list')
                .setRequired(true)
                .setMinValue(1)
        )
        .addIntegerOption(option =>
            option.setName('count')
                .setDescription('Nombre de matchs à vérifier (défaut: 20, max: 100)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(100)
        ),

    async execute(interaction) {
        // 🔒 VÉRIFICATION PERMISSIONS
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const isOwner = interaction.user.id === OWNER_ID;

        if (!isAdmin && !isOwner) {
            return interaction.reply({
                content: '❌ Seuls les administrateurs peuvent utiliser cette commande.',
                ephemeral: true
            });
        }

        await interaction.deferReply();

        const position = interaction.options.getInteger('position');
        const matchCount = interaction.options.getInteger('count') || 20;
        const guildId = interaction.guild.id;

        try {
            // 🔍 RÉCUPÉRER LE JOUEUR
            const players = global.db.prepare(
                `SELECT * FROM players WHERE guild_id = ? ORDER BY id`
            ).all(guildId);

            if (!players || players.length === 0) {
                return interaction.editReply('❌ Aucun joueur surveillé sur ce serveur.');
            }

            if (position > players.length) {
                return interaction.editReply(`❌ Position invalide. Il n'y a que ${players.length} joueur(s) surveillé(s).`);
            }

            const player = players[position - 1];
            const channel = await interaction.client.channels.fetch(player.channel_id);

            // 📥 RÉCUPÉRER LES MATCHS DEPUIS L'API
            const matchesResponse = await axios.get(
                `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${player.puuid}/ids?queue=420&count=${matchCount}`,
                { headers: { "X-Riot-Token": RIOT_API_KEY } }
            );

            const matchIds = matchesResponse.data;

            if (!matchIds || matchIds.length === 0) {
                return interaction.editReply('❌ Aucun match trouvé pour ce joueur.');
            }

            // 🔍 VÉRIFIER LESQUELS SONT DÉJÀ EN BDD
            const existingMatches = global.db.prepare(
                `SELECT match_id FROM match_history WHERE player_id = ?`
            ).all(player.id).map(r => r.match_id);

            const newMatchIds = matchIds.filter(id => !existingMatches.includes(id));

            if (newMatchIds.length === 0) {
                return interaction.editReply(`✅ Tous les matchs sont déjà à jour pour **${player.riot_id}** (${matchIds.length} match(s) vérifiés)`);
            }

            // 🔄 INVERSER POUR TRAITER DU PLUS ANCIEN AU PLUS RÉCENT
            newMatchIds.reverse();

            let inserted = 0;
            let errors = 0;

            // 🎯 TRAITER CHAQUE NOUVEAU MATCH
            for (const matchId of newMatchIds) {
                try {
                    await processNewMatch(player, matchId, channel, interaction.client);
                    inserted++;
                    await sleep(1200); // Rate limit
                } catch (error) {
                    console.error(`❌ Erreur traitement match ${matchId}:`, error.message);
                    errors++;
                }
            }

            // 📊 METTRE À JOUR last_match_id
            global.db.prepare(`UPDATE players SET last_match_id = ? WHERE id = ?`)
                .run(matchIds[0], player.id);

            // 📨 MESSAGE DE RÉSULTAT
            const resultEmbed = new EmbedBuilder()
                .setTitle('✅ Synchronisation terminée')
                .setDescription(`**${player.riot_id}**`)
                .addFields(
                    { name: '📊 Matchs vérifiés', value: `${matchIds.length}`, inline: true },
                    { name: '✅ Nouveaux insérés', value: `${inserted}`, inline: true },
                    { name: '❌ Erreurs', value: `${errors}`, inline: true }
                )
                .setColor(errors > 0 ? '#FFA500' : '#00FF00')
                .setFooter({ text: `${inserted} notification(s) envoyée(s) dans ${channel.name}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [resultEmbed] });

        } catch (error) {
            console.error('❌ Erreur update-matches:', error);
            await interaction.editReply(`❌ Erreur: ${error.message}`);
        }
    }
};

// ==========================================
// 🆕 TRAITER UN NOUVEAU MATCH (COPIE INDEX.JS)
// ==========================================
async function processNewMatch(player, matchId, channel, client) {
    // ✅ Vérifier si déjà traité (double sécurité)
    const existingMatch = db.prepare(
        `SELECT id FROM match_history WHERE match_id = ? AND player_id = ?`
    ).get(matchId, player.id);


    if (existingMatch) {
        console.log(`⏭️ Match ${matchId} déjà traité pour ${player.riot_id}`);
        return;
    }

    // 📥 RÉCUPÉRER LES DÉTAILS DU MATCH
    const matchResponse = await axios.get(
        `https://europe.api.riotgames.com/lol/match/v5/matches/${matchId}`,
        { headers: { "X-Riot-Token": RIOT_API_KEY } }
    );

    const match = matchResponse.data;
    const participant = match.info.participants.find(p => p.puuid === player.puuid);

    // Skip si pas soloQ
    if (match.info.queueId !== 420) return;

    // 📊 RÉCUPÉRER LE RANG ACTUEL
    const rankedResponse = await axios.get(
        `https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${player.puuid}`,
        { headers: { "X-Riot-Token": RIOT_API_KEY } }
    );

    const rankedData = rankedResponse.data.find(entry => entry.queueType === 'RANKED_SOLO_5x5');

    if (!rankedData) {
        console.log(`⚠️ Pas de données ranked pour ${player.riot_id}`);
        return;
    }

    const currentRank = `${rankedData.tier} ${rankedData.rank}`;
    const currentLP = rankedData.leaguePoints;

    // 📊 CALCULER LP AVANT/APRÈS
    const lpGain = participant.win ?
        (participant.lpGain !== undefined ? participant.lpGain : 20) :
        (participant.lpLoss !== undefined ? -participant.lpLoss : -20);

    const lpAfter = currentLP;
    const lpBefore = currentLP - lpGain;

    // 🎯 DÉDUIRE LE RANG AVANT
    let rankBefore = currentRank;

    if (participant.win && lpBefore < 0) {
        // Promotion détectée
        rankBefore = getPreviousRank(currentRank);
    } else if (!participant.win && lpAfter >= 100) {
        // Rétrogradation détectée
        rankBefore = getNextRank(currentRank);
    }

    const rankAfter = currentRank;

    // ✅ better-sqlite3
    db.prepare(`INSERT INTO match_history (
    player_id, match_id, champion_id, champion_name,
    kills, deaths, assists, win, lp_change,
    rank_before, rank_after, lp_before, lp_after,
    match_duration, game_creation
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
            player.id,
            matchId,
            participant.championId,
            participant.championName,
            participant.kills,
            participant.deaths,
            participant.assists,
            participant.win ? 1 : 0,
            lpGain,
            rankBefore,
            rankAfter,
            lpBefore,
            lpAfter,
            match.info.gameDuration,
            match.info.gameCreation
        );


    // 📢 NOTIFICATION DE MATCH (COMME INDEX.JS)
    const winEmoji = participant.win ? "🟢" : "🔴";
    const resultText = participant.win ? "VICTOIRE" : "DÉFAITE";
    const kda = `${participant.kills}/${participant.deaths}/${participant.assists}`;
    const lpText = lpGain > 0 ? `+${lpGain}` : `${lpGain}`;

    const matchEmbed = new EmbedBuilder()
        .setTitle(`${winEmoji} ${resultText}`)
        .setDescription(`**${player.riot_id}**`)
        .addFields(
            { name: "🎮 Champion", value: participant.championName, inline: true },
            { name: "⚔️ KDA", value: kda, inline: true },
            { name: "📊 LP", value: `${lpText} LP`, inline: true },
            { name: "🏆 Rang", value: `${getRankEmoji(rankAfter)} ${rankAfter} (${lpAfter} LP)`, inline: false }
        )
        .setColor(participant.win ? "#00FF00" : "#FF0000")
        .setTimestamp();

    await channel.send({ embeds: [matchEmbed] });

    // 🎯 VÉRIFIER CHANGEMENT DE RANG
    if (rankBefore !== rankAfter) {
        await sendRankChangeNotification(player, rankBefore, rankAfter, lpBefore, lpAfter, channel);
    }

    console.log(`✅ Match traité: ${player.riot_id} - ${matchId}`);
}

// 🆕 NOTIFICATION DE CHANGEMENT DE RANG
async function sendRankChangeNotification(player, oldRank, newRank, oldLP, newLP, channel) {
    const oldRankData = getRankOrder(oldRank, oldLP);
    const newRankData = getRankOrder(newRank, newLP);
    const rankUp = newRankData.totalScore > oldRankData.totalScore;

    // 🤡 EXCEPTION POUR LESAINTRAZMO
    if (player.riot_id === "LeSaintRazmo #KCORP" && newRank.toLowerCase().includes("silver")) {
        const trollEmbed = new EmbedBuilder()
            .setTitle("🤡 DISGRÂCE TOTALE")
            .setDescription(`**${player.riot_id}** vient de tomber en Silver... COMMENT C'EST POSSIBLE ?? 😂`)
            .addFields(
                { name: "Ancien rang", value: `${getRankEmoji(oldRank)} ${oldRank}`, inline: true },
                { name: "Nouveau rang", value: `🥈 ${newRank} (LA HONTE)`, inline: true },
                { name: "💬 Commentaire", value: "Comment on fait pour être si nul ? mdrr va la bas ton vieux heimer top là", inline: false }
            )
            .setColor("#8B4513")
            .setTimestamp();

        return await channel.send({ embeds: [trollEmbed] });
    }

    const embed = new EmbedBuilder()
        .setTitle(rankUp ? "📈 PROMOTION !" : "📉 RÉTROGRADATION")
        .setDescription(`**${player.riot_id}** a changé de rang !`)
        .addFields(
            { name: "Ancien rang", value: `${getRankEmoji(oldRank)} ${oldRank}`, inline: true },
            { name: "Nouveau rang", value: `${getRankEmoji(newRank)} ${newRank}`, inline: true }
        )
        .setColor(rankUp ? "#00FF00" : "#FF0000")
        .setTimestamp();

    await channel.send({ embeds: [embed] });
}

// 🔧 HELPERS POUR DÉDUCTION DE RANG
function getPreviousRank(currentRank) {
    const ranks = {
        'IRON IV': 'IRON IV',
        'IRON III': 'IRON IV',
        'IRON II': 'IRON III',
        'IRON I': 'IRON II',
        'BRONZE IV': 'IRON I',
        'BRONZE III': 'BRONZE IV',
        'BRONZE II': 'BRONZE III',
        'BRONZE I': 'BRONZE II',
        'SILVER IV': 'BRONZE I',
        'SILVER III': 'SILVER IV',
        'SILVER II': 'SILVER III',
        'SILVER I': 'SILVER II',
        'GOLD IV': 'SILVER I',
        'GOLD III': 'GOLD IV',
        'GOLD II': 'GOLD III',
        'GOLD I': 'GOLD II',
        'PLATINUM IV': 'GOLD I',
        'PLATINUM III': 'PLATINUM IV',
        'PLATINUM II': 'PLATINUM III',
        'PLATINUM I': 'PLATINUM II',
        'EMERALD IV': 'PLATINUM I',
        'EMERALD III': 'EMERALD IV',
        'EMERALD II': 'EMERALD III',
        'EMERALD I': 'EMERALD II',
        'DIAMOND IV': 'EMERALD I',
        'DIAMOND III': 'DIAMOND IV',
        'DIAMOND II': 'DIAMOND III',
        'DIAMOND I': 'DIAMOND II',
        'MASTER': 'DIAMOND I'
    };
    return ranks[currentRank] || currentRank;
}

function getNextRank(currentRank) {
    const ranks = {
        'IRON IV': 'IRON III',
        'IRON III': 'IRON II',
        'IRON II': 'IRON I',
        'IRON I': 'BRONZE IV',
        'BRONZE IV': 'BRONZE III',
        'BRONZE III': 'BRONZE II',
        'BRONZE II': 'BRONZE I',
        'BRONZE I': 'SILVER IV',
        'SILVER IV': 'SILVER III',
        'SILVER III': 'SILVER II',
        'SILVER II': 'SILVER I',
        'SILVER I': 'GOLD IV',
        'GOLD IV': 'GOLD III',
        'GOLD III': 'GOLD II',
        'GOLD II': 'GOLD I',
        'GOLD I': 'PLATINUM IV',
        'PLATINUM IV': 'PLATINUM III',
        'PLATINUM III': 'PLATINUM II',
        'PLATINUM II': 'PLATINUM I',
        'PLATINUM I': 'EMERALD IV',
        'EMERALD IV': 'EMERALD III',
        'EMERALD III': 'EMERALD II',
        'EMERALD II': 'EMERALD I',
        'EMERALD I': 'DIAMOND IV',
        'DIAMOND IV': 'DIAMOND III',
        'DIAMOND III': 'DIAMOND II',
        'DIAMOND II': 'DIAMOND I',
        'DIAMOND I': 'MASTER'
    };
    return ranks[currentRank] || currentRank;
}

// ⏱️ HELPER POUR ATTENDRE
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
