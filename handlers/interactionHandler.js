const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require("discord.js");
const { generateLPGraph } = require("../utils/graphUtils");
const { getPlayerMatches, createHistoryEmbedWithColors } = require("../utils/historyUtils");
const { getPlayerById, getGuildPlayers } = require("../utils/playerUtils");
const { computePlayerRating, getGuildRatingRanking, getRatingEvolution, getGameScoreDetails } = require("../utils/ratingUtils");
const { buildRatingEmbed, buildGameScoreEmbed } = require("../embeds/ratingEmbed");
const { buildDetailedStatsEmbed } = require("../embeds/detailedStatsEmbed");
const { getMatch, getTimeline } = require("../services/riotApiService");
const { storeTimelineStats } = require("../services/matchService");
const matchCache = require("../cache/matchCache");
const timelineCache = require("../cache/timelineCache");
const logger = require("../utils/loggers");
const axios = require("axios");
const FormData = require("form-data");

// ─── Router principal ─────────────────────────────────────────────────────────
async function handleInteraction(interaction) {
    if (interaction.isChatInputCommand()) {
        return handleCommand(interaction);
    }
    if (interaction.isAutocomplete()) {
        return handleAutocomplete(interaction);
    }
    if (interaction.isButton()) {
        return handleButton(interaction);
    }
    if (interaction.isModalSubmit()) {
        return handleModal(interaction);
    }
}

async function sendFileViaAxios(interaction, embed, imageBuffer, filename) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({
        embeds: [embed.toJSON()],
    }));
    form.append('files[0]', imageBuffer, filename);

    const url = `https://discord.com/api/v10/webhooks/${interaction.client.user.id}/${interaction.token}/messages/@original`;

    return axios.patch(url, form, {
        headers: form.getHeaders(),
        timeout: 15000,
    });
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

// ─── Autocomplétion ───────────────────────────────────────────────────────────
async function handleAutocomplete(interaction) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command || !command.autocomplete) return;

    try {
        await command.autocomplete(interaction);
    } catch (error) {
        logger.error("HANDLER", `Erreur autocomplete /${interaction.commandName}`, {
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
            return await handleLPChart(interaction);
        }

        // Historique matchs
        if (customId.startsWith("match_history_")) {
            return await handleMatchHistoryButton(interaction);
        }

        // Stats détaillées
        if (customId.startsWith("stats|")) {
            return await handleDetailedStats(interaction);
        }

        // Partager stats
        if (customId.startsWith("share|")) {
            return await handleShare(interaction);
        }

        // Détail de la note de la game
        if (customId.startsWith("gamescore|")) {
            return await handleGameScore(interaction);
        }

        // Refresh
        if (customId === "refresh_stats") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            return await interaction.followUp({
                content: "🔄 **Cache actualisé !**\nRelance `/stats` pour voir les nouvelles données.",
                flags: MessageFlags.Ephemeral,
            });
        }

        // Infos note
        if (customId.startsWith("rating_info_")) {
            return await handleRatingInfo(interaction);
        }

        // Inconnu
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return await interaction.followUp({
            content: `❓ Bouton non reconnu : ${customId}`,
            flags: MessageFlags.Ephemeral,
        });

    } catch (error) {
        logger.error("HANDLER", `Erreur bouton (${interaction.customId})`, {
            error: error.message,
        });
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: "❌ Erreur survenue", flags: MessageFlags.Ephemeral });
            } else {
                await interaction.followUp({ content: "❌ Erreur survenue", flags: MessageFlags.Ephemeral });
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

        const embed = new EmbedBuilder()
            .setTitle("📊 Évolution du Rang")
            .setDescription(`Graphique d'évolution pour **${player.riot_id}**`)
            .setImage("attachment://rank-evolution.jpg")
            .setColor(0x00ff88);

        // ── Envoi via axios (bypass undici) ────────────────────────────────
        await sendFileViaAxios(interaction, embed, imageBuffer, "rank-evolution.jpg");

    } catch (error) {
        logger.error("HANDLER", `Erreur graphique LP`, { error: error.message });
        await interaction.editReply({ content: `❌ Erreur : ${error.message}` });
    }
}

