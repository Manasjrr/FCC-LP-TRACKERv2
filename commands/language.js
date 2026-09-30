const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const {
    DEFAULT_LANGUAGE,
    LANGUAGES,
    t,
    getTranslator,
    getGuildLanguage,
    setGuildLanguage,
} = require("../utils/i18n");
const logger = require("../utils/loggers");

const languageName = (code) => LANGUAGES.find((l) => l.code === code)?.name ?? code;

module.exports = {
    data: new SlashCommandBuilder()
        .setName("language")
        .setDescription(t(DEFAULT_LANGUAGE, "commands.language.description"))
        .addStringOption(option =>
            option
                .setName("language")
                .setDescription(t(DEFAULT_LANGUAGE, "commands.language.options.language.description"))
                .setRequired(false)
                // Choix générés depuis locales/ : une nouvelle langue apparaît automatiquement
                .addChoices(...LANGUAGES.map(({ code, name }) => ({ name, value: code })))
        ),

    async execute(interaction) {
        const isOwner = interaction.user.id === process.env.OWNER_ID;
        const isAdmin = interaction.member?.permissions.has(PermissionFlagsBits.Administrator);
        const newLanguage = interaction.options.getString("language");

        // Sans option : simple affichage de la langue actuelle (ouvert à tous)
        if (newLanguage !== null && !isAdmin && !isOwner) {
            logger.warn("COMMAND", `Accès refusé /language`, { user: interaction.user.tag, guild: interaction.guildId });
            const tr = getTranslator(interaction.guildId);

            const deniedEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle(tr("common.accessDeniedTitle"))
                .setDescription(tr("common.accessDenied"))
                .addFields({ name: tr("common.requiredPermissions"), value: tr("common.requiredPermissionsList") })
                .setTimestamp();

            return interaction.reply({ embeds: [deniedEmbed], flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply();

        const changed = newLanguage !== null && newLanguage !== getGuildLanguage(interaction.guildId);
        if (changed) {
            setGuildLanguage(interaction.guildId, newLanguage);
            logger.success("COMMAND", `/language : ${newLanguage} défini par ${interaction.user.tag}`, {
                guild: interaction.guildId,
            });
        }

        // Réponse dans la (nouvelle) langue du serveur
        const tr = getTranslator(interaction.guildId);
        const current = languageName(tr.lang);

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(tr("language.title"))
            .setDescription(changed
                ? `${tr("language.changed", { language: current })}\n${tr("language.commandsUpdating")}`
                : tr("language.current", { language: current }))
            .addFields({
                name: tr("language.available"),
                value: LANGUAGES.map(({ code, name }) => `${code === tr.lang ? "✅" : "▫️"} ${name} (\`${code}\`)`).join("\n"),
            })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Descriptions des slash commands redéployées dans la nouvelle langue
        if (changed) {
            const { deployToSingleGuild } = require("../handlers/commandHandler");
            await deployToSingleGuild(interaction.client, interaction.guild);
        }
    },
};
