const { Client, GatewayIntentBits, Events, EmbedBuilder, GuildScheduledEventStatus, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, ActivityType, StringSelectMenuBuilder, MessageFlags, Collection } = require('discord.js');
const schedule = require('node-schedule');
require('dotenv').config();
const path = require('path');
const { parseIntervals, getFormattedTimeString, generateGoogleCalendarLink, formatDuration } = require('./utils.js');
const { eventDb, serverConfig, saveConfig, saveDb, forceSaveDb, setStorageErrorHandler } = require('./storage.js');
const { version } = require('./package.json');
const { t, getNormalizedLocale } = require('./i18n.js');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.GuildScheduledEvents
    ] 
});

/**
 * Retrieves the configured announcement channel ID for a specific guild.
 * Prioritizes the database config, then falls back to the .env variable.
 * @param {string} guildId - The Discord Guild ID.
 * @returns {string|undefined} The channel ID or undefined if not configured.
 */
function getAnnouncementChannelId(guildId) {
    // Prioritize DB config, then fall back to .env
    const config = serverConfig[guildId];
    if (typeof config === 'object' && config !== null) return config.channelId || process.env.ANNOUNCEMENT_CHANNEL_ID;
    return config || process.env.ANNOUNCEMENT_CHANNEL_ID;
}

/**
 * Retrieves the reminder mode ('public' or 'private') for a specific guild.
 * @param {string} guildId - The Discord Guild ID.
 * @returns {string} The configured mode (defaults to 'private').
 */
function getAnnouncementMode(guildId) {
    const config = serverConfig[guildId];
    if (typeof config === 'object' && config !== null) return config.mode || 'private';
    return 'private';
}

/**
 * Resolves the localized text description of the reminder mode.
 * @param {string} mode - The reminder mode ('public', 'private', or 'hybrid').
 * @param {string} locale - The user/guild locale.
 * @returns {string} The localized mode description.
 */
function getModeText(mode, locale) {
    const normalized = typeof locale === 'string' ? locale.toLowerCase() : 'en';
    if (mode === 'public') {
        if (normalized.startsWith('es')) return 'Recordatorios de canal público';
        if (normalized.startsWith('de')) return 'Öffentliche Kanal-Erinnerungen';
        if (normalized.startsWith('fr')) return 'Rappels de salon public';
        if (normalized.startsWith('pt')) return 'Lembretes de canal público';
        return 'Public Channel Reminders';
    } else if (mode === 'hybrid') {
        if (normalized.startsWith('es')) return 'Híbrido (Canal público y MD)';
        if (normalized.startsWith('de')) return 'Hybrid (Öffentlicher Kanal & DM)';
        if (normalized.startsWith('fr')) return 'Hybride (Salon public & DM)';
        if (normalized.startsWith('pt')) return 'Híbrido (Canal público e DM)';
        return 'Hybrid (Public Channel & DM)';
    } else {
        if (normalized.startsWith('es')) return 'Recordatorios de MD privado (Opt-in)';
        if (normalized.startsWith('de')) return 'Private DM-Erinnerungen (Opt-in)';
        if (normalized.startsWith('fr')) return 'Rappels de DM privé (Opt-in)';
        if (normalized.startsWith('pt')) return 'Lembretes de DM privado (Opt-in)';
        return 'Private DM Reminders (Opt-in)';
    }
}


/**
 * Retrieves the configured reminder intervals for a specific guild.
 * @param {string} guildId - The Discord Guild ID.
 * @returns {Array<{value: number, unit: string, ms: number}>} Array of interval objects.
 */
function getReminderIntervals(guildId) {
    const config = serverConfig[guildId];
    if (typeof config === 'object' && config !== null && Array.isArray(config.intervals) && config.intervals.length > 0) {
        return config.intervals;
    }
    // Default fallback if not configured
    return [{ value: 24, unit: 'h', ms: 24 * 60 * 60 * 1000 }, { value: 1, unit: 'h', ms: 1 * 60 * 60 * 1000 }];
}

/**
 * Checks if the "Add to Calendar" button feature is enabled for a specific guild.
 * @param {string} guildId - The Discord Guild ID.
 * @returns {boolean} True if enabled, false otherwise (defaults to true).
 */
function getCalendarEnabled(guildId) {
    const config = serverConfig[guildId];
    if (typeof config === 'object' && config !== null && config.calendarEnabled !== undefined) return config.calendarEnabled;
    return true; // Default to true
}

/**
 * Checks if the auto-create discussion threads feature is enabled for a specific guild.
 * @param {string} guildId - The Discord Guild ID.
 * @returns {boolean} True if enabled, false otherwise (defaults to true).
 */
function getThreadsEnabled(guildId) {
    const config = serverConfig[guildId];
    if (typeof config === 'object' && config !== null && config.threadsEnabled !== undefined) return config.threadsEnabled;
    return true; // Default to true
}

/**
 * Checks if the auto-delete feature is enabled for a specific guild.
 * @param {string} guildId - The Discord Guild ID.
 * @returns {boolean} True if enabled, false otherwise (defaults to false).
 */
function getAutoDeleteEnabled(guildId) {
    const config = serverConfig[guildId];
    if (typeof config === 'object' && config !== null && config.autoDeleteEnabled !== undefined) return config.autoDeleteEnabled;
    return false; // Default to false (archive instead of delete)
}

/**
 * Sends a Direct Message to the configured administrator user with error details.
 * @param {string} contextMessage - A description of what the bot was doing when the error occurred.
 * @param {Error|string} error - The error object or string.
 * @returns {Promise<void>}
 */
async function notifyAdmin(contextMessage, error) {
    const adminId = process.env.ADMIN_USER_ID;
    if (!adminId || !client.isReady()) return;

    try {
        const admin = await client.users.fetch(adminId);
        if (admin) {
            const errorMessage = error instanceof Error ? error.stack : error;
            const msg = `⚠️ **Bot Error Alert** ⚠️\n**Context:** ${contextMessage}\n\`\`\`js\n${String(errorMessage).slice(0, 1800)}\n\`\`\``;
            await admin.send(msg);
        }
    } catch (err) {
        console.error('Failed to notify admin via DM:', err);
    }
}

setStorageErrorHandler(notifyAdmin);

/**
 * Checks if an event is silenced either by title/description tags or via database configuration.
 * @param {GuildScheduledEvent} event - The Discord Scheduled Event object.
 * @returns {boolean} True if silenced, false otherwise.
 */
function isEventSilenced(event) {
    if (!event) return false;
    
    // 1. Tag Check: Check if name or description contains [silent] or [exclude] (case-insensitive)
    const silentPattern = /\[silent\]|\[exclude\]/i;
    if (silentPattern.test(event.name || '') || silentPattern.test(event.description || '')) {
        return true;
    }
    
    // 2. Database Check: Check if remindersDisabled is set to true in eventDb
    if (eventDb[event.id] && eventDb[event.id].remindersDisabled) {
        return true;
    }
    
    return false;
}

/**
 * Synchronizes the "Remind Me!" live counter on the original announcement message.
 * @param {string} eventId - The ID of the Discord Scheduled Event.
 */
async function updateLiveCounter(eventId) {
    try {
        const eventData = eventDb[eventId];
        if (!eventData || !eventData.messageId) return;

        let guild;
        if (eventData.guildId) {
            guild = client.guilds.cache.get(eventData.guildId);
        }
        if (!guild) {
            guild = client.guilds.cache.find(g => g.scheduledEvents.cache.has(eventId));
        }
        if (!guild) return;

        const channelId = getAnnouncementChannelId(guild.id);
        if (!channelId) return;

        const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const msg = await channel.messages.fetch(eventData.messageId).catch(() => null);
        if (!msg || !msg.components || msg.components.length === 0) return;

        const userCount = Object.keys(eventData.users || {}).length;
        const guildLocale = getNormalizedLocale(guild.preferredLocale);
        const baseRemindLabel = t(guildLocale, 'announcement_button_remind');
        const newLabel = userCount > 0 ? `${baseRemindLabel} (${userCount})` : baseRemindLabel;

        const currentComponents = msg.components[0].components;
        if (!currentComponents[0].customId || !currentComponents[0].customId.startsWith('remind_')) return;
        if (currentComponents[0].label === newLabel) return; // Prevent redundant API calls

        const updatedRow = new ActionRowBuilder().addComponents(ButtonBuilder.from(currentComponents[0]).setLabel(newLabel));
        for (let i = 1; i < currentComponents.length; i++) {
            updatedRow.addComponents(ButtonBuilder.from(currentComponents[i]));
        }
        await msg.edit({ components: [updatedRow] }).catch(() => {});
    } catch (err) {
        console.error(`Failed to update live counter for event ${eventId}:`, err);
    }
}

/**
 * Cancels all pending node-schedule reminder jobs for a given event ID.
 * @param {string} eventId - The ID of the Discord Scheduled Event.
 */
function cancelEventReminders(eventId) {
    const prefix = `${eventId}-`;
    for (const jobName in schedule.scheduledJobs) {
        if (jobName.startsWith(prefix)) {
            schedule.scheduledJobs[jobName].cancel();
            console.log(`Cancelled: ${jobName}`);
        }
    }
}

/**
 * Fetches users and sends DMs with a delay between each message to respect Discord's rate limits.
 * @param {Array<string>} userIds Array of Discord User IDs
 * @param {Object|String} messagePayload Message payload to send
 * @returns {Promise<Boolean>} True if at least one message was sent successfully
 */
async function sendDMsWithRateLimit(userIds, messagePayload) {
    const failedUserIds = [];
    const BATCH_SIZE = 5;
    const BATCH_DELAY = 1000; // 1 second delay between batches

    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
        const batch = userIds.slice(i, i + BATCH_SIZE);
        
        const promises = batch.map(async userId => {
            try {
                const user = client.users.cache.get(userId) || await client.users.fetch(userId);
                if (user && !user.bot) {
                    await user.send(messagePayload);
                } else {
                    failedUserIds.push(userId);
                }
            } catch (err) {
                console.log(`Could not fetch or send DM to ${userId}`);
                failedUserIds.push(userId);
            }
        });

        await Promise.all(promises);

        // Delay between batches to prevent spamming the Discord API
        if (i + BATCH_SIZE < userIds.length) {
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
    }
    return failedUserIds;
}

/**
 * Sends an update notification DM to all users opted-in to a specific event.
 * @param {GuildScheduledEvent} event - The Discord Scheduled Event object.
 * @param {string} messageText - The notification text to send.
 * @returns {Promise<void>}
 */
async function notifyUsersOfEventChange(event, messageText) {
    const eventData = eventDb[event.id];
    if (!eventData || !eventData.users) return;
    
    const userIds = Object.keys(eventData.users);
    if (userIds.length === 0) return;

    await sendDMsWithRateLimit(userIds, { content: messageText });
}

/**
 * Syncs and schedules all active event reminders for a given guild.
 * @param {Guild} guild - The Discord Guild object.
 * @returns {Promise<void>}
 */
async function syncEventReminders(guild) {
    const events = await guild.scheduledEvents.fetch().catch(() => null);
    if (!events) return;
    const now = Date.now();
    const channelId = getAnnouncementChannelId(guild.id);
    const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
    
    for (const event of events.values()) {
        scheduleRemindersForEvent(event, now);
        
        // Clean up obsolete reminders that might have rolled over or postponed while offline
        const eventData = eventDb[event.id];
        if (eventData && eventData.reminderMessageIds && eventData.reminderMessageIds.length > 0 && channel) {
            const intervals = getReminderIntervals(guild.id);
            const maxIntervalMs = intervals.length > 0 ? Math.max(...intervals.map(i => i.ms)) : 0;
            const thresholdTime = event.scheduledStartTimestamp - maxIntervalMs - 60000; // 1 minute safety buffer
            
            const remainingMessageIds = [];
            for (const rMsgId of eventData.reminderMessageIds) {
                try {
                    const msgTimestamp = Number((BigInt(rMsgId) >> 22n) + 1420070400000n);
                    if (msgTimestamp < thresholdTime) {
                        const rMsg = await channel.messages.fetch(rMsgId).catch(() => null);
                        if (rMsg) {
                            await rMsg.delete().catch(() => {});
                        }
                    } else {
                        remainingMessageIds.push(rMsgId);
                    }
                } catch (err) {
                    remainingMessageIds.push(rMsgId);
                }
            }
            if (remainingMessageIds.length !== eventData.reminderMessageIds.length) {
                eventDb[event.id].reminderMessageIds = remainingMessageIds;
                await saveDb();
            }
        }
    }
}

