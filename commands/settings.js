const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, GuildScheduledEventStatus } = require('discord.js');
const { t, getNormalizedLocale } = require('../i18n.js');
const { eventDb, serverConfig, saveConfig, saveDb } = require('../storage.js');
const { parseIntervals, getFormattedTimeString } = require('../utils.js');
const { getAnnouncementChannelId, getAnnouncementMode, getModeText, getReminderIntervals, getCalendarEnabled, getThreadsEnabled, getPingsEnabled, getAutoDeleteEnabled } = require('../services/config.js');
const { buildAnnouncementEmbed, archiveAnnouncementMessage } = require('../services/announcements.js');
const { scheduleRemindersForEvent, cancelEventReminders } = require('../services/reminders.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setNameLocalizations({'es-ES': 'configuracion', 'de': 'einstellungen', 'fr': 'parametres', 'pt-BR': 'configuracoes'})
        .setDescription('Manage bot configuration for this server.')
        .setDescriptionLocalizations({'es-ES': 'Administrar la configuración del bot para este servidor.', 'de': 'Verwalte die Bot-Konfiguration für diesen Server.', 'fr': 'Gérer la configuration du bot pour ce serveur.', 'pt-BR': 'Gerenciar a configuração do bot para este servidor.'})
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand(subcommand => subcommand.setName('channel').setNameLocalizations({'es-ES': 'canal', 'de': 'kanal', 'fr': 'salon', 'pt-BR': 'canal'}).setDescription('Sets the channel for event announcements and reminders.').addChannelOption(option => option.setName('channel').setDescription('The text channel to use for announcements').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
        .addSubcommand(subcommand => subcommand.setName('mode').setDescription('Choose the reminder delivery mode (Public channel pings, Private DM-only, or Hybrid).').addStringOption(option => option.setName('mode').setDescription('The announcement mode').setRequired(true).addChoices({ name: 'Public Channel Reminders', value: 'public' }, { name: 'Private DM Reminders (Opt-in)', value: 'private' }, { name: 'Hybrid (Public Channel & DM)', value: 'hybrid' })))
        .addSubcommand(subcommand => subcommand.setName('view').setDescription('View the current bot settings for this server.'))
        .addSubcommand(subcommand => subcommand.setName('calendar').setDescription('Toggle the "Add to Calendar" button on event announcements.').addBooleanOption(option => option.setName('enabled').setDescription('Enable or disable the calendar button').setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('threads').setDescription('Toggle whether the bot automatically creates a discussion thread for new events.').addBooleanOption(option => option.setName('enabled').setDescription('Enable or disable auto-thread creation').setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('autodelete').setDescription('Delete announcement when event ends? (Warning: Also deletes attached discussion thread)').addBooleanOption(option => option.setName('enabled').setDescription('Enable to delete, disable to gracefully archive').setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('intervals').setDescription('Set custom reminder intervals (e.g., 24h, 1h, 15m).').addStringOption(option => option.setName('times').setDescription('Comma-separated list of times (max 5). Examples: "24h, 1h"').setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('mentions').setDescription('Toggle whether public reminders mention/ping opted-in users.').addBooleanOption(option => option.setName('enabled').setDescription('Enable to ping users, disable for silent reminders').setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('testreminder').setDescription('Test what an event reminder will look like in your server.'))
        .addSubcommand(subcommand => subcommand.setName('cleanup').setDescription('Scan and archive any unarchived concluded event announcements.'))
        .addSubcommand(subcommand => subcommand.setName('silenceevent').setDescription('Disable reminder scheduling for a specific event (stops DMs and pings).').addStringOption(option => option.setName('event').setDescription('The event link or ID to silence').setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('unsilenceevent').setDescription('Re-enable reminder scheduling for a silenced event.').addStringOption(option => option.setName('event').setDescription('The event link or ID to unsilence').setRequired(true))),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const userLocale = getNormalizedLocale(interaction.locale);

        if (subcommand === 'channel') {
            const channel = interaction.options.getChannel('channel');

            if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
                return interaction.reply({ content: t(userLocale, 'settings_invalid_channel'), flags: MessageFlags.Ephemeral });
            }

            const botPermissions = channel.permissionsFor(interaction.guild.members.me);
            if (!botPermissions.has(PermissionFlagsBits.ViewChannel) || !botPermissions.has(PermissionFlagsBits.SendMessages) || !botPermissions.has(PermissionFlagsBits.EmbedLinks)) {
                return interaction.reply({ content: t(userLocale, 'settings_bot_no_permissions', { channel: channel.toString() }), flags: MessageFlags.Ephemeral });
            }

            if (typeof serverConfig[interaction.guildId] === 'object' && serverConfig[interaction.guildId] !== null) {
                serverConfig[interaction.guildId].channelId = channel.id;
            } else {
                serverConfig[interaction.guildId] = { channelId: channel.id, mode: 'private' };
            }
            await saveConfig();
            await interaction.reply({ content: t(userLocale, 'settings_channel_success', { channel: channel.toString() }), flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'mode') {
            const mode = interaction.options.getString('mode');

            if (typeof serverConfig[interaction.guildId] === 'object' && serverConfig[interaction.guildId] !== null) {
                serverConfig[interaction.guildId].mode = mode;
            } else {
                const existingChannel = serverConfig[interaction.guildId];
                serverConfig[interaction.guildId] = { channelId: typeof existingChannel === 'string' ? existingChannel : null, mode: mode };
            }
            await saveConfig();
            const modeText = getModeText(mode, userLocale);
            await interaction.reply({ content: t(userLocale, 'settings_mode_success', { mode: modeText }), flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'calendar') {
            const enabled = interaction.options.getBoolean('enabled');
            if (typeof serverConfig[interaction.guildId] === 'object' && serverConfig[interaction.guildId] !== null) {
                serverConfig[interaction.guildId].calendarEnabled = enabled;
            } else {
                serverConfig[interaction.guildId] = { channelId: null, mode: 'private', calendarEnabled: enabled };
            }
            await saveConfig();
            let statusText = enabled ? 'enabled' : 'disabled';
            if (userLocale === 'es') statusText = enabled ? 'activado' : 'desactivado';
            else if (userLocale === 'de') statusText = enabled ? 'aktiviert' : 'deaktiviert';
            else if (userLocale === 'fr') statusText = enabled ? 'activé' : 'désactivé';
            else if (userLocale === 'pt') statusText = enabled ? 'ativado' : 'desativado';
            await interaction.reply({ content: t(userLocale, 'settings_calendar_success', { status: statusText }), flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'threads') {
            const enabled = interaction.options.getBoolean('enabled');
            if (typeof serverConfig[interaction.guildId] === 'object' && serverConfig[interaction.guildId] !== null) {
                serverConfig[interaction.guildId].threadsEnabled = enabled;
            } else {
                serverConfig[interaction.guildId] = { channelId: null, mode: 'private', threadsEnabled: enabled };
            }
            await saveConfig();
            let statusText = enabled ? 'enabled' : 'disabled';
            if (userLocale === 'es') statusText = enabled ? 'activado' : 'desactivado';
            else if (userLocale === 'de') statusText = enabled ? 'aktiviert' : 'deaktiviert';
            else if (userLocale === 'fr') statusText = enabled ? 'activé' : 'désactivé';
            else if (userLocale === 'pt') statusText = enabled ? 'ativado' : 'desativado';
            await interaction.reply({ content: t(userLocale, 'settings_threads_success', { status: statusText }), flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'autodelete') {
            const enabled = interaction.options.getBoolean('enabled');
            if (typeof serverConfig[interaction.guildId] === 'object' && serverConfig[interaction.guildId] !== null) {
                serverConfig[interaction.guildId].autoDeleteEnabled = enabled;
            } else {
                serverConfig[interaction.guildId] = { channelId: null, mode: 'private', autoDeleteEnabled: enabled };
            }
            await saveConfig();
            let statusText = enabled ? 'enabled' : 'disabled';
            let archiveStatusText = enabled ? 'disabled' : 'enabled';
            if (userLocale === 'es') { statusText = enabled ? 'activado' : 'desactivado'; archiveStatusText = enabled ? 'desactivado' : 'activado'; }
            else if (userLocale === 'de') { statusText = enabled ? 'aktiviert' : 'deaktiviert'; archiveStatusText = enabled ? 'deaktiviert' : 'aktiviert'; }
            else if (userLocale === 'fr') { statusText = enabled ? 'activé' : 'désactivé'; archiveStatusText = enabled ? 'désactivé' : 'activé'; }
            else if (userLocale === 'pt') { statusText = enabled ? 'ativado' : 'desativado'; archiveStatusText = enabled ? 'desativado' : 'ativado'; }
            await interaction.reply({ content: t(userLocale, 'settings_autodelete_success', { status: statusText, archiveStatus: archiveStatusText }), flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'intervals') {
            const input = interaction.options.getString('times');
            const parsed = parseIntervals(input);
            if (parsed.length === 0) {
                return interaction.reply({ content: t(userLocale, 'settings_intervals_invalid'), flags: MessageFlags.Ephemeral });
            }
            if (typeof serverConfig[interaction.guildId] === 'object' && serverConfig[interaction.guildId] !== null) {
                serverConfig[interaction.guildId].intervals = parsed;
            } else {
                serverConfig[interaction.guildId] = { channelId: null, mode: 'private', intervals: parsed };
            }
            await saveConfig();
            
            const guildEvents = await interaction.guild.scheduledEvents.fetch();
            const now = Date.now();
            guildEvents.forEach(event => { cancelEventReminders(event.id); scheduleRemindersForEvent(event, now); });
            
            const intervalsStr = parsed.map(i => `${i.value}${i.unit}`).join(', ');
            await interaction.reply({ content: t(userLocale, 'settings_intervals_success', { intervals: intervalsStr }), flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'mentions') {
            const enabled = interaction.options.getBoolean('enabled');
            if (typeof serverConfig[interaction.guildId] === 'object' && serverConfig[interaction.guildId] !== null) {
                serverConfig[interaction.guildId].pingsEnabled = enabled;
            } else {
                serverConfig[interaction.guildId] = { channelId: null, mode: 'private', pingsEnabled: enabled };
            }
            await saveConfig();
            let statusText = enabled ? 'Enabled' : 'Disabled';
            if (userLocale === 'es') statusText = enabled ? 'Activado' : 'Desactivado';
            else if (userLocale === 'de') statusText = enabled ? 'Aktiviert' : 'Deaktiviert';
            else if (userLocale === 'fr') statusText = enabled ? 'Activé' : 'Désactivé';
            else if (userLocale === 'pt') statusText = enabled ? 'Ativado' : 'Desativado';
            await interaction.reply({ content: t(userLocale, 'settings_mentions_success', { status: statusText }), flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'testreminder') {
            const mode = getAnnouncementMode(interaction.guildId);
            const intervals = getReminderIntervals(interaction.guildId);
            const interval = intervals.length > 0 ? intervals[0] : { value: 24, unit: 'h', ms: 24 * 60 * 60 * 1000 };
            const timeUntil = interval.ms || 24 * 60 * 60 * 1000;
            const mockStartTime = Date.now() + timeUntil;
            const timeString = getFormattedTimeString(mockStartTime, 'F');
            
            const msg = t(userLocale, 'settings_testreminder_msg', { value: interval.value, unit: interval.unit, time: timeString });
            
            let modeLabel = 'Private';
            if (mode === 'public') modeLabel = 'Public';
            else if (mode === 'hybrid') modeLabel = 'Hybrid';

            const normalized = userLocale.toLowerCase();
            if (normalized.startsWith('es')) modeLabel = mode === 'public' ? 'Público' : (mode === 'hybrid' ? 'Híbrido' : 'Privado');
            else if (normalized.startsWith('de')) modeLabel = mode === 'public' ? 'Öffentlich' : (mode === 'hybrid' ? 'Hybrid' : 'Privat');
            else if (normalized.startsWith('fr')) modeLabel = mode === 'public' ? 'Public' : (mode === 'hybrid' ? 'Hybride' : 'Privé');
            else if (normalized.startsWith('pt')) modeLabel = mode === 'public' ? 'Público' : (mode === 'hybrid' ? 'Híbrido' : 'Privado');

            let previewHeader = t(userLocale, 'settings_testreminder_preview', { mode: modeLabel });
            let replyContent = previewHeader + msg;
            const row = new ActionRowBuilder();
            
            if (mode === 'public' || mode === 'hybrid') {
                if (mode === 'public') {
                    replyContent += `\n\n<@${interaction.user.id}>`;
                }
                row.addComponents(new ButtonBuilder().setCustomId('mock_remind').setLabel(t(userLocale, 'announcement_button_remind')).setStyle(ButtonStyle.Primary).setEmoji('⏰').setDisabled(true));
                if (getCalendarEnabled(interaction.guildId)) {
                    row.addComponents(new ButtonBuilder().setLabel(t(userLocale, 'announcement_button_calendar')).setStyle(ButtonStyle.Link).setURL('https://calendar.google.com/').setEmoji('📅'));
                }
                row.addComponents(new ButtonBuilder().setLabel(t(userLocale, 'announcement_button_view')).setStyle(ButtonStyle.Link).setURL('https://discord.com/').setEmoji('🔗'));
            } else {
                row.addComponents(new ButtonBuilder().setCustomId('mock_cancel').setLabel(t(userLocale, 'reminder_button_cancel')).setStyle(ButtonStyle.Danger).setEmoji('🔕').setDisabled(true));
                row.addComponents(new ButtonBuilder().setLabel(t(userLocale, 'announcement_button_view')).setStyle(ButtonStyle.Link).setURL('https://discord.com/').setEmoji('🔗'));
            }

            await interaction.reply({ content: replyContent, components: [row], flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'view') {
            const channelId = getAnnouncementChannelId(interaction.guildId);
            const mode = getAnnouncementMode(interaction.guildId);
            const intervals = getReminderIntervals(interaction.guildId);
            const intervalsStr = intervals.map(i => `${i.value}${i.unit}`).join(', ');
            
            const modeText = getModeText(mode, userLocale);
            let enabledText = 'Enabled ✅';
            let disabledText = 'Disabled ❌';
            let notConfiguredText = '*Not configured*';
            
            if (userLocale === 'es') { enabledText = 'Activado ✅'; disabledText = 'Desactivado ❌'; notConfiguredText = '*No configurado*'; }
            else if (userLocale === 'de') { enabledText = 'Aktiviert ✅'; disabledText = 'Deaktiviert ❌'; notConfiguredText = '*Nicht konfiguriert*'; }
            else if (userLocale === 'fr') { enabledText = 'Activé ✅'; disabledText = 'Désactivé ❌'; notConfiguredText = '*Non configuré*'; }
            else if (userLocale === 'pt') { enabledText = 'Ativado ✅'; disabledText = 'Desativado ❌'; notConfiguredText = '*Não configurado*'; }

            let replyMessage = t(userLocale, 'settings_view_title');
            replyMessage += t(userLocale, 'settings_view_channel', { channel: channelId ? `<#${channelId}>` : notConfiguredText });
            replyMessage += t(userLocale, 'settings_view_mode', { mode: modeText });
            replyMessage += t(userLocale, 'settings_view_intervals', { intervals: intervalsStr });
            replyMessage += t(userLocale, 'settings_view_calendar', { status: getCalendarEnabled(interaction.guildId) ? enabledText : disabledText });
            replyMessage += t(userLocale, 'settings_view_threads', { status: getThreadsEnabled(interaction.guildId) ? enabledText : disabledText });
            
            const autoDeleteStatus = getAutoDeleteEnabled(interaction.guildId) 
                ? (userLocale === 'es' ? 'Activado ✅ (Eliminado)' : userLocale === 'de' ? 'Aktiviert ✅ (Gelöscht)' : userLocale === 'fr' ? 'Activé ✅ (Supprimé)' : userLocale === 'pt' ? 'Ativado ✅ (Excluído)' : 'Enabled ✅ (Deleted)')
                : (userLocale === 'es' ? 'Desactivado ❌ (Archivado)' : userLocale === 'de' ? 'Deaktiviert ❌ (Archiviert)' : userLocale === 'fr' ? 'Désactivé ❌ (Archivé)' : userLocale === 'pt' ? 'Desativado ❌ (Arquivado)' : 'Disabled ❌ (Archived)');
            
            replyMessage += t(userLocale, 'settings_view_autodelete', { status: autoDeleteStatus });

            await interaction.reply({ content: replyMessage, flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'cleanup') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const channelId = getAnnouncementChannelId(interaction.guildId);
            const channel = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : null;
            
            if (!channel) {
                return interaction.editReply({ content: t(userLocale, 'announce_no_channel') });
            }

            const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
            if (!messages || messages.size === 0) {
                return interaction.editReply({ content: 'No messages found in the announcement channel to clean up.' });
            }

            const autoDelete = getAutoDeleteEnabled(interaction.guildId);
            const guildLocale = getNormalizedLocale(interaction.guild.preferredLocale);
            let cleanedCount = 0;
            let remindersDeletedCount = 0;

            const botMessages = Array.from(messages.values()).filter(msg => msg.author.id === interaction.client.user.id);
            const foundEvents = new Map();
            const deletedMessageIds = new Set();
            const activeEventsCollection = await interaction.guild.scheduledEvents.fetch().catch(() => null);
            const activeEventsList = activeEventsCollection ? Array.from(activeEventsCollection.values()) : [];

            for (const msg of botMessages) {
                const isAnnouncement = msg.embeds.length > 0;
                if (!isAnnouncement) {
                    let eventId = null;
                    let eventName = '';
                    if (msg.components.length > 0) {
                        for (const row of msg.components) {
                            for (const comp of row.components) {
                                if (comp.url) {
                                    const match = comp.url.match(/(?:\/events\/|discord\.com\/events\/\d+\/)(\d{17,19})/);
                                    if (match) { eventId = match[1]; break; }
                                }
                                if (comp.customId && comp.customId.startsWith('remind_')) {
                                    eventId = comp.customId.replace('remind_', ''); break;
                                }
                            }
                            if (eventId) break;
                        }
                    }
                    if (msg.content) {
                        const match = msg.content.match(/\*\*(.*?)\*\*/);
                        if (match) eventName = match[1];
                    }

                    let isConcluded = false;
                    if (eventId) {
                        const event = activeEventsCollection ? activeEventsCollection.get(eventId) : null;
                        if (!event || event.status === GuildScheduledEventStatus.Completed || event.status === GuildScheduledEventStatus.Canceled) {
                            isConcluded = true;
                        } else {
                            const timeMatch = msg.content ? msg.content.match(/<t:(\d+):[a-zA-Z]?>/) : null;
                            if (timeMatch) {
                                const msgStartTimestampMs = parseInt(timeMatch[1], 10) * 1000;
                                if (msgStartTimestampMs < event.scheduledStartTimestamp) isConcluded = true;
                            }
                        }
                    } else if (eventName) {
                        const timeMatch = msg.content ? msg.content.match(/<t:(\d+):[a-zA-Z]?>/) : null;
                        if (timeMatch) {
                            const msgStartTimestampMs = parseInt(timeMatch[1], 10) * 1000;
                            const matchingActiveEvent = activeEventsList.find(e => e.name === eventName && e.scheduledStartTimestamp === msgStartTimestampMs);
                            if (!matchingActiveEvent) isConcluded = true;
                            else eventId = matchingActiveEvent.id;
                        } else {
                            const activeEvent = activeEventsList.find(e => e.name === eventName);
                            if (!activeEvent) isConcluded = true;
                            else eventId = activeEvent.id;
                        }
                    }

                    if (isConcluded) {
                        await msg.delete().catch(() => {});
                        if (!deletedMessageIds.has(msg.id)) { deletedMessageIds.add(msg.id); remindersDeletedCount++; }
                    } else if (eventId && eventName) {
                        if (!foundEvents.has(eventId)) foundEvents.set(eventId, { eventName, isAnnouncement: false, msg });
                    }
                    continue;
                }

                let eventId = null;
                const embed = msg.embeds[0];
                const title = embed.data.title || '';
                const isArchived = title.startsWith('~~') || title.includes('\u0336') || title.includes('\n');

                if (msg.components.length > 0) {
                    for (const row of msg.components) {
                        for (const comp of row.components) {
                            if (comp.customId && comp.customId.startsWith('remind_')) { eventId = comp.customId.replace('remind_', ''); break; }
                        }
                        if (eventId) break;
                    }
                }
                if (!eventId && msg.components.length > 0) {
                    for (const row of msg.components) {
                        for (const comp of row.components) {
                            if (comp.url) {
                                const match = comp.url.match(/(?:\/events\/|discord\.com\/events\/\d+\/)(\d{17,19})/);
                                if (match) { eventId = match[1]; break; }
                            }
                        }
                        if (eventId) break;
                    }
                }
                if (!eventId && embed.description) {
                    const match = embed.description.match(/(?:\/events\/|discord\.com\/events\/\d+\/)(\d{17,19})/);
                    if (match) eventId = match[1];
                }

                if (eventId) {
                    const cleanTitle = title.replace(/^~~|~~$/g, '').replace(/[\u0336]/g, '').replace(/\n.*/g, '').replace(/ \[[^\]]+\]$/g, '');
                    const eventName = cleanTitle.replace(/^(New Event:|Nuevo evento:|Neues Event:|Nouvel événement\s*:|Novo evento:)\s*/i, '');
                    foundEvents.set(eventId, { eventName, isAnnouncement: true, msg, isArchived });
                }
            }

            for (const [eventId, info] of foundEvents.entries()) {
                const event = activeEventsCollection ? activeEventsCollection.get(eventId) : null;
                if (!event || event.status === GuildScheduledEventStatus.Completed || event.status === GuildScheduledEventStatus.Canceled) {
                    const statusText = event && event.status === GuildScheduledEventStatus.Canceled ? 'Canceled' : 'Completed';
                    const { eventName, isAnnouncement, msg: announceMsg, isArchived } = info;

                    if (isAnnouncement && !isArchived) {
                        if (eventDb[eventId]) {
                            await archiveAnnouncementMessage(interaction.guild, eventId, statusText, announceMsg);
                            delete eventDb[eventId];
                        } else {
                            if (autoDelete) await announceMsg.delete().catch(() => {});
                            else {
                                await archiveAnnouncementMessage(interaction.guild, eventId, statusText, announceMsg);
                            }
                        }
                        cleanedCount++;
                    } else if (eventDb[eventId]) {
                        delete eventDb[eventId];
                    }

                    const eventUrl = `https://discord.com/events/${interaction.guildId}/${eventId}`;
                    let announceTimestamp = null;
                    if (isAnnouncement && announceMsg && announceMsg.embeds.length > 0 && announceMsg.embeds[0].description) {
                        const timeMatch = announceMsg.embeds[0].description.match(/<t:(\d+):[a-zA-Z]?>/);
                        if (timeMatch) announceTimestamp = timeMatch[1];
                    }

                    const matchingReminders = botMessages.filter(remMsg => {
                        if (isAnnouncement && remMsg.id === announceMsg.id) return false;
                        if (remMsg.content && remMsg.content.includes(eventUrl)) return true;
                        if (remMsg.components.length > 0) {
                            for (const row of remMsg.components) {
                                for (const comp of row.components) {
                                    if (comp.url && comp.url.includes(eventUrl)) return true;
                                    if (comp.customId && comp.customId.includes(eventId)) return true;
                                }
                            }
                        }
                        if (remMsg.content && remMsg.content.includes(`**${eventName}**`)) {
                            const remTimeMatch = remMsg.content.match(/<t:(\d+):[a-zA-Z]?>/);
                            if (remTimeMatch) {
                                if (announceTimestamp) return remTimeMatch[1] === announceTimestamp;
                                else return (parseInt(remTimeMatch[1], 10) * 1000) < Date.now();
                            }
                            return true; 
                        }
                        return false;
                    });

                    for (const remMsg of matchingReminders) {
                        if (!deletedMessageIds.has(remMsg.id)) {
                            await remMsg.delete().catch(() => {});
                            deletedMessageIds.add(remMsg.id);
                            remindersDeletedCount++;
                        }
                    }
                }
            }

            if (cleanedCount > 0 || remindersDeletedCount > 0) await saveDb();
            let successMsg = `Successfully scanned and cleaned up **${cleanedCount}** concluded event announcement(s) and deleted **${remindersDeletedCount}** public reminder(s)!`;
            await interaction.editReply({ content: successMsg });
        }

        if (subcommand === 'silenceevent' || subcommand === 'unsilenceevent') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const eventIdentifier = interaction.options.getString('event');
            const match = eventIdentifier.match(/(?:\/events\/\d+\/)?(\d{17,19})/);
            const eventId = match ? match[1] : null;

            if (!eventId) {
                return interaction.editReply({ content: t(userLocale, 'announce_invalid_id') });
            }

            const event = await interaction.guild.scheduledEvents.fetch(eventId).catch(() => null);
            if (!event) {
                return interaction.editReply({ content: t(userLocale, 'announce_not_found') });
            }

            if (subcommand === 'silenceevent') {
                if (!eventDb[eventId]) {
                    eventDb[eventId] = { messageId: null, guildId: interaction.guildId, users: {}, reminderMessageIds: [], skippedUsers: {}, remindersDisabled: true };
                } else {
                    eventDb[eventId].remindersDisabled = true;
                }
                cancelEventReminders(eventId);
                await saveDb();

                if (eventDb[eventId].messageId) {
                    try {
                        const channelId = getAnnouncementChannelId(interaction.guildId);
                        const channel = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : null;
                        if (channel) {
                            const msg = await channel.messages.fetch(eventDb[eventId].messageId).catch(() => null);
                            if (msg && msg.embeds.length > 0) {
                                const updatedEmbed = buildAnnouncementEmbed(event);
                                let components = msg.components;
                                if (components && components.length > 0) {
                                    const currentComponents = components[0].components;
                                    const remindButton = ButtonBuilder.from(currentComponents[0]).setDisabled(true);
                                    const updatedRow = new ActionRowBuilder().addComponents(remindButton);
                                    for (let i = 1; i < currentComponents.length; i++) updatedRow.addComponents(ButtonBuilder.from(currentComponents[i]));
                                    components = [updatedRow];
                                }
                                await msg.edit({ embeds: [updatedEmbed], components: components }).catch(() => {});
                            }
                        }
                    } catch (err) {}
                }
                await interaction.editReply({ content: t(userLocale, 'settings_silenceevent_success', { name: event.name }) });
            } else {
                if (eventDb[eventId]) {
                    const silentPattern = /\[silent\]|\[exclude\]/i;
                    const hasTag = silentPattern.test(event.name || '') || silentPattern.test(event.description || '');

                    eventDb[eventId].remindersDisabled = false;
                    if (!hasTag) scheduleRemindersForEvent(event);
                    await saveDb();

                    if (eventDb[eventId].messageId) {
                        try {
                            const channelId = getAnnouncementChannelId(interaction.guildId);
                            const channel = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : null;
                            if (channel) {
                                const msg = await channel.messages.fetch(eventDb[eventId].messageId).catch(() => null);
                                if (msg && msg.embeds.length > 0) {
                                    const updatedEmbed = buildAnnouncementEmbed(event);
                                    let components = msg.components;
                                    if (components && components.length > 0) {
                                        const currentComponents = components[0].components;
                                        const remindButton = ButtonBuilder.from(currentComponents[0]).setDisabled(hasTag);
                                        const updatedRow = new ActionRowBuilder().addComponents(remindButton);
                                        for (let i = 1; i < currentComponents.length; i++) updatedRow.addComponents(ButtonBuilder.from(currentComponents[i]));
                                        components = [updatedRow];
                                    }
                                    await msg.edit({ embeds: [updatedEmbed], components: components }).catch(() => {});
                                }
                            }
                        } catch (err) {}
                    }
                    let warningText = hasTag ? '\n\n*(Note: This event still contains a silencing tag [silent]/[exclude] in Discord. You must edit the event details to remove it before reminders will resume.)*' : '';
                    await interaction.editReply({ content: t(userLocale, 'settings_unsilenceevent_success', { name: event.name }) + warningText });
                } else {
                    await interaction.editReply({ content: t(userLocale, 'settings_silenceevent_error') });
                }
            }
        }
    }
};
