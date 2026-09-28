const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const {
    isFlexEnabled,
    setFlexEnabled,
    getGroupThumbnailStyle,
    setGroupThumbnailStyle,
} = require("../utils/guildSettings");
const logger = require("../utils/loggers");

const THUMBNAIL_LABELS = {
    gif: "🎞️ GIF animé (chaque champion + son rôle)",
    mosaique: "🧩 Mosaïque (tous les champions en une image)",
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName("flex")
        .setDescription("Réglages des notifications Flex (admins uniquement)")
        .addBooleanOption(option =>
            option
                .setName("activer")
                .setDescription("true = notifier les parties Flex, false = ne plus les notifier")
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName("vignette")
                .setDescription("Vignette des parties à 3+ joueurs suivis / face-à-face")
                .setRequired(false)
                .addChoices(
                    { name: "GIF animé (chaque champion + son rôle)", value: "gif" },
                    { name: "Mosaïque (tous les champions en une image)", value: "mosaique" },
                )
        ),

    async execute(interaction) {
        const isOwner = interaction.user.id === process.env.OWNER_ID;
        const isAdmin = interaction.member?.permissions.has(PermissionFlagsBits.Administrator);

        // Refus visible uniquement par l'utilisateur ; les réglages, eux, sont affichés à tout le monde
        if (!isAdmin && !isOwner) {
            logger.warn("COMMAND", `Accès refusé /flex`, { user: interaction.user.tag, guild: interaction.guildId });

            const deniedEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle("🚫 Accès refusé")
                .setDescription("Vous n'avez pas les permissions nécessaires pour utiliser cette commande.")
                .addFields({ name: "Permissions requises", value: "• Administrateur\n• Utilisateur autorisé" })
                .setTimestamp();

            return await interaction.reply({ embeds: [deniedEmbed], flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply();

        const activer = interaction.options.getBoolean("activer");
        const vignette = interaction.options.getString("vignette");
        const changes = [];

        if (activer !== null) {
            setFlexEnabled(interaction.guildId, activer);
            changes.push(activer ? "notifications Flex **activées**" : "notifications Flex **désactivées**");
        }
        if (vignette !== null) {
            setGroupThumbnailStyle(interaction.guildId, vignette);
            changes.push(`vignette : **${THUMBNAIL_LABELS[vignette]}**`);
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
            .setTitle("⚙️ Notifications Flex")
            .setDescription(changes.length
                ? `✅ ${changes.join("\n✅ ")}`
                : "Réglages actuels du serveur :")
            .addFields(
                {
                    name: "Parties Flex",
                    value: enabled
                        ? "✅ Notifiées *(ne comptent pas dans les stats, les LP ni les notes)*"
                        : "❌ Non notifiées",
                },
                { name: "Vignette des groupes (3+ joueurs / face-à-face)", value: THUMBNAIL_LABELS[style] },
            )
            .setFooter({ text: `Modifié par ${interaction.user.tag} · /flex activer / vignette pour changer` })
            .setTimestamp();

        if (!changes.length) embed.setFooter({ text: "/flex activer / vignette pour changer" });

        await interaction.editReply({ embeds: [embed] });
    },
};