/**
 * Calculates and schedules the node-schedule jobs for an event's reminders.
 * @param {GuildScheduledEvent} event - The Discord Scheduled Event object.
 * @param {number} [now=Date.now()] - Current timestamp reference.
 */
function scheduleRemindersForEvent(event, now = Date.now()) {
    // Skip events that are already completed, canceled, or silenced
    if (event.status === GuildScheduledEventStatus.Completed || event.status === GuildScheduledEventStatus.Canceled || isEventSilenced(event)) {
        return;
    }

    const startTime = event.scheduledStartTimestamp;
    const intervals = getReminderIntervals(event.guild.id);
    const minMs = intervals.length > 0 ? Math.min(...intervals.map(i => i.ms)) : 0;
    
    // Store only interval details statically at scheduling time
    const alerts = intervals.map(interval => ({
        id: `${event.id}-${interval.value}${interval.unit}`,
        time: startTime - interval.ms,
        ms: interval.ms,
        value: interval.value,
        unit: interval.unit
    }));

    alerts.forEach(alert => {
        if (alert.time > now) {
            if (schedule.scheduledJobs[alert.id]) schedule.scheduledJobs[alert.id].cancel();
            schedule.scheduleJob(alert.id, new Date(alert.time), async () => {
                const channelId = getAnnouncementChannelId(event.guild.id);
                const channel = channelId ? await event.guild.channels.fetch(channelId).catch(() => null) : null;
                if (channel) {
                    try {                            
                        const eventData = eventDb[event.id];
                        const mode = getAnnouncementMode(event.guild.id);
                        const rawUserIds = eventData && eventData.users ? Object.keys(eventData.users) : [];
                        const skippedUsers = eventData && eventData.skippedUsers ? eventData.skippedUsers : {};
                        const userIds = rawUserIds.filter(id => skippedUsers[id] !== event.scheduledStartTimestamp);
                        
                        // 1. DYNAMIC EVALUATION: Evaluate time string dynamically AT DISPATCH TIME
                        // This guarantees the relative countdown (e.g. "in 1 hour") is always calculated correctly.
                        // Since this runs exactly at dispatch time, start time is now within 1 week, so countdown will always show!
                        // As per request, pings/DMs are lightweight, so we do not pass event.scheduledEndTimestamp (no time ranges).
                        const currentFormattedTime = getFormattedTimeString(event.scheduledStartTimestamp, null, 'F');
                        
                        // 2. DYNAMIC LOCATION: Retrieve up-to-date location details from live cache
                        const currentLocation = event.entityMetadata?.location || (event.channelId ? `<#${event.channelId}>` : 'Discord');
                        
                        // 3. DEFENSIVE SAFETY TRUNCATION: Keeping the whole message strictly under Discord's 2,000-character limit
                        // We reserve 1,900 characters for the alert text to leave plenty of room for buttons, mentions, etc.
                        const guildLocale = getNormalizedLocale(event.guild.preferredLocale);
                        const baseMsg = t(guildLocale, mode === 'public' ? 'reminder_body_public' : 'reminder_body_private', {
                            value: alert.value,
                            unit: alert.unit,
                            name: event.name,
                            time: currentFormattedTime,
                            location: currentLocation
                        });
                        
                        let truncatedDesc = '';
                        if (event.description) {
                            const maxDescLength = 1900 - baseMsg.length - 10; // 10 chars buffer for spacing/newlines/elipses
                            if (maxDescLength > 10) {
                                if (event.description.length > maxDescLength) {
                                    truncatedDesc = `\n\n${event.description.substring(0, maxDescLength - 3)}...`;
                                } else {
                                    truncatedDesc = `\n\n${event.description}`;
                                }
                            }
                        }
                        
                        const alertMsg = `${baseMsg}${truncatedDesc}`;
                        
                        const isLastReminder = alert.ms === minMs;

                        // 1. Send public channel reminder if mode is 'public' or 'hybrid'
                        if (mode === 'public' || mode === 'hybrid') {
                            let mentions = '';
                            if (mode === 'public' && userIds.length > 0) {
                                mentions = '\n\n' + userIds.map(id => `<@${id}>`).join(' ');
                            }
                            const publicMsg = `${alertMsg}${mentions}`;
                            
                            const payload = {};
                            if (publicMsg.length > 2000) {
                                let safeMsg = `${alertMsg}\n\n` + t(guildLocale, 'public_reminders_hidden', { count: userIds.length });
                                if (safeMsg.length > 2000) safeMsg = safeMsg.substring(0, 1995) + '...';
                                payload.content = safeMsg;
                            } else {
                                payload.content = publicMsg;
                            }
                            
                            const row = new ActionRowBuilder();
                            if (!isLastReminder) {
                                row.addComponents(
                                    new ButtonBuilder().setCustomId(`remind_${event.id}`).setLabel(t(guildLocale, 'announcement_button_remind')).setStyle(ButtonStyle.Primary).setEmoji('⏰')
                                );
                            }
                            if (getCalendarEnabled(event.guild.id) && alert.ms > 60 * 60 * 1000) {
                                row.addComponents(new ButtonBuilder().setLabel(t(guildLocale, 'announcement_button_calendar')).setStyle(ButtonStyle.Link).setURL(generateGoogleCalendarLink(event)).setEmoji('📅'));
                            }
                            row.addComponents(new ButtonBuilder().setLabel(t(guildLocale, 'announcement_button_view')).setStyle(ButtonStyle.Link).setURL(`https://discord.com/events/${event.guild.id}/${event.id}`).setEmoji('🔗'));
                            if (row.components.length > 0) {
                                payload.components = [row];
                            }
                            
                            const sentMsg = await channel.send(payload).catch(() => null);
                            if (sentMsg && eventDb[event.id]) {
                                if (!eventDb[event.id].reminderMessageIds) {
                                    eventDb[event.id].reminderMessageIds = [];
                                }
                                eventDb[event.id].reminderMessageIds.push(sentMsg.id);
                                await saveDb();
                            }
                        }

                        // 2. Send private DM reminders if mode is 'private' or 'hybrid' AND there are opted-in users
                        if ((mode === 'private' || mode === 'hybrid') && userIds.length > 0) {
                            const components = [];
                            const row = new ActionRowBuilder();
                            if (!isLastReminder) {
                                row.addComponents(
                                    new ButtonBuilder().setCustomId(`cancel_remind_${event.id}`).setLabel(t(guildLocale, 'reminder_button_cancel')).setStyle(ButtonStyle.Danger).setEmoji('🔕')
                                );
                            }
                            row.addComponents(
                                new ButtonBuilder().setLabel(t(guildLocale, 'announcement_button_view')).setStyle(ButtonStyle.Link).setURL(`https://discord.com/events/${event.guild.id}/${event.id}`).setEmoji('🔗')
                            );
                            components.push(row);

                            const failedUserIds = await sendDMsWithRateLimit(userIds, { content: alertMsg, components });
                            
                            // If DMs failed, and NOT hybrid mode, post fallback mentions in public channel
                            if (failedUserIds.length > 0 && mode !== 'hybrid') {
                                const mentions = failedUserIds.map(id => `<@${id}>`).join(' ');
                                let prefix = 'Could not DM:';
                                if (guildLocale === 'es') prefix = 'No se pudo enviar MD a:';
                                else if (guildLocale === 'de') prefix = 'Konnte keine DM senden an:';
                                else if (guildLocale === 'fr') prefix = "Impossible d'envoyer un DM à :";
                                else if (guildLocale === 'pt') prefix = 'Não foi possível enviar DM para:';
                                const fallbackMsg = `${alertMsg}\n\n${prefix} ${mentions}`;
                                let sentMsg;
                                if (fallbackMsg.length > 2000) {
                                    let safeFallback = `${alertMsg}\n\n` + t(guildLocale, 'public_reminders_hidden_fallback', { count: failedUserIds.length });
                                    if (safeFallback.length > 2000) safeFallback = safeFallback.substring(0, 1995) + '...';
                                    sentMsg = await channel.send(safeFallback).catch(() => null);
                                } else {
                                    sentMsg = await channel.send(fallbackMsg).catch(() => null);
                                }
                                if (sentMsg && eventDb[event.id]) {
                                    if (!eventDb[event.id].reminderMessageIds) {
                                        eventDb[event.id].reminderMessageIds = [];
                                    }
                                    eventDb[event.id].reminderMessageIds.push(sentMsg.id);
                                    await saveDb();
                                }
                            }
                        }

                        // 3. Fallback if mode is 'private' and nobody opted in at all (keeps legacy behavior)
                        if (mode === 'private' && userIds.length === 0) {
                            let noOptInMsg = alertMsg;
                            if (noOptInMsg.length > 2000) noOptInMsg = noOptInMsg.substring(0, 1995) + '...';
                            const sentMsg = await channel.send(noOptInMsg).catch(() => null);
                            if (sentMsg && eventDb[event.id]) {
                                if (!eventDb[event.id].reminderMessageIds) {
                                    eventDb[event.id].reminderMessageIds = [];
                                }
                                eventDb[event.id].reminderMessageIds.push(sentMsg.id);
                                await saveDb();
                            }
                        }

                    } catch (err) {
                        console.error('Error sending reminders:', err);
                        notifyAdmin(`Error sending reminders for event ${event.id}`, err);
                    }
                } else {
                    console.error('Reminder failed: Announcement channel not found in guild.');
                    notifyAdmin(`Reminder failed: Announcement channel not found in guild ${event.guild.id}`, new Error('Channel missing'));
                }
            });
        }
    });
}

client.on(Events.ClientReady, async c => {
    console.log(`Bot logged in as ${c.user.tag} (v${version})`);
    
    c.user.setActivity({
        name: 'Custom Status',
        type: ActivityType.Custom,
        state: '/help | Event reminders and announcements'
    });
    
    const activeEventIds = new Set();
    const successfulGuildIds = new Set();
    
    // Sync all events and collect active IDs concurrently across all guilds
    const syncPromises = c.guilds.cache.map(async guild => {
        try {
            await syncEventReminders(guild);
            guild.scheduledEvents.cache.forEach(e => activeEventIds.add(e.id));
            successfulGuildIds.add(guild.id);
        } catch (err) {
            console.error(`Failed to sync events for guild ${guild.id}:`, err);
        }
    });
    await Promise.all(syncPromises);

    // Offline Garbage Collection: Remove events deleted while bot was offline
    let dbModified = false;
    for (const eventId in eventDb) {
        const eventData = eventDb[eventId];
        // Only garbage collect if we successfully synced the guild the event belongs to,
        // and the event is no longer active in that guild.
        if (eventData && eventData.guildId && successfulGuildIds.has(eventData.guildId)) {
            if (!activeEventIds.has(eventId)) {
                try {
                    const guild = c.guilds.cache.get(eventData.guildId);
                    if (guild) {
                        const event = await guild.scheduledEvents.fetch(eventId).catch(() => null);
                        const statusText = event && event.status === GuildScheduledEventStatus.Canceled ? 'Canceled' : 'Completed';
                        await archiveAnnouncementMessage(guild, eventId, statusText);
                    }
                } catch (archiveErr) {
                    console.error(`Failed to auto-archive offline event ${eventId}:`, archiveErr);
                }
                delete eventDb[eventId];
                dbModified = true;
            }
        }
    }
    if (dbModified) await saveDb();
    
    // Start the Web Dashboard server
    startDashboardServer();
});

client.on(Events.GuildScheduledEventCreate, async e => {
    if (isEventSilenced(e)) return;
    scheduleRemindersForEvent(e);
    
    // Post announcement message for the new event
    const channelId = getAnnouncementChannelId(e.guild.id);
    const channel = channelId ? await e.guild.channels.fetch(channelId).catch(() => null) : null;
    if (!channel) {
        console.error(`Cannot post announcement for event ${e.id}: Announcement channel not configured or found for guild ${e.guild.id}.`);
        return;
    }

    try {
        await postAnnouncement(e, channel);
    } catch (err) {
        // The error is already logged by postAnnouncement, no need to do anything else here.
    }
});

