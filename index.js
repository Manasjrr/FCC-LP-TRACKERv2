require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const Database = require("better-sqlite3");
const cron = require("node-cron");
const logger = require("./utils/loggers");

// ─── Services & Handlers ──────────────────────────────────────────────────────
const { initDB } = require("./database/initDB");
const { loadCommands, deployCommands } = require("./handlers/commandHandler");
const { handleInteraction } = require("./handlers/interactionHandler");
const { checkAllPlayers } = require("./services/monitoringService");
const { checkApiStatus } = require("./services/riotApiService");
const { sendWeeklyRecap } = require("./utils/weeklyRecap");

// ─── Vérification des variables d'environnement ───────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID || !process.env.RIOT_API_KEY) {
    logger.error("BOOT", "Variables d'environnement manquantes (DISCORD_TOKEN / CLIENT_ID / RIOT_API_KEY)");
    process.exit(1);
}

// ─── Base de données ──────────────────────────────────────────────────────────
const db = new Database("./players.db");
global.db = db;
initDB(db);

// ─── Client Discord ───────────────────────────────────────────────────────────
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    rest: { timeout: 60000 },
});

// ─── Chargement des commandes ─────────────────────────────────────────────────
loadCommands(client);

// ─── Événements ───────────────────────────────────────────────────────────────
client.once("ready", async () => {
    logger.success("BOOT", `${client.user.tag} connecté !`, {
        guilds: client.guilds.cache.size,
    });

    client.guilds.cache.forEach((guild) => {
        logger.info("BOOT", `Serveur: ${guild.name} (${guild.id}) — ${guild.memberCount} membres`);
    });

    // Déploiement des commandes slash
    await deployCommands(client);

    // Monitoring
    logger.info("MONITOR", "Démarrage du monitoring...");
    checkAllPlayers(client);
    setInterval(() => checkAllPlayers(client), 2 * 60 * 1000);

    // Check API Riot
    await checkApiStatus();
    setInterval(async () => {
        const ok = await checkApiStatus();
        if (!ok) {
            try {
                const user = await client.users.fetch(process.env.OWNER_ID);
                await user.send("**API RIOT DOWN** - La clé API ne fonctionne plus !");
                logger.info("API", "MP d'alerte envoyé");
            } catch (err) {
                logger.error("API", "Erreur envoi MP alerte", { error: err.message });
            }
        }
    }, 30 * 60 * 1000);

    // Récap hebdomadaire (vendredi 18h00, Paris)
    cron.schedule("0 18 * * 5", () => sendWeeklyRecap(client), {
        timezone: "Europe/Paris",
    });

    logger.success("BOOT", "Bot entièrement opérationnel ✅");
});

// Nouveau serveur → déploiement automatique
client.on("guildCreate", async (guild) => {
    logger.info("BOOT", `Nouveau serveur : ${guild.name} (${guild.id})`);
    await deployCommands(client, guild.id);
});

// Toutes les interactions
client.on("interactionCreate", (interaction) => handleInteraction(interaction));

// ─── Gestion des erreurs globales ─────────────────────────────────────────────
process.on("unhandledRejection", (error) => {
    logger.error("PROCESS", "Unhandled rejection", { error: error.message });
});

process.on("uncaughtException", (error) => {
    logger.error("PROCESS", "Uncaught exception", { error: error.message });
    process.exit(1);
});

// ─── Connexion ────────────────────────────────────────────────────────────────
client.login(TOKEN);
