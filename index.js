//  dépendances
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getRankEmoji, getRankOrder } = require("./utils/rankUtils");
const cron = require('node-cron');
const logger = require('./utils/loggers');

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    SlashCommandBuilder,
    Routes,
    Collection,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js");

// Débug API KEY
console.log(
    "RIOT_API_KEY:",
    process.env.RIOT_API_KEY ? "Définie" : "MANQUANTE",
);
//console.log(" Longueur clé:", process.env.RIOT_API_KEY?.length);

const { REST } = require("@discordjs/rest");
const axios = require("axios");
const Database = require("better-sqlite3");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const RIOT_API_KEY = process.env.RIOT_API_KEY;

// global db:
const db = new Database("./players.db");
global.db = db;

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    rest: { timeout: 60000 }
});

// Chargement des commandes
client.commands = new Collection();

const commandsPath = path.join(__dirname, "commands");
//console.log(" Chemin des commandes:", commandsPath);

// Vérifiez si le dossier existe
if (!fs.existsSync(commandsPath)) {
    console.error("Le dossier commands n'existe pas !");
} else {
    console.log("Dossier commands trouvé");
}

const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith(".js"));
//console.log("Fichiers trouvés:", commandFiles);

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    //console.log("Tentative de chargement:", filePath);

    try {
        const command = require(filePath);
        //console.log(" Commande importée:", command);

        if ("data" in command && "execute" in command) {
            client.commands.set(command.data.name, command);
            //console.log(`Commande chargée: ${command.data.name}`);
        } else {
            console.log(` Structure invalide pour: ${file}`);
            console.log("   - data présent:", "data" in command);
            console.log("   - execute présent:", "execute" in command);
        }
    } catch (error) {
        console.error(` Erreur lors du chargement de ${file}:`, error);
    }
}

console.log(" Commandes finalement chargées:", client.commands.keys());
// Initialisation de la base de données (une seule fois)
// Table players
db.prepare(`
CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY,
    user_id TEXT,
    guild_id TEXT,
    channel_id TEXT,
    riot_id TEXT,
    puuid TEXT,
    last_match_id TEXT,
    last_lp INTEGER DEFAULT 0,
    last_rank TEXT DEFAULT '',
    last_update TEXT
)
`).run();


// Table user_links
db.prepare(`
CREATE TABLE IF NOT EXISTS user_links (
    user_id TEXT,
    guild_id TEXT,
    player_id INTEGER,
    PRIMARY KEY (user_id, guild_id),
    FOREIGN KEY (player_id) REFERENCES players(id)
)
`).run();


// Table match_history
db.prepare(`
CREATE TABLE IF NOT EXISTS match_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    match_id TEXT,
    champion_id INTEGER,
    champion_name TEXT,
    kills INTEGER,
    deaths INTEGER,
    assists INTEGER,
    win BOOLEAN,
    lp_change INTEGER,
    rank_before TEXT,
    rank_after TEXT,
    lp_before INTEGER,
    lp_after INTEGER,
    match_duration INTEGER,
    game_creation BIGINT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players (id),
    UNIQUE(player_id, match_id)
)
`).run();


async function deployCommands() {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    try {
        const commands = [];
        client.commands.forEach((command) => {
            commands.push(command.data.toJSON());
        });

        console.log(
            ` Déploiement sur ${client.guilds.cache.size} serveurs...`,
        );
        console.log(
            `Commandes à déployer: ${commands.map((c) => c.name).join(", ")}`,
        );

        for (const [guildId, guild] of client.guilds.cache) {
            console.log(`\n🎯 === ${guild.name} (${guildId}) ===`);
            console.log(
                `   ⏰ ${new Date().toLocaleTimeString()} - Début du déploiement`,
            );

            let success = false;
            let attempts = 0;
            const maxAttempts = 3;

            while (!success && attempts < maxAttempts) {
                attempts++;
                console.log(`   🔄 Tentative ${attempts}/${maxAttempts}...`);

                try {
                    // Déploiement avec timeout de 10 secondes
                    const deployPromise = rest.put(
                        Routes.applicationGuildCommands(CLIENT_ID, guildId),
                        { body: commands },
                    );

                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error("Timeout")), 10000),
                    );

                    const result = await Promise.race([
                        deployPromise,
                        timeoutPromise,
                    ]);

                    console.log(
                        `     SUCCÈS: ${result.length} commande(s) déployée(s)`,
                    );
                    success = true;
                } catch (error) {
                    console.error(`    Tentative ${attempts} échouée:`);

                    if (error.message === "Timeout") {
                        console.error(
                            `        TIMEOUT - Discord ne répond pas`,
                        );
                    } else if (error.status === 429) {
                        console.error(`        RATE LIMITED - Attente...`);
                        await new Promise((resolve) =>
                            setTimeout(resolve, 5000),
                        );
                    } else {
                        console.error(`      ${error.message || error}`);
                    }

                    if (attempts < maxAttempts) {
                        console.log(`     Retry dans 3 secondes...`);
                        await new Promise((resolve) =>
                            setTimeout(resolve, 3000),
                        );
                    }
                }
            }

            if (!success) {
                console.error(`     ÉCHEC TOTAL pour ${guild.name}`);
            }

            // Pause entre serveurs
            console.log(`    Pause de 2 secondes...`);
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        console.log("\n  Processus de déploiement terminé !");
    } catch (error) {
        console.error("  Erreur générale:", error);
    }
}

