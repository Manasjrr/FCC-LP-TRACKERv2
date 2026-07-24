const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { sendWeeklyRecap } = require('../utils/weeklyRecap');
const logger = require('../utils/loggers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('forcerecap')
        .setDescription(' Force le recap hebdomadaire (OWNER ONLY)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        // ── Restriction stricte à l'owner du bot ──────────────────────────────
        if (interaction.user.id !== process.env.OWNER_ID) {
            logger.warn('COMMAND', `Tentative /forcerecap refusée`, {
                user: interaction.user.tag,
                userId: interaction.user.id,
            });
            return interaction.reply({
                content: "Cette commande est réservée au propriétaire du bot.",
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            logger.info('COMMAND', `Force recap demandé par ${interaction.user.tag}`);
            await sendWeeklyRecap(interaction.client);

            await interaction.editReply({
                content: '**Recap hebdomadaire forcé avec succès !**\n\nVérifie les salons configurés pour voir les résultats.',
            });

        } catch (error) {
            logger.error('COMMAND', `Erreur /forcerecap`, { error: error.message });
            await interaction.editReply({
                content: ` **Erreur lors de la génération du recap :**\n\`\`\`${error.message}\`\`\``,
            });
        }
    },
};