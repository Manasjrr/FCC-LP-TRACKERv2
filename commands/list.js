const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getRankEmoji } = require("../utils/rankUtils");
const logger = require("../utils/loggers");
const { getGuildPlayers, sortPlayersByRank, getDpmUrl } = require("../utils/playerUtils");
const { computePlayerRating } = require("../utils/ratingUtils");
const { DEFAULT_LANGUAGE, t, getTranslator } = require("../utils/i18n");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("list")
        .setDescription(t(DEFAULT_LANGUAGE, "commands.list.description")),

    async execute(interaction) {
        await interaction.deferReply();

        const tr = getTranslator(interaction.guildId);

        logger.info('COMMAND', `/list exécuté par ${interaction.user.tag}`, { guild: interaction.guildId });

        // ── Joueurs actifs sur CE serveur uniquement ───────────────────────────
        const rows = getGuildPlayers(interaction.guildId);

        if (!rows || rows.length === 0) {
            logger.info('COMMAND', `Aucun compte surveillé sur le serveur`, { guild: interaction.guildId });
            return interaction.editReply(tr("common.noTrackedAccounts"));
        }

        sortPlayersByRank(rows);

        const embed = new EmbedBuilder()
            .setTitle(tr("list.title"))
            .setColor(0x3498db)
            .setTimestamp()
            .setFooter({ text: tr("list.footer", { count: rows.length }) });

        let description = `${tr("list.sortedByRank")}\n\n`;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            try {
                const rankEmoji = getRankEmoji(row.last_rank);
                const dpmLink = `[DPM](${getDpmUrl(row.riot_id)})`;
                const rating = computePlayerRating(row.id);
                const ratingText = rating.empty
                    ? ""
                    : ` • **${rating.score}/100** (${rating.tier.grade})${rating.provisional ? ` ${tr("list.provisional")}` : ""}`;

                description += `**${i + 1}.** ${row.riot_id} ${dpmLink}\n`;
                description += `└ ${rankEmoji} ${row.last_rank || "UNRANKED"} (${row.last_lp || 0} LP)${ratingText}\n\n`;

            } catch (error) {
                logger.warn('COMMAND', `Erreur affichage joueur dans /list : ${row.riot_id}`, {
                    error: error.message,
                    guild: interaction.guildId
                });

                const rankEmoji = getRankEmoji(row.last_rank);
                description += `**${i + 1}.** ${row.riot_id}\n`;
                description += `└ ${tr("list.userNotFound")}\n`;
                description += `└ ${rankEmoji} ${row.last_rank || "UNRANKED"} (${row.last_lp || 0} LP)\n\n`;
            }
        }

        logger.success('COMMAND', `/list affiché avec succès`, {
            count: rows.length,
            guild: interaction.guildId
        });

        description += `*[${tr("list.dpmLeaderboard")}](https://dpm.lol/leaderboards/2959450a-838c-4bd0-87fa-fe733f81c245)*`;
        embed.setDescription(description);
        await interaction.editReply({ embeds: [embed] });
    },
};