client.once("ready", async () => {
    console.log(`  ${client.user.tag} est connecté !`);

    //  DÉTAILS DES SERVEURS
    console.log(`  Nombre total de serveurs: ${client.guilds.cache.size}`);

    client.guilds.cache.forEach((guild) => {
        console.log(
            `   - ${guild.name} (ID: ${guild.id}) - ${guild.memberCount} membres`,
        );
    });

    // Puis déployer
    await deployCommands();

    console.log("🔍 Démarrage du monitoring...");
    checkAllPlayers()
    setInterval(checkAllPlayers, 2 * 60 * 1000);
});

// Déploiement automatique sur les nouveaux serveurs
client.on("guildCreate", async (guild) => {
    console.log(`  Nouveau serveur: ${guild.name}`);

    const rest = new REST({ version: "10" }).setToken(TOKEN);
    const commands = [];

    client.commands.forEach((command) => {
        commands.push(command.data.toJSON());
    });

    try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guild.id), {
            body: commands,
        });
        console.log(
            `  Commandes déployées sur le nouveau serveur: ${guild.name}`,
        );
    } catch (error) {
        console.error(
            `  Erreur déploiement sur ${guild.name}:`,
            error.message,
        );
    }
});


//==============================
// BOUTONS INTERACTIFS UNIFIÉS
//==============================

