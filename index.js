const { Client, GatewayIntentBits, Events, EmbedBuilder, GuildScheduledEventStatus, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, ActivityType, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const schedule = require('node-schedule');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.GuildScheduledEvents
    ] 
});

const DB_PATH = path.join(__dirname, 'events.json');
const CONFIG_PATH = path.join(__dirname, 'config.json');

// Database format: { eventId: { messageId: '...', users: ['userId1', ...] } }
let eventDb = {};
try {
    if (fs.existsSync(DB_PATH)) {
        const fileContent = fs.readFileSync(DB_PATH, 'utf8');
        if (fileContent.trim() === '') {
            console.warn('events.json is empty. Starting fresh.');
        } else {
            const rawDb = JSON.parse(fileContent);
            // Migration from old format (eventId: messageId)
            for (const [key, value] of Object.entries(rawDb)) {
                if (typeof value === 'string') {
                    eventDb[key] = { messageId: value, users: {} };
                } else {
                    let usersObj = {};
                    if (Array.isArray(value.users)) {
                        value.users.forEach(id => usersObj[id] = true);
                    } else {
                        usersObj = value.users || {};
                    }
                    eventDb[key] = { messageId: value.messageId, users: usersObj };
                }
            }
        }
    }
} catch (err) {
    console.error('Failed to load events database due to corruption or invalid JSON:', err);
    const backupPath = `${DB_PATH}.corrupt.${Date.now()}.bak`;
    try {
        fs.renameSync(DB_PATH, backupPath);
        console.warn(`Backed up corrupted database to: ${backupPath}`);
    } catch (renameErr) {
        console.error('Failed to back up the corrupted database:', renameErr);
    }
    console.warn('Initializing a fresh database so the bot can continue running.');
}

// Config format: { guildId: 'channelId' }
let serverConfig = {};
try {
    if (fs.existsSync(CONFIG_PATH)) {
        const fileContent = fs.readFileSync(CONFIG_PATH, 'utf8');
        if (fileContent.trim() !== '') {
            serverConfig = JSON.parse(fileContent);
        }
    }
} catch (err) {
    console.error('Failed to load config.json:', err);
    // Don't backup config, just start fresh. It's not as critical as user data.
}

function getAnnouncementChannelId(guildId) {
    // Prioritize DB config, then fall back to .env
    const config = serverConfig[guildId];
    if (typeof config === 'object' && config !== null) return config.channelId || process.env.ANNOUNCEMENT_CHANNEL_ID;
    return config || process.env.ANNOUNCEMENT_CHANNEL_ID;
}

function getAnnouncementMode(guildId) {
    const config = serverConfig[guildId];
    if (typeof config === 'object' && config !== null) return config.mode || 'private';
    return 'private';
}

async function saveConfig() {
    try {
        const data = JSON.stringify(serverConfig, null, 2);
        const tempPath = `${CONFIG_PATH}.tmp`;
        await fs.promises.writeFile(tempPath, data);
        try {
            await fs.promises.rename(tempPath, CONFIG_PATH);
        } catch (renameErr) {
            if (renameErr.code === 'EBUSY' || renameErr.code === 'EXDEV') {
                await fs.promises.writeFile(CONFIG_PATH, data);
                await fs.promises.unlink(tempPath).catch(() => {});
            } else throw renameErr;
        }
    } catch (err) {
        console.error('Failed to save config:', err);
    }
}

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

let savePromise = Promise.resolve();
let saveTimeout = null;

async function executeSave() {
    try {
        const data = JSON.stringify(eventDb, null, 2);
        const tempPath = `${DB_PATH}.tmp`;
        await fs.promises.writeFile(tempPath, data);
        try {
            await fs.promises.rename(tempPath, DB_PATH);
        } catch (renameErr) {
            if (renameErr.code === 'EBUSY' || renameErr.code === 'EXDEV') {
                await fs.promises.writeFile(DB_PATH, data);
                await fs.promises.unlink(tempPath).catch(() => {});
            } else throw renameErr;
        }
    } catch (err) {
        console.error('Failed to save events database:', err);
        notifyAdmin('Failed to save events database (events.json)', err);
    }
}

async function saveDb() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    // Wait 5 seconds after the last interaction to batch disk writes
    saveTimeout = setTimeout(() => {
        savePromise = savePromise.then(executeSave);
        saveTimeout = null;
    }, 5000);
}

async function forceSaveDb() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
        savePromise = savePromise.then(executeSave);
    }
    return savePromise;
}

