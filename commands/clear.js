const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("clear")
        .setDescription("Supprimer tous les messages du channel")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(option =>
            option
                .setName("nombre")
                .setDescription("Nombre de messages à supprimer (max 1000, défaut: tous)")
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(1000)
        )
        .addStringOption(option =>
            option
                .setName("channel")
                .setDescription("ID du channel à nettoyer (défaut: channel actuel)")
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        // 🔐 VÉRIFICATION DES PERMISSIONS
        const userId = interaction.user.id;
        const member = interaction.member;
        const isSpecialUser = userId === "414354252236849172";
        const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

        if (!isAdmin && !isSpecialUser) {
            const deniedEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle("🚫 Accès refusé")
                .setDescription("Vous n'avez pas les permissions nécessaires pour utiliser cette commande.")
                .addFields(
                    { name: "Permissions requises", value: "• Administrateur\n• Utilisateur autorisé" }
                )
                .setTimestamp();

            return await interaction.editReply({ embeds: [deniedEmbed] });
        }

        const nombre = interaction.options.getInteger("nombre");
        const channelId = interaction.options.getString("channel");

        // 📍 DÉTERMINER LE CHANNEL À NETTOYER
        let targetChannel;

        if (channelId) {
            try {
                targetChannel = await interaction.guild.channels.fetch(channelId);

                if (!targetChannel.isTextBased()) {
                    return await interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setColor("#ff0000")
                            .setTitle("❌ Channel invalide")
                            .setDescription("Le channel spécifié n'est pas un channel textuel.")
                            .setTimestamp()
                        ]
                    });
                }
            } catch (error) {
                return await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor("#ff0000")
                        .setTitle("❌ Channel introuvable")
                        .setDescription(`Impossible de trouver le channel avec l'ID: \`${channelId}\``)
                        .addFields(
                            { name: "Vérifiez que", value: "• L'ID est correct\n• Le bot a accès au channel\n• Le channel existe sur ce serveur" }
                        )
                        .setTimestamp()
                    ]
                });
            }
        } else {
            targetChannel = interaction.channel;
        }

        try {
            let deletedCount = 0;
            const FOURTEEN_DAYS = Date.now() - 14 * 24 * 60 * 60 * 1000;

            // ⏳ Mise à jour du statut toutes les 10 suppressions
            const updateStatus = async (count) => {
                if (count % 10 === 0) {
                    await interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setColor("#ffaa00")
                            .setTitle("⏳ Suppression en cours...")
                            .setDescription(`**${count}** messages supprimés jusqu'à présent...`)
                            .addFields(
                                { name: "Channel", value: `<#${targetChannel.id}>` },
                                { name: "⚠️ Note", value: "Ne pas fermer Discord pendant l'opération." }
                            )
                            .setTimestamp()
                        ]
                    });
                }
            };

            // 🗑️ FONCTION DE SUPPRESSION INTELLIGENTE
            // Sépare automatiquement les messages récents (bulkDelete) des anciens (delete unitaire)
            const deleteMessages = async (messages) => {
                const now = Date.now();
                const recentMessages = [];
                const oldMessages = [];

                // Trier les messages selon leur âge
                messages.forEach(msg => {
                    const messageAge = now - msg.createdTimestamp;
                    const isOlderThan14Days = messageAge > 14 * 24 * 60 * 60 * 1000;

                    if (isOlderThan14Days) {
                        oldMessages.push(msg);
                    } else {
                        recentMessages.push(msg);
                    }
                });

                // Supprimer les messages récents en bulk (rapide)
                if (recentMessages.length > 1) {
                    await targetChannel.bulkDelete(recentMessages);
                    deletedCount += recentMessages.length;
                } else if (recentMessages.length === 1) {
                    // bulkDelete nécessite au moins 2 messages, sinon delete unitaire
                    await recentMessages[0].delete();
                    deletedCount++;
                }

                // Supprimer les messages anciens un par un (lent mais obligatoire)
                for (const msg of oldMessages) {
                    try {
                        await msg.delete();
                        deletedCount++;
                        await updateStatus(deletedCount);

                        // ⏱️ Délai pour éviter le rate limit (1 delete/seconde environ)
                        await new Promise(resolve => setTimeout(resolve, 1100));
                    } catch (deleteError) {
                        // Ignorer si le message a déjà été supprimé
                        if (deleteError.code !== 10008) {
                            console.error("Erreur suppression message:", deleteError);
                        }
                    }
                }
            };

            if (nombre) {
                // 📌 SUPPRIMER UN NOMBRE SPÉCIFIQUE DE MESSAGES
                let remaining = nombre;
                let lastId = null;

                while (remaining > 0) {
                    const fetchLimit = Math.min(remaining, 100);
                    const fetchOptions = { limit: fetchLimit };
                    if (lastId) fetchOptions.before = lastId;

                    const messages = await targetChannel.messages.fetch(fetchOptions);
                    if (messages.size === 0) break;

                    lastId = messages.last().id;
                    await deleteMessages(messages);
                    remaining -= messages.size;

                    if (messages.size < fetchLimit) break;
                }

            } else {
                // 📌 SUPPRIMER TOUS LES MESSAGES
                let lastId = null;
                let hasMore = true;

                while (hasMore) {
                    const fetchOptions = { limit: 100 };
                    if (lastId) fetchOptions.before = lastId;

                    const messages = await targetChannel.messages.fetch(fetchOptions);
                    if (messages.size === 0) break;

                    lastId = messages.last().id;
                    await deleteMessages(messages);

                    hasMore = messages.size === 100;
                }
            }

            // ✅ SUCCÈS
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor("#00ff00")
                    .setTitle("🧹 Messages supprimés")
                    .setDescription(`✅ **${deletedCount}** messages ont été supprimés !`)
                    .addFields(
                        { name: "Channel", value: `<#${targetChannel.id}> (\`${targetChannel.name}\`)` },
                        { name: "Exécuté par", value: `${interaction.user.tag}${isSpecialUser ? " (Utilisateur spécial)" : " (Administrateur)"}` }
                    )
                    .setTimestamp()
                ]
            });

        } catch (error) {
            console.error("❌ Erreur lors de la suppression:", error);

            let errorMessage = "Impossible de supprimer les messages.";
            let errorDetails = error.message;

            if (error.code === 50013) {
                errorMessage = "Permissions insuffisantes.";
                errorDetails = "Le bot n'a pas les permissions nécessaires dans ce channel.";
            }

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor("#ff0000")
                    .setTitle("❌ Erreur")
                    .setDescription(errorMessage)
                    .addFields(
                        { name: "Channel", value: `<#${targetChannel.id}> (\`${targetChannel.name}\`)` },
                        { name: "Détails", value: `\`\`\`${errorDetails}\`\`\`` }
                    )
                    .setTimestamp()
                ]
            });
        }
    },
};
