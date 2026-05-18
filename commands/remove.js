const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getRankOrder } = require('../utils/rankUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("remove")
        .setDescription("Supprimer un compte du monitoring")
        .addIntegerOption((option) =>
            option
                .setName("numero")
                .setDescription(
                    "Numéro du compte à supprimer (voir avec /list)",
                )
                .setRequired(true)
                .setMinValue(1),
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const numero = interaction.options.getInteger("numero");

        // Vérifier que la DB est disponible
        if (!global.db) {
            return interaction.editReply("❌ Base de données non disponible");
        }

        const rows = global.db.prepare(`SELECT * FROM players WHERE guild_id = ?`).all(interaction.guildId);

        if (!rows || rows.length === 0) {
            return interaction.editReply("📭 Aucun compte à supprimer.");
        }

        // 🔥 TRI IDENTIQUE AU /list (par rang décroissant)
        rows.sort((a, b) => {
            const rankA = getRankOrder(a.last_rank, a.last_lp);
            const rankB = getRankOrder(b.last_rank, b.last_lp);

            if (rankA.order !== rankB.order) return rankB.order - rankA.order;
            if (rankA.divisionOrder !== rankB.divisionOrder) return rankB.divisionOrder - rankA.divisionOrder;
            return rankB.lp - rankA.lp;
        });

        if (numero < 1 || numero > rows.length) {
            return interaction.editReply(`❌ Numéro invalide ! Choisissez entre 1 et ${rows.length}.`);
        }

        const targetRow = rows[numero - 1];

        try {
            global.db.prepare(`DELETE FROM players WHERE id = ?`).run(targetRow.id);

            let embed;
            try {
                const user = await interaction.client.users.fetch(targetRow.user_id);
                embed = new EmbedBuilder()
                    .setTitle("🗑️ Compte supprimé")
                    .setDescription(`**${targetRow.riot_id}** (ajouté par ${user.username}) n'est plus surveillé.`)
                    .setColor(0xff9900)
                    .setTimestamp();
            } catch {
                embed = new EmbedBuilder()
                    .setTitle("🗑️ Compte supprimé")
                    .setDescription(`**${targetRow.riot_id}** n'est plus surveillé.`)
                    .setColor(0xff9900)
                    .setTimestamp();
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error("❌ Erreur suppression:", err);
            return interaction.editReply("❌ Erreur lors de la suppression.");
        }
    },
};
