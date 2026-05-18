const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getRankEmoji, getRankOrder } = require("../utils/rankUtils");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("link")
        .setDescription(
            "Se lier à un compte du classement ou voir son compte actuel",
        )
        .addIntegerOption((option) =>
            option
                .setName("numero")
                .setDescription(
                    "Numéro du classement (utilisez /list pour voir)",
                )
                .setRequired(false) // 🔄 PLUS OBLIGATOIRE
                .setMinValue(1),
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true }); // 🔒 MESSAGE PRIVÉ

        const numero = interaction.options.getInteger("numero");
        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        // 📋 SI PAS DE NUMÉRO → AFFICHER COMPTE LIÉ
        if (!numero) {
            const linkedPlayer = global.db.prepare(
                `SELECT p.* FROM user_links ul 
         JOIN players p ON ul.player_id = p.id 
         WHERE ul.user_id = ? AND ul.guild_id = ?`
            ).get(userId, guildId);

            if (!linkedPlayer) {
                return interaction.editReply(
                    "❌ **Aucun compte lié**\n\n*Utilisez `/link numero:X` pour vous lier à un compte*",
                );
            }

            const rankEmoji = getRankEmoji(linkedPlayer.last_rank);
            const message = `🔗 **Compte actuellement lié :**\n\n**${linkedPlayer.riot_id}** ${rankEmoji} **${linkedPlayer.last_rank || "UNRANKED"}** (${linkedPlayer.last_lp || 0} LP)\n\n*Utilisez \`/stats\` pour voir vos statistiques !*`;

            return interaction.editReply(message);
        }


        // 🔗 SI NUMÉRO → CRÉER LIAISON
        const players = global.db.prepare(`SELECT * FROM players WHERE guild_id = ?`).all(guildId);

        if (!players || players.length === 0) {
            return interaction.editReply("❌ Aucun compte disponible sur ce serveur");
        }

        // Trier exactement comme dans /list
        players.sort((a, b) => {
            const rankA = getRankOrder(a.last_rank, a.last_lp);
            const rankB = getRankOrder(b.last_rank, b.last_lp);
            return rankB - rankA;
        });

        // Vérifier numéro valide
        if (numero > players.length) {
            return interaction.editReply(
                `❌ Numéro invalide ! Utilisez un numéro entre 1 et ${players.length}`
            );
        }

        const targetPlayer = players[numero - 1];

        // Vérifier si déjà lié à quelqu'un d'autre
        const existingLink = global.db.prepare(
            `SELECT user_id FROM user_links WHERE player_id = ? AND guild_id = ?`
        ).get(targetPlayer.id, guildId);

        if (existingLink && existingLink.user_id !== userId) {
            return interaction.editReply("❌ Ce compte est déjà lié à un autre utilisateur !");
        }

        try {
            global.db.prepare(`DELETE FROM user_links WHERE user_id = ? AND guild_id = ?`).run(userId, guildId);
            global.db.prepare(`INSERT OR REPLACE INTO user_links (user_id, guild_id, player_id) VALUES (?, ?, ?)`).run(userId, guildId, targetPlayer.id);

            const rankEmoji = getRankEmoji(targetPlayer.last_rank);
            return interaction.editReply(
                `✅ **Compte lié avec succès !**\n🔗 **${targetPlayer.riot_id}** ${rankEmoji} **${targetPlayer.last_rank || "UNRANKED"}** (${targetPlayer.last_lp || 0} LP)\n\n*Vous pouvez maintenant utiliser /stats sans argument !*`
            );
        } catch (err) {
            return interaction.editReply("❌ Erreur lors de la liaison du compte");
        }
    },
};
