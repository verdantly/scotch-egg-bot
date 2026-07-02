const { Events } = require('discord.js');
const { t, getNormalizedLocale } = require('../i18n.js');
const { eventDb, saveDb } = require('../storage.js');
const { archiveAnnouncementMessage } = require('../services/announcements.js');
const { cancelEventReminders, notifyUsersOfEventChange } = require('../services/reminders.js');

module.exports = {
    name: Events.GuildScheduledEventDelete,
    async execute(e) {
        cancelEventReminders(e.id);
        
        if (eventDb[e.id]) {
            try {
                const guildLocale = getNormalizedLocale(e.guild.preferredLocale);
                await notifyUsersOfEventChange(e, t(guildLocale, 'notification_deleted', { name: e.name }));
                await archiveAnnouncementMessage(e.guild, e.id, 'Deleted');
                delete eventDb[e.id];
                await saveDb();
            } catch (err) {
                console.error(`Error processing deletion for event ${e.id}:`, err);
            }
        }
    }
};
