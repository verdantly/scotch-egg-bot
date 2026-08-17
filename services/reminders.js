const schedule = require('node-schedule');
const { GuildScheduledEventStatus, ActionRowBuilder, ButtonBuilder, ButtonStyle, Routes } = require('discord.js');
const { t, getNormalizedLocale } = require('../i18n.js');
const { eventDb, saveDb } = require('../storage.js');
const { getFormattedTimeString, generateGoogleCalendarLink } = require('../utils.js');
const { getAnnouncementChannelId, getAnnouncementMode, getReminderIntervals, getCalendarEnabled, getThreadsEnabled, getPingsEnabled, isEventSilenced } = require('./config.js');
const { notifyAdmin } = require('./admin.js');

let discordClient = null;
const liveCounterTimeouts = new Map();

function setClient(client) {
    discordClient = client;
}

function updateLiveCounter(eventId) {
    if (liveCounterTimeouts.has(eventId)) {
        clearTimeout(liveCounterTimeouts.get(eventId));
    }
    const timeout = setTimeout(() => {
        executeLiveCounterUpdate(eventId);
        liveCounterTimeouts.delete(eventId);
    }, 5000); 
    liveCounterTimeouts.set(eventId, timeout);
}

async function executeLiveCounterUpdate(eventId) {
    if (!discordClient) return;
    try {
        const eventData = eventDb[eventId];
        if (!eventData || !eventData.messageId) return;

        let guild;
        if (eventData.guildId) {
            guild = discordClient.guilds.cache.get(eventData.guildId);
        }
        if (!guild) {
            guild = discordClient.guilds.cache.find(g => g.scheduledEvents.cache.has(eventId));
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
        if (currentComponents[0].label === newLabel) return; 

        const updatedRow = new ActionRowBuilder().addComponents(ButtonBuilder.from(currentComponents[0]).setLabel(newLabel));
        for (let i = 1; i < currentComponents.length; i++) {
            updatedRow.addComponents(ButtonBuilder.from(currentComponents[i]));
        }
        await msg.edit({ components: [updatedRow] }).catch(() => {});
    } catch (err) {
        console.error(`Failed to update live counter for event ${eventId}:`, err);
    }
}

function cancelEventReminders(eventId) {
    const prefix = `${eventId}-`;
    for (const jobName in schedule.scheduledJobs) {
        if (jobName.startsWith(prefix)) {
            schedule.scheduledJobs[jobName].cancel();
            console.log(`Cancelled: ${jobName}`);
        }
    }
}

async function sendDMsWithRateLimit(userIds, messagePayload) {
    if (!discordClient) return userIds;
    const failedUserIds = [];
    const BATCH_SIZE = 5;
    const BATCH_DELAY = 1000; 

    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
        const batch = userIds.slice(i, i + BATCH_SIZE);
        
        const promises = batch.map(async userId => {
            try {
                const user = discordClient.users.cache.get(userId) || await discordClient.users.fetch(userId);
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

        if (i + BATCH_SIZE < userIds.length) {
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
    }
    return failedUserIds;
}

async function notifyUsersOfEventChange(event, messageText) {
    const eventData = eventDb[event.id];
    if (!eventData || !eventData.users) return;
    
    const userIds = Object.keys(eventData.users);
    if (userIds.length === 0) return;

    await sendDMsWithRateLimit(userIds, { content: messageText });
}

function scheduleRemindersForEvent(event, now = Date.now()) {
    if (event.status === GuildScheduledEventStatus.Completed || event.status === GuildScheduledEventStatus.Canceled || isEventSilenced(event)) {
        return;
    }

    const startTime = event.scheduledStartTimestamp;
    const intervals = getReminderIntervals(event.guild.id);
    const minMs = intervals.length > 0 ? Math.min(...intervals.map(i => i.ms)) : 0;
    
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
                        const rawEvent = await event.client.rest.get(Routes.guildScheduledEvent(event.guild.id, event.id)).catch(() => null);
                        if (!rawEvent) {
                            console.log(`Reminder skipped for event ${event.id} because it could not be fetched (possibly deleted).`);
                            return;
                        }

                        if (rawEvent.status === GuildScheduledEventStatus.Completed || rawEvent.status === GuildScheduledEventStatus.Canceled) {
                            console.log(`Reminder skipped for event ${event.id} because the event status is ${rawEvent.status}.`);
                            return;
                        }

                        const currentStartTimestamp = Date.parse(rawEvent.scheduled_start_time);
                        if (currentStartTimestamp !== event.scheduledStartTimestamp) {
                            console.log(`Reminder skipped for event ${event.id} because the scheduled start time has changed from ${event.scheduledStartTimestamp} to ${currentStartTimestamp}.`);
                            return;
                        }

                        if (rawEvent.guild_scheduled_event_exceptions && Array.isArray(rawEvent.guild_scheduled_event_exceptions)) {
                            const isOccurrenceCanceled = rawEvent.guild_scheduled_event_exceptions.some(exception => {
                                if (!exception.is_canceled) return false;
                                const exceptionTimestamp = Number((BigInt(exception.event_exception_id) >> 22n) + 1420070400000n);
                                return exceptionTimestamp === currentStartTimestamp;
                            });

                            if (isOccurrenceCanceled) {
                                console.log(`Reminder skipped for event ${event.id} because the occurrence at ${rawEvent.scheduled_start_time} is canceled.`);
                                return;
                            }
                        }

                        const eventData = eventDb[event.id];
                        const mode = getAnnouncementMode(event.guild.id);
                        const rawUserIds = eventData && eventData.users ? Object.keys(eventData.users) : [];
                        const skippedUsers = eventData && eventData.skippedUsers ? eventData.skippedUsers : {};
                        const userIds = rawUserIds.filter(id => skippedUsers[id] !== event.scheduledStartTimestamp);
                        
                        const currentFormattedTime = getFormattedTimeString(event.scheduledStartTimestamp, null, 'F');
                        const currentLocation = event.entityMetadata?.location || (event.channelId ? `<#${event.channelId}>` : 'Discord');
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
                            const maxDescLength = 1900 - baseMsg.length - 10;
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

                        if (mode === 'public' || mode === 'hybrid') {
                            let mentions = '';
                            if (mode === 'public' && userIds.length > 0 && getPingsEnabled(event.guild.id)) {
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
                            
                            const threadId = eventData && (eventData.threadId || eventData.messageId);
                            const shouldShowThreadButton = (eventData && eventData.threadId) || (getThreadsEnabled(event.guild.id) && threadId);
                            if (shouldShowThreadButton && threadId) {
                                row.addComponents(
                                    new ButtonBuilder()
                                        .setLabel(t(guildLocale, 'reminder_button_thread'))
                                        .setStyle(ButtonStyle.Link)
                                        .setURL(`https://discord.com/channels/${event.guild.id}/${threadId}`)
                                        .setEmoji('💬')
                                );
                            }

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

                            const threadId = eventData && (eventData.threadId || eventData.messageId);
                            const shouldShowThreadButton = (eventData && eventData.threadId) || (getThreadsEnabled(event.guild.id) && threadId);
                            if (shouldShowThreadButton && threadId) {
                                row.addComponents(
                                    new ButtonBuilder()
                                        .setLabel(t(guildLocale, 'reminder_button_thread'))
                                        .setStyle(ButtonStyle.Link)
                                        .setURL(`https://discord.com/channels/${event.guild.id}/${threadId}`)
                                        .setEmoji('💬')
                                );
                            }

                            components.push(row);

                            const failedUserIds = await sendDMsWithRateLimit(userIds, { content: alertMsg, components });
                            
                            if (failedUserIds.length > 0 && mode !== 'hybrid') {
                                const activeFailedUserIds = [];
                                for (const id of failedUserIds) {
                                    const member = await event.guild.members.fetch(id).catch(() => null);
                                    if (member) activeFailedUserIds.push(id);
                                }
                                
                                if (activeFailedUserIds.length > 0) {
                                    const mentions = activeFailedUserIds.map(id => `<@${id}>`).join(' ');
                                    let prefix = 'Could not DM:';
                                    if (guildLocale === 'es') prefix = 'No se pudo enviar MD a:';
                                    else if (guildLocale === 'de') prefix = 'Konnte keine DM senden an:';
                                    else if (guildLocale === 'fr') prefix = "Impossible d'envoyer un DM à :";
                                    else if (guildLocale === 'pt') prefix = 'Não foi possível enviar DM para:';
                                    const fallbackMsg = `${alertMsg}\n\n${prefix} ${mentions}`;
                                    let sentMsg;
                                    if (fallbackMsg.length > 2000) {
                                        let safeFallback = `${alertMsg}\n\n` + t(guildLocale, 'public_reminders_hidden_fallback', { count: activeFailedUserIds.length });
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
                        }

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

async function syncEventReminders(guild) {
    const events = await guild.scheduledEvents.fetch().catch(() => null);
    if (!events) return;
    const now = Date.now();
    const channelId = getAnnouncementChannelId(guild.id);
    const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
    
    for (const event of events.values()) {
        scheduleRemindersForEvent(event, now);
        
        const eventData = eventDb[event.id];
        if (eventData && eventData.reminderMessageIds && eventData.reminderMessageIds.length > 0 && channel) {
            const intervals = getReminderIntervals(guild.id);
            const maxIntervalMs = intervals.length > 0 ? Math.max(...intervals.map(i => i.ms)) : 0;
            const thresholdTime = event.scheduledStartTimestamp - maxIntervalMs - 60000; 
            
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

module.exports = {
    setClient,
    updateLiveCounter,
    executeLiveCounterUpdate,
    cancelEventReminders,
    sendDMsWithRateLimit,
    notifyUsersOfEventChange,
    scheduleRemindersForEvent,
    syncEventReminders
};