client.on("interactionCreate", async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`  Erreur commande: ${error.message}`);
        }
    }

    //  GESTION DES BOUTONS OPTIMISÉE
    else if (interaction.isButton()) {
        try {
            // Vérification de sécurité AVANT defer
            if (interaction.replied || interaction.deferred) {
                console.log("  Interaction déjà traitée, on ignore");
                return;
            }

            //  BOUTON GRAPHIQUE LP
            if (interaction.customId.startsWith('lp_chart_')) {
                const playerId = interaction.customId.split('_')[2];

                try {
                    await interaction.deferReply();
                    console.log('  deferReply OK');

                    const { generateLPGraph } = require('./utils/graphUtils');
                    console.log('  Génération graphique pour:', playerId);
                    const imageBuffer = await generateLPGraph(playerId);
                    console.log('  Buffer généré, taille:', imageBuffer.length);

                    const player = db.prepare(`SELECT * FROM players WHERE id = ?`).get(playerId);
                    console.log('  Player trouvé:', player?.riot_id ?? '  NULL');

                    if (!player) throw new Error(`Joueur introuvable en BDD (id: ${playerId})`);

                    const attachment = new AttachmentBuilder(imageBuffer, { name: 'rank-evolution.jpg' });

                    const chartEmbed = new EmbedBuilder()
                        .setTitle('📊 Évolution du Rang')
                        .setDescription(`Graphique d'évolution du rang pour **${player.riot_id}**`)
                        .setImage('attachment://rank-evolution.jpg')
                        .setColor(0x00ff88);

                    console.log('  Envoi editReply...');
                    await interaction.editReply({
                        embeds: [chartEmbed],
                        files: [attachment]
                    });
                    console.log('  editReply OK');

                } catch (error) {
                    console.error('  Erreur graphique:', error);
                    try {
                        await interaction.editReply({
                            content: `  Erreur lors de la génération du graphique: ${error.message}`,
                        });
                    } catch (e) {
                        console.error('  editReply échoué aussi:', e.message);
                    }
                }
            }

            // BOUTTON MODAL APRES GAME
            else if (interaction.customId.startsWith("stats|")) {
                await interaction.deferReply({ ephemeral: true });

                const parts = interaction.customId.split("|");
                const matchId = parts[1];
                const puuid = parts[2];

                logger.info('BUTTON', `Stats détaillées demandées`, {
                    matchId,
                    cacheHit: matchCache.has(matchId),
                    user: interaction.user.tag
                });

                const matchInfo = matchCache.get(matchId);
                if (!matchInfo) {
                    await interaction.editReply({
                        content: "Les données du match ont expiré (2 jours max enfin j'crois). Désolé !",
                    });
                    return;
                }

                let timeline = null;
                try {
                    const timelineResponse = await axios.get(
                        `https://europe.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`,
                        { headers: { "X-Riot-Token": RIOT_API_KEY } },
                    );
                    timeline = timelineResponse.data;
                } catch (error) {
                    logger.error('API', `Erreur récupération timeline`, {
                        matchId,
                        message: error.message
                    });
                }

                const embed = buildDetailedStatsEmbed(matchInfo, puuid, timeline, interaction.user.tag);

                const shareButton = new ButtonBuilder()
                    .setCustomId(`share|${matchId}|${puuid}`)
                    .setLabel("📢 Envoyer à tout le monde")
                    .setStyle(ButtonStyle.Primary);

                const row = new ActionRowBuilder().addComponents(shareButton);

                await interaction.editReply({ embeds: [embed], components: [row] });
            }


            // handler pour le bouton "Envoyer à tout le monde"
            else if (interaction.customId.startsWith("share|")) {
                await interaction.deferReply({ ephemeral: false }); //  visible par tous

                const parts = interaction.customId.split("|");
                const matchId = parts[1];
                const puuid = parts[2];

                const matchInfo = matchCache.get(matchId);
                if (!matchInfo) {
                    await interaction.editReply({
                        content: "❌ Les données du match ont expiré (2 jours max enfin j'crois). Désolé !",
                    });
                    return;
                }

                let timeline = null;
                try {
                    const timelineResponse = await axios.get(
                        `https://europe.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`,
                        { headers: { "X-Riot-Token": RIOT_API_KEY } },
                    );
                    timeline = timelineResponse.data;
                } catch (error) {
                    console.error("  Erreur timeline:", error.message);
                }

                const embed = buildDetailedStatsEmbed(matchInfo, puuid, timeline, interaction.user.tag); // 👈 on passe le user
                await interaction.editReply({ embeds: [embed] });
            }



            // BOUTON HISTORIQUE MATCHS - VERSION MODAL
            else if (interaction.customId.startsWith('match_history_')) {
                const playerId = interaction.customId.split('_')[2];

                //  CRÉER LE MODAL POUR CHOISIR LE NOMBRE DE MATCHS
                const modal = new ModalBuilder()
                    .setCustomId(`history_modal_${playerId}`)
                    .setTitle('📜 Historique des matchs');

                const matchCountInput = new TextInputBuilder()
                    .setCustomId('match_count')
                    .setLabel('Nombre de matchs à afficher (1-25)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('5')
                    .setValue('5')
                    .setMinLength(1)
                    .setMaxLength(2)
                    .setRequired(false);

                const firstActionRow = new ActionRowBuilder().addComponents(matchCountInput);
                modal.addComponents(firstActionRow);

                await interaction.showModal(modal);
            }

            //  BOUTON REFRESH
            else if (interaction.customId === "refresh_stats") {
                await interaction.deferReply({ flags: 64 });
                await interaction.followUp({
                    content: "🔄 **Cache actualisé !**\nRelance `/stats` pour voir les nouvelles données.",
                    flags: 64
                });
            }

            //  BOUTON COMPARE
            else if (interaction.customId === "compare_rank") {
                await interaction.deferReply({ flags: 64 });
                await interaction.followUp({
                    content: "🏆 **Comparaison à venir !**",
                    flags: 64
                });
            }

            //  BOUTON NON RECONNU
            else {
                await interaction.deferReply({ flags: 64 });
                await interaction.followUp({
                    content: `❓ Bouton non reconnu: ${interaction.customId}`,
                    flags: 64
                });
            }

        } catch (error) {
            console.error(`  Erreur bouton (${interaction.customId}):`, error);

            // Gestion d'erreur sans double acknowledgment
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: "  Erreur survenue", flags: 64 });
                } else if (interaction.deferred && !interaction.replied) {
                    await interaction.followUp({ content: "  Erreur survenue", flags: 64 });
                }
            } catch (finalError) {
                console.error(" Impossible de gérer l'erreur finale:", finalError.message);
            }
        }
    }

    //  GESTION DES MODALS 
    else if (interaction.isModalSubmit()) {
        try {
            if (interaction.customId.startsWith('history_modal_')) {
                const playerId = interaction.customId.split('_')[2];
                let matchCount = parseInt(interaction.fields.getTextInputValue('match_count')) || 5;
                let isOverLimit = false;

                //  LIMITER À 25 MATCHS MAXIMUM
                if (matchCount > 25) {
                    isOverLimit = true;
                    await interaction.reply({
                        content: `⚠️ **Limite dépassée !**\nVous avez demandé **${matchCount} matchs** mais la limite est de **25 matchs maximum**.\nAffichage de 25 matchs.`,
                        ephemeral: true
                    });
                    matchCount = 25; // On limite à 25
                } else if (matchCount < 1) {
                    matchCount = 5; // Valeur par défaut si nombre invalide
                    await interaction.deferReply(); // Defer normal
                } else {
                    await interaction.deferReply(); // Defer normal
                }

                //  UTILISER TES FONCTIONS EXISTANTES
                const { getPlayerById, getPlayerMatches, createHistoryEmbedWithColors } = require('./utils/historyUtils');

                const player = await getPlayerById(playerId);
                if (!player) {
                    const content = `  Joueur introuvable (ID: ${playerId}).`;
                    return isOverLimit ?
                        await interaction.followUp({ content, ephemeral: true }) :
                        await interaction.editReply(content);
                }

                const matches = await getPlayerMatches(playerId, matchCount);
                if (!matches || matches.length === 0) {
                    const content = `  Aucun historique trouvé pour **${player.riot_id}**.`;
                    return isOverLimit ?
                        await interaction.followUp({ content, ephemeral: true }) :
                        await interaction.editReply(content);
                }

                //  CRÉER L'EMBED AVEC COULEUR DYNAMIQUE
                const embed = createHistoryEmbedWithColors(player, matches, matchCount);

                //  BOUTONS POUR MODIFIER ET GRAPHIQUE
                const actionRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`match_history_${playerId}`)
                            .setLabel('🔄 Modifier')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId(`lp_chart_${playerId}`)
                            .setLabel('📊 Graphique')
                            .setStyle(ButtonStyle.Primary)
                    );

                const replyData = {
                    embeds: [embed],
                    components: [actionRow]
                };

                // RÉPONSE SELON LE TYPE D'INTERACTION
                if (isOverLimit) {
                    await interaction.followUp(replyData); // Follow-up après le message d'avertissement
                } else {
                    await interaction.editReply(replyData); // Reply normale
                }
            }

        } catch (error) {
            console.error(`  Erreur historique:`, error);
            const content = `  Erreur lors de la récupération de l'historique.`;

            try {
                if (interaction.replied) {
                    await interaction.followUp({ content, ephemeral: true });
                } else if (interaction.deferred) {
                    await interaction.editReply(content);
                } else {
                    await interaction.reply({ content, ephemeral: true });
                }
            } catch (finalError) {
                console.error("  Erreur finale:", finalError);
            }
        }
    }
});