/**
 * Constructs the rich embed payload for a new event announcement.
 * @param {GuildScheduledEvent} event - The Discord Scheduled Event object.
 * @returns {EmbedBuilder} The built announcement embed.
 */
function buildAnnouncementEmbed(event) {
    const startTime = event.scheduledStartTimestamp;
    const endTime = event.scheduledEndTimestamp;
    const location = event.entityMetadata?.location || (event.channelId ? `<#${event.channelId}>` : 'Discord');
    const description = event.description ? `\n\n${event.description}` : '';
    const timeString = getFormattedTimeString(startTime, endTime, 'F');

    const mode = getAnnouncementMode(event.guild.id);
    const intervals = getReminderIntervals(event.guild.id);
    const intervalsStr = intervals.map(i => `${i.value}${i.unit}`).join(', ');
    const guildLocale = getNormalizedLocale(event.guild.preferredLocale);
    
    let reminderText;
    if (isEventSilenced(event)) {
        reminderText = t(guildLocale, 'announcement_footer_silenced');
    } else {
        reminderText = t(guildLocale, mode === 'public' ? 'announcement_footer_public' : 'announcement_footer_private', {
            intervals: intervalsStr
        });
    }

    let titlePrefix = 'New Event:';
    if (guildLocale === 'es') titlePrefix = 'Nuevo evento:';
    else if (guildLocale === 'de') titlePrefix = 'Neues Event:';
    else if (guildLocale === 'fr') titlePrefix = 'Nouvel événement :';
    else if (guildLocale === 'pt') titlePrefix = 'Novo evento:';
    let title = `${titlePrefix} ${event.name}`;
    if (title.length > 256) title = title.substring(0, 253) + '...';

    const timeField = t(guildLocale, 'announcement_time', { time: timeString });
    const locationField = t(guildLocale, 'announcement_location', { location: location });
    let fullDescription = `${timeField}\n${locationField}${description}\n\n${reminderText}`;
    
    // Defensive truncation for the 4096 embed description limit
    if (fullDescription.length > 4096 && event.description) {
        const overflow = fullDescription.length - 4096 + 3; // +3 for '...'
        const truncatedDesc = event.description.substring(0, event.description.length - overflow) + '...';
        fullDescription = `${timeField}\n${locationField}\n\n${truncatedDesc}\n\n${reminderText}`;
    }

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(fullDescription)
        .setColor('#0099ff');

    const duration = formatDuration(startTime, endTime);
    if (event.creatorId || duration) {
        const fields = [];
        if (event.creatorId) {
            fields.push({ name: t(guildLocale, 'announcement_host'), value: `<@${event.creatorId}>`, inline: true });
        }
        if (duration) {
            fields.push({ name: t(guildLocale, 'announcement_duration'), value: duration, inline: true });
        }
        embed.addFields(fields);
    }

    const coverImage = event.coverImageURL({ size: 512 });
    if (coverImage) {
        embed.setImage(coverImage);
    }

    return embed;
}

/**
 * Posts an event announcement to the configured channel and handles optional thread creation.
 * @param {GuildScheduledEvent} event - The Discord Scheduled Event object.
 * @param {TextChannel|AnnouncementChannel} channel - The channel to post in.
 * @returns {Promise<void>}
 */
async function postAnnouncement(event, channel) {
    const embed = buildAnnouncementEmbed(event);
    const guildLocale = getNormalizedLocale(event.guild.preferredLocale);

    const remindButton = new ButtonBuilder().setCustomId(`remind_${event.id}`).setLabel(t(guildLocale, 'announcement_button_remind')).setStyle(ButtonStyle.Primary).setEmoji('⏰');
    if (isEventSilenced(event)) {
        remindButton.setDisabled(true);
    }
    const row = new ActionRowBuilder().addComponents(remindButton);

    if (getCalendarEnabled(event.guild.id)) {
        row.addComponents(new ButtonBuilder().setLabel(t(guildLocale, 'announcement_button_calendar')).setStyle(ButtonStyle.Link).setURL(generateGoogleCalendarLink(event)).setEmoji('📅'));
    }

    row.addComponents(new ButtonBuilder().setLabel(t(guildLocale, 'announcement_button_view')).setStyle(ButtonStyle.Link).setURL(`https://discord.com/events/${event.guild.id}/${event.id}`).setEmoji('🔗'));

    try {
        const message = await channel.send({ embeds: [embed], components: [row] });
        eventDb[event.id] = { messageId: message.id, users: {}, guildId: event.guild.id };
        await saveDb();

        if (getThreadsEnabled(event.guild.id)) {
            try {
                await message.startThread({ name: `💬 Discussion: ${event.name}`.substring(0, 100) });
            } catch (threadErr) {
                console.error(`Could not create discussion thread for event ${event.id}:`, threadErr);
            }
        }
    } catch (err) {
        console.error(`Could not post announcement message for event ${event.id} in channel ${channel?.id}:`, err);
        notifyAdmin(`Could not post announcement message for event ${event.id} in channel ${channel?.id}`, err);
        throw err;
    }
}

/**
 * Generates the paginated response payload for the `/upcoming` command.
 * @param {CommandInteraction} interaction - The Discord interaction object.
 * @param {number} [page=0] - The zero-indexed page number to display.
 * @returns {Promise<{content: string, components: Array<ActionRowBuilder>}>}
 */
async function generateUpcomingPage(interaction, page = 0) {
    const userId = interaction.user.id;
    const guildEvents = await interaction.guild.scheduledEvents.fetch();
    
    const upcomingEvents = Array.from(guildEvents.values()).filter(event => {
        const users = eventDb[event.id]?.users || {};
        return !users[userId] && (event.status === GuildScheduledEventStatus.Scheduled || event.status === GuildScheduledEventStatus.Active);
    }).sort((a, b) => a.scheduledStartTimestamp - b.scheduledStartTimestamp);

    const userLocale = getNormalizedLocale(interaction.locale);
    if (upcomingEvents.length === 0) {
        return { content: t(userLocale, 'upcoming_no_events'), components: [] };
    }

    const totalPages = Math.ceil(upcomingEvents.length / 25);
    if (page >= totalPages) page = totalPages - 1;
    if (page < 0) page = 0;

    const startIndex = page * 25;
    const pageEvents = upcomingEvents.slice(startIndex, startIndex + 25);

    const pageText = totalPages > 1 ? ` - Page ${page + 1}/${totalPages}` : '';
    let replyMessage = t(userLocale, 'upcoming_title', { pageText: pageText });
    
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('list_optin_select')
        .setPlaceholder(t(userLocale, 'upcoming_select_placeholder'))
        .setMinValues(1)
        .setMaxValues(pageEvents.length);

    pageEvents.forEach(event => {
        const timeString = getFormattedTimeString(event.scheduledStartTimestamp, 'f');
        const nextLine = `• **${event.name}** - ${timeString}\n`;
        if (replyMessage.length + nextLine.length < 1900) {
            replyMessage += nextLine;
        }
        let label = event.name;
        if (label.length > 100) label = label.substring(0, 97) + '...';
        selectMenu.addOptions({ label: label, value: event.id, emoji: '⏰' });
    });

    const components = [new ActionRowBuilder().addComponents(selectMenu)];

    if (totalPages > 1) {
        const navRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`upcoming_page_${page - 1}`)
                .setLabel(t(userLocale, 'upcoming_btn_prev'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`upcoming_page_${page + 1}`)
                .setLabel(t(userLocale, 'upcoming_btn_next'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === totalPages - 1)
        );
        components.push(navRow);
    }
    return { content: replyMessage, components: components };
}

/**
 * Generates the paginated response payload for the `/myreminders` command.
 * @param {CommandInteraction} interaction - The Discord interaction object.
 * @param {number} [page=0] - The zero-indexed page number to display.
 * @returns {Promise<{content: string, components: Array<ActionRowBuilder>}>}
 */
async function generateMyRemindersPage(interaction, page = 0) {
    const userId = interaction.user.id;
    const myEventIds = new Set();

    // Find all event IDs the user is opted into
    for (const [eventId, data] of Object.entries(eventDb)) {
        if (data.users && data.users[userId]) {
            myEventIds.add(eventId);
        }
    }

    const userLocale = getNormalizedLocale(interaction.locale);
    if (myEventIds.size === 0) {
        return { content: t(userLocale, 'myreminders_no_events'), components: [] };
    }

    // Fetch the actual events from the current guild to filter out events from other servers
    const guildEvents = await interaction.guild.scheduledEvents.fetch();
    const myGuildEvents = Array.from(guildEvents.values())
        .filter(event => myEventIds.has(event.id) && (event.status === GuildScheduledEventStatus.Scheduled || event.status === GuildScheduledEventStatus.Active))
        .sort((a, b) => a.scheduledStartTimestamp - b.scheduledStartTimestamp);

    if (myGuildEvents.length === 0) {
         return { content: t(userLocale, 'myreminders_no_guild_events'), components: [] };
    }

    const totalPages = Math.ceil(myGuildEvents.length / 25);
    if (page >= totalPages) page = totalPages - 1;
    if (page < 0) page = 0;

    const startIndex = page * 25;
    const pageEvents = myGuildEvents.slice(startIndex, startIndex + 25);

    const pageText = totalPages > 1 ? ` - Page ${page + 1}/${totalPages}` : '';
    let replyMessage = t(userLocale, 'myreminders_title', { pageText: pageText });
    
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('list_cancel_select')
        .setPlaceholder(t(userLocale, 'myreminders_select_placeholder'))
        .setMinValues(1)
        .setMaxValues(pageEvents.length);

    pageEvents.forEach(event => {
        const timeString = getFormattedTimeString(event.scheduledStartTimestamp, 'f');
        const nextLine = `• **${event.name}** - ${timeString}\n`;
        if (replyMessage.length + nextLine.length < 1900) {
            replyMessage += nextLine;
        }
        let label = event.name;
        if (label.length > 100) label = label.substring(0, 97) + '...';
        selectMenu.addOptions({ label: label, value: event.id, emoji: '🔕' });
    });

    const components = [new ActionRowBuilder().addComponents(selectMenu)];

    if (totalPages > 1) {
        const navRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`myreminders_page_${page - 1}`).setLabel(t(userLocale, 'upcoming_btn_prev')).setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId(`myreminders_page_${page + 1}`).setLabel(t(userLocale, 'upcoming_btn_next')).setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages - 1)
        );
        components.push(navRow);
    }
    return { content: replyMessage, components: components };
}

const commandCooldowns = new Collection();
const buttonCooldowns = new Collection();