// ─── Infos note (détail + barème) ─────────────────────────────────────────────
async function handleRatingInfo(interaction) {
    const playerId = Number(interaction.customId.split("_")[2]);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const player = getPlayerById(playerId);
    if (!player) {
        return interaction.editReply({ content: `❌ Joueur introuvable (ID: ${playerId})` });
    }

    const ranking = getGuildRatingRanking(getGuildPlayers(interaction.guildId));
    const index = ranking.findIndex((r) => r.player.id === playerId);
    const rating = index >= 0 ? ranking[index].rating : computePlayerRating(playerId);

    if (rating.empty) {
        return interaction.editReply({ content: `❔ **${player.riot_id}** n'a pas encore de game classée enregistrée.` });
    }

    logger.info("HANDLER", `Infos note consultées par ${interaction.user.tag}`, {
        player: player.riot_id,
        score: rating.score,
        guild: interaction.guildId,
    });

    const evolutions = [7, 30]
        .map((days) => getRatingEvolution(playerId, days, rating))
        .filter(Boolean);

    await interaction.editReply({
        embeds: [buildRatingEmbed(player, rating, index >= 0 ? { position: index + 1, total: ranking.length } : null, evolutions)],
    });
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

// ─── Match + timeline (cache en priorité) → embed stats détaillées ───────────
async function getDetailedStatsEmbed(matchId, puuid, userTag) {
    let matchInfo = matchCache.getMatch(matchId);

    if (!matchInfo) {
        try {
            const match = await getMatch(matchId);
            matchInfo = match.info;
            matchCache.setMatch(matchId, matchInfo);
        } catch (error) {
            logger.warn("HANDLER", `Match introuvable`, { matchId });
            return null;
        }
    }

    let timeline = timelineCache.getTimeline(matchId);
    if (!timeline) {
        try {
            timeline = await getTimeline(matchId);
            timelineCache.setTimeline(matchId, timeline);
            // Profite de l'appel pour enregistrer les stats timeline (écarts à 15 min...)
            storeTimelineStats(matchId, timeline, matchInfo);
        } catch (error) {
            logger.warn("HANDLER", `Timeline indisponible pour ${matchId}`, { error: error.message });
        }
    }

    return buildDetailedStatsEmbed(matchInfo, puuid, timeline, userTag);
}

// ─── Stats détaillées ─────────────────────────────────────────────────────────
async function handleDetailedStats(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const parts = interaction.customId.split("|");
    const matchId = parts[1];
    const puuid = parts[2];

    // Log du clic
    logger.info("HANDLER", `Bouton stats détaillées cliqué par ${interaction.user.tag}`, {
        matchId,
        guild: interaction.guildId,
        channel: interaction.channelId,
    });

    const embed = await getDetailedStatsEmbed(matchId, puuid, interaction.user.tag);
    if (!embed) {
        return interaction.editReply({ content: "❌ Les données du match sont introuvables." });
    }

    const shareButton = new ButtonBuilder()
        .setCustomId(`share|${matchId}|${puuid}`)
        .setLabel("📢 Envoyer à tout le monde")
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(shareButton);

    // Bouton "Détail de la note" : identifié par la ligne match_history (les custom_id
    // Discord sont limités à 100 caractères → pas de place pour matchId + puuid)
    const matchRow = global.db.prepare(`
        SELECT mh.id FROM match_history mh
        JOIN players p ON p.id = mh.player_id
        WHERE mh.match_id = ? AND p.puuid = ? AND mh.is_remake = 0
    `).get(matchId, puuid);

    if (matchRow) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`gamescore|${matchRow.id}`)
                .setLabel("🧮 Détail de la note")
                .setStyle(ButtonStyle.Secondary)
        );
    }

    await interaction.editReply({ embeds: [embed], components: [row] });
}

// ─── Détail de la note d'une game ─────────────────────────────────────────────
async function handleGameScore(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const matchRowId = Number(interaction.customId.split("|")[1]);

    const match = global.db.prepare(`
        SELECT mh.*, p.riot_id FROM match_history mh
        JOIN players p ON p.id = mh.player_id
        WHERE mh.id = ?
    `).get(matchRowId);
    const matchId = match?.match_id;

    const details = getGameScoreDetails(match);
    if (!details) {
        return interaction.editReply({
            content: match?.is_remake
                ? "⚪ Pas de note pour un remake."
                : "❌ Note indisponible pour cette game.",
        });
    }

    logger.info("HANDLER", `Détail de la note consulté par ${interaction.user.tag}`, {
        matchId,
        player: match.riot_id,
        score: details.score,
    });

    await interaction.editReply({ embeds: [buildGameScoreEmbed(details, match, match.riot_id)] });
}

// ─── Partager ─────────────────────────────────────────────────────────────────
async function handleShare(interaction) {
    await interaction.deferReply();

    const parts = interaction.customId.split("|");
    const matchId = parts[1];
    const puuid = parts[2];

    const embed = await getDetailedStatsEmbed(matchId, puuid, interaction.user.tag);
    if (!embed) {
        return interaction.editReply({ content: "❌ Les données du match sont introuvables." });
    }
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
            flags: MessageFlags.Ephemeral,
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
                ? interaction.followUp({ content, flags: MessageFlags.Ephemeral })
                : interaction.editReply(content);
        }

        const matches = getPlayerMatches(playerId, matchCount);
        if (!matches.length) {
            const content = "❌ Aucun match trouvé.";
            return isOverLimit
                ? interaction.followUp({ content, flags: MessageFlags.Ephemeral })
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
                await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
            } else if (interaction.deferred) {
                await interaction.editReply(content);
            } else {
                await interaction.reply({ content, flags: MessageFlags.Ephemeral });
            }
        } catch (e) {
            logger.error("HANDLER", "Erreur finale modal", { error: e.message });
        }
    }
}

module.exports = { handleInteraction };
