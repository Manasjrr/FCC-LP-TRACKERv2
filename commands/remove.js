const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getRankOrder } = require('../utils/rankUtils');
const logger = require("../utils/loggers");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("remove")
        .setDescription("Supprimer un compte du monitoring")
        .addIntegerOption((option) =>
            option
                .setName("numero")
                .setDescription("Numéro du compte à supprimer (voir avec /list)")
                .setRequired(true)
                .setMinValue(1),
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const numero = interaction.options.getInteger("numero");

        logger.info('COMMAND', `/remove exécuté par ${interaction.user.tag}`, {
            numero,
            guild: interaction.guildId
        });

        if (!global.db) {
            logger.error('DB', `Base de données non disponible pour /remove`, { guild: interaction.guildId });
            return interaction.editReply("❌ Base de données non disponible");
        }

        const rows = global.db.prepare(`SELECT * FROM players WHERE guild_id = ?`).all(interaction.guildId);

        if (!rows || rows.length === 0) {
            logger.info('COMMAND', `Aucun compte à supprimer`, { guild: interaction.guildId });
            return interaction.editReply("📭 Aucun compte à supprimer.");
        }

        rows.sort((a, b) => {
            const rankA = getRankOrder(a.last_rank, a.last_lp);
            const rankB = getRankOrder(b.last_rank, b.last_lp);

            if (rankA.order !== rankB.order) return rankB.order - rankA.order;
            if (rankA.divisionOrder !== rankB.divisionOrder) return rankB.divisionOrder - rankA.divisionOrder;
            return rankB.lp - rankA.lp;
        });

        if (numero < 1 || numero > rows.length) {
            logger.warn('COMMAND', `Numéro invalide dans /remove`, {
                numero,
                max: rows.length,
                user: interaction.user.tag,
                guild: interaction.guildId
            });
            return interaction.editReply(`❌ Numéro invalide ! Choisissez entre 1 et ${rows.length}.`);
        }

        const targetRow = rows[numero - 1];

        try {
            // Suppression des données liées avant le joueur (contraintes FK)
            global.db.prepare(`DELETE FROM match_history WHERE player_id = ?`).run(targetRow.id);
            global.db.prepare(`DELETE FROM user_links WHERE player_id = ?`).run(targetRow.id);
            global.db.prepare(`DELETE FROM players WHERE id = ?`).run(targetRow.id);

            logger.success('COMMAND', `Compte supprimé du monitoring : ${targetRow.riot_id}`, {
                riotId: targetRow.riot_id,
                playerId: targetRow.id,
                removedBy: interaction.user.tag,
                guild: interaction.guildId
            });

            let embed;
            try {
                const user = await interaction.client.users.fetch(targetRow.user_id);
                embed = new EmbedBuilder()
                    .setTitle("🗑️ Compte supprimé")
                    .setDescription(`**${targetRow.riot_id}** (ajouté par ${user.username}) n'est plus surveillé.`)
                    .setColor(0xff9900)
                    .setTimestamp();
            } catch {
                logger.warn('COMMAND', `Impossible de fetch l'utilisateur lié à ${targetRow.riot_id}`, {
                    userId: targetRow.user_id
                });
                embed = new EmbedBuilder()
                    .setTitle("🗑️ Compte supprimé")
                    .setDescription(`**${targetRow.riot_id}** n'est plus surveillé.`)
                    .setColor(0xff9900)
                    .setTimestamp();
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            logger.error('DB', `Erreur suppression dans /remove : ${targetRow.riot_id}`, {
                error: err.message,
                playerId: targetRow.id,
                guild: interaction.guildId
            });
            return interaction.editReply("❌ Erreur lors de la suppression.");
        }
    },
};