client.on(Events.InteractionCreate, async interaction => {
    try {
    if (interaction.isChatInputCommand()) {
        
        // Command Cooldown System
        if (!commandCooldowns.has(interaction.commandName)) {
            commandCooldowns.set(interaction.commandName, new Collection());
        }

        const now = Date.now();
        const timestamps = commandCooldowns.get(interaction.commandName);
        
        // 10-second cooldown for list commands to prevent API spam, 3-second default for others
        const specificCooldowns = { upcoming: 10, myreminders: 10 };
        const cooldownAmount = (specificCooldowns[interaction.commandName] || 3) * 1000;

        if (timestamps.has(interaction.user.id)) {
            const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

            if (now < expirationTime) {
                const expiredTimestamp = Math.round(expirationTime / 1000);
                const userLocale = getNormalizedLocale(interaction.locale);
                return interaction.reply({ 
                    content: t(userLocale, 'command_cooldown', { command: interaction.commandName, time: `<t:${expiredTimestamp}:R>` }), 
                    flags: MessageFlags.Ephemeral 
                });
            }
        }

        timestamps.set(interaction.user.id, now);
        setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

        if (interaction.commandName === 'settings') {
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
                    // Handle legacy config formatting gracefully
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
                if (userLocale === 'es') {
                    statusText = enabled ? 'activado' : 'desactivado';
                    archiveStatusText = enabled ? 'desactivado' : 'activado';
                } else if (userLocale === 'de') {
                    statusText = enabled ? 'aktiviert' : 'deaktiviert';
                    archiveStatusText = enabled ? 'deaktiviert' : 'aktiviert';
                } else if (userLocale === 'fr') {
                    statusText = enabled ? 'activé' : 'désactivé';
                    archiveStatusText = enabled ? 'désactivé' : 'activé';
                } else if (userLocale === 'pt') {
                    statusText = enabled ? 'ativado' : 'desativado';
                    archiveStatusText = enabled ? 'desactivado' : 'ativado';
                }

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
                
                // Reschedule for existing active events in this server
                const guildEvents = await interaction.guild.scheduledEvents.fetch();
                const now = Date.now();
                guildEvents.forEach(event => { cancelEventReminders(event.id); scheduleRemindersForEvent(event, now); });
                
                const intervalsStr = parsed.map(i => `${i.value}${i.unit}`).join(', ');
                await interaction.reply({ content: t(userLocale, 'settings_intervals_success', { intervals: intervalsStr }), flags: MessageFlags.Ephemeral });
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
                
                if (userLocale === 'es') {
                    enabledText = 'Activado ✅';
                    disabledText = 'Desactivado ❌';
                    notConfiguredText = '*No configurado*';
                } else if (userLocale === 'de') {
                    enabledText = 'Aktiviert ✅';
                    disabledText = 'Deaktiviert ❌';
                    notConfiguredText = '*Nicht konfiguriert*';
                } else if (userLocale === 'fr') {
                    enabledText = 'Activé ✅';
                    disabledText = 'Désactivé ❌';
                    notConfiguredText = '*Non configuré*';
                } else if (userLocale === 'pt') {
                    enabledText = 'Ativado ✅';
                    disabledText = 'Desativado ❌';
                    notConfiguredText = '*Não configurado*';
                }

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
                const userLocale = getNormalizedLocale(interaction.locale);
                const channelId = getAnnouncementChannelId(interaction.guildId);
                const channel = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : null;
                
                if (!channel) {
                    return interaction.editReply({ content: t(userLocale, 'announce_no_channel') });
                }

                // Fetch last 100 messages from the channel to scan for announcements
                const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
                if (!messages || messages.size === 0) {
                    let noMsg = 'No messages found in the announcement channel to clean up.';
                    if (userLocale === 'es') noMsg = 'No se encontraron mensajes en el canal de anuncios para limpiar.';
                    else if (userLocale === 'de') noMsg = 'Keine Nachrichten im Ankündigungskanal zum Bereinigen gefunden.';
                    else if (userLocale === 'fr') noMsg = 'Aucun message trouvé dans le salon d\'annonces à nettoyer.';
                    else if (userLocale === 'pt') noMsg = 'Nenhuma mensagem encontrada no canal de anúncios para limpar.';
                    return interaction.editReply({ content: noMsg });
                }

                const autoDelete = getAutoDeleteEnabled(interaction.guildId);
                const guildLocale = getNormalizedLocale(interaction.guild.preferredLocale);
                let cleanedCount = 0;
                let remindersDeletedCount = 0;

                // Process bot messages to find unarchived announcements
                const botMessages = Array.from(messages.values()).filter(msg => msg.author.id === client.user.id);
                
                // Track parsed details for all events found in the announcement channel
                const foundEvents = new Map();
                const deletedMessageIds = new Set();

                // Fetch all active scheduled events in the guild to cross-reference
                const activeEventsCollection = await interaction.guild.scheduledEvents.fetch().catch(() => null);
                const activeEventsList = activeEventsCollection ? Array.from(activeEventsCollection.values()) : [];

                for (const msg of botMessages) {
                    const isAnnouncement = msg.embeds.length > 0;

                    if (!isAnnouncement) {
                        let eventId = null;
                        let eventName = '';

                        // 1. Try to parse eventId from button components if buttons exist
                        if (msg.components.length > 0) {
                            for (const row of msg.components) {
                                for (const comp of row.components) {
                                    if (comp.url) {
                                        const match = comp.url.match(/(?:\/events\/|discord\.com\/events\/\d+\/)(\d{17,19})/);
                                        if (match) {
                                            eventId = match[1];
                                            break;
                                        }
                                    }
                                    if (comp.customId && comp.customId.startsWith('remind_')) {
                                        eventId = comp.customId.replace('remind_', '');
                                        break;
                                    }
                                }
                                if (eventId) break;
                            }
                        }

                        // 2. Try to parse eventName from the content (between ** asterisks)
                        if (msg.content) {
                            const match = msg.content.match(/\*\*(.*?)\*\*/);
                            if (match) {
                                eventName = match[1];
                            }
                        }

                        // 3. Determine if the reminder belongs to a concluded event
                        let isConcluded = false;
                        if (eventId) {
                            const event = activeEventsCollection ? activeEventsCollection.get(eventId) : null;
                            if (!event || event.status === GuildScheduledEventStatus.Completed || event.status === GuildScheduledEventStatus.Canceled) {
                                isConcluded = true;
                            } else {
                                // If the event exists but the reminder is for a past occurrence, it is concluded
                                const timeMatch = msg.content ? msg.content.match(/<t:(\d+):[a-zA-Z]?>/) : null;
                                if (timeMatch) {
                                    const msgStartTimestampMs = parseInt(timeMatch[1], 10) * 1000;
                                    if (msgStartTimestampMs < event.scheduledStartTimestamp) {
                                        isConcluded = true;
                                    }
                                }
                            }
                        } else if (eventName) {
                            const timeMatch = msg.content ? msg.content.match(/<t:(\d+):[a-zA-Z]?>/) : null;
                            if (timeMatch) {
                                const msgStartTimestampMs = parseInt(timeMatch[1], 10) * 1000;
                                const matchingActiveEvent = activeEventsList.find(e => e.name === eventName && e.scheduledStartTimestamp === msgStartTimestampMs);
                                if (!matchingActiveEvent) {
                                    isConcluded = true;
                                } else {
                                    eventId = matchingActiveEvent.id;
                                }
                            } else {
                                const activeEvent = activeEventsList.find(e => e.name === eventName);
                                if (!activeEvent) {
                                    isConcluded = true;
                                } else {
                                    eventId = activeEvent.id;
                                }
                            }
                        }

                        if (isConcluded) {
                            // Immediately delete concluded reminder message (even if it has no buttons)
                            await msg.delete().catch(() => {});
                            if (!deletedMessageIds.has(msg.id)) {
                                deletedMessageIds.add(msg.id);
                                remindersDeletedCount++;
                            }
                        } else if (eventId && eventName) {
                            // Track active reminders so we can match them if necessary
                            if (!foundEvents.has(eventId)) {
                                foundEvents.set(eventId, { eventName, isAnnouncement: false, msg });
                            }
                        }
                        continue;
                    }

                    // Process Announcement Messages
                    let eventId = null;
                    const embed = msg.embeds[0];
                    const title = embed.data.title || '';
                    const isArchived = title.startsWith('~~') || title.includes('\u0336') || title.includes('\n');

                    // 1. Try to extract eventId from button custom ID
                    if (msg.components.length > 0) {
                        for (const row of msg.components) {
                            for (const comp of row.components) {
                                if (comp.customId && comp.customId.startsWith('remind_')) {
                                    eventId = comp.customId.replace('remind_', '');
                                    break;
                                }
                            }
                            if (eventId) break;
                        }
                    }

                    // 2. Try to extract eventId from button URLs
                    if (!eventId && msg.components.length > 0) {
                        for (const row of msg.components) {
                            for (const comp of row.components) {
                                if (comp.url) {
                                    const match = comp.url.match(/(?:\/events\/|discord\.com\/events\/\d+\/)(\d{17,19})/);
                                    if (match) {
                                        eventId = match[1];
                                        break;
                                    }
                                }
                            }
                            if (eventId) break;
                        }
                    }

                    // 3. Try to extract eventId from description URL
                    if (!eventId && embed.description) {
                        const match = embed.description.match(/(?:\/events\/|discord\.com\/events\/\d+\/)(\d{17,19})/);
                        if (match) {
                            eventId = match[1];
                        }
                    }

                    if (eventId) {
                        const cleanTitle = title
                             .replace(/^~~|~~$/g, '')
                             .replace(/[\u0336]/g, '')
                             .replace(/\n.*/g, '')
                             .replace(/ \[[^\]]+\]$/g, '');
                        const eventName = cleanTitle.replace(/^(New Event:|Nuevo evento:|Neues Event:|Nouvel événement\s*:|Novo evento:)\s*/i, '');

                        // Announcement takes precedence to preserve isArchived status
                        foundEvents.set(eventId, { eventName, isAnnouncement: true, msg, isArchived });
                    }
                }

                // Process compiled event IDs to clean up announcements and any remaining public pings
                for (const [eventId, info] of foundEvents.entries()) {
                    const event = activeEventsCollection ? activeEventsCollection.get(eventId) : null;
                    
                    // If the event does not exist (null) OR is Completed/Canceled, it is concluded!
                    if (!event || event.status === GuildScheduledEventStatus.Completed || event.status === GuildScheduledEventStatus.Canceled) {
                        const statusText = event && event.status === GuildScheduledEventStatus.Canceled ? 'Canceled' : 'Completed';
                        const { eventName, isAnnouncement, msg: announceMsg, isArchived } = info;

                        // A. Process announcement archiving if the announcement is unarchived
                        if (isAnnouncement && !isArchived) {
                            if (eventDb[eventId]) {
                                await archiveAnnouncementMessage(interaction.guild, eventId, statusText, announceMsg);
                                delete eventDb[eventId];
                            } else {
                                if (autoDelete) {
                                    await announceMsg.delete().catch(() => {});
                                } else {
                                    const originalEmbed = EmbedBuilder.from(announceMsg.embeds[0]);
                                    const title = announceMsg.embeds[0].data.title || '';
                                    const cleanTitle = title
                                         .replace(/^~~|~~$/g, '')
                                         .replace(/[\u0336]/g, '')
                                         .replace(/\n.*/g, '')
                                         .replace(/ \[[^\]]+\]$/g, '');

                                    let newTitle = toUnicodeStrikeThrough(cleanTitle);
                                    if (newTitle.length > 256) {
                                        newTitle = `${toUnicodeStrikeThrough(cleanTitle.substring(0, 124))}...`;
                                    }
                                    originalEmbed.setTitle(newTitle);
                                    originalEmbed.setColor('#808080');
                                    originalEmbed.setImage(null);
                                    
                                    const statusBanner = t(guildLocale, statusText === 'Completed' ? 'concluded_banner' : 'canceled_banner') + '\n\n';
                                    
                                    let newDesc = originalEmbed.data.description || '';
                                    newDesc = newDesc
                                        .replace(/\n\n\*(?:Click|¡Haz|Klicke|Cliquez|Clique)[^*]+\*/gi, '')
                                        .replace(/\s\(<t:\d+:R>\)/, '');
                                    newDesc = newDesc.replace(/(🗓️ \*\*.*?\*\* .*?)(\n|$)/g, '~~$1~~$2')
                                                     .replace(/(📍 \*\*.*?\*\* .*?)(\n|$)/g, '~~$1~~$2');
                                                     
                                    if (newDesc.trim()) {
                                        newDesc = newDesc.split('\n').map(line => line.startsWith('> ') ? line : `> ${line}`).join('\n');
                                        newDesc = `${statusBanner}${newDesc}`;
                                    } else {
                                        newDesc = statusBanner.trim();
                                    }
                                    
                                    if (newDesc.length > 4096) newDesc = newDesc.substring(0, 4093) + '...';
                                    originalEmbed.setDescription(newDesc);
                                    await announceMsg.edit({ embeds: [originalEmbed], components: [] }).catch(() => {});
                                }
                            }
                            cleanedCount++;
                        } else {
                            // If the event database still tracks this concluded event but announcement is already archived/deleted
                            if (eventDb[eventId]) {
                                delete eventDb[eventId];
                            }
                        }

                        // B. Fail-safe: Always scan and clean up any remaining public reminder messages associated with this event!
                        const eventUrl = `https://discord.com/events/${interaction.guildId}/${eventId}`;
                        
                        let announceTimestamp = null;
                        if (isAnnouncement && announceMsg && announceMsg.embeds.length > 0 && announceMsg.embeds[0].description) {
                            const timeMatch = announceMsg.embeds[0].description.match(/<t:(\d+):[a-zA-Z]?>/);
                            if (timeMatch) {
                                announceTimestamp = timeMatch[1];
                            }
                        }

                        const matchingReminders = botMessages.filter(remMsg => {
                            if (isAnnouncement && remMsg.id === announceMsg.id) return false;
                            
                            // 1. Precise match: check if the reminder contains the specific event ID/URL in content or components
                            if (remMsg.content && remMsg.content.includes(eventUrl)) return true;
                            
                            if (remMsg.components.length > 0) {
                                for (const row of remMsg.components) {
                                    for (const comp of row.components) {
                                        if (comp.url && comp.url.includes(eventUrl)) return true;
                                        if (comp.customId && comp.customId.includes(eventId)) return true;
                                    }
                                }
                            }
                            
                            // 2. Name match (only for fallback/no-button reminders that lack the specific event URL):
                            // Must match the event name AND belong to the same occurrence (by matching timestamp) or be a past reminder
                            if (remMsg.content && remMsg.content.includes(`**${eventName}**`)) {
                                const remTimeMatch = remMsg.content.match(/<t:(\d+):[a-zA-Z]?>/);
                                if (remTimeMatch) {
                                    if (announceTimestamp) {
                                        return remTimeMatch[1] === announceTimestamp;
                                    } else {
                                        // If no announcement timestamp is available, safely delete if the reminder's timestamp is in the past
                                        const remTimeMs = parseInt(remTimeMatch[1], 10) * 1000;
                                        return remTimeMs < Date.now();
                                    }
                                }
                                return true; // Legacy fallback if no timestamp can be found at all
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
                if (userLocale === 'es') successMsg = `¡Se escanearon y limpiaron con éxito **${cleanedCount}** anuncio(s) de eventos y se eliminaron **${remindersDeletedCount}** recordatorio(s) público(s)!`;
                else if (userLocale === 'de') successMsg = `Erfolgreich gescannt und **${cleanedCount}** beendete Event-Ankündigung(en) bereinigt sowie **${remindersDeletedCount}** öffentliche Erinnerung(en) gelöscht!`;
                else if (userLocale === 'fr') successMsg = `Scan et nettoyage réussis pour **${cleanedCount}** annonce(s) d'événements et **${remindersDeletedCount}** rappel(s) public(s) supprimé(s) !`;
                else if (userLocale === 'pt') successMsg = `Escaneado e limpo com sucesso **${cleanedCount}** anúncio(s) de eventos e excluído(s) **${remindersDeletedCount}** lembrete(s) público(s)!`;

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
                        // Create empty record for it to track silence state
                        eventDb[eventId] = {
                            messageId: null,
                            guildId: interaction.guildId,
                            users: {},
                            reminderMessageIds: [],
                            skippedUsers: {},
                            remindersDisabled: true
                        };
                    } else {
                        eventDb[eventId].remindersDisabled = true;
                    }
                    cancelEventReminders(eventId);
                    await saveDb();

                    // Update live announcement message (disable remind button and update footer)
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
                                        const guildLocale = getNormalizedLocale(interaction.guild.preferredLocale);
                                        const currentComponents = components[0].components;
                                        
                                        // Disable the remind button
                                        const remindButton = ButtonBuilder.from(currentComponents[0]).setDisabled(true);
                                        const updatedRow = new ActionRowBuilder().addComponents(remindButton);
                                        
                                        for (let i = 1; i < currentComponents.length; i++) {
                                            updatedRow.addComponents(ButtonBuilder.from(currentComponents[i]));
                                        }
                                        components = [updatedRow];
                                    }
                                    await msg.edit({ embeds: [updatedEmbed], components: components }).catch(() => {});
                                }
                            }
                        } catch (err) {
                            console.error(`Failed to update announcement message on silence:`, err);
                        }
                    }

                    await interaction.editReply({ content: t(userLocale, 'settings_silenceevent_success', { name: event.name }) });
                } else {
                    // unsilenceevent
                    if (eventDb[eventId]) {
                        const silentPattern = /\[silent\]|\[exclude\]/i;
                        const hasTag = silentPattern.test(event.name || '') || silentPattern.test(event.description || '');

                        eventDb[eventId].remindersDisabled = false;
                        if (!hasTag) {
                            scheduleRemindersForEvent(event);
                        }
                        await saveDb();

                        // Update live announcement message (re-enable remind button and update footer)
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
                                            const guildLocale = getNormalizedLocale(interaction.guild.preferredLocale);
                                            const currentComponents = components[0].components;
                                            
                                            // Re-enable the remind button (unless tag overrides it)
                                            const remindButton = ButtonBuilder.from(currentComponents[0]).setDisabled(hasTag);
                                            const updatedRow = new ActionRowBuilder().addComponents(remindButton);
                                            
                                            for (let i = 1; i < currentComponents.length; i++) {
                                                updatedRow.addComponents(ButtonBuilder.from(currentComponents[i]));
                                            }
                                            components = [updatedRow];
                                        }
                                        await msg.edit({ embeds: [updatedEmbed], components: components }).catch(() => {});
                                    }
                                }
                            } catch (err) {
                                console.error(`Failed to update announcement message on unsilence:`, err);
                            }
                        }

                        let warningText = '';
                        if (hasTag) {
                            if (userLocale === 'es') warningText = '\n\n*(Nota: Este evento todavía contiene una etiqueta de silencio [silent]/[exclude] en Discord. Debes editar los detalles del evento para eliminarla antes de que se reanuden los recordatorios).*';
                            else if (userLocale === 'de') warningText = '\n\n*(Hinweis: Dieses Event enthält immer noch ein Stummschaltungs-Tag [silent]/[exclude] in Discord. Du musst die Event-Details bearbeiten und es entfernen, bevor die Erinnerungen fortgesetzt werden).*';
                            else if (userLocale === 'fr') warningText = '\n\n*(Note : Cet événement contient toujours une balise de silence [silent]/[exclude] sur Discord. Vous devez modifier les détails de l\'événement pour la supprimer avant que les rappels ne reprennent).*';
                            else if (userLocale === 'pt') warningText = '\n\n*(Nota: Este evento ainda contém uma tag de silêncio [silent]/[exclude] no Discord. Você deve editar os detalhes do evento para removê-la antes que os lembretes sejam retomados).*';
                            else warningText = '\n\n*(Note: This event still contains a silencing tag [silent]/[exclude] in Discord. You must edit the event details to remove it before reminders will resume.)*';
                        }

                        await interaction.editReply({ content: t(userLocale, 'settings_unsilenceevent_success', { name: event.name }) + warningText });
                    } else {
                        await interaction.editReply({ content: t(userLocale, 'settings_silenceevent_error') });
                    }
                }
            }
            return;
        }

        if (interaction.commandName === 'announceevent') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const userLocale = getNormalizedLocale(interaction.locale);

            const eventIdentifier = interaction.options.getString('event_link_or_id');
            const match = eventIdentifier.match(/(?:\/events\/\d+\/)?(\d{17,19})/);
            const eventId = match ? match[1] : null;

            if (!eventId) {
                return interaction.editReply({ content: t(userLocale, 'announce_invalid_id') });
            }

            if (eventDb[eventId]) {
                return interaction.editReply({ content: t(userLocale, 'announce_already_posted') });
            }

            const event = await interaction.guild.scheduledEvents.fetch(eventId).catch(() => null);
            if (!event) {
                return interaction.editReply({ content: t(userLocale, 'announce_not_found') });
            }

            const channelId = getAnnouncementChannelId(interaction.guildId);
            const channel = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : null;
            if (!channel) {
                return interaction.editReply({ content: t(userLocale, 'announce_no_channel') });
            }

            const botPermissions = channel.permissionsFor(interaction.guild.members.me);
            if (!botPermissions.has(PermissionFlagsBits.ViewChannel) || !botPermissions.has(PermissionFlagsBits.SendMessages) || !botPermissions.has(PermissionFlagsBits.EmbedLinks)) {
                return interaction.editReply({ content: t(userLocale, 'settings_bot_no_permissions', { channel: channel.toString() }) });
            }

            try {
                await postAnnouncement(event, channel);
                await interaction.editReply({ content: t(userLocale, 'announce_success', { name: event.name }) });
            } catch (err) {
                await interaction.editReply({ content: t(userLocale, 'announce_error') });
            }
        }

        if (interaction.commandName === 'upcoming') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const payload = await generateUpcomingPage(interaction, 0);
            await interaction.editReply(payload);
        }

        if (interaction.commandName === 'myreminders') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const payload = await generateMyRemindersPage(interaction, 0);
            await interaction.editReply(payload);
        }

        if (interaction.commandName === 'help') {
            const isAdmin = interaction.member && interaction.member.permissions && interaction.member.permissions.has(PermissionFlagsBits.Administrator);
            const userLocale = getNormalizedLocale(interaction.locale);

            const fields = [
                { 
                    name: t(userLocale, 'help_everyone_title'), 
                    value: t(userLocale, 'help_everyone_value')
                }
            ];

            if (isAdmin) {
                fields.push({
                    name: t(userLocale, 'help_admin_title'),
                    value: t(userLocale, 'help_admin_value')
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('🥚 Scotch Egg Help')
                .setDescription(t(userLocale, 'help_description'))
                .addFields(fields)
                .setColor('#0099ff');

            if (isAdmin) {
                embed.setFooter({ text: t(userLocale, 'help_footer_admin', { version: version }) });
            } else {
                embed.setFooter({ text: t(userLocale, 'help_footer_everyone', { version: version }) });
            }
            
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (interaction.commandName === 'stats') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const userLocale = getNormalizedLocale(interaction.locale);

            const guildEvents = await interaction.guild.scheduledEvents.fetch();
            const activeEvents = guildEvents.filter(e => e.status === GuildScheduledEventStatus.Scheduled || e.status === GuildScheduledEventStatus.Active);
            
            if (activeEvents.size === 0) {
                return interaction.editReply({ content: t(userLocale, 'stats_no_events') });
            }

            let totalOptIns = 0;
            let description = '';

            activeEvents.forEach(event => {
                const eventData = eventDb[event.id];
                const usersOptedIn = eventData && eventData.users ? Object.keys(eventData.users).length : 0;
                totalOptIns += usersOptedIn;
                
                const nextLine = `• **${event.name}**: ${usersOptedIn} opt-in(s)\n`;
                if (description.length + nextLine.length < 3900) { // Keep under Discord Embed limits
                    description += nextLine;
                }
            });

            const embed = new EmbedBuilder()
                .setTitle(t(userLocale, 'stats_title'))
                .setDescription(description || t(userLocale, 'stats_empty'))
                .addFields({ name: t(userLocale, 'stats_total'), value: totalOptIns.toString(), inline: true })
                .setColor('#0099ff');

            await interaction.editReply({ embeds: [embed] });
        }
        return;
    }

    if (interaction.isStringSelectMenu()) {
        // Select Menu Cooldown System (5 seconds) to prevent updateLiveCounter spam
        if (!buttonCooldowns.has('select_menu')) {
            buttonCooldowns.set('select_menu', new Collection());
        }

        const now = Date.now();
        const timestamps = buttonCooldowns.get('select_menu');
        const cooldownAmount = 5000; 

        if (timestamps.has(interaction.user.id)) {
            const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;
            if (now < expirationTime) {
                const expiredTimestamp = Math.round(expirationTime / 1000);
                return interaction.reply({ 
                    content: `Please wait! You are interacting too fast. You can use this menu again <t:${expiredTimestamp}:R>.`, 
                    flags: MessageFlags.Ephemeral 
                });
            }
        }
        timestamps.set(interaction.user.id, now);
        setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

        const userLocale = getNormalizedLocale(interaction.locale);
        if (interaction.customId === 'list_optin_select') {
            await interaction.deferUpdate();
            
            const eventIdsToOptIn = interaction.values;
            const userId = interaction.user.id;
            let optedInCount = 0;
            
            for (const eventId of eventIdsToOptIn) {
                if (!eventDb[eventId]) eventDb[eventId] = { users: {} };
                if (!eventDb[eventId].users) eventDb[eventId].users = {};
                
                if (!eventDb[eventId].users[userId]) {
                    eventDb[eventId].users[userId] = true;
                    optedInCount++;
                    updateLiveCounter(eventId); // Fire asynchronously
                }
            }
            
            if (optedInCount > 0) await saveDb();
            
            const mode = getAnnouncementMode(interaction.guildId);
            const intervals = getReminderIntervals(interaction.guildId);
            const intervalsStr = intervals.map(i => `${i.value}${i.unit}`).join(', ');
            
            let successText = `✅ Successfully opted in to **${optedInCount}** event(s)!\n*${mode === 'public' ? 'You will be pinged in the announcement channel' : 'I will DM you'} at: ${intervalsStr} before they begin.*`;
            if (userLocale === 'es') {
                successText = `✅ ¡Te has inscrito con éxito en **${optedInCount}** evento(s)!\n*${mode === 'public' ? 'Se te mencionará en el canal de anuncios' : 'Te enviaré un mensaje directo'}: ${intervalsStr} antes de que comiencen.*`;
            } else if (userLocale === 'de') {
                successText = `✅ Erfolgreich für **${optedInCount}** Event(s) angemeldet!\n*${mode === 'public' ? 'Du wirst im Ankündigungskanal benachrichtigt' : 'Ich werde dir eine DM senden'}: ${intervalsStr} bevor sie beginnen.*`;
            } else if (userLocale === 'fr') {
                successText = `✅ Inscrit avec succès à **${optedInCount}** événement(s) !\n*${mode === 'public' ? 'Vous serez mentionné dans le salon d\'annonces' : 'Je vous enverrai un DM'} : ${intervalsStr} avant qu'ils ne commencent.*`;
            } else if (userLocale === 'pt') {
                successText = `✅ Inscrito com sucesso em **${optedInCount}** evento(s)!\n*${mode === 'public' ? 'Você será mencionado no canal de anúncios' : 'Eu lhe enviarei uma DM'}: ${intervalsStr} antes de começarem.*`;
            }

            await interaction.editReply({ content: `${interaction.message.content}\n\n${successText}`, components: [] });
        }

        if (interaction.customId === 'list_cancel_select') {
            await interaction.deferUpdate();
            
            const eventIdsToCancel = interaction.values;
            const userId = interaction.user.id;
            let cancelledCount = 0;
            
            for (const eventId of eventIdsToCancel) {
                if (eventDb[eventId] && eventDb[eventId].users && eventDb[eventId].users[userId]) {
                    delete eventDb[eventId].users[userId];
                    cancelledCount++;
                    updateLiveCounter(eventId); // Fire asynchronously
                }
            }
            
            if (cancelledCount > 0) {
                await saveDb();
            }
            
            let cancelText = `✅ Successfully canceled reminders for **${cancelledCount}** event(s).`;
            if (userLocale === 'es') {
                cancelText = `✅ Se cancelaron con éxito los recordatorios para **${cancelledCount}** evento(s).`;
            } else if (userLocale === 'de') {
                cancelText = `✅ Erinnerungen für **${cancelledCount}** Event(s) erfolgreich abbestellt.`;
            } else if (userLocale === 'fr') {
                cancelText = `✅ Rappels annulés avec succès pour **${cancelledCount}** événement(s).`;
            } else if (userLocale === 'pt') {
                cancelText = `✅ Lembretes cancelados com sucesso para **${cancelledCount}** evento(s).`;
            }

            await interaction.editReply({ content: `${interaction.message.content}\n\n${cancelText}`, components: [] });
        }
        return;
    }

    // Button Cooldown System to prevent database save spam
    if (interaction.customId.startsWith('remind_') || interaction.customId.startsWith('cancel_remind_')) {
        if (!buttonCooldowns.has('remind_btn')) {
            buttonCooldowns.set('remind_btn', new Collection());
        }

        const now = Date.now();
        const timestamps = buttonCooldowns.get('remind_btn');
        const cooldownAmount = 3000; // 3 seconds cooldown

        const userLocale = getNormalizedLocale(interaction.locale);
        if (timestamps.has(interaction.user.id)) {
            const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;
            if (now < expirationTime) {
                const expiredTimestamp = Math.round(expirationTime / 1000);
                return interaction.reply({ 
                    content: t(userLocale, 'button_cooldown', { time: `<t:${expiredTimestamp}:R>` }), 
                    flags: MessageFlags.Ephemeral 
                });
            }
        }
        timestamps.set(interaction.user.id, now);
        setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);
    }

    // Pagination Cooldown System (2 seconds) to prevent scheduledEvents.fetch() spam
    if (interaction.customId.startsWith('upcoming_page_') || interaction.customId.startsWith('myreminders_page_')) {
        if (!buttonCooldowns.has('pagination')) {
            buttonCooldowns.set('pagination', new Collection());
        }

        const now = Date.now();
        const timestamps = buttonCooldowns.get('pagination');
        const cooldownAmount = 2000;

        const userLocale = getNormalizedLocale(interaction.locale);
        if (timestamps.has(interaction.user.id)) {
            const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;
            if (now < expirationTime) {
                const expiredTimestamp = Math.round(expirationTime / 1000);
                return interaction.reply({ 
                    content: t(userLocale, 'button_cooldown', { time: `<t:${expiredTimestamp}:R>` }), 
                    flags: MessageFlags.Ephemeral 
                });
            }
        }
        timestamps.set(interaction.user.id, now);
        setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);
    }

    if (interaction.customId.startsWith('upcoming_page_')) {
        await interaction.deferUpdate();
        const page = parseInt(interaction.customId.replace('upcoming_page_', ''), 10);
        const payload = await generateUpcomingPage(interaction, page);
        await interaction.editReply(payload);
        return;
    }

    if (interaction.customId.startsWith('myreminders_page_')) {
        await interaction.deferUpdate();
        const page = parseInt(interaction.customId.replace('myreminders_page_', ''), 10);
        const payload = await generateMyRemindersPage(interaction, page);
        await interaction.editReply(payload);
        return;
    }

    const userLocale = getNormalizedLocale(interaction.locale);
    if (interaction.customId.startsWith('remind_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const eventId = interaction.customId.replace('remind_', '');
        
        // Ensure the event still actively exists in Discord
        const event = await interaction.guild?.scheduledEvents.fetch(eventId).catch(() => null);
        if (!event) {
            return interaction.editReply({ content: t(userLocale, 'remind_inactive') });
        }

        // Check if reminders are silenced
        if ((eventDb[eventId] && eventDb[eventId].remindersDisabled) || isEventSilenced(event)) {
            return interaction.editReply({ content: t(userLocale, 'reminder_disabled_for_event') });
        }

        // Auto-heal database if the event record was somehow lost
        if (!eventDb[eventId]) {
            eventDb[eventId] = { messageId: interaction.message.id, users: {}, guildId: interaction.guildId };
        }

        try {
            const users = eventDb[eventId].users || {};
            const userId = interaction.user.id;
            let replyText;

            if (users[userId]) {
                // Remove user from reminders
                delete eventDb[eventId].users[userId];
                replyText = t(userLocale, 'remind_removed');
            } else {
                // Add user to reminders
                eventDb[eventId].users[userId] = true;
                
                const mode = getAnnouncementMode(interaction.guildId);
                const intervals = getReminderIntervals(interaction.guildId);
                const intervalsStr = intervals.map(i => `${i.value}${i.unit}`).join(', ');
                
                if (mode === 'public') {
                    replyText = t(userLocale, 'remind_set_public', { intervals: intervalsStr });
                } else {
                    replyText = t(userLocale, 'remind_set_private', { intervals: intervalsStr });
                }
            }
            await saveDb();

            // Update the button on the original message to show the new count
            const userCount = Object.keys(users).length;
            const guildLocale = interaction.guild?.preferredLocale || 'en';
            const baseRemindLabel = t(guildLocale, 'announcement_button_remind');
            const newLabel = userCount > 0 ? `${baseRemindLabel} (${userCount})` : baseRemindLabel;
            
            const currentComponents = interaction.message.components[0].components;
            const updatedRow = new ActionRowBuilder().addComponents(
                ButtonBuilder.from(currentComponents[0]).setLabel(newLabel)
            );
            
            for (let i = 1; i < currentComponents.length; i++) {
                updatedRow.addComponents(ButtonBuilder.from(currentComponents[i]));
            }
            
            await interaction.message.edit({ components: [updatedRow] }).catch(() => {});
            await interaction.editReply({ content: replyText });
            
            // Sync the original announcement message in the background if they clicked a reminder ping
            if (eventDb[eventId].messageId !== interaction.message.id) {
                updateLiveCounter(eventId);
            }
        } catch (error) {
            console.error('Failed to handle remind interaction:', error);
            await interaction.editReply({ content: t(userLocale, 'remind_error') }).catch(() => {});
        }
    }

    if (interaction.customId.startsWith('cancel_remind_')) {
        const eventId = interaction.customId.replace('cancel_remind_', '');
        
        if (eventDb[eventId]) {
            const users = eventDb[eventId].users || {};
            const userId = interaction.user.id;
            
            try {
                if (users[userId]) {
                    // Check if event is recurring
                    const guildId = eventDb[eventId].guildId;
                    const guild = guildId ? client.guilds.cache.get(guildId) : null;
                    const event = guild ? await guild.scheduledEvents.fetch(eventId).catch(() => null) : null;
                    
                    if (event && event.recurrenceRule && (event.status === GuildScheduledEventStatus.Scheduled || event.status === GuildScheduledEventStatus.Active)) {
                        // It is a recurring event series! Show interactive prompt
                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`cancel_occ_${eventId}`).setLabel(t(userLocale, 'cancel_button_next')).setStyle(ButtonStyle.Danger),
                            new ButtonBuilder().setCustomId(`cancel_series_${eventId}`).setLabel(t(userLocale, 'cancel_button_series')).setStyle(ButtonStyle.Secondary)
                        );
                        
                        let promptText = `\n\n⚠️ ${t(userLocale, 'cancel_recurring_prompt')}`;
                        let newContent = `${interaction.message.content}${promptText}`;
                        if (newContent.length > 2000) {
                            newContent = `${interaction.message.content.substring(0, 2000 - promptText.length)}...${promptText}`;
                        }
                        await interaction.update({ content: newContent, components: [row] });
                    } else {
                        // Standard event cancellation (or fallback if event fetch fails)
                        delete eventDb[eventId].users[userId];
                        if (eventDb[eventId].skippedUsers) {
                            delete eventDb[eventId].skippedUsers[userId];
                        }
                        await saveDb();
                        updateLiveCounter(eventId); // Fire asynchronously
                        
                        let cancelNotice = `*(${t(userLocale, 'cancel_remind_success')})*`;
                        let newContent = `${interaction.message.content}\n\n${cancelNotice}`;
                        if (newContent.length > 2000) {
                            newContent = `${interaction.message.content.substring(0, 1950)}...\n\n${cancelNotice}`;
                        }
                        await interaction.update({ content: newContent, components: [] });
                    }
                } else {
                    let notOptedNotice = `*(${t(userLocale, 'cancel_remind_not_opted')})*`;
                    let newContent = `${interaction.message.content}\n\n${notOptedNotice}`;
                    if (newContent.length > 2000) {
                        newContent = `${interaction.message.content.substring(0, 1930)}...\n\n${notOptedNotice}`;
                    }
                    await interaction.update({ content: newContent, components: [] });
                }
            } catch (error) {
                console.error('Failed to handle cancel_remind interaction:', error);
            }
        } else {
            let inactiveNotice = `*(${t(userLocale, 'remind_inactive')})*`;
            let newContent = `${interaction.message.content}\n\n${inactiveNotice}`;
            if (newContent.length > 2000) {
                newContent = `${interaction.message.content.substring(0, 1950)}...\n\n${inactiveNotice}`;
            }
            await interaction.update({ content: newContent, components: [] });
        }
    }

    if (interaction.customId.startsWith('cancel_occ_')) {
        const eventId = interaction.customId.replace('cancel_occ_', '');
        if (eventDb[eventId]) {
            const userId = interaction.user.id;
            try {
                const guildId = eventDb[eventId].guildId;
                const guild = guildId ? client.guilds.cache.get(guildId) : null;
                const event = guild ? await guild.scheduledEvents.fetch(eventId).catch(() => null) : null;
                const startTime = event ? event.scheduledStartTimestamp : Date.now();
                
                if (!eventDb[eventId].skippedUsers) {
                    eventDb[eventId].skippedUsers = {};
                }
                eventDb[eventId].skippedUsers[userId] = startTime;
                await saveDb();
                
                const timeString = getFormattedTimeString(startTime, null, 'f');
                const cancelNotice = t(userLocale, 'cancel_next_success', { time: timeString });
                
                // Remove prompt text and append success notice
                let newContent = interaction.message.content;
                const promptRegex = /\n\n⚠️.*$/;
                newContent = newContent.replace(promptRegex, '');
                newContent = `${newContent}\n\n${cancelNotice}`;
                if (newContent.length > 2000) {
                    newContent = `${newContent.substring(0, 1950)}...\n\n${cancelNotice}`;
                }
                await interaction.update({ content: newContent, components: [] });
            } catch (error) {
                console.error('Failed to handle cancel_occ interaction:', error);
            }
        }
    }

    if (interaction.customId.startsWith('cancel_series_')) {
        const eventId = interaction.customId.replace('cancel_series_', '');
        if (eventDb[eventId]) {
            const userId = interaction.user.id;
            try {
                if (eventDb[eventId].users && eventDb[eventId].users[userId]) {
                    delete eventDb[eventId].users[userId];
                }
                if (eventDb[eventId].skippedUsers) {
                    delete eventDb[eventId].skippedUsers[userId];
                }
                await saveDb();
                updateLiveCounter(eventId); // Fire asynchronously
                
                const cancelNotice = t(userLocale, 'cancel_series_success');
                
                // Remove prompt text and append success notice
                let newContent = interaction.message.content;
                const promptRegex = /\n\n⚠️.*$/;
                newContent = newContent.replace(promptRegex, '');
                newContent = `${newContent}\n\n${cancelNotice}`;
                if (newContent.length > 2000) {
                    newContent = `${newContent.substring(0, 1950)}...\n\n${cancelNotice}`;
                }
                await interaction.update({ content: newContent, components: [] });
            } catch (error) {
                console.error('Failed to handle cancel_series interaction:', error);
            }
        }
    }
    } catch (error) {
        console.error('Unhandled error in InteractionCreate:', error);
        try {
            const errorPayload = { content: 'An unexpected error occurred while processing your request.', flags: MessageFlags.Ephemeral };
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(errorPayload).catch(() => {});
            } else {
                await interaction.reply(errorPayload).catch(() => {});
            }
        } catch (fallbackError) {
            console.error('Failed to send fallback error message:', fallbackError);
        }
    }
});

