const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const logger = require("../utils/loggers");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("remove")
        .setDescription("Supprimer un compte du monitoring")
        .addStringOption((option) =>
            option
                .setName("joueur")
                .setDescription("Riot ID du compte à supprimer")
                .setRequired(true)
                .setAutocomplete(true)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const riotId = interaction.options.getString("joueur");

        logger.info('COMMAND', `/remove exécuté par ${interaction.user.tag}`, {
            riotId,
            guild: interaction.guildId
        });

        if (!global.db) {
            logger.error('DB', `Base de données non disponible pour /remove`, { guild: interaction.guildId });
            return interaction.editReply("Base de données non disponible");
        }

        // ── Récupérer le compte ciblé sur CE serveur ──────────────────────────
        const targetRow = global.db.prepare(`
            SELECT p.*, pg.id as pg_id, pg.user_id as added_by
            FROM players p
            JOIN player_guilds pg ON pg.player_id = p.id
            WHERE pg.guild_id = ? AND pg.active = 1 AND p.riot_id = ?
        `).get(interaction.guildId, riotId);

        if (!targetRow) {
            logger.warn('COMMAND', `Compte "${riotId}" introuvable dans /remove`, {
                user: interaction.user.tag,
                guild: interaction.guildId
            });
            return interaction.editReply(
                `Aucun compte trouvé pour **${riotId}** sur ce serveur.\n` +
                `*Utilise l'autocomplétion ou vérifie \`/list\`.*`
            );
        }

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
            return interaction.editReply("Erreur lors de la suppression.");
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