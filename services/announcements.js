const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { t, getNormalizedLocale } = require('../i18n.js');
const { eventDb, saveDb } = require('../storage.js');
const { getFormattedTimeString, generateGoogleCalendarLink, formatDuration } = require('../utils.js');
const { getAnnouncementChannelId, getAnnouncementMode, getReminderIntervals, getCalendarEnabled, getThreadsEnabled, getAutoDeleteEnabled, isEventSilenced } = require('./config.js');
const { notifyAdmin } = require('./admin.js');

let remindersService = null;
function setRemindersService(service) {
    remindersService = service;
}

function toUnicodeStrikeThrough(text) {
    return Array.from(text || '').map(char => char.codePointAt(0) > 0xFFFF ? char : char + '\u0336').join('');
}

function buildAnnouncementEmbed(event) {
    const startTime = event.scheduledStartTimestamp;
    const endTime = event.scheduledEndTimestamp;
    const location = event.entityMetadata?.location || (event.channelId ? `<#${event.channelId}>` : 'Discord');
    const description = event.description ? `\n\n${event.description}` : '';
    const guildLocale = getNormalizedLocale(event.guild.preferredLocale);
    const timeString = getFormattedTimeString(startTime, endTime, 'F', guildLocale);

    const mode = getAnnouncementMode(event.guild.id);
    const intervals = getReminderIntervals(event.guild.id);
    const intervalsStr = intervals.map(i => `${i.value}${i.unit}`).join(', ');
    
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
    
    if (fullDescription.length > 4096 && event.description) {
        const overflow = fullDescription.length - 4096 + 3;
        const truncatedDesc = event.description.substring(0, event.description.length - overflow) + '...';
        fullDescription = `${timeField}\n${locationField}\n\n${truncatedDesc}\n\n${reminderText}`;
    }

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(fullDescription)
        .setColor('#0099ff');

    const duration = formatDuration(startTime, endTime, guildLocale);
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

function buildAnnouncementComponents(event, userCount = null) {
    const guildLocale = getNormalizedLocale(event.guild ? event.guild.preferredLocale : 'en');
    const baseLabel = t(guildLocale, 'announcement_button_remind');
    const count = userCount !== null
        ? userCount
        : (eventDb[event.id] && eventDb[event.id].users ? Object.keys(eventDb[event.id].users).length : 0);
    const label = count > 0 ? `${baseLabel} (${count})` : baseLabel;

    const remindButton = new ButtonBuilder()
        .setCustomId(`remind_${event.id}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary)
        .setEmoji('⏰');
    if (isEventSilenced(event)) {
        remindButton.setDisabled(true);
    }
    const row = new ActionRowBuilder().addComponents(remindButton);

    if (getCalendarEnabled(event.guild.id)) {
        row.addComponents(
            new ButtonBuilder()
                .setLabel(t(guildLocale, 'announcement_button_calendar'))
                .setStyle(ButtonStyle.Link)
                .setURL(generateGoogleCalendarLink(event))
                .setEmoji('📅')
        );
    }

    row.addComponents(
        new ButtonBuilder()
            .setLabel(t(guildLocale, 'announcement_button_view'))
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/events/${event.guild.id}/${event.id}`)
            .setEmoji('🔗')
    );

    return row;
}

async function refreshGuildAnnouncements(guild) {
    if (!guild || !guild.scheduledEvents || typeof guild.scheduledEvents.fetch !== 'function') return 0;
    let updatedCount = 0;
    try {
        const events = await guild.scheduledEvents.fetch().catch(() => null);
        if (!events) return 0;

        for (const [eventId, data] of Object.entries(eventDb)) {
            if (!data || !data.messageId) continue;
            if (data.guildId && data.guildId !== guild.id) continue;

            const event = typeof events.get === 'function' ? events.get(eventId) : null;
            if (!event) continue;
            if (event.status !== 1 && event.status !== 2) continue; // Only Scheduled (1) or Active (2)

            const channelId = data.channelId || getAnnouncementChannelId(guild.id);
            const channel = channelId && guild.channels && typeof guild.channels.fetch === 'function'
                ? await guild.channels.fetch(channelId).catch(() => null)
                : null;
            if (!channel || !channel.messages || typeof channel.messages.fetch !== 'function') continue;

            const msg = await channel.messages.fetch(data.messageId).catch(() => null);
            if (!msg || typeof msg.edit !== 'function') continue;

            const updatedEmbed = buildAnnouncementEmbed(event);
            const updatedRow = buildAnnouncementComponents(event);
            await msg.edit({ embeds: [updatedEmbed], components: [updatedRow] }).catch(() => {});
            updatedCount++;
        }
    } catch (err) {
        console.error(`Failed to refresh guild announcements for guild ${guild.id}:`, err);
    }
    return updatedCount;
}

