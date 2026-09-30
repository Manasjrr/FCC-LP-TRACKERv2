const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, MessageFlags } = require("discord.js");
const { generateLPGraph } = require("../utils/graphUtils");
const { getPlayerMatches, createHistoryEmbedWithColors } = require("../utils/historyUtils");
const { getPlayerById, getGuildPlayers } = require("../utils/playerUtils");
const { computePlayerRating, getGuildRatingRanking, getRatingEvolution, getGameScoreDetails } = require("../utils/ratingUtils");
const { buildRatingEmbed, buildGameScoreEmbed } = require("../embeds/ratingEmbed");
const { buildDetailedStats } = require("../embeds/detailedStatsEmbed");
const { getMatch, getTimeline } = require("../services/riotApiService");
const { storeTimelineStats } = require("../services/matchService");
const { getPatchVersion } = require("../services/monitoringService");
const { extractFullMatchStats, isRemakeMatch } = require("../utils/matchStatsUtils");
const { getChampionName } = require("../utils/championUtils");
const matchCache = require("../cache/matchCache");
const timelineCache = require("../cache/timelineCache");
const { getTranslator } = require("../utils/i18n");
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
    if (interaction.isStringSelectMenu()) {
        return handleSelectMenu(interaction);
    }
}

// components : lignes de boutons à joindre (ActionRowBuilder), facultatif
async function sendFileViaAxios(interaction, embed, imageBuffer, filename, components = []) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({
        embeds: [embed.toJSON()],
        components: components.map((row) => row.toJSON()),
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
            stack: error.stack,
        });
        // Sans réponse, l'utilisateur resterait bloqué sur "réfléchit..."
        const content = getTranslator(interaction.guildId)("common.error");
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content, embeds: [], components: [] });
            } else {
                await interaction.reply({ content, flags: MessageFlags.Ephemeral });
            }
        } catch (e) {
            logger.error("HANDLER", "Erreur finale commande", { error: e.message });
        }
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

    const tr = getTranslator(interaction.guildId);

    try {
        const { customId } = interaction;

        // Graphique LP
        if (customId.startsWith("lp_chart_")) {
            return await handleLPChart(interaction, tr);
        }

        // Historique matchs
        if (customId.startsWith("match_history_")) {
            return await handleMatchHistoryButton(interaction, tr);
        }

        // Stats détaillées
        if (customId.startsWith("stats|")) {
            return await handleDetailedStats(interaction, tr);
        }

        // Partager stats
        if (customId.startsWith("share|")) {
            return await handleShare(interaction, tr);
        }

        // Détail de la note d'une game non enregistrée (Flex)
        if (customId.startsWith("gamescore_p|")) {
            return await handleParticipantGameScore(interaction, tr);
        }

        // Détail de la note de la game
        if (customId.startsWith("gamescore|")) {
            return await handleGameScore(interaction, tr);
        }

        // Refresh
        if (customId === "refresh_stats") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            return await interaction.followUp({
                content: tr("buttons.refreshed"),
                flags: MessageFlags.Ephemeral,
            });
        }

        // Infos note
        if (customId.startsWith("rating_info_")) {
            return await handleRatingInfo(interaction, tr);
        }

        // Inconnu
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return await interaction.followUp({
            content: tr("buttons.unknown", { id: customId }),
            flags: MessageFlags.Ephemeral,
        });

    } catch (error) {
        logger.error("HANDLER", `Erreur bouton (${interaction.customId})`, {
            error: error.message,
        });
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: tr("common.error"), flags: MessageFlags.Ephemeral });
            } else if (interaction.deferred && !interaction.replied) {
                // Remplace le "réfléchit..." resté affiché
                await interaction.editReply({ content: tr("common.error"), embeds: [], components: [] });
            } else {
                await interaction.followUp({ content: tr("common.error"), flags: MessageFlags.Ephemeral });
            }
        } catch (e) {
            logger.error("HANDLER", "Erreur finale bouton", { error: e.message });
        }
    }
}

