const { SlashCommandBuilder } = require("discord.js");
const { getRankEmoji } = require("../utils/rankUtils");
const logger = require("../utils/loggers");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("link")
        .setDescription("Se lier à un compte du classement ou voir son compte actuel")
        .addStringOption((option) =>
            option
                .setName("joueur")
                .setDescription("Riot ID du compte à lier")
                .setRequired(false)
                .setAutocomplete(true)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const riotId = interaction.options.getString("joueur");
        const userId = interaction.user.id;
        const guildId = interaction.guildId;

        logger.info('COMMAND', `/link exécuté par ${interaction.user.tag}`, {
            joueur: riotId || 'consultation',
            guild: guildId
        });

        // ── PAS DE JOUEUR → AFFICHER COMPTE LIÉ ──────────────────────────────
        if (!riotId) {
            const linkedPlayer = global.db.prepare(`
                SELECT p.* FROM user_links ul
                JOIN players p ON ul.player_id = p.id
                WHERE ul.user_id = ? AND ul.guild_id = ?
            `).get(userId, guildId);

            if (!linkedPlayer) {
                return interaction.editReply(
                    "**Aucun compte lié**\n\n*Utilisez `/link joueur:<pseudo>` pour vous lier à un compte*"
                );
            }

            const rankEmoji = getRankEmoji(linkedPlayer.last_rank);
            return interaction.editReply(
                `🔗 **Compte actuellement lié :**\n\n` +
                `**${linkedPlayer.riot_id}** ${rankEmoji} **${linkedPlayer.last_rank || "UNRANKED"}** (${linkedPlayer.last_lp || 0} LP)\n\n` +
                `*Utilisez \`/stats\` pour voir vos statistiques !*`
            );
        }

        // ── JOUEUR → CRÉER LIAISON ────────────────────────────────────────────
        const targetPlayer = global.db.prepare(`
            SELECT p.* FROM players p
            JOIN player_guilds pg ON pg.player_id = p.id
            WHERE pg.guild_id = ? AND pg.active = 1 AND p.riot_id = ?
        `).get(guildId, riotId);

        if (!targetPlayer) {
            logger.warn('COMMAND', `Compte "${riotId}" introuvable dans /link`, {
                user: interaction.user.tag,
                guild: guildId
            });
            return interaction.editReply(
                `Aucun compte trouvé pour **${riotId}** sur ce serveur.\n` +
                `*Utilise l'autocomplétion ou vérifie \`/list\`.*`
            );
        }

        // ── Vérification liaison existante ────────────────────────────────────
        const existingLink = global.db.prepare(
            `SELECT user_id FROM user_links WHERE player_id = ? AND guild_id = ?`
        ).get(targetPlayer.id, guildId);

        if (existingLink && existingLink.user_id !== userId) {
            return interaction.editReply("Ce compte est déjà lié à un autre utilisateur !");
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
            return interaction.editReply("Erreur lors de la liaison du compte");
        }
    },

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const guildId = interaction.guildId;

        if (!global.db) return interaction.respond([]);

        const rows = global.db.prepare(`
            SELECT DISTINCT p.riot_id FROM players p
            JOIN player_guilds pg ON pg.player_id = p.id
            WHERE pg.guild_id = ? AND pg.active = 1
        `).all(guildId);

        const filtered = rows
            .filter((r) => r.riot_id.toLowerCase().includes(focusedValue))
            .slice(0, 25);

        await interaction.respond(
            filtered.map((r) => ({ name: r.riot_id, value: r.riot_id }))
        );
    },
};