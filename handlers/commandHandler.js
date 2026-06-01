const fs = require("fs");
const path = require("path");
const { Collection, REST, Routes } = require("discord.js");
const logger = require("../utils/loggers");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// ─── Chargement des commandes ─────────────────────────────────────────────────
function loadCommands(client) {
    client.commands = new Collection();

    const commandsPath = path.join(__dirname, "../commands");

    if (!fs.existsSync(commandsPath)) {
        logger.error("HANDLER", "Le dossier commands n'existe pas !");
        return;
    }

    const commandFiles = fs
        .readdirSync(commandsPath)
        .filter((file) => file.endsWith(".js"));

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        try {
            const command = require(filePath);
            if ("data" in command && "execute" in command) {
                client.commands.set(command.data.name, command);
                logger.info("HANDLER", `Commande chargée : ${command.data.name}`);
            } else {
                logger.warn("HANDLER", `Structure invalide pour : ${file}`);
            }
        } catch (error) {
            logger.error("HANDLER", `Erreur chargement ${file}`, { error: error.message });
        }
    }

    logger.success("HANDLER", `${client.commands.size} commande(s) chargée(s)`);
}

// ─── Déploiement sur un serveur ───────────────────────────────────────────────
async function deployToGuild(rest, guildId, guildName, commands) {
    let success = false;
    let attempts = 0;
    const maxAttempts = 3;

    while (!success && attempts < maxAttempts) {
        attempts++;
        try {
            const deployPromise = rest.put(
                Routes.applicationGuildCommands(CLIENT_ID, guildId),
                { body: commands }
            );
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Timeout")), 10000)
            );

            const result = await Promise.race([deployPromise, timeoutPromise]);
            logger.success("HANDLER", `Commandes déployées sur ${guildName}`, {
                count: result.length,
            });
            success = true;
        } catch (error) {
            logger.warn("HANDLER", `Tentative ${attempts}/${maxAttempts} échouée pour ${guildName}`, {
                error: error.message,
            });

            if (error.response?.status === 429) {
                await new Promise((r) => setTimeout(r, 5000));
            } else if (attempts < maxAttempts) {
                await new Promise((r) => setTimeout(r, 3000));
            }
        }
    }

    if (!success) {
        logger.error("HANDLER", `Échec total du déploiement sur ${guildName}`);
    }
}

// ─── Déploiement sur tous les serveurs ───────────────────────────────────────
async function deployCommands(client) {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    const commands = [...client.commands.values()].map((c) => c.data.toJSON());

    logger.info("HANDLER", `Déploiement sur ${client.guilds.cache.size} serveur(s)...`);

    for (const [guildId, guild] of client.guilds.cache) {
        await deployToGuild(rest, guildId, guild.name, commands);
        await new Promise((r) => setTimeout(r, 2000));
    }

    logger.success("HANDLER", "Déploiement terminé !");
}

// ─── Déploiement sur un nouveau serveur ──────────────────────────────────────
async function deployToNewGuild(client, guild) {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    const commands = [...client.commands.values()].map((c) => c.data.toJSON());

    try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guild.id), {
            body: commands,
        });
        logger.success("HANDLER", `Commandes déployées sur le nouveau serveur : ${guild.name}`);
    } catch (error) {
        logger.error("HANDLER", `Erreur déploiement sur ${guild.name}`, {
            error: error.message,
        });
    }
}

module.exports = { loadCommands, deployCommands, deployToNewGuild };