/**
 * Converts a plain string to a Unicode strike-through string (using U+0336).
 * This works around Discord's lack of markdown support in embed titles.
 * @param {string} text - The input text.
 * @returns {string} The text with combining strike-through characters.
 */
function toUnicodeStrikeThrough(text) {
    return text.split('').map(char => char + '\u0336').join('');
}

/**
 * Archives an active event announcement by changing its embed color to gray 
 * and disabling its interaction buttons to indicate it has concluded.
 * @param {Guild} guild - The Discord Guild object.
 * @param {string} eventId - The ID of the event to archive.
 * @param {string} statusText - The status reason ('Completed' or 'Deleted' or 'Canceled').
 * @param {Message} [existingMsg=null] - Optional already-fetched message object.
 */
async function archiveAnnouncementMessage(guild, eventId, statusText, existingMsg = null) {
    if (!eventDb[eventId]) return;
    if (!eventDb[eventId].messageId && existingMsg) {
        eventDb[eventId].messageId = existingMsg.id;
    }
    if (!eventDb[eventId].messageId) return;
    try {
        const channelId = getAnnouncementChannelId(guild.id);
        const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
        if (channel) {
            const msg = existingMsg || await channel.messages.fetch(eventDb[eventId].messageId).catch(() => null);
            const autoDelete = getAutoDeleteEnabled(guild.id);
            
            const guildLocale = getNormalizedLocale(guild.preferredLocale);
            if (msg && autoDelete) {
                await msg.delete().catch(() => {});
            } else if (msg && msg.embeds.length > 0) {
                const originalEmbed = EmbedBuilder.from(msg.embeds[0]);
                
                let statusLabel = '';
                if (statusText === 'Completed') statusLabel = t(guildLocale, 'announcement_button_completed');
                else if (statusText === 'Deleted') statusLabel = t(guildLocale, 'announcement_button_deleted');
                else if (statusText === 'Canceled') statusLabel = t(guildLocale, 'announcement_button_canceled');

                // Format the title with a premium strike-through
                const cleanTitle = (originalEmbed.data.title || '')
                    .replace(/^~~|~~$/g, '')
                    .replace(/[\u0336]/g, '')
                    .replace(/\n.*/g, '')
                    .replace(/ \[[^\]]+\]$/g, '');
                let newTitle = toUnicodeStrikeThrough(cleanTitle);
                if (newTitle.length > 256) {
                    newTitle = `${toUnicodeStrikeThrough(cleanTitle.substring(0, 124))}...`;
                }
                originalEmbed.setTitle(newTitle);
                originalEmbed.setColor('#808080'); // Gray out the sidebar
                originalEmbed.setImage(null); // Remove cover image to shrink visibility
                
                const statusBanner = t(guildLocale, statusText === 'Completed' ? 'concluded_banner' : statusText === 'Deleted' ? 'deleted_banner' : 'canceled_banner') + '\n\n';
                
                let newDesc = originalEmbed.data.description || '';
                newDesc = newDesc
                    .replace(/\n\n\*(?:Click|¡Haz|Klicke|Cliquez|Clique)[^*]+\*/gi, '') // Remove opt-in text
                    .replace(/\s\(<t:\d+:R>\)/, ''); // Remove relative countdowns
                    
                // Let's add strike-throughs to Time and Location
                newDesc = newDesc.replace(/(🗓️ \*\*.*?\*\* .*?)(\n|$)/g, '~~$1~~$2')
                                 .replace(/(📍 \*\*.*?\*\* .*?)(\n|$)/g, '~~$1~~$2');
                                 
                // Prefix every line with a blockquote to dim and indent the text
                if (newDesc.trim()) {
                    newDesc = newDesc.split('\n').map(line => line.startsWith('> ') ? line : `> ${line}`).join('\n');
                    newDesc = `${statusBanner}${newDesc}`;
                } else {
                    newDesc = statusBanner.trim();
                }
                
                if (newDesc.length > 4096) newDesc = newDesc.substring(0, 4093) + '...';
                originalEmbed.setDescription(newDesc);
                
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`archived_${eventId}`)
                        .setLabel(statusLabel)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                        .setEmoji(statusText === 'Completed' ? '✅' : '❌')
                );
                
                await msg.edit({ embeds: [originalEmbed], components: [disabledRow] });
            }

            // 2. ARCHIVE OR DELETE ALL PUBLIC REMINDER PINGS AND FALLBACKS
            const reminderMessageIds = eventDb[eventId].reminderMessageIds || [];
            for (const rMsgId of reminderMessageIds) {
                const rMsg = await channel.messages.fetch(rMsgId).catch(() => null);
                if (rMsg) {
                    await rMsg.delete().catch(() => {});
                }
            }
        }
    } catch (err) {
        console.log(`Failed to archive announcement and reminders for event ${eventId}:`, err);
    }
}