// ─── Graphique LP ─────────────────────────────────────────────────────────────
async function handleLPChart(interaction, tr) {
    const playerId = interaction.customId.split("_")[2];
    await interaction.deferReply();

    try {
        const player = global.db.prepare(`SELECT * FROM players WHERE id = ?`).get(playerId);
        if (!player) {
            return interaction.editReply({ content: tr("common.playerNotFoundById", { id: playerId }) });
        }

        const imageBuffer = await generateLPGraph(playerId, undefined, { tr });

        const embed = new EmbedBuilder()
            .setTitle(tr("buttons.lpChartTitle"))
            .setDescription(tr("buttons.lpChartDescription", { riotId: player.riot_id }))
            .setImage("attachment://rank-evolution.jpg")
            .setColor(0x00ff88);

        // ── Envoi via axios (bypass undici) ────────────────────────────────
        await sendFileViaAxios(interaction, embed, imageBuffer, "rank-evolution.jpg");

    } catch (error) {
        logger.error("HANDLER", `Erreur graphique LP`, { error: error.message });
        await interaction.editReply({ content: tr("common.errorWithMessage", { message: error.message }) });
    }
}

// ─── Infos note (détail + barème) ─────────────────────────────────────────────
async function handleRatingInfo(interaction, tr) {
    const playerId = Number(interaction.customId.split("_")[2]);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const player = getPlayerById(playerId);
    if (!player) {
        return interaction.editReply({ content: tr("common.playerNotFoundById", { id: playerId }) });
    }

    const ranking = getGuildRatingRanking(getGuildPlayers(interaction.guildId));
    const index = ranking.findIndex((r) => r.player.id === playerId);
    const rating = index >= 0 ? ranking[index].rating : computePlayerRating(playerId);

    if (rating.empty) {
        return interaction.editReply({ content: tr("buttons.noRankedGame", { riotId: player.riot_id }) });
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
        embeds: [buildRatingEmbed(player, rating, index >= 0 ? { position: index + 1, total: ranking.length } : null, evolutions, tr)],
    });
}

// ─── Bouton historique → ouvre le modal ──────────────────────────────────────
async function handleMatchHistoryButton(interaction, tr) {
    const playerId = interaction.customId.split("_")[2];

    const modal = new ModalBuilder()
        .setCustomId(`history_modal_${playerId}`)
        .setTitle(tr("history.modalTitle"));

    const input = new TextInputBuilder()
        .setCustomId("match_count")
        .setLabel(tr("history.modalLabel"))
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("5")
        .setValue("5")
        .setMinLength(1)
        .setMaxLength(2)
        .setRequired(false);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
}

// ─── Match + timeline (cache en priorité) ─────────────────────────────────────
// → { matchInfo, timeline } (timeline null si indisponible) ou null (match introuvable)
async function loadMatchData(matchId) {
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
            timeline = timelineCache.setTimeline(matchId, await getTimeline(matchId));
            // Profite de l'appel pour enregistrer les stats timeline (écarts à 15 min...)
            storeTimelineStats(matchId, timeline, matchInfo);
        } catch (error) {
            logger.warn("HANDLER", `Timeline indisponible pour ${matchId}`, { error: error.message });
        }
    }

    return { matchInfo, timeline: timeline ?? null };
}

// ─── Match + timeline → stats détaillées ─────────────────────────────────────
// → { embed, file } ou null (match introuvable)
async function getDetailedStats(matchId, puuid, userTag, tr) {
    const data = await loadMatchData(matchId);
    if (!data) return null;
    return buildDetailedStats(data.matchInfo, puuid, data.timeline, userTag, tr, getPatchVersion());
}

// ─── Stats détaillées ─────────────────────────────────────────────────────────
async function handleDetailedStats(interaction, tr) {
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

    const stats = await getDetailedStats(matchId, puuid, interaction.user.tag, tr);
    if (!stats) {
        return interaction.editReply({ content: tr("buttons.matchDataNotFound") });
    }

    const shareButton = new ButtonBuilder()
        .setCustomId(`share|${matchId}|${puuid}`)
        .setLabel(tr("buttons.share"))
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(shareButton);

    // Bouton "Détail de la note" : identifié par la ligne match_history (les custom_id
    // Discord sont limités à 100 caractères → pas de place pour matchId + puuid)
    const matchRow = global.db.prepare(`
        SELECT mh.id FROM match_history mh
        JOIN players p ON p.id = mh.player_id
        WHERE mh.match_id = ? AND p.puuid = ? AND mh.is_remake = 0
    `).get(matchId, puuid);

    // Match non enregistré (Flex) : note recalculée depuis le match, joueur
    // identifié par sa position dans la game
    // (match déjà en cache après getDetailedStats → aucun appel API)
    let gameScoreId = matchRow ? `gamescore|${matchRow.id}` : null;
    if (!matchRow) {
        const matchInfo = (await loadMatchData(matchId))?.matchInfo;
        const index = matchInfo && !isRemakeMatch(matchInfo)
            ? matchInfo.participants.findIndex((p) => p.puuid === puuid)
            : -1;
        if (index >= 0) gameScoreId = `gamescore_p|${matchId}|${index}`;
    }

    if (gameScoreId) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(gameScoreId)
                .setLabel(tr("buttons.gameScore"))
                .setStyle(ButtonStyle.Secondary)
        );
    }

    await sendDetailedStats(interaction, stats, [row]);
}