//==============================
// MONITORING AUTOMATIQUE
//==============================


// FONCTION PRINCIPALE DE MONITORING
async function checkAllPlayers() {
    logger.info('MONITOR', `Début de la vérification des nouveaux matchs`, {
        timestamp: new Date().toISOString()
    });

    const rows = global.db.prepare(`SELECT * FROM players`).all();

    if (!rows?.length) {
        logger.info('MONITOR', `Aucun joueur à surveiller`);
        return;
    }

    logger.info('MONITOR', `${rows.length} joueur(s) à vérifier`);

    let success = 0;
    let errors = 0;

    for (const player of rows) {
        try {
            await checkPlayerNewMatches(player);
            success++;
        } catch (error) {
            errors++;
            logger.error('MONITOR', `Erreur monitoring pour ${player.riot_id}`, {
                error: error.message,
                playerId: player.id,
                guild: player.guild_id,
                status: error.response?.status ?? null
            });
        }
    }

    logger.info('MONITOR', `Vérification terminée`, {
        total: rows.length,
        success,
        errors
    });
}


const matchCache = new Map();

function setMatchCache(matchId, matchInfo) {
    matchCache.set(matchId, matchInfo);
    logger.info('CACHE', `Cache set pour matchId: "${matchId}" | Taille: ${matchCache.size}`);

    setTimeout(() => {
        matchCache.delete(matchId);
        logger.info('CACHE', `Cache nettoyé pour ${matchId}`);
    }, 2880 * 60 * 1000);
}


const timelineCache = new Map();

function setTimelineCache(matchId, timeline) {
    timelineCache.set(matchId, timeline);
    logger.info('CACHE', `Timeline cache set pour matchId: "${matchId}"`);
    setTimeout(() => {
        timelineCache.delete(matchId);
        logger.info('CACHE', `Timeline cache nettoyé pour ${matchId}`);
    }, 2880 * 60 * 1000);
}




async function checkPlayerNewMatches(player) {
    try {
        const matchesResponse = await axios.get(
            `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${player.puuid}/ids?queue=420&count=5`,
            { headers: { "X-Riot-Token": RIOT_API_KEY } },
        );

        const matchIds = matchesResponse.data;
        if (!matchIds?.length) return;

        const newMatchIds = [];
        for (const matchId of matchIds) {
            if (matchId === player.last_match_id) break;
            newMatchIds.push(matchId);
        }

        if (newMatchIds.length === 0) return;

        logger.info('MONITOR', `${newMatchIds.length} nouveau(x) match(s) pour ${player.riot_id}`, {
            matches: newMatchIds
        });

        // Du plus ancien au plus récent
        for (const matchId of newMatchIds.reverse()) {
            await processNewMatch(player, matchId);

            // Recharger le player depuis la BDD après chaque match
            // pour avoir le bon last_lp / last_rank pour le match suivant
            player = db.prepare(`SELECT * FROM players WHERE id = ?`).get(player.id);
        }

    } catch (error) {
        logger.error('MONITOR', `Erreur vérification ${player.riot_id}`, {
            message: error.message
        });
    }
}