client.on(Events.GuildScheduledEventDelete, async e => {
    cancelEventReminders(e.id);
    
    // Cleanup of the database
    if (eventDb[e.id]) {
        try {
            const guildLocale = getNormalizedLocale(e.guild.preferredLocale);
            await notifyUsersOfEventChange(e, t(guildLocale, 'notification_deleted', { name: e.name }));
            await archiveAnnouncementMessage(e.guild, e.id, 'Deleted');
            delete eventDb[e.id];
            await saveDb();
        } catch (err) {
            console.error(`Error processing deletion for event ${e.id}:`, err);
        }
    }
});

client.on(Events.GuildScheduledEventUpdate, async (o, n) => {
    try {
        // Always reschedule reminders on update to ensure time, location, and description are fresh
        cancelEventReminders(n.id);
        if (n.status === GuildScheduledEventStatus.Scheduled || n.status === GuildScheduledEventStatus.Active) {
            scheduleRemindersForEvent(n);
        }

        // If event is silenced by tag, we handle database/announcement removal
        if (isEventSilenced(n)) {
            const isTagSilenced = /\[silent\]|\[exclude\]/i.test(n.name || '') || /\[silent\]|\[exclude\]/i.test(n.description || '');
            if (isTagSilenced && eventDb[n.id]) {
                await archiveAnnouncementMessage(n.guild, n.id, 'Deleted');
                delete eventDb[n.id];
                await saveDb();
                return; // Stop update processing as the event is now removed from tracking
            }
        } else {
            // If it is not silenced, but was previously tag-excluded (so not in eventDb),
            // and it is scheduled/active, we announce it now!
            if (!eventDb[n.id] && (n.status === GuildScheduledEventStatus.Scheduled || n.status === GuildScheduledEventStatus.Active)) {
                const channelId = getAnnouncementChannelId(n.guild.id);
                const channel = channelId ? await n.guild.channels.fetch(channelId).catch(() => null) : null;
                if (channel) {
                    try {
                        await postAnnouncement(n, channel);
                    } catch (err) {
                        // error logged in postAnnouncement
                    }
                }
            }
        }
    
    // Clean up if the event was completed or canceled
    if (n.status === GuildScheduledEventStatus.Completed || n.status === GuildScheduledEventStatus.Canceled) {
        cancelEventReminders(n.id);
        if (eventDb[n.id]) {
            const statusText = n.status === GuildScheduledEventStatus.Completed ? 'Completed' : 'Canceled';
            if (n.status === GuildScheduledEventStatus.Canceled) {
                const guildLocale = getNormalizedLocale(n.guild.preferredLocale);
                await notifyUsersOfEventChange(n, t(guildLocale, 'notification_canceled', { name: n.name }));
            }
            await archiveAnnouncementMessage(n.guild, n.id, statusText);
            delete eventDb[n.id];
            await saveDb();
        }
    } else {
        // Check if critical details changed to notify users
        if (o && eventDb[n.id]) {
            const timeChanged = o.scheduledStartTimestamp !== n.scheduledStartTimestamp;
            const oldLocation = o.entityMetadata?.location || o.channelId;
            const newLocation = n.entityMetadata?.location || n.channelId;
            const locationChanged = oldLocation !== newLocation;

            if (timeChanged || locationChanged) {
                // If it's a recurring event rollover, we don't send time change notifications to users
                const isRecurringRollover = timeChanged && n.recurrenceRule && o.scheduledStartTimestamp <= Date.now();
                
                if (isRecurringRollover) {
                    // Delete old public reminders and clear message IDs
                    const reminderMessageIds = eventDb[n.id].reminderMessageIds || [];
                    const channelId = getAnnouncementChannelId(n.guild.id);
                    const channel = channelId ? await n.guild.channels.fetch(channelId).catch(() => null) : null;
                    if (channel) {
                        for (const rMsgId of reminderMessageIds) {
                            const rMsg = await channel.messages.fetch(rMsgId).catch(() => null);
                            if (rMsg) {
                                await rMsg.delete().catch(() => {});
                            }
                        }
                    }
                    eventDb[n.id].reminderMessageIds = [];
                    await saveDb();
                } else {
                    const guildLocale = getNormalizedLocale(n.guild.preferredLocale);
                    let changeMsg = '';
                    
                    if (timeChanged && locationChanged) {
                        changeMsg += t(guildLocale, 'notification_time_changed', { name: n.name });
                        changeMsg += t(guildLocale, 'notification_new_time', { time: `<t:${Math.floor(n.scheduledStartTimestamp / 1000)}:F>` });
                        
                        const locStr = n.entityMetadata?.location || (n.channelId ? `<#${n.channelId}>` : 'Discord');
                        changeMsg += t(guildLocale, 'notification_new_location', { location: locStr });
                    } else if (timeChanged) {
                        changeMsg += t(guildLocale, 'notification_time_changed', { name: n.name });
                        changeMsg += t(guildLocale, 'notification_new_time', { time: `<t:${Math.floor(n.scheduledStartTimestamp / 1000)}:F>` });
                    } else if (locationChanged) {
                        changeMsg += t(guildLocale, 'notification_location_changed', { name: n.name });
                        const locStr = n.entityMetadata?.location || (n.channelId ? `<#${n.channelId}>` : 'Discord');
                        changeMsg += t(guildLocale, 'notification_new_location', { location: locStr });
                    }
                    await notifyUsersOfEventChange(n, changeMsg);
                    
                    // If the event was postponed after it already started, clean up old reminders
                    if (timeChanged && o.scheduledStartTimestamp <= Date.now()) {
                        const reminderMessageIds = eventDb[n.id].reminderMessageIds || [];
                        const channelId = getAnnouncementChannelId(n.guild.id);
                        const channel = channelId ? await n.guild.channels.fetch(channelId).catch(() => null) : null;
                        if (channel) {
                            for (const rMsgId of reminderMessageIds) {
                                const rMsg = await channel.messages.fetch(rMsgId).catch(() => null);
                                if (rMsg) {
                                    await rMsg.delete().catch(() => {});
                                }
                            }
                        }
                        eventDb[n.id].reminderMessageIds = [];
                        await saveDb();
                    }
                }
            }
        }

        // The event was updated (e.g., name, description, time changed), so we update the original announcement message
        if (eventDb[n.id] && eventDb[n.id].messageId) {
            try {
                const channelId = getAnnouncementChannelId(n.guild.id);
                const channel = channelId ? await n.guild.channels.fetch(channelId).catch(() => null) : null;
                if (channel) {
                    const msg = await channel.messages.fetch(eventDb[n.id].messageId).catch(() => null);
                    if (msg && msg.embeds.length > 0) {
                        const updatedEmbed = buildAnnouncementEmbed(n);
                        let components = msg.components;
                        if (components && components.length > 0) {
                            const guildLocale = getNormalizedLocale(n.guild.preferredLocale);
                            const currentComponents = components[0].components;
                            
                            // Re-build/update the remind button using the new label in the guild's language, preserving the existing user count if any.
                            const originalLabel = currentComponents[0].label || '';
                            const match = originalLabel.match(/\((\d+)\)/);
                            const countText = match ? ` (${match[1]})` : '';
                            const newRemindLabel = t(guildLocale, 'announcement_button_remind') + countText;
                            
                            const remindButton = ButtonBuilder.from(currentComponents[0])
                                .setLabel(newRemindLabel)
                                .setDisabled(isEventSilenced(n));
                            const updatedRow = new ActionRowBuilder().addComponents(remindButton);
                            
                            if (getCalendarEnabled(n.guild.id)) {
                                const calendarLink = generateGoogleCalendarLink(n);
                                updatedRow.addComponents(new ButtonBuilder().setLabel(t(guildLocale, 'announcement_button_calendar')).setStyle(ButtonStyle.Link).setURL(calendarLink).setEmoji('📅'));
                            }
                            
                            updatedRow.addComponents(new ButtonBuilder().setLabel(t(guildLocale, 'announcement_button_view')).setStyle(ButtonStyle.Link).setURL(`https://discord.com/events/${n.guild.id}/${n.id}`).setEmoji('🔗'));

                            components = [updatedRow];
                        }
                        await msg.edit({ embeds: [updatedEmbed], components: components });
                    }
                }
            } catch (err) {
                console.error(`Failed to update announcement message for event ${n.id}:`, err);
            }
        }
    }
    } catch (error) {
        console.error(`Unhandled error in GuildScheduledEventUpdate for event ${n?.id}:`, error);
    }
});

