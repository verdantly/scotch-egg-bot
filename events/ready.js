const { Events, ActivityType, GuildScheduledEventStatus } = require('discord.js');
const schedule = require('node-schedule');
const { eventDb, saveDb } = require('../storage.js');
const { syncEventReminders } = require('../services/reminders.js');
const { archiveAnnouncementMessage } = require('../services/announcements.js');
const { pruneInactiveThreads } = require('../services/threads.js');
const { version } = require('../package.json');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(c) {
        console.log(`Bot logged in as ${c.user.tag} (v${version})`);
        
        if (!process.env.ADMIN_USER_ID) {
            console.warn('⚠️ WARNING: ADMIN_USER_ID is not configured in your .env file. Critical runtime error alerts will not be sent via DM.');
        }
        if (!process.env.DEFAULT_INTERVALS) {
            console.log('ℹ️ INFO: DEFAULT_INTERVALS is not configured in your .env file. Servers without custom intervals will default to 24 hours and 1 hour.');
        }
        
        c.user.setActivity({
            name: 'Custom Status',
            type: ActivityType.Custom,
            state: '/help | Event reminders and announcements'
        });
        
        const activeEventIds = new Set();
        const successfulGuildIds = new Set();
        
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

        // Prune inactive discussion threads (30+ days old) on startup
        for (const guild of c.guilds.cache.values()) {
            try {
                await pruneInactiveThreads(guild);
            } catch (err) {
                console.error(`Failed to prune inactive threads for guild ${guild.id}:`, err);
            }
        }

        // Schedule daily maintenance job to prune inactive threads at 03:00 AM
        schedule.scheduleJob('daily-thread-prune', '0 3 * * *', async () => {
            for (const guild of c.guilds.cache.values()) {
                try {
                    await pruneInactiveThreads(guild);
                } catch (err) {
                    console.error(`Failed daily thread prune for guild ${guild.id}:`, err);
                }
            }
        });

        let dbModified = false;
        for (const eventId in eventDb) {
            const eventData = eventDb[eventId];
            
            if (eventData && eventData.guildId && !c.guilds.cache.has(eventData.guildId)) {
                delete eventDb[eventId];
                dbModified = true;
                continue;
            }

            const eventTimestamp = Number((BigInt(eventId) >> 22n) + 1420070400000n);
            const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
            if (Date.now() - eventTimestamp > THIRTY_DAYS_MS) {
                if (!activeEventIds.has(eventId)) {
                    delete eventDb[eventId];
                    dbModified = true;
                    continue;
                }
            }

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
    }
};
