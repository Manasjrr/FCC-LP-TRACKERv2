const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { DEFAULT_LANGUAGE, t, getTranslator } = require("../utils/i18n");
const logger = require("../utils/loggers");

const DOCS_URL = "https://ambessabot.reisrodrigo.com/pages/commands.html";

// Description et usage de chaque commande : locales → help.commands.<nom>
const COMMANDS_INFO = [
    { name: "add", emoji: "➕" },
    { name: "remove", emoji: "🗑️" },
    { name: "list", emoji: "📋" },
    { name: "stats", emoji: "📊" },
    { name: "history", emoji: "📜" },
    { name: "ingame", emoji: "🎥" },
    { name: "flex", emoji: "⚙️" },
    { name: "language", emoji: "🌐" },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription(t(DEFAULT_LANGUAGE, "commands.help.description")),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const tr = getTranslator(interaction.guildId);

        logger.info("COMMAND", `/help exécuté par ${interaction.user.tag}`, {
            guild: interaction.guildId,
        });

        const embed = new EmbedBuilder()
            .setTitle(tr("help.title"))
            .setDescription(tr("help.description", { url: DOCS_URL }))
            .setColor(0x5865f2)
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .setTimestamp()
            .setFooter({
                text: tr("common.requestedBy", { user: interaction.user.tag }),
                iconURL: interaction.user.displayAvatarURL(),
            });

        // ── Ajout des commandes ───────────────────────────────────────────────
        for (const cmd of COMMANDS_INFO) {
            embed.addFields({
                name: `${cmd.emoji} /${cmd.name}`,
                value: `${tr(`help.commands.${cmd.name}.description`)}\n\`\`\`${tr(`help.commands.${cmd.name}.usage`)}\`\`\``,
                inline: false,
            });
        }

        // ── Bouton vers la doc ────────────────────────────────────────────────
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel(tr("help.fullDocs"))
                .setURL(DOCS_URL)
                .setStyle(ButtonStyle.Link),
            new ButtonBuilder()
                .setLabel("🔗 DPM Leaderboard")
                .setURL("https://dpm.lol/leaderboards/2959450a-838c-4bd0-87fa-fe733f81c245")
                .setStyle(ButtonStyle.Link)
        );

        logger.success("COMMAND", `/help affiché pour ${interaction.user.tag}`, {
            guild: interaction.guildId,
        });

        await interaction.editReply({ embeds: [embed], components: [row] });
    },
};
