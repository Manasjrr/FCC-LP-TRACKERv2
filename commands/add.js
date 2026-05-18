const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const axios = require("axios");

// Configuration (à adapter selon votre structure)
const RIOT_API_KEY = process.env.RIOT_API_KEY; // ou importez depuis votre config

// Fonction utilitaire (si elle existe ailleurs, importez-la)
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

    // Vérifier que la DB est disponible
    if (!global.db) {
      return interaction.editReply(" Base de données non disponible");
    }

    try {
      // Vérifier si le compte existe déjà
      const existingPlayer = global.db.prepare(
        `SELECT * FROM players WHERE guild_id = ? AND riot_id = ?`
      ).get(interaction.guildId, riotId);


      if (existingPlayer) {
        return interaction.editReply("❌ Ce compte est déjà surveillé !");
      }

      // Vérifier le compte Riot
      const [gameName, tagLine] = riotId.split("#");
      if (!gameName || !tagLine) {
        return interaction.editReply(
          "❌ Format invalide ! Utilisez : Pseudonyme#TAG",
        );
      }

      const accountResponse = await axios.get(
        `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${gameName}/${tagLine}`,
        { headers: { "X-Riot-Token": RIOT_API_KEY } },
      );

      const puuid = accountResponse.data.puuid;

      // Récupérer le dernier match pour initialiser
      const matchesResponse = await axios.get(
        `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&count=1`,
        { headers: { "X-Riot-Token": RIOT_API_KEY } },
      );

      let lastMatchId = null;
      if (matchesResponse.data.length > 0) {
        lastMatchId = matchesResponse.data[0];
      }

      // Récupérer le rang et LP actuels
      const summonerId = await getSummonerId(puuid);
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
      }

      // Ajouter en base de données
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

        const embed = new EmbedBuilder()
          .setTitle("✅ Compte ajouté !")
          .setDescription(
            `**${riotId}** est maintenant surveillé !\n📊 **Rang initial :** ${currentRank} (${currentLP} LP)`
          )
          .setColor(0x00ff00)
          .setTimestamp();

        interaction.editReply({ embeds: [embed] });

      } catch (err) {
        console.error("Erreur DB:", err);
        interaction.editReply("❌ Erreur lors de l'ajout.");
      }

    } catch (error) {
      console.error("Erreur lors de l'ajout:", error);
      if (error.response?.status === 404) {
        await interaction.editReply(`❌ Joueur introuvable : **${riotId}**`);
      } else if (error.response?.status === 403) {
        await interaction.editReply(`❌ Clé API Riot invalide ou expirée !`);
      } else {
        await interaction.editReply(`❌ Erreur : ${error.message}`);
      }
    }
  },
};
