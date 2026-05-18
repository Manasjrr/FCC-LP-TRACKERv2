const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
require('dotenv').config();

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function forceClean() {
    try {
        console.log('Inspection des commandes...');

        // Lister les commandes actuelles
        const guild = await rest.get(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, "852989919043780633")
        );

        const global = await rest.get(
            Routes.applicationCommands(process.env.CLIENT_ID)
        );

        console.log('Commandes serveur trouvées:', guild.map(c => `${c.name} (ID: ${c.id})`));
        console.log('Commandes globales trouvées:', global.map(c => `${c.name} (ID: ${c.id})`));

        // Force delete TOUT
        await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, "852989919043780633"), { body: [] });
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });

        console.log('SUPPRESSION FORCÉE TERMINÉE !');
        console.log('Redémarrez le bot maintenant');

    } catch (error) {
        console.error(' Erreur:', error);
    }
}

forceClean();
