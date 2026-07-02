const { Events } = require('discord.js');
const { getAnnouncementChannelId, isEventSilenced } = require('../services/config.js');
const { postAnnouncement } = require('../services/announcements.js');
const { scheduleRemindersForEvent } = require('../services/reminders.js');

module.exports = {
    name: Events.GuildScheduledEventCreate,
    async execute(e) {
        if (isEventSilenced(e)) return;
        scheduleRemindersForEvent(e);
        
        const channelId = getAnnouncementChannelId(e.guild.id);
        const channel = channelId ? await e.guild.channels.fetch(channelId).catch(() => null) : null;
        if (!channel) {
            console.error(`Cannot post announcement for event ${e.id}: Announcement channel not configured or found for guild ${e.guild.id}.`);
            return;
        }

        try {
            await postAnnouncement(e, channel);
        } catch (err) {
            // Error is logged by postAnnouncement
        }
    }
};
