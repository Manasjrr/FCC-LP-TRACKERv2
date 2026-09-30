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
        const footerLink = `*[${tr("list.dpmLeaderboard")}](https://dpm.lol/leaderboards/2959450a-838c-4bd0-87fa-fe733f81c245)*`;
        // Limite Discord : 4096 caractères par description (marge pour la ligne "… et N autres")
        const MAX_DESCRIPTION = 4096 - footerLink.length - 80;
        let shown = 0;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            let entry;
            try {
                const rankEmoji = getRankEmoji(row.last_rank);
                const dpmLink = `[DPM](${getDpmUrl(row.riot_id)})`;
                const rating = computePlayerRating(row.id);
                const ratingText = rating.empty
                    ? ""
                    : ` • **${rating.score}/100** (${rating.tier.grade})${rating.provisional ? ` ${tr("list.provisional")}` : ""}`;

                entry = `**${i + 1}.** ${row.riot_id} ${dpmLink}\n`;
                entry += `└ ${rankEmoji} ${row.last_rank || "UNRANKED"} (${row.last_lp || 0} LP)${ratingText}\n\n`;

            } catch (error) {
                logger.warn('COMMAND', `Erreur affichage joueur dans /list : ${row.riot_id}`, {
                    error: error.message,
                    guild: interaction.guildId
                });

                const rankEmoji = getRankEmoji(row.last_rank);
                entry = `**${i + 1}.** ${row.riot_id}\n`;
                entry += `└ ${tr("list.userNotFound")}\n`;
                entry += `└ ${rankEmoji} ${row.last_rank || "UNRANKED"} (${row.last_lp || 0} LP)\n\n`;
            }

            if (description.length + entry.length > MAX_DESCRIPTION) break;
            description += entry;
            shown++;
        }

        logger.success('COMMAND', `/list affiché avec succès`, {
            count: rows.length,
            guild: interaction.guildId
        });

        if (shown < rows.length) description += `${tr("list.more", { count: rows.length - shown })}\n\n`;
        description += footerLink;
        embed.setDescription(description);
        await interaction.editReply({ embeds: [embed] });
    },
};
