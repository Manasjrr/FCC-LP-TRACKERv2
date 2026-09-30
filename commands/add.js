const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getAccountByRiotId, getRecentMatchIds, getRankedDataByPuuid } = require("../services/riotApiService");
const { DEFAULT_LANGUAGE, t, getTranslator } = require("../utils/i18n");
const logger = require("../utils/loggers");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("add")
        .setDescription(t(DEFAULT_LANGUAGE, "commands.add.description"))
        .addStringOption((option) =>
            option
                .setName("riot-id")
                .setDescription(t(DEFAULT_LANGUAGE, "commands.add.options.riot-id.description"))
                .setRequired(true),
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const tr = getTranslator(interaction.guildId);
        const riotId = interaction.options.getString("riot-id");

        logger.info('COMMAND', `Commande /add exécutée par ${interaction.user.tag}`, {
            riotId,
            guild: interaction.guildId
        });

        if (!global.db) {
            logger.error('DB', `Base de données non disponible lors du /add`, { user: interaction.user.tag });
            return interaction.editReply(tr("common.dbUnavailable"));
        }

        // ── Validation du format ──────────────────────────────────────────────
        const [gameName, tagLine] = riotId.split("#").map((part) => part?.trim());
        if (!gameName || !tagLine) {
            logger.warn('COMMAND', `Format Riot ID invalide : ${riotId}`, { user: interaction.user.tag });
            return interaction.editReply(tr("add.invalidFormat"));
        }

        // ── Vérification doublon actif sur CE serveur ─────────────────────────
        const existingOnGuild = global.db.prepare(`
            SELECT pg.id FROM player_guilds pg
            JOIN players p ON p.id = pg.player_id
            WHERE pg.guild_id = ? AND p.riot_id = ? AND pg.active = 1
        `).get(interaction.guildId, riotId);

        if (existingOnGuild) {
            logger.info('COMMAND', `Compte déjà surveillé sur ce serveur : ${riotId}`, {
                guild: interaction.guildId
            });
            return interaction.editReply(tr("add.alreadyTracked"));
        }

        // ── Appels API Riot ───────────────────────────────────────────────────
        try {
            const account = await getAccountByRiotId(gameName, tagLine);
            const puuid = account.puuid;
            // Riot ID officiel (casse exacte) plutôt que la saisie de l'utilisateur
            const canonicalRiotId = account.gameName && account.tagLine
                ? `${account.gameName}#${account.tagLine}`
                : riotId;
            logger.info('COMMAND', `PUUID récupéré pour ${riotId}`, {
                puuid: puuid.substring(0, 8) + '...'
            });

            // ── Vérifier si le joueur existe déjà globalement ─────────────────
            const existingPlayer = global.db.prepare(`
                SELECT * FROM players WHERE puuid = ?
            `).get(puuid);

            let playerId;
            let currentRank;
            let currentLP;

            if (existingPlayer) {
                // ── Joueur connu → réutiliser ses données ─────────────────────
                playerId = existingPlayer.id;
                currentRank = existingPlayer.last_rank;
                currentLP = existingPlayer.last_lp;

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

                const lastMatchId = matchIds[0] ?? null;
                const soloQueueEntry = rankedData.find(e => e.queueType === "RANKED_SOLO_5x5") ?? null;
                currentRank = soloQueueEntry ? `${soloQueueEntry.tier} ${soloQueueEntry.rank}` : "UNRANKED";
                currentLP = soloQueueEntry?.leaguePoints ?? 0;

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
                    canonicalRiotId,
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

            // ── Insertion ou réactivation dans player_guilds ──────────────────
            const existingInGuild = global.db.prepare(`
                SELECT active FROM player_guilds
                WHERE player_id = ? AND guild_id = ?
            `).get(playerId, interaction.guildId);

            if (existingInGuild?.active) {
                // Déjà suivi sur ce serveur (Riot ID saisi avec une autre casse / un ancien pseudo)
                logger.info('COMMAND', `Compte déjà surveillé sur ce serveur : ${canonicalRiotId}`, {
                    guild: interaction.guildId
                });
                return interaction.editReply(tr("add.alreadyTracked"));
            }

            if (existingInGuild) {
                // Entrée existante (active = 0) → réactiver
                global.db.prepare(`
                    UPDATE player_guilds
                    SET active = 1, channel_id = ?, user_id = ?
                    WHERE player_id = ? AND guild_id = ?
                `).run(interaction.channelId, interaction.user.id, playerId, interaction.guildId);

                logger.success('DB', `player_guilds réactivé pour ${riotId}`, {
                    playerId,
                    guild: interaction.guildId
                });
            } else {
                // Nouvelle entrée
                global.db.prepare(`
                    INSERT INTO player_guilds (player_id, guild_id, channel_id, user_id, active)
                    VALUES (?, ?, ?, ?, 1)
                `).run(playerId, interaction.guildId, interaction.channelId, interaction.user.id);

                logger.success('DB', `player_guilds créé pour ${riotId}`, {
                    playerId,
                    guild: interaction.guildId
                });
            }

            // ── Réponse ───────────────────────────────────────────────────────
            const isAlreadyKnown = !!existingPlayer;
            const embed = new EmbedBuilder()
                .setTitle(tr("add.title"))
                .setDescription(
                    tr("add.description", { riotId: existingPlayer?.riot_id ?? canonicalRiotId, rank: currentRank, lp: currentLP }) +
                    (isAlreadyKnown ? `\n\n${tr("add.sharedStats")}` : "")
                )
                .setColor(0x00ff00)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            if (error.response?.status === 404) {
                logger.warn('API', `Joueur introuvable sur Riot : ${riotId}`, { status: 404 });
                await interaction.editReply(tr("add.notFound", { riotId }));
            } else if (error.response?.status === 403) {
                logger.error('API', `Clé API Riot invalide ou expirée`, { status: 403 });
                await interaction.editReply(tr("add.invalidApiKey"));
            } else if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
                logger.error('DB', `Contrainte BDD violée pour ${riotId}`, { error: error.message });
                await interaction.editReply(tr("add.alreadyInDb"));
            } else {
                logger.error('COMMAND', `Erreur inattendue /add pour ${riotId}`, {
                    error: error.message,
                    status: error.response?.status
                });
                await interaction.editReply(tr("common.errorWithMessage", { message: error.message }));
            }
        }
    },
};