async function postAnnouncement(event, channel) {
    const embed = buildAnnouncementEmbed(event);
    const guildLocale = getNormalizedLocale(event.guild.preferredLocale);
    const row = buildAnnouncementComponents(event, 0);

    try {
        const message = await channel.send({ embeds: [embed], components: [row] });
        const existing = eventDb[event.id] || {};
        eventDb[event.id] = {
            messageId: message.id,
            channelId: channel.id,
            users: existing.users || {},
            guildId: event.guild.id,
            remindersDisabled: !!existing.remindersDisabled,
            reminderMessageIds: existing.reminderMessageIds || [],
            skippedUsers: existing.skippedUsers || {},
            threadId: existing.threadId || undefined
        };
        await saveDb();

        if (Object.keys(existing.users || {}).length > 0 && remindersService) {
            await remindersService.updateLiveCounter(event.id);
        }

        if (getThreadsEnabled(event.guild.id)) {
            let reusedThread = null;
            if (existing.threadId) {
                try {
                    reusedThread = (channel.threads && typeof channel.threads.fetch === 'function'
                        ? await channel.threads.fetch(existing.threadId).catch(() => null)
                        : null) || (event.guild.channels && typeof event.guild.channels.fetch === 'function'
                        ? await event.guild.channels.fetch(existing.threadId).catch(() => null)
                        : null);
                } catch (fetchErr) {
                    reusedThread = null;
                }
            }

            if (reusedThread) {
                try {
                    if (reusedThread.archived && typeof reusedThread.setArchived === 'function') {
                        await reusedThread.setArchived(false).catch(() => {});
                    }
                    const newTimeFormatted = `<t:${Math.floor(event.scheduledStartTimestamp / 1000)}:F>`;
                    const rescheduleMsg = t(guildLocale, 'thread_rescheduled_announcement', {
                        time: newTimeFormatted
                    });
                    await reusedThread.send({ content: rescheduleMsg }).catch(reschedSendErr => {
                        if (reschedSendErr.code === 50001 || reschedSendErr.code === 50013 || reschedSendErr.status === 403) {
                            console.warn(`[Announcement Thread] Could not send reschedule message in thread for event ${event.id}: Missing permissions.`);
                        } else {
                            console.error(`Could not send reschedule message in thread for event ${event.id}:`, reschedSendErr);
                        }
                    });
                } catch (threadErr) {
                    console.error(`Error reusing discussion thread for event ${event.id}:`, threadErr);
                }
            } else {
                try {
                    const thread = await message.startThread({ name: `💬 Discussion: ${event.name}`.substring(0, 100) });
                    if (thread) {
                        if (eventDb[event.id]) {
                            eventDb[event.id].threadId = thread.id;
                            await saveDb();
                        }
                        const hostTag = event.creatorId ? `, <@${event.creatorId}>` : '';
                        const starterMsg = t(guildLocale, 'thread_starter_message', {
                            name: event.name,
                            host: hostTag
                        });
                        await thread.send({ content: starterMsg }).catch(starterErr => {
                            if (starterErr.code === 50001 || starterErr.code === 50013 || starterErr.status === 403) {
                                console.warn(`[Announcement Thread] Could not send starter message in thread for event ${event.id}: Missing "Send Messages in Threads" permission in channel.`);
                            } else {
                                console.error(`Could not send starter message in thread for event ${event.id}:`, starterErr);
                            }
                        });
                    }
                } catch (threadErr) {
                    console.error(`Could not create discussion thread for event ${event.id}:`, threadErr);
                }
            }
        }
    } catch (err) {
        console.error(`Could not post announcement message for event ${event.id} in channel ${channel?.id}:`, err);
        notifyAdmin(`Could not post announcement message for event ${event.id} in channel ${channel?.id}`, err);
        throw err;
    }
}

async function archiveAnnouncementMessage(guild, eventId, statusText, existingMsg = null) {
    if (!eventDb[eventId]) return;
    if (!eventDb[eventId].messageId && existingMsg) {
        eventDb[eventId].messageId = existingMsg.id;
    }
    if (!eventDb[eventId].messageId) return;
    try {
        const channelId = eventDb[eventId].channelId || getAnnouncementChannelId(guild.id);
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
                else if (statusText === 'Rescheduled') statusLabel = t(guildLocale, 'announcement_button_rescheduled');

                const cleanTitle = (originalEmbed.data.title || '')
                    .replace(/^~~|~~$/g, '')
                    .replace(/[\u0336]/g, '')
                    .replace(/\n.*/g, '')
                    .replace(/ \[[^\]]+\]$/g, '');
                let newTitle = toUnicodeStrikeThrough(cleanTitle);
                if (newTitle.length > 256) {
                    newTitle = `${toUnicodeStrikeThrough(Array.from(cleanTitle).slice(0, 120).join(''))}...`;
                }
                originalEmbed.setTitle(newTitle);
                originalEmbed.setColor('#808080'); 
                originalEmbed.setImage(null); 
                
                const statusBanner = t(guildLocale, statusText === 'Completed' ? 'concluded_banner' : statusText === 'Deleted' ? 'deleted_banner' : statusText === 'Canceled' ? 'canceled_banner' : 'rescheduled_banner') + '\n\n';
                
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
                
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`archived_${eventId}`)
                        .setLabel(statusLabel)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                        .setEmoji(statusText === 'Completed' ? '✅' : statusText === 'Rescheduled' ? '📅' : '❌')
                );
                
                await msg.edit({ embeds: [originalEmbed], components: [disabledRow] });
            }

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

module.exports = {
    setRemindersService,
    buildAnnouncementEmbed,
    buildAnnouncementComponents,
    refreshGuildAnnouncements,
    postAnnouncement,
    archiveAnnouncementMessage,
    toUnicodeStrikeThrough
};
