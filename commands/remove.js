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

        // ── Récupérer les joueurs actifs sur CE serveur ───────────────────────
        const rows = global.db.prepare(`
            SELECT p.*, pg.id as pg_id, pg.user_id as added_by
            FROM players p
            JOIN player_guilds pg ON pg.player_id = p.id
            WHERE pg.guild_id = ? AND pg.active = 1
        `).all(interaction.guildId);

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
            // ── Désactivation dans player_guilds UNIQUEMENT ───────────────────
            // L'historique et le joueur global sont conservés
            global.db.prepare(`
                UPDATE player_guilds SET active = 0 WHERE id = ?
            `).run(targetRow.pg_id);

            logger.success('COMMAND', `Compte retiré du monitoring : ${targetRow.riot_id}`, {
                riotId: targetRow.riot_id,
                playerId: targetRow.id,
                pgId: targetRow.pg_id,
                removedBy: interaction.user.tag,
                guild: interaction.guildId
            });

            let embed;
            try {
                const user = await interaction.client.users.fetch(targetRow.added_by);
                embed = new EmbedBuilder()
                    .setTitle("🗑️ Compte retiré du monitoring")
                    .setDescription(
                        `**${targetRow.riot_id}** (ajouté par ${user.username}) n'est plus surveillé sur ce serveur.\n` +
                        `*L'historique des parties est conservé.*`
                    )
                    .setColor(0xff9900)
                    .setTimestamp();
            } catch {
                embed = new EmbedBuilder()
                    .setTitle("🗑️ Compte retiré du monitoring")
                    .setDescription(
                        `**${targetRow.riot_id}** n'est plus surveillé sur ce serveur.\n` +
                        `*L'historique des parties est conservé.*`
                    )
                    .setColor(0xff9900)
                    .setTimestamp();
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            logger.error('DB', `Erreur /remove : ${targetRow.riot_id}`, {
                error: err.message,
                playerId: targetRow.id,
                guild: interaction.guildId
            });
            return interaction.editReply("❌ Erreur lors de la suppression.");
        }
    },
};
