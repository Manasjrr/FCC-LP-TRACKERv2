const { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { generateLPGraph } = require("../utils/graphUtils");
const { getPlayerById, getPlayerMatches, createHistoryEmbedWithColors } = require("../utils/historyUtils");
const { buildDetailedStatsEmbed } = require("../embeds/detailedStatsEmbed");
const { getMatch, getTimeline } = require("../services/riotApiService");
const matchCache = require("../cache/matchCache");
const logger = require("../utils/loggers");

// ─── Router principal ─────────────────────────────────────────────────────────
async function handleInteraction(interaction) {
    if (interaction.isChatInputCommand()) {
        return handleCommand(interaction);
    }
    if (interaction.isButton()) {
        return handleButton(interaction);
    }
    if (interaction.isModalSubmit()) {
        return handleModal(interaction);
    }
}

// ─── Commandes slash ──────────────────────────────────────────────────────────
async function handleCommand(interaction) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        logger.error("HANDLER", `Erreur commande /${interaction.commandName}`, {
            error: error.message,
        });
    }
}

// ─── Boutons ──────────────────────────────────────────────────────────────────
async function handleButton(interaction) {
    if (interaction.replied || interaction.deferred) return;

    try {
        const { customId } = interaction;

        // Graphique LP
        if (customId.startsWith("lp_chart_")) {
            return handleLPChart(interaction);
        }

        // Historique matchs
        if (customId.startsWith("match_history_")) {
            return handleMatchHistoryButton(interaction);
        }

        // Stats détaillées
        if (customId.startsWith("stats|")) {
            return handleDetailedStats(interaction);
        }

        // Partager stats
        if (customId.startsWith("share|")) {
            return handleShare(interaction);
        }

        // Refresh
        if (customId === "refresh_stats") {
            await interaction.deferReply({ flags: 64 });
            return interaction.followUp({
                content: "🔄 **Cache actualisé !**\nRelance `/stats` pour voir les nouvelles données.",
                flags: 64,
            });
        }

        // Comparer
        if (customId === "compare_rank") {
            await interaction.deferReply({ flags: 64 });
            return interaction.followUp({
                content: "🏆 **Comparaison à venir !**",
                flags: 64,
            });
        }

        // Inconnu
        await interaction.deferReply({ flags: 64 });
        return interaction.followUp({
            content: `❓ Bouton non reconnu : ${customId}`,
            flags: 64,
        });

    } catch (error) {
        logger.error("HANDLER", `Erreur bouton (${interaction.customId})`, {
            error: error.message,
        });
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: "❌ Erreur survenue", flags: 64 });
            } else {
                await interaction.followUp({ content: "❌ Erreur survenue", flags: 64 });
            }
        } catch (e) {
            logger.error("HANDLER", "Erreur finale bouton", { error: e.message });
        }
    }
}

// ─── Graphique LP ─────────────────────────────────────────────────────────────
async function handleLPChart(interaction) {
    const playerId = interaction.customId.split("_")[2];
    await interaction.deferReply();

    try {
        const imageBuffer = await generateLPGraph(playerId);
        const player = global.db.prepare(`SELECT * FROM players WHERE id = ?`).get(playerId);

        if (!player) throw new Error(`Joueur introuvable (id: ${playerId})`);

        const attachment = new AttachmentBuilder(imageBuffer, { name: "rank-evolution.jpg" });
        const embed = new EmbedBuilder()
            .setTitle("📊 Évolution du Rang")
            .setDescription(`Graphique d'évolution pour **${player.riot_id}**`)
            .setImage("attachment://rank-evolution.jpg")
            .setColor(0x00ff88);

        await interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (error) {
        logger.error("HANDLER", `Erreur graphique LP`, { error: error.message });
        await interaction.editReply({ content: `❌ Erreur : ${error.message}` });
    }
}

// ─── Bouton historique → ouvre le modal ──────────────────────────────────────
async function handleMatchHistoryButton(interaction) {
    const playerId = interaction.customId.split("_")[2];

    const modal = new ModalBuilder()
        .setCustomId(`history_modal_${playerId}`)
        .setTitle("📜 Historique des matchs");

    const input = new TextInputBuilder()
        .setCustomId("match_count")
        .setLabel("Nombre de matchs à afficher (1-25)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("5")
        .setValue("5")
        .setMinLength(1)
        .setMaxLength(2)
        .setRequired(false);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
}

// ─── Stats détaillées ─────────────────────────────────────────────────────────
async function handleDetailedStats(interaction) {
    await interaction.deferReply({ flags: 64 });

    const parts = interaction.customId.split("|");
    const matchId = parts[1];
    const puuid = parts[2];

    // Log du clic
    logger.info("HANDLER", `Bouton stats détaillées cliqué par ${interaction.user.tag}`, {
        matchId,
        guild: interaction.guildId,
        channel: interaction.channelId,
    });

    let matchInfo = matchCache.getMatch(matchId);

    if (!matchInfo) {
        try {
            const match = await getMatch(matchId);
            matchInfo = match.info;
            matchCache.setMatch(matchId, matchInfo);
        } catch (error) {
            logger.warn("HANDLER", `Match introuvable`, { matchId });
            return interaction.editReply({ content: "❌ Les données du match sont introuvables." });
        }
    }

    let timeline = null;
    try {
        timeline = await getTimeline(matchId);
    } catch (error) {
        logger.warn("HANDLER", `Timeline indisponible pour ${matchId}`, { error: error.message });
    }

    const embed = buildDetailedStatsEmbed(matchInfo, puuid, timeline, interaction.user.tag);

    const shareButton = new ButtonBuilder()
        .setCustomId(`share|${matchId}|${puuid}`)
        .setLabel("📢 Envoyer à tout le monde")
        .setStyle(ButtonStyle.Primary);

    await interaction.editReply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(shareButton)],
    });
}