function buildDetailedStatsEmbed(matchInfo, puuid, timeline = null, userTag) {
    const participants = matchInfo.participants;

    const player = participants.find(p => p.puuid === puuid);
    const allyTeamId = player.teamId;
    const allies = participants.filter(p => p.teamId === allyTeamId);
    const enemies = participants.filter(p => p.teamId !== allyTeamId);
    const opponent = enemies.find(p => p.teamPosition === player.teamPosition) || enemies[0];

    const role = player.teamPosition; // TOP | JUNGLE | MIDDLE | BOTTOM | UTILITY

    const fmt = (n) => n?.toLocaleString("fr-FR") ?? "N/A";
    const diff = (a, b) => {
        const d = a - b;
        return d > 0 ? `+${fmt(d)}` : `${fmt(d)}`;
    };
    const arrow = (a, b) => a > b ? "🟢" : a < b ? "🔴" : "⚪";

    // ── Tableau équipes ──
    const roleEmoji = {
        TOP: "🗡️", JUNGLE: "🌿", MIDDLE: "🔮",
        BOTTOM: "🏹", UTILITY: "🛡️"
    };

    const playerLine = (p) => {
        const kda = p.deaths === 0
            ? "Perfect"
            : ((p.kills + p.assists) / p.deaths).toFixed(2);
        const r = roleEmoji[p.teamPosition] || "❓";
        const cs = p.totalMinionsKilled + p.neutralMinionsKilled;
        const highlight = p.puuid === puuid ? "▶ " : "   ";
        return `${highlight}${r} **${p.championName}** ${p.kills}/${p.deaths}/${p.assists} | ${fmt(cs)} CS | ${fmt(p.totalDamageDealtToChampions)} dmg`;
    };

    const alliesText = allies.map(playerLine).join("\n");
    const enemiesText = enemies.map(playerLine).join("\n");

    // ── CS total ──
    const playerCs = player.totalMinionsKilled + player.neutralMinionsKilled;
    const opponentCs = opponent.totalMinionsKilled + opponent.neutralMinionsKilled;

    // ── Timeline @15 ──
    let goldDiff15 = null;
    let csDiff15 = null;
    let playerAssists15 = null;
    let opponentAssists15 = null;

    if (timeline) {
        const frame15 = timeline.info.frames[15];
        if (frame15) {
            const playerParticipantId = participants.indexOf(player) + 1;
            const opponentParticipantId = participants.indexOf(opponent) + 1;

            const playerFrame = frame15.participantFrames[playerParticipantId];
            const opponentFrame = frame15.participantFrames[opponentParticipantId];

            const playerGold15 = playerFrame?.totalGold ?? 0;
            const opponentGold15 = opponentFrame?.totalGold ?? 0;
            goldDiff15 = playerGold15 - opponentGold15;

            const playerCs15 = (playerFrame?.minionsKilled ?? 0) + (playerFrame?.jungleMinionsKilled ?? 0);
            const opponentCs15 = (opponentFrame?.minionsKilled ?? 0) + (opponentFrame?.jungleMinionsKilled ?? 0);
            csDiff15 = playerCs15 - opponentCs15;

            // Assists @15 via les events (pour support)
            if (role === "UTILITY") {
                let pAssists = 0;
                let oAssists = 0;
                for (let i = 0; i <= 15; i++) {
                    const frame = timeline.info.frames[i];
                    if (!frame) continue;
                    for (const event of frame.events) {
                        if (event.type === "CHAMPION_KILL") {
                            if (event.assistingParticipantIds?.includes(playerParticipantId)) pAssists++;
                            if (event.assistingParticipantIds?.includes(opponentParticipantId)) oAssists++;
                        }
                    }
                }
                playerAssists15 = pAssists;
                opponentAssists15 = oAssists;
            }
        }
    }

    // ── Construction des stats selon le rôle ──
    const stats = [];

    // Stats communes à tous les rôles
    stats.push(`💰 Gold : ${arrow(player.goldEarned, opponent.goldEarned)} **${diff(player.goldEarned, opponent.goldEarned)}**`);
    stats.push(
        goldDiff15 !== null
            ? `⏱️ Gold diff @15 : ${arrow(goldDiff15, 0)} **${goldDiff15 > 0 ? "+" : ""}${fmt(goldDiff15)}**`
            : `⏱️ Gold diff @15 : ⚪ **N/A**`
    );
    stats.push(`💥 Dégâts : ${arrow(player.totalDamageDealtToChampions, opponent.totalDamageDealtToChampions)} **${diff(player.totalDamageDealtToChampions, opponent.totalDamageDealtToChampions)}**`);
    stats.push(`👁️ Vision : ${arrow(player.visionScore, opponent.visionScore)} **${diff(player.visionScore, opponent.visionScore)}** (${player.visionScore} vs ${opponent.visionScore})`);

    // ── Stats spécifiques par rôle ──
    if (role === "JUNGLE") {
        stats.push(
            csDiff15 !== null
                ? `🌿 CS diff @15 : ${arrow(csDiff15, 0)} **${csDiff15 > 0 ? "+" : ""}${fmt(csDiff15)}**`
                : `🌿 CS diff @15 : ⚪ **N/A**`
        );
        stats.push(`🗺️ CS total : ${arrow(playerCs, opponentCs)} **${diff(playerCs, opponentCs)}**`);

        const pJungleKills = player.challenges?.killsOnOtherLanesEarlyJungleAsJungler ?? 0;
        const oJungleKills = opponent.challenges?.killsOnOtherLanesEarlyJungleAsJungler ?? 0;
        stats.push(`🎯 Kills early autres lanes : ${arrow(pJungleKills, oJungleKills)} **${pJungleKills}** vs **${oJungleKills}**`);

    } else if (role === "UTILITY") {
        stats.push(`👁️ Wards kill : ${arrow(player.wardsKilled, opponent.wardsKilled)} **${player.wardsKilled}** vs **${opponent.wardsKilled}**`);

        stats.push(
            playerAssists15 !== null
                ? `🤝 Assists @15 : ${arrow(playerAssists15, opponentAssists15)} **${playerAssists15}** vs **${opponentAssists15}**`
                : `🤝 Assists @15 : ⚪ **N/A**`
        );

    } else {
        // TOP / MIDDLE / BOTTOM
        stats.push(
            csDiff15 !== null
                ? `🌾 CS diff @15 : ${arrow(csDiff15, 0)} **${csDiff15 > 0 ? "+" : ""}${fmt(csDiff15)}**`
                : `🌾 CS diff @15 : ⚪ **N/A**`
        );
        stats.push(`⚔️ CS total : ${arrow(playerCs, opponentCs)} **${diff(playerCs, opponentCs)}**`);

        // Je retire cette statistiques de l'affichage car depuis la nouvelle saison c'est plus du tt représentatif

        // const pPlates = player.challenges?.turretPlatesTaken ?? 0;
        // const oPlates = opponent.challenges?.turretPlatesTaken ?? 0;
        // stats.push(`🏰 Plaques : ${arrow(pPlates, oPlates)} **${pPlates}** vs **${oPlates}**`);

        // Solo kills uniquement pour TOP / MIDDLE
        if (role === "TOP" || role === "MIDDLE") {
            const pSolo = player.challenges?.soloKills ?? 0;
            const oSolo = opponent.challenges?.soloKills ?? 0;
            stats.push(`🗡️ Solo kills : ${arrow(pSolo, oSolo)} **${pSolo}** vs **${oSolo}**`);
        }
    }

    const diffText = stats.join("\n");

    return new EmbedBuilder()
        .setTitle("📊 Stats détaillées de la partie")
        .setColor(player.win ? 0x00ff00 : 0xff0000)
        .addFields(
            {
                name: "🟦 Équipe alliée",
                value: alliesText || "N/A",
                inline: false,
            },
            {
                name: "🟥 Équipe ennemie",
                value: enemiesText || "N/A",
                inline: false,
            },
            {
                name: `⚖️ Toi vs ${opponent.championName}`,
                value: diffText,
                inline: false,
            }
        )
        .setFooter({ text: `Durée : ${Math.floor(matchInfo.gameDuration / 60)}min${userTag ? ` • Demandé par ${userTag}` : ""}` })
        .setTimestamp();
}



