const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { sendWeeklyRecap } = require('../utils/weeklyRecap');
const { DEFAULT_LANGUAGE, t, getTranslator } = require('../utils/i18n');
const logger = require('../utils/loggers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('forcerecap')
        .setDescription(t(DEFAULT_LANGUAGE, 'commands.forcerecap.description'))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const tr = getTranslator(interaction.guildId);

        // ── Restriction stricte à l'owner du bot ──────────────────────────────
        if (interaction.user.id !== process.env.OWNER_ID) {
            logger.warn('COMMAND', `Tentative /forcerecap refusée`, {
                user: interaction.user.tag,
                userId: interaction.user.id,
            });
            return interaction.reply({
                content: tr('forcerecap.ownerOnly'),
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            logger.info('COMMAND', `Force recap demandé par ${interaction.user.tag}`);
            await sendWeeklyRecap(interaction.client);

            await interaction.editReply({ content: tr('forcerecap.success') });

        } catch (error) {
            logger.error('COMMAND', `Erreur /forcerecap`, { error: error.message });
            await interaction.editReply({
                content: tr('forcerecap.error', { message: error.message }),
            });
        }
    },
};
