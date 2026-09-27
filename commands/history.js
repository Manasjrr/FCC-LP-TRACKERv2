const { SlashCommandBuilder } = require("discord.js");
const logger = require("../utils/loggers");
const { getPlayerMatches, createHistoryEmbedWithColors } = require("../utils/historyUtils");
const { getPlayerByRiotId, autocompletePlayers } = require("../utils/playerUtils");

// ─────────────────────────────────────────
//  COMMANDE
// ─────────────────────────────────────────
module.exports = {
    data: new SlashCommandBuilder()
        .setName("history")
        .setDescription("Historique des derniers matchs d'un joueur")
        .addStringOption((option) =>
            option
                .setName("joueur")
                .setDescription("Riot ID du joueur")
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addIntegerOption((option) =>
            option
                .setName("nombre")
                .setDescription("Nombre de matchs à afficher (1-25, défaut : 5)")
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

        const joueurOption = interaction.options.getString("joueur");
        const matchCount = interaction.options.getInteger("nombre") ?? 5;

        logger.info('COMMAND', `/history exécuté par ${interaction.user.tag}`, {
            guild: interaction.guildId,
            joueur: joueurOption || null,
            nombre: matchCount,
        });

        if (!global.db) {
            logger.error('DB', `Base de données non disponible pour /history`, { guild: interaction.guildId });
            return interaction.editReply("❌ Base de données indisponible").catch(() => { });
        }

        const targetPlayer = getPlayerByRiotId(joueurOption, interaction.guildId);
        if (!targetPlayer) {
            logger.warn('COMMAND', `Joueur "${joueurOption}" introuvable dans /history`, { guild: interaction.guildId });
            return interaction.editReply(
                `❌ Aucun joueur trouvé pour **${joueurOption}** sur ce serveur.\n` +
                `*Utilise l'autocomplétion ou vérifie \`/list\`.*`
            );
        }

        try {
            const matches = getPlayerMatches(targetPlayer.id, matchCount);
            if (!matches.length) {
                return interaction.editReply(`❌ Aucun match trouvé pour **${targetPlayer.riot_id}**.`);
            }

            const embed = createHistoryEmbedWithColors(targetPlayer, matches, matchCount);

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
            await interaction.editReply("❌ Erreur lors de la récupération de l'historique.").catch(() => { });
        }
    },

    autocomplete: autocompletePlayers,
};
