const { Client, GatewayIntentBits, Events, EmbedBuilder, GuildScheduledEventStatus } = require('discord.js');
const schedule = require('node-schedule');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ] 
});

const ANNOUNCEMENT_CHANNEL_ID = process.env.ANNOUNCEMENT_CHANNEL_ID || '1383197237412237335';
const DB_PATH = path.join(__dirname, 'events.json');

// Simple JSON database for storing event ID to message ID mappings
let eventDb = {};
try {
    if (fs.existsSync(DB_PATH)) {
        eventDb = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
} catch (err) {
    console.error('Failed to load events database:', err);
}

function saveDb() {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(eventDb, null, 2));
    } catch (err) {
        console.error('Failed to save events database:', err);
    }
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

/**
 * Fetches all users who reacted with a specific emoji on a message.
 * @param {MessageReaction} reaction 
 * @returns {Promise<Array>} Array of User objects
 */
async function fetchAllReactedUsers(reaction) {
    let allUsers = [];
    let lastId;
    
    while (true) {
        const options = { limit: 100 };
        if (lastId) options.after = lastId;
        
        const usersBatch = await reaction.users.fetch(options);
        if (usersBatch.size === 0) break;
        
        usersBatch.forEach(user => allUsers.push(user));
        lastId = usersBatch.last().id;
    }
    
    return allUsers;
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
        const alerts = [
            { id: `${event.id}-24h`, time: startTime - (24 * 60 * 60 * 1000), msg: `📢 24h until ${event.url}!` },
            { id: `${event.id}-1h`, time: startTime - (1 * 60 * 60 * 1000), msg: `📢 1h until ${event.url}!` }
        ];
        alerts.forEach(alert => {
            if (alert.time > now) {
                if (schedule.scheduledJobs[alert.id]) schedule.scheduledJobs[alert.id].cancel();
                schedule.scheduleJob(alert.id, new Date(alert.time), async () => {
                    const channel = guild.channels.cache.get(ANNOUNCEMENT_CHANNEL_ID);
                    if (channel) {
                        try {
                            let sentToDms = false;
                            
                            // Look up the exact message ID from our JSON database
                            const messageId = eventDb[event.id];
                            
                            if (messageId) {
                                // Fetch exactly that message directly
                                const announcementMessage = await channel.messages.fetch(messageId).catch(() => null);
                                
                                if (announcementMessage) {
                                    const reaction = announcementMessage.reactions.cache.get('⏰');
                                    if (reaction) {
                                        const users = await fetchAllReactedUsers(reaction);
                                        sentToDms = await sendDMsWithRateLimit(users, alert.msg);
                                    }
                                }
                            }
                            
                            // Fallback: If we couldn't find the announcement or nobody reacted, 
                            // we send the reminder to the channel instead so it's not lost.
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

client.on(Events.ClientReady, c => c.guilds.cache.forEach(syncEventReminders));

client.on(Events.GuildScheduledEventCreate, async e => {
    syncEventReminders(e.guild);
    
    // Post announcement message for the new event
    const channel = e.guild.channels.cache.get(ANNOUNCEMENT_CHANNEL_ID);
    if (channel) {
        const embed = new EmbedBuilder()
            .setTitle(`New Event: ${e.name}`)
            .setDescription(`React with ⏰ to receive a DM reminder 24 hours and 1 hour before the event begins!\n\n${e.url}`)
            .setFooter({ text: `EventID:${e.id}` })
            .setColor('#0099ff');

        try {
            const message = await channel.send({ embeds: [embed] });
            await message.react('⏰');
            
            // Save the exact message ID into our JSON database
            eventDb[e.id] = message.id;
            saveDb();
            
        } catch (err) {
            console.error('Could not post announcement message or add reaction:', err);
        }
    }
});

client.on(Events.GuildScheduledEventDelete, e => {
    cancelEventReminders(e.id);
    
    // Cleanup of the database
    if (eventDb[e.id]) {
        delete eventDb[e.id];
        saveDb();
    }
});

client.on(Events.GuildScheduledEventUpdate, (o, n) => {
    if (o.scheduledStartTimestamp !== n.scheduledStartTimestamp) {
        cancelEventReminders(n.id);
        syncEventReminders(n.guild);
    }
    
    // Clean up if the event was completed or canceled
    if (n.status === GuildScheduledEventStatus.Completed || n.status === GuildScheduledEventStatus.Canceled) {
        cancelEventReminders(n.id);
        if (eventDb[n.id]) {
            delete eventDb[n.id];
            saveDb();
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
