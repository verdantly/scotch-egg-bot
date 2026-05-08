const { Client, GatewayIntentBits, Events, EmbedBuilder, GuildScheduledEventStatus, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

const GLOBAL_ANNOUNCEMENT_CHANNEL_ID = process.env.ANNOUNCEMENT_CHANNEL_ID;
let SERVER_CHANNELS = {};

try {
    SERVER_CHANNELS = JSON.parse(process.env.ANNOUNCEMENT_CHANNELS || '{}');
} catch (err) {
    console.error('FATAL ERROR: ANNOUNCEMENT_CHANNELS in .env must be valid JSON.');
    process.exit(1);
}

if (!GLOBAL_ANNOUNCEMENT_CHANNEL_ID && Object.keys(SERVER_CHANNELS).length === 0) {
    console.error('FATAL ERROR: You must define either ANNOUNCEMENT_CHANNEL_ID or ANNOUNCEMENT_CHANNELS in your .env file.');
    process.exit(1);
}
const DB_PATH = path.join(__dirname, 'events.json');

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

let savePromise = Promise.resolve();

async function saveDb() {
    savePromise = savePromise.then(async () => {
        try {
            await fs.promises.writeFile(DB_PATH, JSON.stringify(eventDb, null, 2));
        } catch (err) {
            console.error('Failed to save events database:', err);
        }
    });
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
 * @param {String} msg Message to send
 * @returns {Promise<Boolean>} True if at least one message was sent successfully
 */
async function sendDMsWithRateLimit(users, msg) {
    let sentCount = 0;
    for (const user of users) {
        if (!user.bot) {
            try {
                await user.send(msg);
                sentCount++;
                // 500ms delay between DMs to avoid hitting rate limits
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (err) {
                console.log(`Could not send DM to ${user.tag}`);
            }
        }
    }
    return sentCount > 0;
}

async function syncEventReminders(guild) {
    const events = await guild.scheduledEvents.fetch();
    const now = Date.now();
    events.forEach(event => {
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
                    const channelId = SERVER_CHANNELS[guild.id] || GLOBAL_ANNOUNCEMENT_CHANNEL_ID;
                    const channel = channelId ? guild.channels.cache.get(channelId) : null;
                    if (channel) {
                        try {
                            let sentToDms = false;
                            
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
                                sentToDms = await sendDMsWithRateLimit(users, alert.msg);
                            }
                            
                            // Fallback: If nobody opted in, we send the reminder to the channel instead so it's not lost.
                            if (!sentToDms) {
                                channel.send(alert.msg);
                            }

                        } catch (err) {
                            console.error('Error sending reminders:', err);
                        }
                    } else {
                        console.error('Reminder failed: Announcement channel not found in guild.');
                    }
                });
            }
        });
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
    syncEventReminders(e.guild);
    
    // Post announcement message for the new event
    const channelId = SERVER_CHANNELS[e.guild.id] || GLOBAL_ANNOUNCEMENT_CHANNEL_ID;
    const channel = channelId ? e.guild.channels.cache.get(channelId) : null;
    if (channel) {
        const embed = new EmbedBuilder()
            .setTitle(`New Event: ${e.name}`)
            .setDescription(`Click the button below to receive a DM reminder 24 hours and 1 hour before the event begins!`)
            .setFooter({ text: `EventID:${e.id}` })
            .setColor('#0099ff');

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`remind_${e.id}`)
                    .setLabel('Remind Me!')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⏰')
            );

        try {
            const message = await channel.send({ embeds: [embed], components: [row] });
            
            // Save the message ID and initialize users array into our JSON database
            eventDb[e.id] = { messageId: message.id, users: [] };
            await saveDb();
            
        } catch (err) {
            console.error('Could not post announcement message:', err);
        }
    }
});

client.on(Events.InteractionCreate, async interaction => {
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
        syncEventReminders(n.guild);
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
    await savePromise; // Wait for any pending database saves to finish
    await schedule.gracefulShutdown(); // Cancel all pending reminder jobs
    client.destroy(); // Disconnect bot from Discord safely
    console.log('Shutdown complete. Safe to exit.');
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
