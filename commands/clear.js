const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { DEFAULT_LANGUAGE, t, getTranslator } = require("../utils/i18n");
const logger = require("../utils/loggers");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("clear")
        .setDescription(t(DEFAULT_LANGUAGE, "commands.clear.description"))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(option =>
            option
                .setName("count")
                .setDescription(t(DEFAULT_LANGUAGE, "commands.clear.options.count.description"))
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(1000)
        )
        .addStringOption(option =>
            option
                .setName("channel")
                .setDescription(t(DEFAULT_LANGUAGE, "commands.clear.options.channel.description"))
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const tr = getTranslator(interaction.guildId);
        const userId = interaction.user.id;
        const member = interaction.member;
        const isSpecialUser = userId === process.env.OWNER_ID;
        const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

        if (!isAdmin && !isSpecialUser) {
            logger.warn('COMMAND', `Accès refusé /clear`, { user: interaction.user.tag, guild: interaction.guildId });

            const deniedEmbed = new EmbedBuilder()
                .setColor("#ff0000")
                .setTitle(tr("common.accessDeniedTitle"))
                .setDescription(tr("common.accessDenied"))
                .addFields({ name: tr("common.requiredPermissions"), value: tr("common.requiredPermissionsList") })
                .setTimestamp();

            return await interaction.editReply({ embeds: [deniedEmbed] });
        }

        const nombre = interaction.options.getInteger("count");
        const channelId = interaction.options.getString("channel");

        logger.info('COMMAND', `/clear exécuté par ${interaction.user.tag}`, {
            nombre: nombre || 'tous',
            channelId: channelId || interaction.channelId,
            guild: interaction.guildId
        });

        let targetChannel;

        if (channelId) {
            try {
                targetChannel = await interaction.guild.channels.fetch(channelId);

                if (!targetChannel.isTextBased()) {
                    logger.warn('COMMAND', `Channel non textuel spécifié dans /clear`, { channelId });
                    return await interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setColor("#ff0000")
                            .setTitle(tr("clear.invalidChannelTitle"))
                            .setDescription(tr("clear.invalidChannel"))
                            .setTimestamp()
                        ]
                    });
                }
            } catch (error) {
                logger.error('COMMAND', `Channel introuvable dans /clear`, { channelId, error: error.message });
                return await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor("#ff0000")
                        .setTitle(tr("clear.channelNotFoundTitle"))
                        .setDescription(tr("clear.channelNotFound", { id: channelId }))
                        .addFields({ name: tr("clear.checkTitle"), value: tr("clear.checkList") })
                        .setTimestamp()
                    ]
                });
            }
        } else {
            targetChannel = interaction.channel;
        }

        try {
            let deletedCount = 0;

            const updateStatus = async (count) => {
                if (count % 10 === 0) {
                    await interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setColor("#ffaa00")
                            .setTitle(tr("clear.progressTitle"))
                            .setDescription(tr("clear.progress", { count }))
                            .addFields(
                                { name: tr("clear.channel"), value: `<#${targetChannel.id}>` },
                                { name: tr("clear.noteTitle"), value: tr("clear.note") }
                            )
                            .setTimestamp()
                        ]
                    });
                }
            };

            const deleteMessages = async (messages) => {
                const now = Date.now();
                const recentMessages = [];
                const oldMessages = [];

                messages.forEach(msg => {
                    const isOlderThan14Days = (now - msg.createdTimestamp) > 14 * 24 * 60 * 60 * 1000;
                    if (isOlderThan14Days) oldMessages.push(msg);
                    else recentMessages.push(msg);
                });

                if (recentMessages.length > 1) {
                    await targetChannel.bulkDelete(recentMessages);
                    deletedCount += recentMessages.length;
                } else if (recentMessages.length === 1) {
                    await recentMessages[0].delete();
                    deletedCount++;
                }

                for (const msg of oldMessages) {
                    try {
                        await msg.delete();
                        deletedCount++;
                        await updateStatus(deletedCount);
                        await new Promise(resolve => setTimeout(resolve, 1100));
                    } catch (deleteError) {
                        if (deleteError.code !== 10008) {
                            logger.warn('COMMAND', `Erreur suppression message individuel`, { 
                                messageId: msg.id, 
                                error: deleteError.message,
                                code: deleteError.code
                            });
                        }
                    }
                }
            };

            if (nombre) {
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

            logger.success('COMMAND', `/clear terminé par ${interaction.user.tag}`, {
                deletedCount,
                channel: targetChannel.name,
                guild: interaction.guildId
            });

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor("#00ff00")
                    .setTitle(tr("clear.doneTitle"))
                    .setDescription(tr("clear.done", { count: deletedCount }))
                    .addFields(
                        { name: tr("clear.channel"), value: `<#${targetChannel.id}> (\`${targetChannel.name}\`)` },
                        { name: tr("clear.executedBy"), value: `${interaction.user.tag} ${tr(isSpecialUser ? "clear.specialUser" : "clear.admin")}` }
                    )
                    .setTimestamp()
                ]
            });

        } catch (error) {
            logger.error('COMMAND', `Erreur /clear`, {
                error: error.message,
                code: error.code,
                channel: targetChannel.name,
                user: interaction.user.tag
            });

            let errorMessage = tr("clear.error");
            let errorDetails = error.message;

            if (error.code === 50013) {
                errorMessage = tr("clear.missingPermissions");
                errorDetails = tr("clear.missingPermissionsDetails");
            }

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor("#ff0000")
                    .setTitle(tr("clear.errorTitle"))
                    .setDescription(errorMessage)
                    .addFields(
                        { name: tr("clear.channel"), value: `<#${targetChannel.id}> (\`${targetChannel.name}\`)` },
                        { name: tr("clear.details"), value: `\`\`\`${errorDetails}\`\`\`` }
                    )
                    .setTimestamp()
                ]
            });
        }
    },
};
