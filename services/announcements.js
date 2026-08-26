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
    return text.split('').map(char => char + '\u0336').join('');
}

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
    
    if (fullDescription.length > 4096 && event.description) {
        const overflow = fullDescription.length - 4096 + 3;
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
        const existing = eventDb[event.id] || {};
        eventDb[event.id] = {
            messageId: message.id,
            users: existing.users || {},
            guildId: event.guild.id,
            remindersDisabled: !!existing.remindersDisabled,
            reminderMessageIds: existing.reminderMessageIds || [],
            skippedUsers: existing.skippedUsers || {}
        };
        await saveDb();

        if (Object.keys(existing.users || {}).length > 0 && remindersService) {
            await remindersService.updateLiveCounter(event.id);
        }

        if (getThreadsEnabled(event.guild.id)) {
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
                        console.error(`Could not send starter message in thread for event ${event.id}:`, starterErr);
                    });
                }
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
                else if (statusText === 'Rescheduled') statusLabel = t(guildLocale, 'announcement_button_rescheduled');

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
    postAnnouncement,
    archiveAnnouncementMessage,
    toUnicodeStrikeThrough
};
