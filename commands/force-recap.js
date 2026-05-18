const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { sendWeeklyRecap } = require('../utils/weeklyRecap');  // ✅ CORRECTION ICI

module.exports = {
    data: new SlashCommandBuilder()
        .setName('forcerecap')
        .setDescription('🔧 Force le recap hebdomadaire (ADMIN ONLY)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            console.log('🔧 Force recap demandé par:', interaction.user.tag);

            // ✅ Appeler sendWeeklyRecap au lieu de generateWeeklyRecap
            await sendWeeklyRecap(interaction.client);

            await interaction.editReply({
                content: '✅ **Recap hebdomadaire forcé avec succès !**\n\nVérifie les salons configurés pour voir les résultats.',
                ephemeral: true
            });

        } catch (error) {
            console.error('❌ Erreur lors du force recap:', error);
            await interaction.editReply({
                content: `❌ **Erreur lors de la génération du recap :**\n\`\`\`${error.message}\`\`\``,
                ephemeral: true
            });
        }
    },
};