/**
 * Helper to cancel all pending reminder jobs for a specific guild.
 */
function cancelEventRemindersForGuild(guildId) {
    for (const [eventId, data] of Object.entries(eventDb)) {
        if (data && data.guildId === guildId) {
            cancelEventReminders(eventId);
        }
    }
}

/**
 * Middleware to authenticate requests using Discord OAuth2 Bearer Token.
 */
async function checkAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }
    const token = authHeader.split(' ')[1];
    
    try {
        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!userResponse.ok) {
            return res.status(401).json({ error: 'Invalid access token' });
        }
        const userData = await userResponse.json();
        req.user = userData;
        req.token = token;
        next();
    } catch (err) {
        console.error('Error in auth middleware:', err);
        res.status(500).json({ error: 'Internal server error during authentication' });
    }
}

/**
 * Middleware to check if the authenticated user has Administrator/Manage Guild permissions in the guild.
 */
async function checkGuildAdmin(req, res, next) {
    const guildId = req.params.guildId;
    if (!guildId) return res.status(400).json({ error: 'Missing guild ID' });
    
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        return res.status(404).json({ error: 'Guild not found or bot is not in the guild' });
    }
    
    try {
        const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${req.token}` }
        });
        if (!guildsResponse.ok) {
            return res.status(500).json({ error: 'Failed to retrieve user guilds from Discord' });
        }
        const userGuilds = await guildsResponse.json();
        const userGuild = userGuilds.find(g => g.id === guildId);
        
        if (!userGuild) {
            return res.status(403).json({ error: 'User is not a member of this guild' });
        }
        
        const permissions = BigInt(userGuild.permissions);
        const isAdmin = (permissions & 0x8n) !== 0n || (permissions & 0x20n) !== 0n || req.user.id === process.env.ADMIN_USER_ID;
        
        if (!isAdmin) {
            return res.status(403).json({ error: 'User does not have Administrator or Manage Guild permissions' });
        }
        
        req.guild = guild;
        next();
    } catch (err) {
        console.error(`Error authorizing guild admin for guild ${guildId}:`, err);
        res.status(500).json({ error: 'Internal server error during authorization' });
    }
}

/**
 * Initializes and starts the lightweight Express server for the web dashboard.
 */
function startDashboardServer() {
    const express = require('express');
    const app = express();
    
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));
    
    app.get('/api/auth-config', (req, res) => {
        res.json({
            clientId: process.env.CLIENT_ID
        });
    });
    
    app.get('/api/guilds', checkAuth, async (req, res) => {
        try {
            const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
                headers: { Authorization: `Bearer ${req.token}` }
            });
            if (!guildsResponse.ok) {
                return res.status(500).json({ error: 'Failed to fetch user guilds from Discord' });
            }
            const userGuilds = await guildsResponse.json();
            
            const sharedGuilds = userGuilds.filter(g => {
                const permissions = BigInt(g.permissions);
                const isAdmin = (permissions & 0x8n) !== 0n || (permissions & 0x20n) !== 0n || req.user.id === process.env.ADMIN_USER_ID;
                const botIsPresent = client.guilds.cache.has(g.id);
                return isAdmin && botIsPresent;
            }).map(g => ({
                id: g.id,
                name: g.name,
                icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null
            }));
            
            res.json(sharedGuilds);
        } catch (err) {
            console.error('Error fetching authorized guilds:', err);
            res.status(500).json({ error: 'Failed to retrieve servers list' });
        }
    });
    
    app.get('/api/guilds/:guildId/settings', checkAuth, checkGuildAdmin, async (req, res) => {
        const guild = req.guild;
        const config = serverConfig[guild.id] || {};
        
        const channels = guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)
            .map(ch => ({
                id: ch.id,
                name: ch.name
            }));
            
        const rawIntervals = config.intervals || [{ value: 24, unit: 'h' }, { value: 1, unit: 'h' }];
        const formattedIntervals = rawIntervals.map(i => ({ value: i.value, unit: i.unit }));
        
        res.json({
            settings: {
                channelId: config.channelId || '',
                mode: config.mode || 'private',
                calendarEnabled: config.calendarEnabled !== undefined ? config.calendarEnabled : true,
                threadsEnabled: config.threadsEnabled !== undefined ? config.threadsEnabled : true,
                autoDeleteEnabled: config.autoDeleteEnabled !== undefined ? config.autoDeleteEnabled : false,
                intervals: formattedIntervals
            },
            channels: channels
        });
    });
    
    app.post('/api/guilds/:guildId/settings', checkAuth, checkGuildAdmin, async (req, res) => {
        const guild = req.guild;
        const { channelId, mode, calendarEnabled, threadsEnabled, autoDeleteEnabled, intervals } = req.body;
        
        if (!channelId) {
            return res.status(400).json({ error: 'Announcement channel is required' });
        }
        if (!['public', 'private', 'hybrid'].includes(mode)) {
            return res.status(400).json({ error: 'Invalid reminder mode' });
        }
        if (!Array.isArray(intervals) || intervals.length === 0) {
            return res.status(400).json({ error: 'At least one reminder interval is required' });
        }
        
        const parsedIntervals = [];
        for (const item of intervals) {
            const val = parseInt(item.value, 10);
            const unit = String(item.unit).toLowerCase();
            
            if (isNaN(val) || val <= 0 || !['m', 'h', 'd'].includes(unit)) {
                return res.status(400).json({ error: `Invalid interval value or unit: ${item.value}${item.unit}` });
            }
            
            let ms = val * 60 * 1000;
            if (unit === 'h') ms = val * 60 * 60 * 1000;
            if (unit === 'd') ms = val * 24 * 60 * 60 * 1000;
            
            parsedIntervals.push({ value: val, unit, ms });
        }
        
        serverConfig[guild.id] = {
            channelId,
            mode,
            calendarEnabled: !!calendarEnabled,
            threadsEnabled: !!threadsEnabled,
            autoDeleteEnabled: !!autoDeleteEnabled,
            intervals: parsedIntervals
        };
        
        try {
            await saveConfig();
            
            cancelEventRemindersForGuild(guild.id);
            await syncEventReminders(guild);
            
            res.json({ success: true, message: 'Settings saved successfully' });
        } catch (err) {
            console.error(`Failed to save settings for guild ${guild.id}:`, err);
            res.status(500).json({ error: 'Failed to persist settings' });
        }
    });
    
    app.get('/api/guilds/:guildId/stats', checkAuth, checkGuildAdmin, async (req, res) => {
        const guild = req.guild;
        
        const guildEvents = Object.entries(eventDb)
            .filter(([_, data]) => data.guildId === guild.id);
            
        const activeEventsCount = guildEvents.length;
        
        let totalOptIns = 0;
        const upcomingEventsList = [];
        
        const currentGuildEvents = await guild.scheduledEvents.fetch().catch(() => new Map());
        
        for (const [eventId, data] of guildEvents) {
            const optInsCount = data.users ? Object.keys(data.users).length : 0;
            totalOptIns += optInsCount;
            
            const discordEvent = currentGuildEvents.get(eventId);
            if (discordEvent && (discordEvent.status === GuildScheduledEventStatus.Scheduled || discordEvent.status === GuildScheduledEventStatus.Active)) {
                upcomingEventsList.push({
                    id: eventId,
                    name: discordEvent.name,
                    startTime: discordEvent.scheduledStartTimestamp,
                    optInsCount: optInsCount
                });
            }
        }
        
        upcomingEventsList.sort((a, b) => a.startTime - b.startTime);
        
        res.json({
            activeEventsCount,
            totalOptIns,
            upcomingEvents: upcomingEventsList
        });
    });
    
    const PORT = process.env.DASHBOARD_PORT || 8080;
    app.listen(PORT, () => {
        console.log(`Web dashboard server listening on port ${PORT}`);
    });
}

client.login(process.env.DISCORD_TOKEN);

/**
 * Graceful Shutdown handler for catching Docker stop signals or Ctrl+C.
 */
async function shutdown() {
    try {
        console.log('\nReceived stop signal. Shutting down gracefully...');
        await forceSaveDb(); // Flush any pending batched saves to disk immediately
        await schedule.gracefulShutdown(); // Cancel all pending reminder jobs
        client.destroy(); // Disconnect bot from Discord safely
        console.log('Shutdown complete. Safe to exit.');
        process.exit(0);
    } catch (error) {
        console.error('Error occurred during graceful shutdown:', error);
        process.exit(1);
    }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    notifyAdmin('Unhandled Promise Rejection', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    notifyAdmin('Uncaught Exception (Bot restarting)', error).finally(() => {
        process.exit(1);
    });
});
