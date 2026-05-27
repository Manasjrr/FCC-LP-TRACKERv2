const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const logger = require("../utils/loggers");

const RIOT_API_KEY = process.env.RIOT_API_KEY;

async function getSummonerId(puuid) {
  try {
    const response = await axios.get(
      `https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`,
      { headers: { "X-Riot-Token": RIOT_API_KEY } },
    );
    return response.data.id;
  } catch (error) {
    throw error;
  }
}

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

    try {
      const existingPlayer = global.db.prepare(
        `SELECT * FROM players WHERE guild_id = ? AND riot_id = ?`
      ).get(interaction.guildId, riotId);

      if (existingPlayer) {
        logger.info('COMMAND', `Compte déjà surveillé : ${riotId}`, { guild: interaction.guildId });
        return interaction.editReply("❌ Ce compte est déjà surveillé !");
      }

      const [gameName, tagLine] = riotId.split("#");
      if (!gameName || !tagLine) {
        logger.warn('COMMAND', `Format Riot ID invalide : ${riotId}`, { user: interaction.user.tag });
        return interaction.editReply("❌ Format invalide ! Utilisez : Pseudonyme#TAG");
      }

      logger.api('RIOT', `GET account by riot-id : ${riotId}`);
      const accountResponse = await axios.get(
        `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${gameName}/${tagLine}`,
        { headers: { "X-Riot-Token": RIOT_API_KEY } },
      );
      const puuid = accountResponse.data.puuid;
      logger.api('RIOT', `PUUID récupéré pour ${riotId}`, { puuid: puuid.substring(0, 8) + '...' });

      logger.api('RIOT', `GET dernier match pour ${riotId}`);
      const matchesResponse = await axios.get(
        `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&count=1`,
        { headers: { "X-Riot-Token": RIOT_API_KEY } },
      );

      let lastMatchId = null;
      if (matchesResponse.data.length > 0) {
        lastMatchId = matchesResponse.data[0];
        logger.info('COMMAND', `Dernier match trouvé pour ${riotId}`, { matchId: lastMatchId });
      } else {
        logger.info('COMMAND', `Aucun match trouvé pour ${riotId}, initialisation sans match`);
      }

      const summonerId = await getSummonerId(puuid);

      logger.api('RIOT', `GET ranked entries pour ${riotId}`);
      const rankedResponse = await axios.get(
        `https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`,
        { headers: { "X-Riot-Token": RIOT_API_KEY } },
      );

      let currentRank = "Non classé";
      let currentLP = 0;

      const soloQueueEntry = rankedResponse.data.find(
        (entry) => entry.queueType === "RANKED_SOLO_5x5",
      );
      if (soloQueueEntry) {
        currentRank = `${soloQueueEntry.tier} ${soloQueueEntry.rank}`;
        currentLP = soloQueueEntry.leaguePoints;
        logger.info('COMMAND', `Rang récupéré pour ${riotId}`, { rank: currentRank, lp: currentLP });
      } else {
        logger.info('COMMAND', `${riotId} non classé en SoloQ`);
      }

      try {
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

        interaction.editReply({ embeds: [embed] });

      } catch (err) {
        logger.error('DB', `Erreur insertion BDD pour ${riotId}`, { error: err.message });
        interaction.editReply("❌ Erreur lors de l'ajout.");
      }

    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn('API', `Joueur introuvable sur Riot : ${riotId}`, { status: 404 });
        await interaction.editReply(`❌ Joueur introuvable : **${riotId}**`);
      } else if (error.response?.status === 403) {
        logger.error('API', `Clé API Riot invalide ou expirée`, { status: 403 });
        await interaction.editReply(`❌ Clé API Riot invalide ou expirée !`);
      } else {
        logger.error('COMMAND', `Erreur inattendue /add pour ${riotId}`, { error: error.message, status: error.response?.status });
        await interaction.editReply(`❌ Erreur : ${error.message}`);
      }
    }
  },
};