// Embed + tableau des scores (image envoyée via axios, voir sendFileViaAxios)
async function sendDetailedStats(interaction, { embed, file }, components = []) {
    if (file) return sendFileViaAxios(interaction, embed, file.buffer, file.name, components);
    return interaction.editReply({ embeds: [embed], components });
}

// ─── Détail de la note d'une game ─────────────────────────────────────────────
async function handleGameScore(interaction, tr) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const matchRowId = Number(interaction.customId.split("|")[1]);

    const match = global.db.prepare(`
        SELECT mh.*, p.riot_id, p.puuid FROM match_history mh
        JOIN players p ON p.id = mh.player_id
        WHERE mh.id = ?
    `).get(matchRowId);
    const matchId = match?.match_id;

    const details = getGameScoreDetails(match);
    if (!details) {
        return interaction.editReply({
            content: tr(match?.is_remake ? "buttons.noRemakeScore" : "buttons.scoreUnavailable"),
        });
    }

    logger.info("HANDLER", `Détail de la note consulté par ${interaction.user.tag}`, {
        matchId,
        player: match.riot_id,
        score: details.score,
    });

    // Menu pour voir la note des autres joueurs de la game (match déjà en cache
    // après "Stats détaillées" → pas d'appel API dans la grande majorité des cas)
    const data = await loadMatchData(matchId);
    const components = data ? [buildGameScorePicker(matchId, data, match.puuid, tr)] : [];

    await interaction.editReply({ embeds: [buildGameScoreEmbed(details, match, match.riot_id, tr)], components });
}

// ─── Détail de la note d'un joueur d'une game non enregistrée (Flex) ────────
async function handleParticipantGameScore(interaction, tr) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [, matchId, index] = interaction.customId.split("|");
    const data = await loadMatchData(matchId);
    const participant = data?.matchInfo.participants[Number(index)];
    if (!participant) {
        return interaction.editReply({ content: tr("buttons.matchDataNotFound") });
    }

    const row = getParticipantScoreRow(matchId, data, participant);
    const details = getGameScoreDetails(row);
    if (!details) {
        return interaction.editReply({
            content: tr(row.is_remake ? "buttons.noRemakeScore" : "buttons.scoreUnavailable"),
        });
    }

    logger.info("HANDLER", `Détail de la note consulté par ${interaction.user.tag}`, {
        matchId,
        player: row.riot_id,
        score: details.score,
    });

    await interaction.editReply({
        embeds: [buildGameScoreEmbed(details, row, row.riot_id, tr)],
        components: [buildGameScorePicker(matchId, data, participant.puuid, tr)],
    });
}

// ─── Note d'un joueur de la game (suivi ou non) ──────────────────────────────
// Joueur suivi : ligne match_history (même note que partout ailleurs)
// Autre joueur : ligne reconstruite depuis le match + la timeline
function getParticipantScoreRow(matchId, { matchInfo, timeline }, participant) {
    const stored = global.db.prepare(`
        SELECT mh.*, p.riot_id FROM match_history mh
        JOIN players p ON p.id = mh.player_id
        WHERE mh.match_id = ? AND p.puuid = ?
    `).get(matchId, participant.puuid);
    if (stored) return stored;

    return {
        ...extractFullMatchStats(matchInfo, participant, timeline),
        champion_name: getChampionName(participant.championId),
        riot_id: participant.riotIdGameName
            ? `${participant.riotIdGameName}#${participant.riotIdTagline}`
            : getChampionName(participant.championId),
    };
}

// Menu déroulant : les 10 joueurs de la game (équipe, champion, pseudo, note)
const TEAM_EMOJIS = { 100: "🔵", 200: "🔴" };