// FONCTION DE NOTIFICATION DE RANG
async function sendRankChangeNotification(
    player,
    oldRank,
    newRank,
    oldLP,
    newLP,
    channel,
) {
    const oldRankData = getRankOrder(oldRank, oldLP);
    const newRankData = getRankOrder(newRank, newLP);
    const rankUp = newRankData.totalScore > oldRankData.totalScore;

    //  EXCEPTION POUR LESAINTRAZMO (fonctionnalité à venir)
    if (
        player.riot_id === "LeSaintRazmo #KCORP" &&
        newRank.toLowerCase().includes("silver")
    ) {
        const trollEmbed = new EmbedBuilder()
            .setTitle("🤡 DISGRÂCE ABSOLUE ! 🤡")
            .setDescription(
                "**LeSaintRazmo** est tomber en silver 💀 <@414354252236849172> <@276441631723356161> <@396012679996637184>",
            )
            .addFields(
                {
                    name: "😭 Ancien rang",
                    value: `${getRankEmoji(oldRank)} ${oldRank}`,
                    inline: true,
                },
                {
                    name: "🗑️ Nouveau rang",
                    value: `${getRankEmoji(newRank)} ${newRank}`,
                    inline: true,
                },
                {
                    name: "💬 Commentaire",
                    value: "Comment on fait pour être si nul ? mdrr va la bas ton vieux heimer top là",
                    inline: false,
                },
            )
            .setColor("#8B4513") // Marron pour la honte
            .setImage("https://tenor.com/fr/view/m-gif-8189626666123261652.gif") // GIF optionnel
            .setTimestamp();

        return await channel.send({ embeds: [trollEmbed] });
    }

    const embed = new EmbedBuilder()
        .setTitle(rankUp ? "📈 PROMOTION !" : "📉 RÉTROGRADATION")
        .setDescription(`**${player.riot_id}** a changé de rang !`)
        .addFields(
            {
                name: "Ancien rang",
                value: `${getRankEmoji(oldRank)} ${oldRank}`,
                inline: true,
            },
            {
                name: "Nouveau rang",
                value: `${getRankEmoji(newRank)} ${newRank}`,
                inline: true,
            },
        )
        .setColor(rankUp ? "#00FF00" : "#FF0000")
        .setTimestamp();

    await channel.send({ embeds: [embed] });
}

