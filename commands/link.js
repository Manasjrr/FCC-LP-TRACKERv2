const { SlashCommandBuilder } = require("discord.js");
const { getRankEmoji, getRankOrder } = require("../utils/rankUtils");
const logger = require("../utils/loggers");

function sortPlayersByRank(players) {
    return players.sort((a, b) => {
        const rankA = getRankOrder(a.last_rank, a.last_lp);
        const rankB = getRankOrder(b.last_rank, b.last_lp);
        if (rankB.order !== rankA.order) return rankB.order - rankA.order;
        if (rankB.divisionOrder !== rankA.divisionOrder) return rankB.divisionOrder - rankA.divisionOrder;
        return (rankB.lp || 0) - (rankA.lp || 0);
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("link")
        .setDescription("Se lier à un compte du classement ou voir son compte actuel")
        .addIntegerOption((option) =>
            option
                .setName("numero")
                .setDescription("Numéro du classement (utilisez /list pour voir)")
                .setRequired(false)
                .setMinValue(1),
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const numero = interaction.options.getInteger("numero");
        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        logger.info('COMMAND', `/link exécuté par ${interaction.user.tag}`, {
            numero: numero || 'consultation',
            guild: guildId
        });

        // ── PAS DE NUMÉRO → AFFICHER COMPTE LIÉ ──────────────────────────────
        if (!numero) {
            const linkedPlayer = global.db.prepare(`
                SELECT p.* FROM user_links ul
                JOIN players p ON ul.player_id = p.id
                WHERE ul.user_id = ? AND ul.guild_id = ?
            `).get(userId, guildId);

            if (!linkedPlayer) {
                return interaction.editReply(
                    "❌ **Aucun compte lié**\n\n*Utilisez `/link numero:X` pour vous lier à un compte*"
                );
            }

            const rankEmoji = getRankEmoji(linkedPlayer.last_rank);
            return interaction.editReply(
                `🔗 **Compte actuellement lié :**\n\n` +
                `**${linkedPlayer.riot_id}** ${rankEmoji} **${linkedPlayer.last_rank || "UNRANKED"}** (${linkedPlayer.last_lp || 0} LP)\n\n` +
                `*Utilisez \`/stats\` pour voir vos statistiques !*`
            );
        }

        // ── NUMÉRO → CRÉER LIAISON ────────────────────────────────────────────
        // Récupérer les joueurs actifs sur CE serveur via player_guilds
        const players = global.db.prepare(`
            SELECT p.* FROM players p
            JOIN player_guilds pg ON pg.player_id = p.id
            WHERE pg.guild_id = ? AND pg.active = 1
        `).all(guildId);

        if (!players?.length) {
            return interaction.editReply("❌ Aucun compte disponible sur ce serveur");
        }

        sortPlayersByRank(players);

        if (numero > players.length) {
            return interaction.editReply(
                `❌ Numéro invalide ! Utilisez un numéro entre **1** et **${players.length}**`
            );
        }

        const targetPlayer = players[numero - 1];

        // ── Vérification liaison existante ────────────────────────────────────
        const existingLink = global.db.prepare(
            `SELECT user_id FROM user_links WHERE player_id = ? AND guild_id = ?`
        ).get(targetPlayer.id, guildId);

        if (existingLink && existingLink.user_id !== userId) {
            return interaction.editReply("❌ Ce compte est déjà lié à un autre utilisateur !");
        }

        // ── Insertion BDD ─────────────────────────────────────────────────────
        try {
            global.db.transaction(() => {
                global.db.prepare(`DELETE FROM user_links WHERE user_id = ? AND guild_id = ?`).run(userId, guildId);
                global.db.prepare(`INSERT OR REPLACE INTO user_links (user_id, guild_id, player_id) VALUES (?, ?, ?)`).run(userId, guildId, targetPlayer.id);
            })();

            logger.success('COMMAND', `Liaison créée : ${interaction.user.tag} → ${targetPlayer.riot_id}`, {
                userId,
                playerId: targetPlayer.id,
                guild: guildId
            });

            const rankEmoji = getRankEmoji(targetPlayer.last_rank);
            return interaction.editReply(
                `✅ **Compte lié avec succès !**\n` +
                `🔗 **${targetPlayer.riot_id}** ${rankEmoji} **${targetPlayer.last_rank || "UNRANKED"}** (${targetPlayer.last_lp || 0} LP)\n\n` +
                `*Vous pouvez maintenant utiliser \`/stats\` sans argument !*`
            );

        } catch (err) {
            logger.error('DB', `Erreur liaison /link`, { error: err.message, guild: guildId });
            return interaction.editReply("❌ Erreur lors de la liaison du compte");
        }
    },
};
