const { Events } = require('discord.js');
const { eventDb, saveDb } = require('../storage.js');
const { getSyncInterestedEnabled } = require('../services/config.js');
const { updateLiveCounter } = require('../services/reminders.js');

module.exports = {
    name: Events.GuildScheduledEventUserRemove,
    async execute(guildScheduledEvent, user) {
        if (!guildScheduledEvent || !user || user.bot) return;
        const guildId = guildScheduledEvent.guildId || guildScheduledEvent.guild?.id;
        if (!guildId || !getSyncInterestedEnabled(guildId)) return;

        const eventId = guildScheduledEvent.id;
        if (eventDb[eventId] && eventDb[eventId].users && eventDb[eventId].users[user.id]) {
            delete eventDb[eventId].users[user.id];
            if (eventDb[eventId].skippedUsers) {
                delete eventDb[eventId].skippedUsers[user.id];
            }
            await saveDb();
            updateLiveCounter(eventId);
        }
    }
};
