const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { isFlexEnabled, setFlexEnabled } = require("../utils/guildSettings");
const logger = require("../utils/loggers");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("flex")
        .setDescription("Active ou désactive les notifications des parties Flex (admins uniquement)")
        .addBooleanOption(option =>
            option
                .setName("activer")
                .setDescription("true = notifier les parties Flex, false = ne plus les notifier (vide = voir l'état actuel)")
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const isOwner = interaction.user.id === process.env.OWNER_ID;
        const isAdmin = interaction.member?.permissions.has(PermissionFlagsBits.Administrator);

        if (!isAdmin && !isOwner) {
            logger.warn("COMMAND", `Accès refusé /flex`, { user: interaction.user.tag, guild: interaction.guildId });

            const deniedEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle("🚫 Accès refusé")
                .setDescription("Vous n'avez pas les permissions nécessaires pour utiliser cette commande.")
                .addFields({ name: "Permissions requises", value: "• Administrateur\n• Utilisateur autorisé" })
                .setTimestamp();

            return await interaction.editReply({ embeds: [deniedEmbed] });
        }

        const activer = interaction.options.getBoolean("activer");

        // Sans option : affichage de l'état actuel
        if (activer === null) {
            const enabled = isFlexEnabled(interaction.guildId);
            return await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(enabled ? 0x2ecc71 : 0x808080)
                    .setTitle("⚙️ Notifications Flex")
                    .setDescription(enabled
                        ? "✅ Les parties **Flex** sont actuellement **notifiées** sur ce serveur."
                        : "❌ Les parties **Flex** ne sont actuellement **pas notifiées** sur ce serveur.")
                    .setFooter({ text: "/flex activer: true / false pour changer" })
                    .setTimestamp()
                ],
            });
        }

        setFlexEnabled(interaction.guildId, activer);

        logger.success("COMMAND", `/flex ${activer ? "activé" : "désactivé"} par ${interaction.user.tag}`, {
            guild: interaction.guildId,
        });

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(activer ? 0x2ecc71 : 0x808080)
                .setTitle("⚙️ Notifications Flex")
                .setDescription(activer
                    ? "✅ Les parties **Flex** des joueurs suivis seront maintenant **notifiées**.\n*Elles ne comptent pas dans les stats, les LP ni les notes (SoloQ uniquement).*"
                    : "❌ Les parties **Flex** ne seront plus notifiées.")
                .setTimestamp()
            ],
        });
    },
};
