const { Client, GatewayIntentBits, Events, EmbedBuilder, GuildScheduledEventStatus, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const schedule = require('node-schedule');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
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
                    eventDb[key] = { messageId: value, users: [] };
                } else {
                    eventDb[key] = value;
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
    return serverConfig[guildId] || process.env.ANNOUNCEMENT_CHANNEL_ID;
}

async function saveConfig() {
    // No need for a queue here, as config saves are rare and admin-invoked.
    await fs.promises.writeFile(CONFIG_PATH, JSON.stringify(serverConfig, null, 2));
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
        await fs.promises.writeFile(DB_PATH, JSON.stringify(eventDb, null, 2));
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
                        
                        if (eventData && eventData.users && eventData.users.length > 0) {
                            const users = [];
                            for (const userId of eventData.users) {
                                try {
                                    const user = await client.users.fetch(userId);
                                    if (user) users.push(user);
                                } catch (e) {
                                    console.log(`Could not fetch user ${userId}`);
                                }
                            }
                            
                            const dmRow = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId(`cancel_remind_${event.id}`).setLabel('Cancel Reminders').setStyle(ButtonStyle.Danger).setEmoji('🔕')
                            );
                            const failedUserIds = await sendDMsWithRateLimit(users, { content: alert.msg, components: [dmRow] });

                            // Fallback for users who couldn't be DMed
                            if (failedUserIds.length > 0) {
                                const mentions = failedUserIds.map(id => `<@${id}>`).join(' ');
                                const fallbackMsg = `${alert.msg}\n\nCould not DM: ${mentions}`;
                                if (fallbackMsg.length > 2000) {
                                    await channel.send(`${alert.msg}\n\n*Could not DM ${failedUserIds.length} users (mentions hidden to save space).*`);
                                } else {
                                    await channel.send(fallbackMsg);
                                }
                            }
                        } else {
                            // Fallback if nobody opted in at all
                            await channel.send(alert.msg);
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
    
    const activeEventIds = new Set();
    
    // Sync all events and collect active IDs
    for (const guild of c.guilds.cache.values()) {
        await syncEventReminders(guild);
        guild.scheduledEvents.cache.forEach(e => activeEventIds.add(e.id));
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

async function postAnnouncement(event, channel) {
    const startTime = event.scheduledStartTimestamp;
    const location = event.entityMetadata?.location || (event.channelId ? `<#${event.channelId}>` : 'Discord');
    const description = event.description ? `\n\n${event.description}` : '';
    const timeString = `<t:${Math.floor(startTime / 1000)}:F>`;

    const embed = new EmbedBuilder()
        .setTitle(`New Event: ${event.name}`)
        .setDescription(`🗓️ **Time:** ${timeString}\n📍 **Location:** ${location}${description}\n\n*Click the button below to receive a DM reminder 24 hours and 1 hour before the event begins!*`)
        .setFooter({ text: `EventID:${event.id}` })
        .setColor('#0099ff');

    const coverImage = event.coverImageURL({ size: 512 });
    if (coverImage) {
        embed.setImage(coverImage);
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`remind_${event.id}`).setLabel('Remind Me!').setStyle(ButtonStyle.Primary).setEmoji('⏰')
    );

    try {
        const message = await channel.send({ embeds: [embed], components: [row] });
        eventDb[event.id] = { messageId: message.id, users: [] };
        await saveDb();
    } catch (err) {
        console.error(`Could not post announcement message for event ${event.id} in channel ${channel.id}:`, err);
        notifyAdmin(`Could not post announcement message for event ${event.id} in channel ${channel.id}`, err);
        throw err;
    }
}

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'setchannel') {
            const channel = interaction.options.getChannel('channel');

            if (channel.type !== ChannelType.GuildText) {
                return interaction.reply({ content: 'Please select a valid text channel within this server.', ephemeral: true });
            }

            serverConfig[interaction.guildId] = channel.id;
            await saveConfig();

            await interaction.reply({ content: `Success! Event announcements will now be posted in ${channel}.`, ephemeral: true });
        }

        if (interaction.commandName === 'checkchannel') {
            const channelId = getAnnouncementChannelId(interaction.guildId);

            if (channelId) {
                await interaction.reply({ content: `Event announcements are currently configured to be sent to <#${channelId}>.`, ephemeral: true });
            } else {
                await interaction.reply({ content: `No announcement channel has been configured for this server. An administrator can set one using the \`/setchannel\` command.`, ephemeral: true });
            }
        }

        if (interaction.commandName === 'announceevent') {
            const eventIdentifier = interaction.options.getString('event_link_or_id');
            // Regex to extract a Discord snowflake ID from a string, optionally preceded by an event URL structure.
            const match = eventIdentifier.match(/(?:\/events\/\d+\/)?(\d{17,19})/);
            const eventId = match ? match[1] : null;

            if (!eventId) {
                return interaction.reply({ content: 'Invalid event link or ID provided. Please provide a valid Discord event link or the event ID.', ephemeral: true });
            }

            if (eventDb[eventId]) {
                return interaction.reply({ content: 'An announcement for this event has already been posted.', ephemeral: true });
            }

            const event = await interaction.guild.scheduledEvents.fetch(eventId).catch(() => null);
            if (!event) {
                return interaction.reply({ content: 'Could not find an event with that ID in this server.', ephemeral: true });
            }

            const channelId = getAnnouncementChannelId(interaction.guildId);
            const channel = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : null;
            if (!channel) {
                return interaction.reply({ content: 'The announcement channel is not configured for this server. Please use `/setchannel` first.', ephemeral: true });
            }

            try {
                await postAnnouncement(event, channel);
                await interaction.reply({ content: `Successfully posted an announcement for **${event.name}**.`, ephemeral: true });
            } catch (err) {
                await interaction.reply({ content: 'An error occurred while trying to post the announcement. Please check the bot\'s permissions in the target channel.', ephemeral: true });
            }
        }

        if (interaction.commandName === 'myreminders') {
            const userId = interaction.user.id;
            const myEventIds = [];

            // Find all event IDs the user is opted into
            for (const [eventId, data] of Object.entries(eventDb)) {
                if (data.users && data.users.includes(userId)) {
                    myEventIds.push(eventId);
                }
            }

            if (myEventIds.length === 0) {
                return interaction.reply({ content: 'You are not currently opted-in to receive reminders for any events.', ephemeral: true });
            }

            // Fetch the actual events from the current guild to filter out events from other servers
            const guildEvents = await interaction.guild.scheduledEvents.fetch();
            const myGuildEvents = guildEvents.filter(event => myEventIds.includes(event.id));

            if (myGuildEvents.size === 0) {
                 return interaction.reply({ content: 'You are not currently opted-in to receive reminders for any upcoming events in this server.', ephemeral: true });
            }

            let replyMessage = '**Your Upcoming Reminders for this Server:**\n\n';
            const actionRows = [];
            let currentRow = new ActionRowBuilder();
            let buttonCount = 0;

            myGuildEvents.forEach(event => {
                const timeString = `<t:${Math.floor(event.scheduledStartTimestamp / 1000)}:f>`;
                const nextLine = `• **${event.name}** - ${timeString}\n`;
                
                if (replyMessage.length + nextLine.length < 1900) {
                    replyMessage += nextLine;
                } else if (!replyMessage.endsWith('...and more!\n')) {
                    replyMessage += '...and more!\n';
                }

                // Discord has a hard limit of 5 Action Rows and 5 Buttons per Row (Max 25 buttons total)
                if (buttonCount < 25) {
                    let label = `Cancel Reminders for: ${event.name}`;
                    if (label.length > 80) label = label.substring(0, 77) + '...';
                    
                    currentRow.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`list_cancel_${event.id}`)
                            .setLabel(label)
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('🔕')
                    );
                    buttonCount++;

                    if (currentRow.components.length === 5) {
                        actionRows.push(currentRow);
                        currentRow = new ActionRowBuilder();
                    }
                }
            });

            await interaction.reply({ content: replyMessage, ephemeral: true });
            if (currentRow.components.length > 0) {
                actionRows.push(currentRow);
            }

            await interaction.reply({ content: replyMessage, components: actionRows, ephemeral: true });
        }
        return;
    }

    if (!interaction.isButton()) return;
    
    if (interaction.customId.startsWith('remind_')) {
        const eventId = interaction.customId.replace('remind_', '');
        
        // Ensure the event still actively exists in Discord
        const event = interaction.guild?.scheduledEvents.cache.get(eventId);
        if (!event) {
            return interaction.reply({ content: 'This event is no longer active or has been deleted.', ephemeral: true });
        }

        // Auto-heal database if the event record was somehow lost
        if (!eventDb[eventId]) {
            eventDb[eventId] = { messageId: interaction.message.id, users: [] };
        }
        
        const users = eventDb[eventId].users || [];
        const userId = interaction.user.id;
        
        if (users.includes(userId)) {
            // Remove user from reminders
            eventDb[eventId].users = users.filter(id => id !== userId);
            await saveDb();
            await interaction.reply({ content: 'You will no longer receive reminders for this event.', ephemeral: true });
        } else {
            // Add user to reminders
            eventDb[eventId].users.push(userId);
            await saveDb();
            await interaction.reply({ content: 'Reminder set! I will DM you 24 hours and 1 hour before the event begins.', ephemeral: true });
        }
    }

    if (interaction.customId.startsWith('cancel_remind_')) {
        const eventId = interaction.customId.replace('cancel_remind_', '');
        
        if (eventDb[eventId]) {
            const users = eventDb[eventId].users || [];
            const userId = interaction.user.id;
            
            if (users.includes(userId)) {
                eventDb[eventId].users = users.filter(id => id !== userId);
                await saveDb();
                // Replaces the button with text confirming the cancellation to avoid spam clicks
                await interaction.update({ content: `${interaction.message.content}\n\n*(Reminders cancelled)*`, components: [] });
            } else {
                await interaction.update({ content: `${interaction.message.content}\n\n*(You are not receiving reminders for this event)*`, components: [] });
            }
        } else {
            await interaction.update({ content: `${interaction.message.content}\n\n*(This event is no longer active)*`, components: [] });
        }
    }

    if (interaction.customId.startsWith('list_cancel_')) {
        const eventId = interaction.customId.replace('list_cancel_', '');
        
        if (eventDb[eventId]) {
            const users = eventDb[eventId].users || [];
            const userId = interaction.user.id;
            
            if (users.includes(userId)) {
                eventDb[eventId].users = users.filter(id => id !== userId);
                await saveDb();
                
                // Rebuilds the components to disable the clicked button and change its text
                const updatedComponents = interaction.message.components.map(row => {
                    const updatedRow = new ActionRowBuilder();
                    row.components.forEach(component => {
                        const button = ButtonBuilder.from(component);
                        if (component.customId === interaction.customId) {
                            button.setDisabled(true).setLabel('Opted Out').setStyle(ButtonStyle.Secondary).setEmoji('✅');
                        }
                        updatedRow.addComponents(button);
                    });
                    return updatedRow;
                });
                
                await interaction.update({ components: updatedComponents });
            } else {
                await interaction.reply({ content: 'You are already not receiving reminders for this event.', ephemeral: true });
            }
        } else {
            await interaction.reply({ content: 'This event is no longer active.', ephemeral: true });
        }
    }
});

client.on(Events.GuildScheduledEventDelete, async e => {
    cancelEventReminders(e.id);
    
    // Cleanup of the database
    if (eventDb[e.id]) {
        delete eventDb[e.id];
        await saveDb();
    }
});

client.on(Events.GuildScheduledEventUpdate, async (o, n) => {
    if (o.scheduledStartTimestamp !== n.scheduledStartTimestamp) {
        cancelEventReminders(n.id);
        scheduleRemindersForEvent(n);
    }
    
    // Clean up if the event was completed or canceled
    if (n.status === GuildScheduledEventStatus.Completed || n.status === GuildScheduledEventStatus.Canceled) {
        cancelEventReminders(n.id);
        if (eventDb[n.id]) {
            delete eventDb[n.id];
            await saveDb();
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
