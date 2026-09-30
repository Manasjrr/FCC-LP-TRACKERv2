const { SlashCommandBuilder } = require("discord.js");
const logger = require("../utils/loggers");
const { getPlayerMatches, createHistoryEmbedWithColors } = require("../utils/historyUtils");
const { getPlayerByRiotId, autocompletePlayers } = require("../utils/playerUtils");
const { DEFAULT_LANGUAGE, t, getTranslator } = require("../utils/i18n");

// ─────────────────────────────────────────
//  COMMANDE
// ─────────────────────────────────────────
module.exports = {
    data: new SlashCommandBuilder()
        .setName("history")
        .setDescription(t(DEFAULT_LANGUAGE, "commands.history.description"))
        .addStringOption((option) =>
            option
                .setName("player")
                .setDescription(t(DEFAULT_LANGUAGE, "commands.history.options.player.description"))
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addIntegerOption((option) =>
            option
                .setName("count")
                .setDescription(t(DEFAULT_LANGUAGE, "commands.history.options.count.description"))
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(25)
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply();
        } catch {
            return;
        }

        const tr = getTranslator(interaction.guildId);
        const joueurOption = interaction.options.getString("player");
        const matchCount = interaction.options.getInteger("count") ?? 5;

        logger.info('COMMAND', `/history exécuté par ${interaction.user.tag}`, {
            guild: interaction.guildId,
            joueur: joueurOption || null,
            nombre: matchCount,
        });

        if (!global.db) {
            logger.error('DB', `Base de données non disponible pour /history`, { guild: interaction.guildId });
            return interaction.editReply(tr("common.dbUnavailable")).catch(() => { });
        }

        const targetPlayer = getPlayerByRiotId(joueurOption, interaction.guildId);
        if (!targetPlayer) {
            logger.warn('COMMAND', `Joueur "${joueurOption}" introuvable dans /history`, { guild: interaction.guildId });
            return interaction.editReply(tr("common.playerNotFound", { player: joueurOption }));
        }

        try {
            const matches = getPlayerMatches(targetPlayer.id, matchCount);
            if (!matches.length) {
                return interaction.editReply(tr("history.noMatchesFor", { riotId: targetPlayer.riot_id }));
            }

            const embed = createHistoryEmbedWithColors(targetPlayer, matches, matchCount, tr);

            logger.success('COMMAND', `/history affiché pour ${targetPlayer.riot_id}`, {
                matches: matches.length,
                guild: interaction.guildId,
            });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            logger.error('COMMAND', `Erreur /history pour ${targetPlayer.riot_id}`, {
                error: error.message,
                guild: interaction.guildId,
            });
            await interaction.editReply(tr("history.error")).catch(() => { });
        }
    },

    autocomplete: autocompletePlayers,
};
