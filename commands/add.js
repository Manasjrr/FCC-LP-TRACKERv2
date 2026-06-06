const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getAccountByRiotId, getRecentMatchIds, getRankedDataByPuuid } = require("../services/riotApiService");
const logger = require("../utils/loggers");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("add")
        .setDescription("Ajouter un compte LOL au monitoring")
        .addStringOption((option) =>
            option
                .setName("riot-id")
                .setDescription("Riot ID (Nom#TAG)")
                .setRequired(true),
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const riotId = interaction.options.getString("riot-id");

        logger.info('COMMAND', `Commande /add exécutée par ${interaction.user.tag}`, {
            riotId,
            guild: interaction.guildId
        });

        if (!global.db) {
            logger.error('DB', `Base de données non disponible lors du /add`, { user: interaction.user.tag });
            return interaction.editReply("Base de données non disponible");
        }

        // ── Validation du format ──────────────────────────────────────────────
        const [gameName, tagLine] = riotId.split("#");
        if (!gameName || !tagLine) {
            logger.warn('COMMAND', `Format Riot ID invalide : ${riotId}`, { user: interaction.user.tag });
            return interaction.editReply("❌ Format invalide ! Utilisez : Pseudonyme#TAG");
        }

        // ── Vérification doublon sur CE serveur ───────────────────────────────
        const existingOnGuild = global.db.prepare(`
            SELECT pg.id FROM player_guilds pg
            JOIN players p ON p.id = pg.player_id
            WHERE pg.guild_id = ? AND p.riot_id = ? AND pg.active = 1
        `).get(interaction.guildId, riotId);

        if (existingOnGuild) {
            logger.info('COMMAND', `Compte déjà surveillé sur ce serveur : ${riotId}`, {
                guild: interaction.guildId
            });
            return interaction.editReply("❌ Ce compte est déjà surveillé sur ce serveur !");
        }

        // ── Appels API Riot ───────────────────────────────────────────────────
        try {
            // 1) PUUID
            const account = await getAccountByRiotId(gameName, tagLine);
            const puuid = account.puuid;
            logger.info('COMMAND', `PUUID récupéré pour ${riotId}`, {
                puuid: puuid.substring(0, 8) + '...'
            });

            // ── Vérifier si le joueur existe déjà globalement (autre serveur) ──
            const existingPlayer = global.db.prepare(`
                SELECT * FROM players WHERE puuid = ?
            `).get(puuid);

            let playerId;
            let currentRank;
            let currentLP;

            if (existingPlayer) {
                // ── Joueur déjà connu → on réutilise ses données ──────────────
                playerId    = existingPlayer.id;
                currentRank = existingPlayer.last_rank;
                currentLP   = existingPlayer.last_lp;

                logger.info('COMMAND', `Joueur déjà connu globalement : ${riotId}`, {
                    playerId,
                    rank: currentRank,
                    existingGuilds: global.db.prepare(
                        `SELECT COUNT(*) as c FROM player_guilds WHERE player_id = ?`
                    ).get(playerId).c
                });

            } else {
                // ── Nouveau joueur → appels API + insertion dans players ───────
                const [matchIds, rankedData] = await Promise.all([
                    getRecentMatchIds(puuid, 1),
                    getRankedDataByPuuid(puuid),
                ]);

                const lastMatchId     = matchIds[0] ?? null;
                const soloQueueEntry  = rankedData.find(e => e.queueType === "RANKED_SOLO_5x5") ?? null;
                currentRank           = soloQueueEntry ? `${soloQueueEntry.tier} ${soloQueueEntry.rank}` : "Non classé";
                currentLP             = soloQueueEntry?.leaguePoints ?? 0;

                if (lastMatchId) {
                    logger.info('COMMAND', `Dernier match trouvé pour ${riotId}`, { matchId: lastMatchId });
                } else {
                    logger.info('COMMAND', `Aucun match trouvé pour ${riotId}`);
                }

                if (soloQueueEntry) {
                    logger.info('COMMAND', `Rang récupéré pour ${riotId}`, { rank: currentRank, lp: currentLP });
                } else {
                    logger.info('COMMAND', `${riotId} non classé en SoloQ`);
                }

                const result = global.db.prepare(`
                    INSERT INTO players (
                        user_id, guild_id, channel_id,
                        riot_id, puuid,
                        last_match_id, last_lp, last_rank
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    interaction.user.id,
                    interaction.guildId,
                    interaction.channelId,
                    riotId,
                    puuid,
                    lastMatchId,
                    currentLP,
                    currentRank
                );

                playerId = result.lastInsertRowid;

                logger.success('DB', `Nouveau joueur inséré : ${riotId}`, {
                    playerId,
                    guild: interaction.guildId,
                    rank: currentRank,
                    lp: currentLP
                });
            }

            // ── Insertion dans player_guilds dans tous les cas ─────────────────
            global.db.prepare(`
                INSERT INTO player_guilds (player_id, guild_id, channel_id, user_id, active)
                VALUES (?, ?, ?, ?, 1)
            `).run(playerId, interaction.guildId, interaction.channelId, interaction.user.id);

            logger.success('DB', `player_guilds créé pour ${riotId}`, {
                playerId,
                guild: interaction.guildId
            });

            // ── Réponse ───────────────────────────────────────────────────────
            const isAlreadyKnown = !!existingPlayer;
            const embed = new EmbedBuilder()
                .setTitle("✅ Compte ajouté !")
                .setDescription(
                    `**${riotId}** est maintenant surveillé sur ce serveur !\n` +
                    `📊 **Rang :** ${currentRank} (${currentLP} LP)` +
                    (isAlreadyKnown ? `\n\n*Ce joueur est déjà suivi sur d'autres serveurs, les stats sont partagées !*` : "")
                )
                .setColor(0x00ff00)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            if (error.response?.status === 404) {
                logger.warn('API', `Joueur introuvable sur Riot : ${riotId}`, { status: 404 });
                await interaction.editReply(`❌ Joueur introuvable : **${riotId}**`);
            } else if (error.response?.status === 403) {
                logger.error('API', `Clé API Riot invalide ou expirée`, { status: 403 });
                await interaction.editReply(`❌ Clé API Riot invalide ou expirée !`);
            } else if (error.code === 'SQLITE_CONSTRAINT') {
                logger.error('DB', `Contrainte BDD violée pour ${riotId}`, { error: error.message });
                await interaction.editReply("❌ Ce compte existe déjà dans la base de données.");
            } else {
                logger.error('COMMAND', `Erreur inattendue /add pour ${riotId}`, {
                    error: error.message,
                    status: error.response?.status
                });
                await interaction.editReply(`❌ Erreur : ${error.message}`);
            }
        }
    },
};
