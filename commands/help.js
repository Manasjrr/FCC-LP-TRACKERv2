const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const logger = require("../utils/loggers");

const DOCS_URL = "https://ambessabot.reisrodrigo.com/pages/commands.html";

const COMMANDS_INFO = [
    {
        name: "/add",
        emoji: "➕",
        description: "Ajouter un compte League of Legends au monitoring",
        usage: "/add riot-id: Pseudo#TAG",
    },
    {
        name: "/remove",
        emoji: "🗑️",
        description: "Retirer un compte du monitoring",
        usage: "/remove numero: 1",
    },
    {
        name: "/list",
        emoji: "📋",
        description: "Afficher tous les comptes surveillés sur ce serveur",
        usage: "/list",
    },
    {
        name: "/stats",
        emoji: "📊",
        description: "Statistiques détaillées d'un joueur avec analyse de performance",
        usage: "/stats [rang: 1]",
    },
    {
        name: "/link",
        emoji: "🔗",
        description: "Lier ton compte Discord à un joueur suivi pour utiliser /stats sans argument",
        usage: "/link [numero: 1]",
    },
        {
        name: "/ingame",
        emoji: "🎥",
        description: "Affiche toute les comptes surveillées actuellement in-game",
        usage: "/ingame",
    },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription("Affiche la documentation et la liste des commandes disponibles"),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        logger.info("COMMAND", `/help exécuté par ${interaction.user.tag}`, {
            guild: interaction.guildId,
        });

        const embed = new EmbedBuilder()
            .setTitle("📖 Documentation — Ambessa Bot")
            .setDescription(
                `Voici un aperçu rapide des commandes disponibles.\n` +
                `Pour la documentation complète, clique sur le bouton ci-dessous !\n\n` +
                `> 🔗 **${DOCS_URL}**`
            )
            .setColor(0x5865f2)
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .setTimestamp()
            .setFooter({
                text: `Demandé par ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL(),
            });

        // ── Ajout des commandes ───────────────────────────────────────────────
        for (const cmd of COMMANDS_INFO) {
            embed.addFields({
                name: `${cmd.emoji} ${cmd.name}`,
                value: `${cmd.description}\n\`\`\`${cmd.usage}\`\`\``,
                inline: false,
            });
        }

        // ── Bouton vers la doc ────────────────────────────────────────────────
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel("📖 Documentation complète")
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