// ─── Partager ─────────────────────────────────────────────────────────────────
async function handleShare(interaction) {
    await interaction.deferReply({ ephemeral: false });

    const parts = interaction.customId.split("|");
    const matchId = parts[1];
    const puuid = parts[2];

    let matchInfo = matchCache.getMatch(matchId);

    if (!matchInfo) {
        try {
            const match = await getMatch(matchId);
            matchInfo = match.info;
            matchCache.setMatch(matchId, matchInfo);
        } catch (error) {
            logger.warn("HANDLER", `Match introuvable`, { matchId });
            return interaction.editReply({ content: "❌ Les données du match sont introuvables." });
        }
    }

    let timeline = null;
    try {
        timeline = await getTimeline(matchId);
    } catch (error) {
        logger.warn("HANDLER", `Timeline indisponible pour ${matchId}`, { error: error.message });
    }

    const embed = buildDetailedStatsEmbed(matchInfo, puuid, timeline, interaction.user.tag);
    await interaction.editReply({ embeds: [embed] });
}

// ─── Modal historique ─────────────────────────────────────────────────────────
async function handleModal(interaction) {
    if (!interaction.customId.startsWith("history_modal_")) return;

    const playerId = interaction.customId.split("_")[2];
    let matchCount = parseInt(interaction.fields.getTextInputValue("match_count")) || 5;
    let isOverLimit = false;

    if (matchCount > 25) {
        isOverLimit = true;
        matchCount = 25;
        await interaction.reply({
            content: `⚠️ Limite dépassée ! Affichage de **25 matchs** maximum.`,
            ephemeral: true,
        });
    } else {
        matchCount = Math.max(1, matchCount);
        await interaction.deferReply();
    }

    try {
        const player = getPlayerById(playerId);
        if (!player) {
            const content = `❌ Joueur introuvable (ID: ${playerId})`;
            return isOverLimit
                ? interaction.followUp({ content, ephemeral: true })
                : interaction.editReply(content);
        }

        const matches = getPlayerMatches(playerId, matchCount);
        if (!matches.length) {
            const content = "❌ Aucun match trouvé.";
            return isOverLimit
                ? interaction.followUp({ content, ephemeral: true })
                : interaction.editReply(content);
        }

        const embed = createHistoryEmbedWithColors(player, matches, matchCount);
        const replyData = { embeds: [embed] };

        return isOverLimit
            ? interaction.followUp(replyData)
            : interaction.editReply(replyData);

    } catch (error) {
        logger.error("HANDLER", `Erreur modal historique`, { error: error.message });
        const content = "❌ Erreur lors de la récupération de l'historique.";
        try {
            if (interaction.replied) {
                await interaction.followUp({ content, ephemeral: true });
            } else if (interaction.deferred) {
                await interaction.editReply(content);
            } else {
                await interaction.reply({ content, ephemeral: true });
            }
        } catch (e) {
            logger.error("HANDLER", "Erreur finale modal", { error: e.message });
        }
    }
}

module.exports = { handleInteraction };
