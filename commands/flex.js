const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const {
    isFlexEnabled,
    setFlexEnabled,
    getGroupThumbnailStyle,
    setGroupThumbnailStyle,
} = require("../utils/guildSettings");
const { DEFAULT_LANGUAGE, t, getTranslator } = require("../utils/i18n");
const logger = require("../utils/loggers");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("flex")
        .setDescription(t(DEFAULT_LANGUAGE, "commands.flex.description"))
        .addBooleanOption(option =>
            option
                .setName("enabled")
                .setDescription(t(DEFAULT_LANGUAGE, "commands.flex.options.enabled.description"))
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName("thumbnail")
                .setDescription(t(DEFAULT_LANGUAGE, "commands.flex.options.thumbnail.description"))
                .setRequired(false)
                .addChoices(
                    { name: t(DEFAULT_LANGUAGE, "commands.flex.options.thumbnail.choices.gif"), value: "gif" },
                    { name: t(DEFAULT_LANGUAGE, "commands.flex.options.thumbnail.choices.mosaique"), value: "mosaique" },
                )
        ),

    async execute(interaction) {
        const tr = getTranslator(interaction.guildId);
        const isOwner = interaction.user.id === process.env.OWNER_ID;
        const isAdmin = interaction.member?.permissions.has(PermissionFlagsBits.Administrator);

        // Refus visible uniquement par l'utilisateur ; les réglages, eux, sont affichés à tout le monde
        if (!isAdmin && !isOwner) {
            logger.warn("COMMAND", `Accès refusé /flex`, { user: interaction.user.tag, guild: interaction.guildId });

            const deniedEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle(tr("common.accessDeniedTitle"))
                .setDescription(tr("common.accessDenied"))
                .addFields({ name: tr("common.requiredPermissions"), value: tr("common.requiredPermissionsList") })
                .setTimestamp();

            return await interaction.reply({ embeds: [deniedEmbed], flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply();

        const activer = interaction.options.getBoolean("enabled");
        const vignette = interaction.options.getString("thumbnail");
        const changes = [];

        if (activer !== null) {
            setFlexEnabled(interaction.guildId, activer);
            changes.push(tr(activer ? "flex.enabled" : "flex.disabled"));
        }
        if (vignette !== null) {
            setGroupThumbnailStyle(interaction.guildId, vignette);
            changes.push(tr("flex.thumbnailChanged", { label: tr(`flex.thumbnails.${vignette}`) }));
        }

        if (changes.length) {
            logger.success("COMMAND", `/flex modifié par ${interaction.user.tag}`, {
                guild: interaction.guildId,
                activer,
                vignette,
            });
        }

        const enabled = isFlexEnabled(interaction.guildId);
        const style = getGroupThumbnailStyle(interaction.guildId);

        const embed = new EmbedBuilder()
            .setColor(enabled ? 0x2ecc71 : 0x808080)
            .setTitle(tr("flex.title"))
            .setDescription(changes.length
                ? `✅ ${changes.join("\n✅ ")}`
                : tr("flex.currentSettings"))
            .addFields(
                { name: tr("flex.flexGames"), value: tr(enabled ? "flex.notified" : "flex.notNotified") },
                { name: tr("flex.groupThumbnail"), value: tr(`flex.thumbnails.${style}`) },
            )
            .setFooter({ text: changes.length ? tr("flex.footerChanged", { user: interaction.user.tag }) : tr("flex.footer") })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
