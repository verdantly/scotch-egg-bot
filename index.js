const { Client, GatewayIntentBits, Events, EmbedBuilder, GuildScheduledEventStatus, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, ActivityType, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const schedule = require('node-schedule');
require('dotenv').config();
const { parseIntervals, getFormattedTimeString, generateGoogleCalendarLink } = require('./utils.js');
const { eventDb, serverConfig, saveConfig, saveDb, forceSaveDb, setStorageErrorHandler } = require('./storage.js');

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
 * Synchronizes the "Remind Me!" live counter on the original announcement message.
 * @param {string} eventId - The ID of the Discord Scheduled Event.
 */
async function updateLiveCounter(eventId) {
    try {
        const eventData = eventDb[eventId];
        if (!eventData || !eventData.messageId) return;

        const guild = client.guilds.cache.find(g => g.scheduledEvents.cache.has(eventId));
        if (!guild) return;

        const channelId = getAnnouncementChannelId(guild.id);
        if (!channelId) return;

        const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const msg = await channel.messages.fetch(eventData.messageId).catch(() => null);
        if (!msg || !msg.components || msg.components.length === 0) return;

        const userCount = Object.keys(eventData.users || {}).length;
        const newLabel = userCount > 0 ? `Remind Me! (${userCount})` : 'Remind Me!';

        const currentComponents = msg.components[0].components;
        if (!currentComponents[0].customId || !currentComponents[0].customId.startsWith('remind_')) return;
        if (currentComponents[0].label === newLabel) return; // Prevent redundant API calls

        const updatedRow = new ActionRowBuilder().addComponents(ButtonBuilder.from(currentComponents[0]).setLabel(newLabel));
        if (currentComponents.length > 1) updatedRow.addComponents(ButtonBuilder.from(currentComponents[1]));
        await msg.edit({ components: [updatedRow] }).catch(() => {});
    } catch (err) {}
}

/**
 * Cancels all pending node-schedule reminder jobs for a given event ID.
 * @param {string} eventId - The ID of the Discord Scheduled Event.
 */
function cancelEventReminders(eventId) {
    Object.keys(schedule.scheduledJobs).forEach(jobName => {
        if (jobName.startsWith(`${eventId}-`)) {
            schedule.scheduledJobs[jobName].cancel();
            console.log(`Cancelled: ${jobName}`);
        }
    });
}

/**
 * Fetches users and sends DMs with a delay between each message to respect Discord's rate limits.
 * @param {Array<string>} userIds Array of Discord User IDs
 * @param {Object|String} messagePayload Message payload to send
 * @returns {Promise<Boolean>} True if at least one message was sent successfully
 */
async function sendDMsWithRateLimit(users, messagePayload) {
async function sendDMsWithRateLimit(userIds, messagePayload) {
    const failedUserIds = [];
    for (const user of users) {
        if (!user.bot) {
            try {
    for (const userId of userIds) {
        try {
            const user = client.users.cache.get(userId) || await client.users.fetch(userId);
            if (user && !user.bot) {
                await user.send(messagePayload);
            } catch (err) {
                console.log(`Could not send DM to ${user.tag}`);
                failedUserIds.push(user.id);
            } else {
                failedUserIds.push(userId);
                continue; // Skip the delay if it's a bot or invalid user
            }
            // 500ms delay between DMs to avoid hitting rate limits
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (err) {
            console.log(`Could not fetch or send DM to ${userId}`);
            failedUserIds.push(userId);
        }
        // 500ms delay between DMs to avoid hitting rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
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

    const fetchPromises = userIds.map(async userId => {
        try {
            return client.users.cache.get(userId) || await client.users.fetch(userId);
        } catch (e) {
            console.log(`Could not fetch user ${userId} for change notification`);
            return null;
        }
    });
    const users = (await Promise.all(fetchPromises)).filter(user => user !== null);

    if (users.length > 0) {
        await sendDMsWithRateLimit(users, { content: messageText });
    }
    await sendDMsWithRateLimit(userIds, { content: messageText });
}

/**
 * Syncs and schedules all active event reminders for a given guild.
 * @param {Guild} guild - The Discord Guild object.
 * @returns {Promise<void>}
 */
async function syncEventReminders(guild) {
    const events = await guild.scheduledEvents.fetch();
    const now = Date.now();
    events.forEach(event => {
        scheduleRemindersForEvent(event, now);
    });
}

/**
 * Calculates and schedules the node-schedule jobs for an event's reminders.
 * @param {GuildScheduledEvent} event - The Discord Scheduled Event object.
 * @param {number} [now=Date.now()] - Current timestamp reference.
 */
function scheduleRemindersForEvent(event, now = Date.now()) {
    // Skip events that are already completed or canceled
    if (event.status === GuildScheduledEventStatus.Completed || event.status === GuildScheduledEventStatus.Canceled) {
        return;
    }

    const startTime = event.scheduledStartTimestamp;
    const location = event.entityMetadata?.location || (event.channelId ? `<#${event.channelId}>` : 'Discord');
    const description = event.description ? `\n\n${event.description}` : '';
    const timeString = getFormattedTimeString(startTime, 'F');

    const intervals = getReminderIntervals(event.guild.id);
    const minMs = intervals.length > 0 ? Math.min(...intervals.map(i => i.ms)) : 0;
    
    const alerts = intervals.map(interval => ({
        id: `${event.id}-${interval.value}${interval.unit}`,
        time: startTime - interval.ms,
        ms: interval.ms,
        msg: `📢 ${interval.value}${interval.unit} until **${event.name}**!\n🗓️ ${timeString}\n📍 ${location}${description}`
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
                        
                        const userIds = eventData && eventData.users ? Object.keys(eventData.users) : [];
                        
                        if (mode === 'public') {
                            let mentions = '';
                            if (userIds.length > 0) {
                                mentions = '\n\n' + userIds.map(id => `<@${id}>`).join(' ');
                            }
                            const publicMsg = `${alert.msg}${mentions}`;
                            
                            const payload = {};
                            if (publicMsg.length > 2000) {
                                let safeMsg = `${alert.msg}\n\n*(${userIds.length} users opted in, mentions hidden to save space)*`;
                                if (safeMsg.length > 2000) safeMsg = safeMsg.substring(0, 1995) + '...';
                                payload.content = safeMsg;
                            } else {
                                payload.content = publicMsg;
                            }
                            
                            const isLastReminder = alert.ms === minMs;
                            const row = new ActionRowBuilder();
                            
                            if (!isLastReminder) {
                                row.addComponents(
                                    new ButtonBuilder().setCustomId(`remind_${event.id}`).setLabel('Remind Me!').setStyle(ButtonStyle.Primary).setEmoji('⏰')
                                );
                            }
                            if (getCalendarEnabled(event.guild.id) && alert.ms > 60 * 60 * 1000) {
                                row.addComponents(new ButtonBuilder().setLabel('Add to Calendar').setStyle(ButtonStyle.Link).setURL(generateGoogleCalendarLink(event)).setEmoji('📅'));
                            }
                            if (row.components.length > 0) {
                                payload.components = [row];
                            }
                            
                            await channel.send(payload);
                        } else if (userIds.length > 0) {
                            const users = [];
                            const fetchFailedUserIds = [];
                            const fetchPromises = userIds.map(async userId => {
                                try {
                                    const user = client.users.cache.get(userId) || await client.users.fetch(userId);
                                    if (user) return { success: true, user, id: userId };
                                } catch (e) {
                                    console.log(`Could not fetch user ${userId}`);
                                }
                                return { success: false, id: userId };
                            });
                            
                            const fetchResults = await Promise.all(fetchPromises);
                            for (const result of fetchResults) {
                                if (result.success) users.push(result.user);
                                else fetchFailedUserIds.push(result.id);
                            }
                            
                            const isLastReminder = alert.ms === minMs;
                            const components = [];
                            if (!isLastReminder) {
                                components.push(new ActionRowBuilder().addComponents(
                                    new ButtonBuilder().setCustomId(`cancel_remind_${event.id}`).setLabel('Cancel Reminders').setStyle(ButtonStyle.Danger).setEmoji('🔕')
                                ));
                            }
                            const failedUserIds = await sendDMsWithRateLimit(users, { content: alert.msg, components });

                            // Fallback for users who couldn't be DMed
                            const allFailedUserIds = [...fetchFailedUserIds, ...failedUserIds];
                            if (allFailedUserIds.length > 0) {
                                const mentions = allFailedUserIds.map(id => `<@${id}>`).join(' ');
                        const failedUserIds = await sendDMsWithRateLimit(userIds, { content: alert.msg, components });
                        if (failedUserIds.length > 0) {
                            const mentions = failedUserIds.map(id => `<@${id}>`).join(' ');
                                const fallbackMsg = `${alert.msg}\n\nCould not DM: ${mentions}`;
                                if (fallbackMsg.length > 2000) {
                                    let safeFallback = `${alert.msg}\n\n*Could not DM ${allFailedUserIds.length} users (mentions hidden to save space).*`;
                                let safeFallback = `${alert.msg}\n\n*Could not DM ${failedUserIds.length} users (mentions hidden to save space).*`;
                                    if (safeFallback.length > 2000) safeFallback = safeFallback.substring(0, 1995) + '...';
                                    await channel.send(safeFallback);
                                } else {
                                    await channel.send(fallbackMsg);
                                }
                            }
                        } else {
                            // Fallback if nobody opted in at all
                            let noOptInMsg = alert.msg;
                            if (noOptInMsg.length > 2000) noOptInMsg = noOptInMsg.substring(0, 1995) + '...';
                            await channel.send(noOptInMsg);
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
    console.log(`Bot logged in as ${c.user.tag}`);
    
    c.user.setActivity({
        name: 'Custom Status',
        type: ActivityType.Custom,
        state: '⏰ Announcing events & sending reminders | /help'
    });
    
    const activeEventIds = new Set();
    
    // Sync all events and collect active IDs concurrently across all guilds
    const syncPromises = c.guilds.cache.map(async guild => {
        try {
            await syncEventReminders(guild);
            guild.scheduledEvents.cache.forEach(e => activeEventIds.add(e.id));
        } catch (err) {
            console.error(`Failed to sync events for guild ${guild.id}:`, err);
        }
    });
    await Promise.all(syncPromises);

    // Offline Garbage Collection: Remove events deleted while bot was offline
    let dbModified = false;
    for (const eventId in eventDb) {
        if (!activeEventIds.has(eventId)) {
            delete eventDb[eventId];
            dbModified = true;
        }
    }
    if (dbModified) await saveDb();
});

client.on(Events.GuildScheduledEventCreate, async e => {
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
    const location = event.entityMetadata?.location || (event.channelId ? `<#${event.channelId}>` : 'Discord');
    const description = event.description ? `\n\n${event.description}` : '';
    const timeString = getFormattedTimeString(startTime, 'F');

    const mode = getAnnouncementMode(event.guild.id);
    const intervals = getReminderIntervals(event.guild.id);
    const intervalsStr = intervals.map(i => `${i.value}${i.unit}`).join(', ');
    const reminderText = mode === 'public' 
        ? `*Click the button below to be pinged via @mention at: ${intervalsStr} before the event begins!*`
        : `*Click the button below to receive a DM reminder at: ${intervalsStr} before the event begins!*`;

    let title = `New Event: ${event.name}`;
    if (title.length > 256) title = title.substring(0, 253) + '...';

    let fullDescription = `🗓️ **Time:** ${timeString}\n📍 **Location:** ${location}${description}\n\n${reminderText}`;
    
    // Defensive truncation for the 4096 embed description limit
    if (fullDescription.length > 4096 && event.description) {
        const overflow = fullDescription.length - 4096 + 3; // +3 for '...'
        const truncatedDesc = event.description.substring(0, event.description.length - overflow) + '...';
        fullDescription = `🗓️ **Time:** ${timeString}\n📍 **Location:** ${location}\n\n${truncatedDesc}\n\n${reminderText}`;
    }

    const embed = new EmbedBuilder()
        .setDescription(fullDescription)
        .setColor('#0099ff');

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

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`remind_${event.id}`).setLabel('Remind Me!').setStyle(ButtonStyle.Primary).setEmoji('⏰')
    );

    if (getCalendarEnabled(event.guild.id)) {
        row.addComponents(new ButtonBuilder().setLabel('Add to Calendar').setStyle(ButtonStyle.Link).setURL(generateGoogleCalendarLink(event)).setEmoji('📅'));
    }

    try {
        const message = await channel.send({ embeds: [embed], components: [row] });
        eventDb[event.id] = { messageId: message.id, users: {} };
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

    if (upcomingEvents.length === 0) {
        return { content: 'There are no new upcoming events for you to opt into!', components: [] };
    }

    const totalPages = Math.ceil(upcomingEvents.length / 25);
    if (page >= totalPages) page = totalPages - 1;
    if (page < 0) page = 0;

    const startIndex = page * 25;
    const pageEvents = upcomingEvents.slice(startIndex, startIndex + 25);

    let replyMessage = `**Upcoming Events (Select below to opt-in)${totalPages > 1 ? ` - Page ${page + 1}/${totalPages}` : ''}:**\n\n`;
    
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('list_optin_select')
        .setPlaceholder('Select events to receive reminders for...')
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
                .setLabel('⬅️ Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`upcoming_page_${page + 1}`)
                .setLabel('Next ➡️')
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

    if (myEventIds.size === 0) {
        return { content: 'You are not currently opted-in to receive reminders for any events.', components: [] };
    }

    // Fetch the actual events from the current guild to filter out events from other servers
    const guildEvents = await interaction.guild.scheduledEvents.fetch();
    const myGuildEvents = Array.from(guildEvents.values())
        .filter(event => myEventIds.has(event.id) && (event.status === GuildScheduledEventStatus.Scheduled || event.status === GuildScheduledEventStatus.Active))
        .sort((a, b) => a.scheduledStartTimestamp - b.scheduledStartTimestamp);

    if (myGuildEvents.length === 0) {
         return { content: 'You are not currently opted-in to receive reminders for any upcoming events in this server.', components: [] };
    }

    const totalPages = Math.ceil(myGuildEvents.length / 25);
    if (page >= totalPages) page = totalPages - 1;
    if (page < 0) page = 0;

    const startIndex = page * 25;
    const pageEvents = myGuildEvents.slice(startIndex, startIndex + 25);

    let replyMessage = `**Your Upcoming Reminders for this Server${totalPages > 1 ? ` - Page ${page + 1}/${totalPages}` : ''}:**\n\n`;
    
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('list_cancel_select')
        .setPlaceholder('Select events to cancel reminders for...')
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
            new ButtonBuilder().setCustomId(`myreminders_page_${page - 1}`).setLabel('⬅️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId(`myreminders_page_${page + 1}`).setLabel('Next ➡️').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages - 1)
        );
        components.push(navRow);
    }
    return { content: replyMessage, components: components };
}

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'settings') {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'channel') {
                const channel = interaction.options.getChannel('channel');

                if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
                    return interaction.reply({ content: 'Please select a valid text channel within this server.', flags: MessageFlags.Ephemeral });
                }

                const botPermissions = channel.permissionsFor(interaction.guild.members.me);
                if (!botPermissions.has(PermissionFlagsBits.ViewChannel) || !botPermissions.has(PermissionFlagsBits.SendMessages) || !botPermissions.has(PermissionFlagsBits.EmbedLinks)) {
                    return interaction.reply({ content: `I do not have permission to view, send messages, or embed links in ${channel}. Please update my role permissions in that channel first!`, flags: MessageFlags.Ephemeral });
                }

                if (typeof serverConfig[interaction.guildId] === 'object' && serverConfig[interaction.guildId] !== null) {
                    serverConfig[interaction.guildId].channelId = channel.id;
                } else {
                    serverConfig[interaction.guildId] = { channelId: channel.id, mode: 'private' };
                }
                await saveConfig();

                await interaction.reply({ content: `Success! Event announcements will now be posted in ${channel}.`, flags: MessageFlags.Ephemeral });
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

                const modeText = mode === 'public' ? 'Public Channel Reminders' : 'Private DM Reminders (Opt-in)';
                await interaction.reply({ content: `Success! Event reminders will now be sent via: **${modeText}**.`, flags: MessageFlags.Ephemeral });
            }

            if (subcommand === 'calendar') {
                const enabled = interaction.options.getBoolean('enabled');
                if (typeof serverConfig[interaction.guildId] === 'object' && serverConfig[interaction.guildId] !== null) {
                    serverConfig[interaction.guildId].calendarEnabled = enabled;
                } else {
                    serverConfig[interaction.guildId] = { channelId: null, mode: 'private', calendarEnabled: enabled };
                }
                await saveConfig();
                await interaction.reply({ content: `Success! "Add to Calendar" button on announcements is now **${enabled ? 'enabled' : 'disabled'}**.`, flags: MessageFlags.Ephemeral });
            }

            if (subcommand === 'threads') {
                const enabled = interaction.options.getBoolean('enabled');
                if (typeof serverConfig[interaction.guildId] === 'object' && serverConfig[interaction.guildId] !== null) {
                    serverConfig[interaction.guildId].threadsEnabled = enabled;
                } else {
                    serverConfig[interaction.guildId] = { channelId: null, mode: 'private', threadsEnabled: enabled };
                }
                await saveConfig();
                await interaction.reply({ content: `Success! Auto-creating discussion threads is now **${enabled ? 'enabled' : 'disabled'}**.`, flags: MessageFlags.Ephemeral });
            }

            if (subcommand === 'autodelete') {
                const enabled = interaction.options.getBoolean('enabled');
                if (typeof serverConfig[interaction.guildId] === 'object' && serverConfig[interaction.guildId] !== null) {
                    serverConfig[interaction.guildId].autoDeleteEnabled = enabled;
                } else {
                    serverConfig[interaction.guildId] = { channelId: null, mode: 'private', autoDeleteEnabled: enabled };
                }
                await saveConfig();
                await interaction.reply({ content: `Success! Auto-deleting concluded event announcements is now **${enabled ? 'enabled' : 'disabled'}** (Archiving is **${enabled ? 'disabled' : 'enabled'}**).`, flags: MessageFlags.Ephemeral });
            }

            if (subcommand === 'intervals') {
                const input = interaction.options.getString('times');
                const parsed = parseIntervals(input);
                
                if (parsed.length === 0) {
                    return interaction.reply({ content: 'Invalid format. Please use a comma-separated list of times like `24h, 1h, 15m` (using m, h, or d). Max 30 days.', flags: MessageFlags.Ephemeral });
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
                await interaction.reply({ content: `Success! Reminder intervals for this server are now set to: **${intervalsStr}**.\n*(Note: Existing announcements will still show the old text, but the internal timers have been instantly updated!)*`, flags: MessageFlags.Ephemeral });
            }

            if (subcommand === 'testreminder') {
                const mode = getAnnouncementMode(interaction.guildId);
                const intervals = getReminderIntervals(interaction.guildId);
                const interval = intervals.length > 0 ? intervals[0] : { value: 24, unit: 'h', ms: 24 * 60 * 60 * 1000 };
                const timeUntil = interval.ms || 24 * 60 * 60 * 1000;
                const mockStartTime = Date.now() + timeUntil;
                const timeString = getFormattedTimeString(mockStartTime, 'F');
                
                const msg = `📢 ${interval.value}${interval.unit} until **Test Event Name**!\n🗓️ ${timeString}\n📍 Test Location\n\nThis is a mock description for the test event.`;
                
                let replyContent = `**Test Reminder Preview (Mode: ${mode === 'public' ? 'Public' : 'Private'})**\n\n`;
                const row = new ActionRowBuilder();
                
                if (mode === 'public') {
                    replyContent += `${msg}\n\n<@${interaction.user.id}>`;
                    row.addComponents(new ButtonBuilder().setCustomId('mock_remind').setLabel('Remind Me!').setStyle(ButtonStyle.Primary).setEmoji('⏰').setDisabled(true));
                    if (getCalendarEnabled(interaction.guildId)) {
                        row.addComponents(new ButtonBuilder().setLabel('Add to Calendar').setStyle(ButtonStyle.Link).setURL('https://calendar.google.com/').setEmoji('📅'));
                    }
                } else {
                    replyContent += `${msg}`;
                    row.addComponents(new ButtonBuilder().setCustomId('mock_cancel').setLabel('Cancel Reminders').setStyle(ButtonStyle.Danger).setEmoji('🔕').setDisabled(true));
                }

                await interaction.reply({ content: replyContent, components: [row], flags: MessageFlags.Ephemeral });
            }

            if (subcommand === 'view') {
                const channelId = getAnnouncementChannelId(interaction.guildId);
                const mode = getAnnouncementMode(interaction.guildId);
                const intervals = getReminderIntervals(interaction.guildId);
                const intervalsStr = intervals.map(i => `${i.value}${i.unit}`).join(', ');
                const modeText = mode === 'public' ? 'Public Channel Reminders' : 'Private DM Reminders (Opt-in)';

                let replyMessage = '**Current Server Settings:**\n';
                replyMessage += `**Announcement Channel:** ${channelId ? `<#${channelId}>` : '*Not configured*'}\n`;
                replyMessage += `**Reminder Mode:** ${modeText}\n`;
                replyMessage += `**Reminder Intervals:** ${intervalsStr}\n`;
                replyMessage += `**Calendar Button:** ${getCalendarEnabled(interaction.guildId) ? 'Enabled ✅' : 'Disabled ❌'}\n`;
                replyMessage += `**Auto-Threads:** ${getThreadsEnabled(interaction.guildId) ? 'Enabled ✅' : 'Disabled ❌'}\n`;
                replyMessage += `**Auto-Delete Concluded Events:** ${getAutoDeleteEnabled(interaction.guildId) ? 'Enabled ✅ (Deleted)' : 'Disabled ❌ (Archived)'}`;

                await interaction.reply({ content: replyMessage, flags: MessageFlags.Ephemeral });
            }
            return;
        }

        if (interaction.commandName === 'announceevent') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const eventIdentifier = interaction.options.getString('event_link_or_id');
            const match = eventIdentifier.match(/(?:\/events\/\d+\/)?(\d{17,19})/);
            const eventId = match ? match[1] : null;

            if (!eventId) {
                return interaction.editReply({ content: 'Invalid event link or ID provided. Please provide a valid Discord event link or the event ID.' });
            }

            if (eventDb[eventId]) {
                return interaction.editReply({ content: 'An announcement for this event has already been posted.' });
            }

            const event = await interaction.guild.scheduledEvents.fetch(eventId).catch(() => null);
            if (!event) {
                return interaction.editReply({ content: 'Could not find an event with that ID in this server.' });
            }

            const channelId = getAnnouncementChannelId(interaction.guildId);
            const channel = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : null;
            if (!channel) {
                return interaction.editReply({ content: 'The announcement channel is not configured for this server. Please use `/settings channel` first.' });
            }

            const botPermissions = channel.permissionsFor(interaction.guild.members.me);
            if (!botPermissions.has(PermissionFlagsBits.ViewChannel) || !botPermissions.has(PermissionFlagsBits.SendMessages) || !botPermissions.has(PermissionFlagsBits.EmbedLinks)) {
                return interaction.editReply({ content: `I do not have permission to view, send messages, or embed links in ${channel}. Please update my role permissions in that channel first!` });
            }

            try {
                await postAnnouncement(event, channel);
                await interaction.editReply({ content: `Successfully posted an announcement for **${event.name}**.` });
            } catch (err) {
                await interaction.editReply({ content: 'An error occurred while trying to post the announcement. Please check the bot\'s permissions in the target channel.' });
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
            const embed = new EmbedBuilder()
                .setTitle('🥚 Scotch Egg Bot Help')
                .setDescription('I automatically announce server events and send reminders at **customizable intervals**!')
                .addFields(
                    { 
                        name: 'For Everyone', 
                        value: '**`/upcoming`** - See a list of upcoming events and opt-in to reminders.\n' +
                               '**`/myreminders`** - View and cancel reminders you are currently opted-in for.\n' +
                               '**`⏰ Remind Me!`** - Click this button on any announcement to get reminders!'
                    },
                    {
                        name: 'For Administrators',
                        value: '**`/settings channel`** - Set the channel for event announcements.\n' +
                               '**`/settings mode`** - Choose between Private (DM) or Public (@mention) reminders.\n' +
                               '**`/settings intervals`** - Customize reminder times (e.g., `24h, 1h, 15m`).\n' +
                               '**`/settings autodelete`** - Choose to delete or archive events when they end.\n' +
                               '**`/settings calendar`** - Toggle the "Add to Calendar" button.\n' +
                               '**`/settings threads`** - Toggle automatic discussion threads.\n' +
                               '**`/settings view`** - See all current settings.\n' +
                               '**`/announceevent`** - Manually post an announcement for an existing event.\n' +
                               '**`/stats`** - View opt-in statistics for active events.'
                    }
                )
                .setColor('#0099ff')
                .setFooter({ text: 'Use /settings testreminder to preview your reminder messages!' });
            
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (interaction.commandName === 'stats') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const guildEvents = await interaction.guild.scheduledEvents.fetch();
            const activeEvents = guildEvents.filter(e => e.status === GuildScheduledEventStatus.Scheduled || e.status === GuildScheduledEventStatus.Active);
            
            if (activeEvents.size === 0) {
                return interaction.editReply({ content: 'There are no active upcoming events in this server.' });
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
                .setTitle('📊 Event Opt-in Statistics')
                .setDescription(description || 'No data to display.')
                .addFields({ name: 'Total Server Opt-ins', value: totalOptIns.toString(), inline: true })
                .setColor('#0099ff');

            await interaction.editReply({ embeds: [embed] });
        }
        return;
    }

    if (interaction.isStringSelectMenu()) {
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
            const modeText = mode === 'public' ? 'You will be pinged in the announcement channel' : 'I will DM you';
            await interaction.editReply({ content: `${interaction.message.content}\n\n✅ Successfully opted in to **${optedInCount}** event(s)!\n*${modeText} at: ${intervalsStr} before they begin.*`, components: [] });
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
            
            await interaction.editReply({ content: `${interaction.message.content}\n\n✅ Successfully canceled reminders for **${cancelledCount}** event(s).`, components: [] });
        }
        return;
    }

    if (!interaction.isButton()) return;
    
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

    if (interaction.customId.startsWith('remind_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const eventId = interaction.customId.replace('remind_', '');
        
        // Ensure the event still actively exists in Discord
        const event = await interaction.guild?.scheduledEvents.fetch(eventId).catch(() => null);
        if (!event) {
            return interaction.editReply({ content: 'This event is no longer active or has been deleted.' });
        }

        // Auto-heal database if the event record was somehow lost
        if (!eventDb[eventId]) {
            eventDb[eventId] = { messageId: interaction.message.id, users: {} };
        }

        try {
            const users = eventDb[eventId].users || {};
            const userId = interaction.user.id;
            let replyText;

            if (users[userId]) {
                // Remove user from reminders
                delete eventDb[eventId].users[userId];
                replyText = 'You will no longer receive reminders for this event.';
            } else {
                // Add user to reminders
                eventDb[eventId].users[userId] = true;
                
                const mode = getAnnouncementMode(interaction.guildId);
                const intervals = getReminderIntervals(interaction.guildId);
                const intervalsStr = intervals.map(i => `${i.value}${i.unit}`).join(', ');
                
                if (mode === 'public') {
                    replyText = `Reminder set! You will be pinged in the announcement channel at: ${intervalsStr} before the event.`;
                } else {
                    replyText = `Reminder set! I will DM you at: ${intervalsStr} before the event.`;
                }
            }
            await saveDb();

            // Update the button on the original message to show the new count
            const userCount = Object.keys(users).length;
            const newLabel = userCount > 0 ? `Remind Me! (${userCount})` : 'Remind Me!';
            
            const currentComponents = interaction.message.components[0].components;
            const updatedRow = new ActionRowBuilder().addComponents(
                ButtonBuilder.from(currentComponents[0]).setLabel(newLabel)
            );
            
            if (currentComponents.length > 1) {
                updatedRow.addComponents(ButtonBuilder.from(currentComponents[1]));
            }
            
            await interaction.message.edit({ components: [updatedRow] }).catch(() => {});
            await interaction.editReply({ content: replyText });
            
            // Sync the original announcement message in the background if they clicked a reminder ping
            if (eventDb[eventId].messageId !== interaction.message.id) {
                updateLiveCounter(eventId);
            }
        } catch (error) {
            console.error('Failed to handle remind interaction:', error);
            await interaction.editReply({ content: 'An error occurred while processing your request.' }).catch(() => {});
        }
    }

    if (interaction.customId.startsWith('cancel_remind_')) {
        const eventId = interaction.customId.replace('cancel_remind_', '');
        
        if (eventDb[eventId]) {
            const users = eventDb[eventId].users || {};
            const userId = interaction.user.id;
            
            try {
            if (users[userId]) {
                delete eventDb[eventId].users[userId];
                await saveDb();
                updateLiveCounter(eventId); // Fire asynchronously
                // Replaces the button with text confirming the cancellation to avoid spam clicks
                let newContent = `${interaction.message.content}\n\n*(Reminders cancelled)*`;
                if (newContent.length > 2000) {
                    newContent = `${interaction.message.content.substring(0, 1950)}...\n\n*(Reminders cancelled)*`;
                }
                await interaction.update({ content: newContent, components: [] });
            } else {
                    let newContent = `${interaction.message.content}\n\n*(You are not receiving reminders for this event)*`;
                    if (newContent.length > 2000) {
                        newContent = `${interaction.message.content.substring(0, 1930)}...\n\n*(You are not receiving reminders for this event)*`;
                    }
                    await interaction.update({ content: newContent, components: [] });
            }
            } catch (error) {
                console.error('Failed to handle cancel_remind interaction:', error);
            }
        } else {
            let newContent = `${interaction.message.content}\n\n*(This event is no longer active)*`;
            if (newContent.length > 2000) {
                newContent = `${interaction.message.content.substring(0, 1950)}...\n\n*(This event is no longer active)*`;
            }
            await interaction.update({ content: newContent, components: [] });
        }
    }
});

/**
 * Archives an active event announcement by changing its embed color to gray 
 * and disabling its interaction buttons to indicate it has concluded.
 * @param {Guild} guild - The Discord Guild object.
 * @param {string} eventId - The ID of the event to archive.
 * @param {string} statusText - The status reason ('Completed' or 'Deleted' or 'Canceled').
 */
async function archiveAnnouncementMessage(guild, eventId, statusText) {
    if (!eventDb[eventId] || !eventDb[eventId].messageId) return;
    try {
        const channelId = getAnnouncementChannelId(guild.id);
        const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
        if (channel) {
            const msg = await channel.messages.fetch(eventDb[eventId].messageId).catch(() => null);
            
            if (msg && getAutoDeleteEnabled(guild.id)) {
                await msg.delete().catch(() => {});
                return;
            }
            
            if (msg && msg.embeds.length > 0) {
                const originalEmbed = EmbedBuilder.from(msg.embeds[0]);
                
                const suffix = ` [${statusText}]`;
                let newTitle = `${originalEmbed.data.title || ''}${suffix}`;
                if (newTitle.length > 256) {
                    newTitle = `${(originalEmbed.data.title || '').substring(0, 256 - suffix.length - 3)}...${suffix}`;
                }
                originalEmbed.setTitle(newTitle);
                originalEmbed.setColor('#808080'); // Gray out the embed to indicate it's over
                originalEmbed.setImage(null); // Remove the cover image to make the archived message less prominent
                
                if (originalEmbed.data.description) {
                    // Remove the obsolete "Click the button below" text to reduce clutter
                    let newDesc = originalEmbed.data.description.replace(/\n\n\*Click the button below.*?\*/, '');
                    // Prefix every line with a blockquote to dim and indent the text
                    newDesc = newDesc.split('\n').map(line => line.startsWith('> ') ? line : `> ${line}`).join('\n');
                    if (newDesc.length > 4096) newDesc = newDesc.substring(0, 4093) + '...';
                    originalEmbed.setDescription(newDesc);
                }
                
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`archived_${eventId}`)
                        .setLabel(`Event ${statusText}`)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                        .setEmoji(statusText === 'Completed' ? '✅' : '❌')
                );
                
                await msg.edit({ embeds: [originalEmbed], components: [disabledRow] });
            }
        }
    } catch (err) {
        console.log(`Failed to archive announcement message for event ${eventId}:`, err);
    }
}

client.on(Events.GuildScheduledEventDelete, async e => {
    cancelEventReminders(e.id);
    
    // Cleanup of the database
    if (eventDb[e.id]) {
        await notifyUsersOfEventChange(e, `⚠️ The event **${e.name}** has been deleted.`);
        await archiveAnnouncementMessage(e.guild, e.id, 'Deleted');
        delete eventDb[e.id];
        await saveDb();
    }
});

client.on(Events.GuildScheduledEventUpdate, async (o, n) => {
    // Always reschedule reminders on update to ensure time, location, and description are fresh
    cancelEventReminders(n.id);
    if (n.status === GuildScheduledEventStatus.Scheduled || n.status === GuildScheduledEventStatus.Active) {
        scheduleRemindersForEvent(n);
    }
    
    // Clean up if the event was completed or canceled
    if (n.status === GuildScheduledEventStatus.Completed || n.status === GuildScheduledEventStatus.Canceled) {
        cancelEventReminders(n.id);
        if (eventDb[n.id]) {
            const statusText = n.status === GuildScheduledEventStatus.Completed ? 'Completed' : 'Canceled';
            if (n.status === GuildScheduledEventStatus.Canceled) {
                await notifyUsersOfEventChange(n, `⚠️ The event **${n.name}** has been canceled.`);
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
                let changeMsg = `🔔 The event **${n.name}** has been updated!\n`;
                if (timeChanged) {
                    changeMsg += `• **New Time:** <t:${Math.floor(n.scheduledStartTimestamp / 1000)}:F>\n`;
                }
                if (locationChanged) {
                    const locStr = n.entityMetadata?.location || (n.channelId ? `<#${n.channelId}>` : 'Discord');
                    changeMsg += `• **New Location:** ${locStr}\n`;
                }
                await notifyUsersOfEventChange(n, changeMsg);
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
                            const currentComponents = components[0].components;
                            const remindButton = ButtonBuilder.from(currentComponents[0]);
                            
                            const updatedRow = new ActionRowBuilder().addComponents(remindButton);
                            
                            if (getCalendarEnabled(n.guild.id)) {
                                const calendarLink = generateGoogleCalendarLink(n);
                                updatedRow.addComponents(new ButtonBuilder().setLabel('Add to Calendar').setStyle(ButtonStyle.Link).setURL(calendarLink).setEmoji('📅'));
                            }

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
});

client.login(process.env.DISCORD_TOKEN);

/**
 * Graceful Shutdown handler for catching Docker stop signals or Ctrl+C.
 */
async function shutdown() {
    console.log('\nReceived stop signal. Shutting down gracefully...');
    await forceSaveDb(); // Flush any pending batched saves to disk immediately
    await schedule.gracefulShutdown(); // Cancel all pending reminder jobs
    client.destroy(); // Disconnect bot from Discord safely
    console.log('Shutdown complete. Safe to exit.');
    process.exit(0);
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
