const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const logger = require("../utils/loggers");
const { autocompletePlayers } = require("../utils/playerUtils");
const { DEFAULT_LANGUAGE, t, getTranslator } = require("../utils/i18n");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("remove")
        .setDescription(t(DEFAULT_LANGUAGE, "commands.remove.description"))
        .addStringOption((option) =>
            option
                .setName("player")
                .setDescription(t(DEFAULT_LANGUAGE, "commands.remove.options.player.description"))
                .setRequired(true)
                .setAutocomplete(true)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const tr = getTranslator(interaction.guildId);
        const riotId = interaction.options.getString("player");

        logger.info('COMMAND', `/remove exécuté par ${interaction.user.tag}`, {
            riotId,
            guild: interaction.guildId
        });

        if (!global.db) {
            logger.error('DB', `Base de données non disponible pour /remove`, { guild: interaction.guildId });
            return interaction.editReply(tr("common.dbUnavailable"));
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
            return interaction.editReply(tr("common.playerNotFound", { player: riotId }));
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

            let description;
            try {
                const user = await interaction.client.users.fetch(targetRow.added_by);
                description = tr("remove.descriptionAddedBy", { riotId: targetRow.riot_id, user: user.username });
            } catch {
                description = tr("remove.description", { riotId: targetRow.riot_id });
            }

            const embed = new EmbedBuilder()
                .setTitle(tr("remove.title"))
                .setDescription(description)
                .setColor(0xff9900)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            logger.error('DB', `Erreur /remove : ${targetRow.riot_id}`, {
                error: err.message,
                playerId: targetRow.id,
                guild: interaction.guildId
            });
            return interaction.editReply(tr("remove.error"));
        }
    },

    autocomplete: autocompletePlayers,
};
