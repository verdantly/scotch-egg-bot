const { Events } = require('discord.js');
const { eventDb, saveDb } = require('../storage.js');
const { getSyncInterestedEnabled, isEventSilenced } = require('../services/config.js');
const { updateLiveCounter } = require('../services/reminders.js');

module.exports = {
    name: Events.GuildScheduledEventUserAdd,
    async execute(guildScheduledEvent, user) {
        if (!guildScheduledEvent || !user || user.bot) return;
        const guildId = guildScheduledEvent.guildId || guildScheduledEvent.guild?.id;
        if (!guildId || !getSyncInterestedEnabled(guildId)) return;

        const eventId = guildScheduledEvent.id;
        if (eventDb[eventId] && eventDb[eventId].remindersDisabled) return;
        if (isEventSilenced(guildScheduledEvent)) return;

        if (!eventDb[eventId]) {
            eventDb[eventId] = { users: {}, guildId };
        }
        if (!eventDb[eventId].users) {
            eventDb[eventId].users = {};
        }
        if (!eventDb[eventId].guildId) {
            eventDb[eventId].guildId = guildId;
        }

        if (!eventDb[eventId].users[user.id]) {
            eventDb[eventId].users[user.id] = true;
            await saveDb();
            updateLiveCounter(eventId);
        }
    }
};
