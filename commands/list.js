const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getRankEmoji, getRankOrder } = require("../utils/rankUtils");
module.exports = {
    data: new SlashCommandBuilder()
        .setName("list")
        .setDescription("Affiche la liste des comptes surveillés"),

    async execute(interaction) {
        await interaction.deferReply();

        // Vous devez importer 'db' en haut du fichier ou le passer depuis index.js
        // Pour l'instant, je vais supposer que 'db' est disponible globalement

        const rows = global.db.prepare(`SELECT * FROM players WHERE guild_id = ?`).all(interaction.guildId);

        if (!rows || rows.length === 0) {
            return interaction.editReply("📭 Aucun compte surveillé sur ce serveur.");
        }

        // 🏆 TRI PAR RANG, DIVISION, LP
        rows.sort((a, b) => {
            const rankA = getRankOrder(a.last_rank, a.last_lp);
            const rankB = getRankOrder(b.last_rank, b.last_lp);

            if (rankB.order !== rankA.order) return rankB.order - rankA.order;
            if (rankB.divisionOrder !== rankA.divisionOrder) return rankB.divisionOrder - rankA.divisionOrder;
            return (rankB.lp || 0) - (rankA.lp || 0);
        });

        const embed = new EmbedBuilder()
            .setTitle("📋 Comptes surveillés")
            .setColor(0x3498db)
            .setTimestamp()
            .setFooter({ text: `${rows.length} compte(s) total` });

        let description = "🏆 *Classés par rang décroissant*\n\n";

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            try {
                const rankEmoji = getRankEmoji(row.last_rank);
                const riotIdFormatted = row.riot_id.replace('#', '-').replace(/ /g, '%20');
                const dpmLink = `[DPM](https://dpm.lol/${riotIdFormatted})`;

                description += `**${i + 1}.** ${row.riot_id} ${dpmLink}\n`;
                description += `└ ${rankEmoji} ${row.last_rank || "Non classé"} (${row.last_lp || 0} LP)\n\n`;
            } catch (error) {
                console.error(`Erreur récupération user/channel pour ${row.riot_id}:`, error);
                const rankEmoji = getRankEmoji(row.last_rank);

                description += `**${i + 1}.** ${row.riot_id}\n`;
                description += `└ ⚠️ Utilisateur/Channel introuvable\n`;
                description += `└ ${rankEmoji} ${row.last_rank || "Non classé"} (${row.last_lp || 0} LP)\n\n`;
            }
        }

        description += `*[ℹ️ Classement DPM](https://dpm.lol/leaderboards/2959450a-838c-4bd0-87fa-fe733f81c245)*`;
        embed.setDescription(description);
        await interaction.editReply({ embeds: [embed] });
    },
};