function buildGameScorePicker(matchId, data, selectedPuuid, tr) {
    const options = data.matchInfo.participants.map((p, index) => {
        const details = getGameScoreDetails(getParticipantScoreRow(matchId, data, p));
        const name = p.riotIdGameName || getChampionName(p.championId);
        const description = [
            p.teamPosition ? tr(`roles.${p.teamPosition}`) : null,
            details ? tr("buttons.pickerScore", { score: details.score, grade: details.tier.grade }) : null,
        ].filter(Boolean).join(" · ");
        return {
            label: `${getChampionName(p.championId)} — ${name}`.slice(0, 100),
            ...(description && { description }),
            value: String(index),
            emoji: { name: TEAM_EMOJIS[p.teamId] ?? "⚪" },
            default: p.puuid === selectedPuuid,
        };
    });

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`gamescore_pick|${matchId}`)
            .setPlaceholder(tr("buttons.pickerPlaceholder"))
            .addOptions(options)
    );
}

// ─── Menus déroulants ─────────────────────────────────────────────────────────
async function handleSelectMenu(interaction) {
    const tr = getTranslator(interaction.guildId);
    try {
        if (interaction.customId.startsWith("gamescore_pick|")) {
            return await handleGameScorePick(interaction, tr);
        }
    } catch (error) {
        logger.error("HANDLER", `Erreur menu (${interaction.customId})`, { error: error.message });
        try {
            const payload = { content: tr("common.error"), flags: MessageFlags.Ephemeral };
            if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
            else await interaction.reply(payload);
        } catch (e) {
            logger.error("HANDLER", "Erreur finale menu", { error: e.message });
        }
    }
}

// Joueur choisi dans le menu → même message, avec la note de ce joueur
async function handleGameScorePick(interaction, tr) {
    await interaction.deferUpdate();

    const matchId = interaction.customId.split("|")[1];
    const data = await loadMatchData(matchId);
    const participant = data?.matchInfo.participants[Number(interaction.values[0])];
    if (!participant) {
        return interaction.followUp({ content: tr("buttons.matchDataNotFound"), flags: MessageFlags.Ephemeral });
    }

    const row = getParticipantScoreRow(matchId, data, participant);
    const details = getGameScoreDetails(row);
    if (!details) {
        return interaction.followUp({
            content: tr(row.is_remake ? "buttons.noRemakeScore" : "buttons.scoreUnavailable"),
            flags: MessageFlags.Ephemeral,
        });
    }

    logger.info("HANDLER", `Détail de la note consulté par ${interaction.user.tag}`, {
        matchId,
        player: row.riot_id,
        score: details.score,
    });

    await interaction.editReply({
        embeds: [buildGameScoreEmbed(details, row, row.riot_id, tr)],
        components: [buildGameScorePicker(matchId, data, participant.puuid, tr)],
    });
}

// ─── Partager ─────────────────────────────────────────────────────────────────
async function handleShare(interaction, tr) {
    await interaction.deferReply();

    const parts = interaction.customId.split("|");
    const matchId = parts[1];
    const puuid = parts[2];

    const stats = await getDetailedStats(matchId, puuid, interaction.user.tag, tr);
    if (!stats) {
        return interaction.editReply({ content: tr("buttons.matchDataNotFound") });
    }
    await sendDetailedStats(interaction, stats);
}

// ─── Modal historique ─────────────────────────────────────────────────────────
async function handleModal(interaction) {
    if (!interaction.customId.startsWith("history_modal_")) return;

    const tr = getTranslator(interaction.guildId);

    const playerId = interaction.customId.split("_")[2];
    let matchCount = parseInt(interaction.fields.getTextInputValue("match_count")) || 5;
    let isOverLimit = false;

    if (matchCount > 25) {
        isOverLimit = true;
        matchCount = 25;
        await interaction.reply({
            content: tr("history.overLimit"),
            flags: MessageFlags.Ephemeral,
        });
    } else {
        matchCount = Math.max(1, matchCount);
        await interaction.deferReply();
    }

    try {
        const player = getPlayerById(playerId);
        if (!player) {
            const content = tr("common.playerNotFoundById", { id: playerId });
            return isOverLimit
                ? interaction.followUp({ content, flags: MessageFlags.Ephemeral })
                : interaction.editReply(content);
        }

        const matches = getPlayerMatches(playerId, matchCount);
        if (!matches.length) {
            const content = tr("history.noMatches");
            return isOverLimit
                ? interaction.followUp({ content, flags: MessageFlags.Ephemeral })
                : interaction.editReply(content);
        }

        const embed = createHistoryEmbedWithColors(player, matches, matchCount, tr);
        const replyData = { embeds: [embed] };

        return isOverLimit
            ? interaction.followUp(replyData)
            : interaction.editReply(replyData);

    } catch (error) {
        logger.error("HANDLER", `Erreur modal historique`, { error: error.message });
        const content = tr("history.error");
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
