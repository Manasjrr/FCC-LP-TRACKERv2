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

    logger.info('COMMAND', `Commande /add exécutée par ${interaction.user.tag}`, { riotId, guild: interaction.guildId });

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

    // ── Vérification doublon ──────────────────────────────────────────────
    const existingPlayer = global.db.prepare(
      `SELECT id FROM players WHERE guild_id = ? AND riot_id = ?`
    ).get(interaction.guildId, riotId);

    if (existingPlayer) {
      logger.info('COMMAND', `Compte déjà surveillé : ${riotId}`, { guild: interaction.guildId });
      return interaction.editReply("❌ Ce compte est déjà surveillé !");
    }

    // ── Appels API Riot ───────────────────────────────────────────────────
    try {
      // 1) PUUID
      const account = await getAccountByRiotId(gameName, tagLine);
      const puuid = account.puuid;
      logger.info('COMMAND', `PUUID récupéré pour ${riotId}`, { puuid: puuid.substring(0, 8) + '...' });

      // 2) Dernier match + Ranked en parallèle
      const [matchIds, rankedData] = await Promise.all([
        getRecentMatchIds(puuid, 1),
        getRankedDataByPuuid(puuid),
      ]);

      // ── Traitement des données ────────────────────────────────────────
      const lastMatchId = matchIds[0] ?? null;
      if (lastMatchId) {
        logger.info('COMMAND', `Dernier match trouvé pour ${riotId}`, { matchId: lastMatchId });
      } else {
        logger.info('COMMAND', `Aucun match trouvé pour ${riotId}, initialisation sans match`);
      }

      const soloQueueEntry = rankedData.find((e) => e.queueType === "RANKED_SOLO_5x5") ?? null;
      const currentRank = soloQueueEntry
        ? `${soloQueueEntry.tier} ${soloQueueEntry.rank}`
        : "Non classé";
      const currentLP = soloQueueEntry?.leaguePoints ?? 0;

      if (soloQueueEntry) {
        logger.info('COMMAND', `Rang récupéré pour ${riotId}`, { rank: currentRank, lp: currentLP });
      } else {
        logger.info('COMMAND', `${riotId} non classé en SoloQ`);
      }

      // ── Insertion en BDD ──────────────────────────────────────────────
      global.db.prepare(`
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

      logger.success('DB', `Joueur ajouté en BDD : ${riotId}`, { guild: interaction.guildId, rank: currentRank, lp: currentLP });

      const embed = new EmbedBuilder()
        .setTitle("✅ Compte ajouté !")
        .setDescription(
          `**${riotId}** est maintenant surveillé !\n📊 **Rang initial :** ${currentRank} (${currentLP} LP)`
        )
        .setColor(0x00ff00)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      // ── Gestion des erreurs API & BDD ─────────────────────────────────
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
        logger.error('COMMAND', `Erreur inattendue /add pour ${riotId}`, { error: error.message, status: error.response?.status });
        await interaction.editReply(`❌ Erreur : ${error.message}`);
      }
    }
  },
};