//  FONCTION POUR CALCULER LES VRAIS CHANGEMENTS DE LP
function calculateLPChange(oldRank, oldLP, newRank, newLP) {
    // Si même rang : calcul normal
    if (oldRank === newRank) {
        return newLP - oldLP;
    }

    // Si changement de rang : détecter promo/rétro
    const oldRankData = getRankOrder(oldRank, oldLP);
    const newRankData = getRankOrder(newRank, newLP);

    if (newRankData.totalScore > oldRankData.totalScore) {
        //  PROMOTION
        const lpToPromo = 100 - oldLP;
        return lpToPromo + newLP;
    } else if (newRankData.totalScore < oldRankData.totalScore) {
        //  RÉTROGRADATION
        const lpLostToZero = oldLP;
        const lpLostFromDemotion = 100 - newLP;
        return -(lpLostToZero + lpLostFromDemotion);
    }

    return 0;
}

async function processNewMatch(player, matchId) {
    try {
        // Vérifier doublon
        const existingMatch = db.prepare(
            `SELECT id FROM match_history WHERE match_id = ? AND player_id = ?`
        ).get(matchId, player.id);

        if (existingMatch) {
            logger.info('MONITOR', `Match ${matchId} déjà en BDD pour ${player.riot_id}`);
            return;
        }

        // Récupérer les détails du match
        const matchResponse = await axios.get(
            `https://europe.api.riotgames.com/lol/match/v5/matches/${matchId}`,
            { headers: { "X-Riot-Token": RIOT_API_KEY } },
        );
        const match = matchResponse.data;

        // Skip AVANT les autres requêtes API si pas soloQ
        if (match.info.queueId !== 420) {
            logger.info('MONITOR', `Match ${matchId} ignoré (pas soloQ, queueId: ${match.info.queueId})`);
            // Mettre à jour last_match_id quand même pour ne pas re-checker ce match
            db.prepare(`UPDATE players SET last_match_id = ? WHERE id = ?`).run(matchId, player.id);
            return;
        }

        const participant = match.info.participants.find(p => p.puuid === player.puuid);
        if (!participant) {
            logger.error('MONITOR', `Participant introuvable dans le match ${matchId}`);
            return;
        }

        // Timeline fetch lazy (mise en cache uniquement, pas bloquante)
        setMatchCache(matchId, match.info);
        fetchAndCacheTimeline(matchId); // fire & forget

        // Récupérer le rang actuel
        const rankedResponse = await axios.get(
            `https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${player.puuid}`,
            { headers: { "X-Riot-Token": RIOT_API_KEY } },
        );

        const rankedData = rankedResponse.data.find(
            entry => entry.queueType === "RANKED_SOLO_5x5"
        );
        const currentLP = rankedData?.leaguePoints ?? 0;
        const currentRank = rankedData ? `${rankedData.tier} ${rankedData.rank}` : "UNRANKED";

        const oldLP = player.last_lp || 0;
        const oldRank = player.last_rank || "UNRANKED";

        const lpChange = calculateLPChange(oldRank, oldLP, currentRank, currentLP);
        const lpChangeText = lpChange > 0 ? `+${lpChange} LP` : `${lpChange} LP`;

        // INSERT sans try/catch interne — on laisse remonter l'erreur
        db.prepare(`
            INSERT INTO match_history (
                player_id, match_id, champion_id, champion_name,
                kills, deaths, assists, win, lp_change,
                rank_before, rank_after, lp_before, lp_after,
                match_duration, game_creation
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            player.id, matchId,
            participant.championId, participant.championName,
            participant.kills, participant.deaths, participant.assists,
            participant.win ? 1 : 0,
            lpChange,
            oldRank, currentRank,
            oldLP, currentLP,
            match.info.gameDuration,
            match.info.gameCreation
        );

        logger.info('MONITOR', `Match ${matchId} stocké pour ${player.riot_id}`);

        // Construire et envoyer l'embed
        const riotIdFormatted = player.riot_id.replace("#", "-").replace(/ /g, "%20");
        const clickablePlayerName = `[**${player.riot_id}**](https://dpm.lol/${riotIdFormatted})`;
        const rankChange = player.last_rank !== currentRank
            ? `\n🏆 **${player.last_rank}** → **${currentRank}**`
            : "";

        const embed = new EmbedBuilder()
            .setTitle(participant.win ? "🟢 VICTOIRE" : "🔴 DÉFAITE")
            .setDescription(`${clickablePlayerName} vient de finir une partie !`)
            .setColor(participant.win ? 0x00ff00 : 0xff0000)
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
                    value: `${Math.floor(match.info.gameDuration / 60)}min`,
                    inline: true,
                },
            )
            .setTimestamp()
            .setFooter({ text: `Match ID: ${matchId}` });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`stats|${matchId}|${player.puuid}`)
                .setLabel("📊 Stats détaillées")
                .setStyle(ButtonStyle.Secondary)
        );

        const channel = await client.channels.fetch(player.channel_id);
        await channel.send({ embeds: [embed], components: [row] });

        // Notification changement de rang
        if (player.last_rank && player.last_rank !== currentRank) {
            await sendRankChangeNotification(player, player.last_rank, currentRank, oldLP, currentLP, channel);
        }

        // UPDATE BDD en dernier, seulement si tout s'est bien passé
        db.prepare(`
            UPDATE players 
            SET last_match_id = ?, last_lp = ?, last_rank = ?, last_update = ?
            WHERE id = ?
        `).run(matchId, currentLP, currentRank, Date.now(), player.id);

        logger.info('MONITOR', `Traitement complet pour ${player.riot_id}`, {
            match: matchId, rank: currentRank, lp: currentLP, lpChange
        });

    } catch (error) {
        logger.error('MONITOR', `Erreur processNewMatch pour ${player.riot_id}`, {
            matchId,
            message: error.message,
            status: error.response?.status ?? null
        });
        throw error;
    }
}

