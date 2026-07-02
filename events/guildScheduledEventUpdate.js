const { Events, GuildScheduledEventStatus, ActionRowBuilder, ButtonBuilder, ButtonStyle, Routes } = require('discord.js');
const { t, getNormalizedLocale } = require('../i18n.js');
const { eventDb, saveDb } = require('../storage.js');
const { generateGoogleCalendarLink } = require('../utils.js');
const { getAnnouncementChannelId, isEventSilenced, getCalendarEnabled } = require('../services/config.js');
const { buildAnnouncementEmbed, postAnnouncement, archiveAnnouncementMessage } = require('../services/announcements.js');
const { scheduleRemindersForEvent, cancelEventReminders, notifyUsersOfEventChange } = require('../services/reminders.js');

module.exports = {
    name: Events.GuildScheduledEventUpdate,
    async execute(o, n) {
        try {
            let rescheduled = false;
            cancelEventReminders(n.id);
            if (n.status === GuildScheduledEventStatus.Scheduled || n.status === GuildScheduledEventStatus.Active) {
                scheduleRemindersForEvent(n);
            }

            if (isEventSilenced(n)) {
                const isTagSilenced = /\[silent\]|\[exclude\]/i.test(n.name || '') || /\[silent\]|\[exclude\]/i.test(n.description || '');
                if (isTagSilenced && eventDb[n.id]) {
                    await archiveAnnouncementMessage(n.guild, n.id, 'Deleted');
                    delete eventDb[n.id];
                    await saveDb();
                    return; 
                }
            } else {
                const isRollover = o && n.recurrenceRule && o.scheduledStartTimestamp <= Date.now();
                if (!eventDb[n.id] && n.status === GuildScheduledEventStatus.Scheduled && !isRollover) {
                    const channelId = getAnnouncementChannelId(n.guild.id);
                    const channel = channelId ? await n.guild.channels.fetch(channelId).catch(() => null) : null;
                    if (channel) {
                        try {
                            await postAnnouncement(n, channel);
                            return; 
                        } catch (err) {
                            return; 
                        }
                    }
                }
            }
        
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
                if (o && eventDb[n.id]) {
                    const timeChanged = o.scheduledStartTimestamp != null && o.scheduledStartTimestamp !== n.scheduledStartTimestamp && n.status === GuildScheduledEventStatus.Scheduled;
                    const oldLocation = o.entityMetadata?.location || o.channelId;
                    const newLocation = n.entityMetadata?.location || n.channelId;
                    const locationChanged = oldLocation != null && oldLocation !== newLocation;

                    if (timeChanged || locationChanged) {
                        let isRecurringRollover = timeChanged && n.recurrenceRule && o.scheduledStartTimestamp <= Date.now();

                        if (timeChanged && n.recurrenceRule && !isRecurringRollover) {
                            try {
                                const rawEvent = await n.client.rest.get(Routes.guildScheduledEvent(n.guild.id, n.id)).catch(() => null);
                                if (rawEvent && rawEvent.guild_scheduled_event_exceptions && Array.isArray(rawEvent.guild_scheduled_event_exceptions)) {
                                    const isOccurrenceCanceled = rawEvent.guild_scheduled_event_exceptions.some(exception => {
                                        if (!exception.is_canceled) return false;
                                        const exceptionTimestamp = Number((BigInt(exception.event_exception_id) >> 22n) + 1420070400000n);
                                        return exceptionTimestamp === o.scheduledStartTimestamp;
                                    });
                                    if (isOccurrenceCanceled) {
                                        isRecurringRollover = true;
                                    }
                                }
                            } catch (err) {
                                console.error(`Error checking event exceptions for rollover in event ${n.id}:`, err);
                            }
                        }
                        
                        if (isRecurringRollover) {
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

                            if (timeChanged) {
                                const channelId = getAnnouncementChannelId(n.guild.id);
                                const channel = channelId ? await n.guild.channels.fetch(channelId).catch(() => null) : null;
                                if (channel) {
                                    await archiveAnnouncementMessage(n.guild, n.id, 'Rescheduled');
                                    try {
                                        await postAnnouncement(n, channel);
                                        rescheduled = true;
                                    } catch (err) {}
                                }
                            }
                        }
                    }
                }

                if (!rescheduled && eventDb[n.id] && eventDb[n.id].messageId) {
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
    }
};