function cancelEventReminders(eventId) {
    Object.keys(schedule.scheduledJobs).forEach(jobName => {
        if (jobName.startsWith(`${eventId}-`)) {
            schedule.scheduledJobs[jobName].cancel();
            console.log(`Cancelled: ${jobName}`);
        }
    });
}

/**
 * Sends DMs to an array of users with a delay between each message to respect Discord's rate limits.
 * @param {Array} users Array of User objects
 * @param {Object|String} messagePayload Message payload to send
 * @returns {Promise<Boolean>} True if at least one message was sent successfully
 */
async function sendDMsWithRateLimit(users, messagePayload) {
    const failedUserIds = [];
    for (const user of users) {
        if (!user.bot) {
            try {
                await user.send(messagePayload);
            } catch (err) {
                console.log(`Could not send DM to ${user.tag}`);
                failedUserIds.push(user.id);
            }
            // 500ms delay between DMs to avoid hitting rate limits
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    return failedUserIds;
}

async function notifyUsersOfEventChange(event, messageText) {
    const eventData = eventDb[event.id];
    if (!eventData || !eventData.users) return;
    
    const userIds = Object.keys(eventData.users);
    if (userIds.length === 0) return;

    const users = [];
    for (const userId of userIds) {
        try {
            const user = await client.users.fetch(userId);
            if (user) users.push(user);
        } catch (e) {
            console.log(`Could not fetch user ${userId} for change notification`);
        }
    }

    if (users.length > 0) {
        await sendDMsWithRateLimit(users, { content: messageText });
    }
}

async function syncEventReminders(guild) {
    const events = await guild.scheduledEvents.fetch();
    const now = Date.now();
    events.forEach(event => {
        scheduleRemindersForEvent(event, now);
    });
}

function scheduleRemindersForEvent(event, now = Date.now()) {
    // Skip events that are already completed or canceled
    if (event.status === GuildScheduledEventStatus.Completed || event.status === GuildScheduledEventStatus.Canceled) {
        return;
    }

    const startTime = event.scheduledStartTimestamp;
    const location = event.entityMetadata?.location || (event.channelId ? `<#${event.channelId}>` : 'Discord');
    const description = event.description ? `\n\n${event.description}` : '';
    const timeString = `<t:${Math.floor(startTime / 1000)}:F>`;
    
    const alerts = [
        { id: `${event.id}-24h`, time: startTime - (24 * 60 * 60 * 1000), msg: `📢 24h until **${event.name}**!\n🗓️ ${timeString}\n📍 ${location}${description}` },
        { id: `${event.id}-1h`, time: startTime - (1 * 60 * 60 * 1000), msg: `📢 1h until **${event.name}**!\n🗓️ ${timeString}\n📍 ${location}${description}` }
    ];
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
                            
                            if (alert.id.endsWith('-24h')) {
                                payload.components = [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`remind_${event.id}`).setLabel('Remind Me!').setStyle(ButtonStyle.Primary).setEmoji('⏰'))];
                            }
                            
                            await channel.send(payload);
                        } else if (userIds.length > 0) {
                            const users = [];
                            const fetchFailedUserIds = [];
                            for (const userId of userIds) {
                                try {
                                    const user = await client.users.fetch(userId);
                                    if (user) users.push(user);
                                    else fetchFailedUserIds.push(userId);
                                } catch (e) {
                                    console.log(`Could not fetch user ${userId}`);
                                    fetchFailedUserIds.push(userId);
                                }
                            }
                            
                            const dmRow = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId(`cancel_remind_${event.id}`).setLabel('Cancel Reminders').setStyle(ButtonStyle.Danger).setEmoji('🔕')
                            );
                            const failedUserIds = await sendDMsWithRateLimit(users, { content: alert.msg, components: [dmRow] });

                            // Fallback for users who couldn't be DMed
                            const allFailedUserIds = [...fetchFailedUserIds, ...failedUserIds];
                            if (allFailedUserIds.length > 0) {
                                const mentions = allFailedUserIds.map(id => `<@${id}>`).join(' ');
                                const fallbackMsg = `${alert.msg}\n\nCould not DM: ${mentions}`;
                                if (fallbackMsg.length > 2000) {
                                    let safeFallback = `${alert.msg}\n\n*Could not DM ${allFailedUserIds.length} users (mentions hidden to save space).*`;
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
    
    // Sync all events and collect active IDs
    for (const guild of c.guilds.cache.values()) {
        try {
            await syncEventReminders(guild);
            guild.scheduledEvents.cache.forEach(e => activeEventIds.add(e.id));
        } catch (err) {
            console.error(`Failed to sync events for guild ${guild.id}:`, err);
        }
    }

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

function buildAnnouncementEmbed(event) {
    const startTime = event.scheduledStartTimestamp;
    const location = event.entityMetadata?.location || (event.channelId ? `<#${event.channelId}>` : 'Discord');
    const description = event.description ? `\n\n${event.description}` : '';
    const timeString = `<t:${Math.floor(startTime / 1000)}:F>`;

    const mode = getAnnouncementMode(event.guild.id);
    const reminderText = mode === 'public' 
        ? '*Click the button below to be pinged via @mention 24 hours and 1 hour before the event begins!*'
        : '*Click the button below to receive a DM reminder 24 hours and 1 hour before the event begins!*';

    const embed = new EmbedBuilder()
        .setTitle(`New Event: ${event.name}`)
        .setDescription(`🗓️ **Time:** ${timeString}\n📍 **Location:** ${location}${description}\n\n${reminderText}`)
        .setColor('#0099ff');

    const coverImage = event.coverImageURL({ size: 512 });
    if (coverImage) {
        embed.setImage(coverImage);
    }

    return embed;
}

async function postAnnouncement(event, channel) {
    const embed = buildAnnouncementEmbed(event);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`remind_${event.id}`).setLabel('Remind Me!').setStyle(ButtonStyle.Primary).setEmoji('⏰')
    );

    try {
        const message = await channel.send({ embeds: [embed], components: [row] });
        eventDb[event.id] = { messageId: message.id, users: {} };
        await saveDb();
    } catch (err) {
        console.error(`Could not post announcement message for event ${event.id} in channel ${channel?.id}:`, err);
        notifyAdmin(`Could not post announcement message for event ${event.id} in channel ${channel?.id}`, err);
        throw err;
    }
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

            if (subcommand === 'view') {
                const channelId = getAnnouncementChannelId(interaction.guildId);
                const mode = getAnnouncementMode(interaction.guildId);
                const modeText = mode === 'public' ? 'Public Channel Reminders' : 'Private DM Reminders (Opt-in)';

                let replyMessage = '**Current Server Settings:**\n';
                replyMessage += `**Announcement Channel:** ${channelId ? `<#${channelId}>` : '*Not configured*'}\n`;
                replyMessage += `**Reminder Mode:** ${modeText}`;

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

            try {
                await postAnnouncement(event, channel);
                await interaction.editReply({ content: `Successfully posted an announcement for **${event.name}**.` });
            } catch (err) {
                await interaction.editReply({ content: 'An error occurred while trying to post the announcement. Please check the bot\'s permissions in the target channel.' });
            }
        }

        if (interaction.commandName === 'myreminders') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const userId = interaction.user.id;
            const myEventIds = new Set();

            // Find all event IDs the user is opted into
            for (const [eventId, data] of Object.entries(eventDb)) {
                if (data.users && data.users[userId]) {
                    myEventIds.add(eventId);
                }
            }

            if (myEventIds.size === 0) {
                return interaction.editReply({ content: 'You are not currently opted-in to receive reminders for any events.' });
            }

            // Fetch the actual events from the current guild to filter out events from other servers
            const guildEvents = await interaction.guild.scheduledEvents.fetch();
            const myGuildEvents = guildEvents.filter(event => myEventIds.has(event.id));

            if (myGuildEvents.size === 0) {
                 return interaction.editReply({ content: 'You are not currently opted-in to receive reminders for any upcoming events in this server.' });
            }

            let replyMessage = '**Your Upcoming Reminders for this Server:**\n\n';
            
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('list_cancel_select')
                .setPlaceholder('Select events to cancel reminders for...')
                .setMinValues(1)
                .setMaxValues(Math.min(myGuildEvents.size, 25));

            let optionCount = 0;

            myGuildEvents.forEach(event => {
                const timeString = `<t:${Math.floor(event.scheduledStartTimestamp / 1000)}:f>`;
                const nextLine = `• **${event.name}** - ${timeString}\n`;
                
                if (replyMessage.length + nextLine.length < 1900) {
                    replyMessage += nextLine;
                } else if (!replyMessage.endsWith('...and more!\n')) {
                    replyMessage += '...and more!\n';
                }

                if (optionCount < 25) {
                    let label = event.name;
                    if (label.length > 100) label = label.substring(0, 97) + '...';
                    
                    selectMenu.addOptions({
                        label: label,
                        value: event.id,
                        emoji: '🔕'
                    });
                    optionCount++;
                }
            });

            const row = new ActionRowBuilder().addComponents(selectMenu);
            await interaction.editReply({ content: replyMessage, components: [row] });
        }

        if (interaction.commandName === 'help') {
            const embed = new EmbedBuilder()
                .setTitle('🥚 Scotch Egg Bot Help')
                .setDescription('I automatically announce server events and can send you DM reminders 24 hours and 1 hour before they start!')
                .addFields(
                    { name: 'How to get reminders', value: 'Whenever a new event is created, I will post an announcement. Click the **⏰ Remind Me!** button on that message to opt in.' },
                    { name: '`/myreminders`', value: 'Lists all upcoming events you are currently receiving reminders for, and lets you opt out.' },
                    { name: '`/settings view`', value: 'Displays the currently configured settings for this server.' },
                    { name: 'Admin Commands', value: '`/settings channel` - Sets the announcement channel\n`/settings mode` - Toggles reminder format\n`/announceevent` - Manually posts an event announcement.' }
                )
                .setColor('#0099ff');
            
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        return;
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'list_cancel_select') {
            await interaction.deferUpdate();
            
            const eventIdsToCancel = interaction.values;
            const userId = interaction.user.id;
            let cancelledCount = 0;
            
            for (const eventId of eventIdsToCancel) {
                if (eventDb[eventId] && eventDb[eventId].users && eventDb[eventId].users[userId]) {
                    delete eventDb[eventId].users[userId];
                    cancelledCount++;
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
    
    if (interaction.customId.startsWith('remind_')) {
        const eventId = interaction.customId.replace('remind_', '');
        
        // Ensure the event still actively exists in Discord
        const event = await interaction.guild?.scheduledEvents.fetch(eventId).catch(() => null);
        if (!event) {
            return interaction.reply({ content: 'This event is no longer active or has been deleted.', flags: MessageFlags.Ephemeral });
        }

        // Auto-heal database if the event record was somehow lost
        if (!eventDb[eventId]) {
            eventDb[eventId] = { messageId: interaction.message.id, users: {} };
        }
        
        try {
        const users = eventDb[eventId].users || {};
        const userId = interaction.user.id;
        
        if (users[userId]) {
            // Remove user from reminders
            delete eventDb[eventId].users[userId];
            await saveDb();
            await interaction.reply({ content: 'You will no longer receive reminders for this event.', flags: MessageFlags.Ephemeral });
        } else {
            // Add user to reminders
            eventDb[eventId].users[userId] = true;
            await saveDb();
            
            const mode = getAnnouncementMode(interaction.guildId);
            const timeUntilEvent = event.scheduledStartTimestamp - Date.now();
            const isPast24h = timeUntilEvent <= 24 * 60 * 60 * 1000;
            
            let replyText = '';
            if (mode === 'public') {
                replyText = isPast24h 
                    ? 'Reminder set! You will be pinged in the announcement channel 1 hour before the event begins.'
                    : 'Reminder set! You will be pinged in the announcement channel 24 hours and 1 hour before the event begins.';
            } else {
                replyText = isPast24h
                    ? 'Reminder set! I will DM you 1 hour before the event begins.'
                    : 'Reminder set! I will DM you 24 hours and 1 hour before the event begins.';
            }
            await interaction.reply({ content: replyText, flags: MessageFlags.Ephemeral });
        }
        } catch (error) {
            console.error('Failed to handle remind interaction:', error);
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

async function archiveAnnouncementMessage(guild, eventId, statusText) {
    if (!eventDb[eventId] || !eventDb[eventId].messageId) return;
    try {
        const channelId = getAnnouncementChannelId(guild.id);
        const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
        if (channel) {
            const msg = await channel.messages.fetch(eventDb[eventId].messageId).catch(() => null);
            if (msg && msg.embeds.length > 0) {
                const originalEmbed = EmbedBuilder.from(msg.embeds[0]);
                originalEmbed.setTitle(`${originalEmbed.data.title} [${statusText}]`);
                originalEmbed.setColor('#808080'); // Gray out the embed to indicate it's over
                
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
                        await msg.edit({ embeds: [updatedEmbed] });
                    }
                }
            } catch (err) {
                console.error(`Failed to update announcement message for event ${n.id}:`, err);
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

// Graceful Shutdown handler for Docker / Ctrl+C
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
    notifyAdmin('Uncaught Exception', error);
});
