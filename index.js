require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const schedule = require('node-schedule');
const commandHandler = require('./handlers/commandHandler');
const eventHandler = require('./handlers/eventHandler');

const remindersService = require('./services/reminders');
const announcementsService = require('./services/announcements');
const adminService = require('./services/admin');
const configService = require('./services/config');
const { forceSaveDb } = require('./storage');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.GuildMessages
    ]
});

// Setup Services
adminService.setClient(client);
remindersService.setClient(client);
announcementsService.setRemindersService(remindersService);

// Load Handlers
commandHandler(client);
eventHandler(client);

// Graceful Shutdown
async function shutdown() {
    try {
        console.log('\nReceived stop signal. Shutting down gracefully...');
        await forceSaveDb();
        await schedule.gracefulShutdown();
        client.destroy();
        console.log('Shutdown complete. Safe to exit.');
        process.exit(0);
    } catch (error) {
        console.error('Error occurred during graceful shutdown:', error);
        process.exit(1);
    }
}

if (process.env.NODE_ENV !== 'test') {
    client.login(process.env.DISCORD_TOKEN);

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        adminService.notifyAdmin('Unhandled Promise Rejection', reason);
    });

    process.on('uncaughtException', (error) => {
        console.error('Uncaught Exception:', error);
        adminService.notifyAdmin('Uncaught Exception (Bot restarting)', error).finally(() => {
            process.exit(1);
        });
    });
}

if (process.env.NODE_ENV === 'test') {
    module.exports = {
        client,
        shutdown,
        remindersService,
        announcementsService,
        adminService,
        isEventSilenced: configService.isEventSilenced,
        getAnnouncementChannelId: configService.getAnnouncementChannelId,
        getPingsEnabled: configService.getPingsEnabled,
        scheduleRemindersForEvent: remindersService.scheduleRemindersForEvent,
        cancelEventReminders: remindersService.cancelEventReminders,
        updateLiveCounter: remindersService.updateLiveCounter,
        executeLiveCounterUpdate: remindersService.executeLiveCounterUpdate
    };
}