// Fonction séparée pour fetch la timeline en arrière-plan
async function fetchAndCacheTimeline(matchId) {
    try {
        const timelineResponse = await axios.get(
            `https://europe.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`,
            { headers: { "X-Riot-Token": RIOT_API_KEY } },
        );
        setTimelineCache(matchId, timelineResponse.data);
        logger.info('MONITOR', `Timeline cachée pour ${matchId}`);
    } catch (error) {
        logger.warn('MONITOR', `Échec cache timeline pour ${matchId}`, { message: error.message });
    }
}



//=================================
//        RECAP HEBDO
//=================================

const { sendWeeklyRecap } = require('./utils/weeklyRecap');

// Programmer le récap automatique
cron.schedule('0 18 * * 5', () => {
    sendWeeklyRecap(client);
}, {
    timezone: "Europe/Paris"
});


//=================================
//  CHECK API (plz send key :( )
//=================================

// Test de la clé API
async function testRiotAPI() {
    let status = false;
    try {
        const response = await axios.get(
            "https://euw1.api.riotgames.com/lol/status/v4/platform-data",
            { headers: { "X-Riot-Token": process.env.RIOT_API_KEY } },
        );
        logger.info('API', `Riot API OK`, { status: response.status });
        status = true;
    } catch (error) {
        logger.error('API', `Riot API KO`, { status: error.response?.status });
        if (error.response?.status === 403) {
            logger.error('API', `Clé expirée ou invalide - Va régénérer sur developer.riotgames.com`);
        }
    }

    if (status === false) {
        try {
            const user = await client.users.fetch('414354252236849172');
            await user.send('**API RIOT DOWN** - La clé API ne fonctionne plus !');
            logger.info('API', `MP d'alerte envoyé`);
        } catch (error) {
            logger.error('API', `Erreur envoi MP alerte`, { message: error.message });
        }
    }

    return status;
}


// Appelle ça au démarrage
testRiotAPI();

//  Programmer le check toutes les 30 minutes 
setInterval(async () => {
    console.log('🔍 Vérification automatique de l\'API Riot...');
    await testRiotAPI();
}, 30 * 60 * 1000); // 30 minutes
//console.log(' Check automatique de l\'API programmé toutes les 30 minutes');

client.login(TOKEN);
