const { executeLiveCounterUpdate, setClient } = require('./services/reminders.js');
const storage = require('./storage.js');

storage.eventDb['event_123'] = {
    messageId: 'msg_123',
    channelId: 'channel_123',
    guildId: 'guild_123',
    users: { 'user1': true, 'user2': true }
};

const mockMessage = {
    id: 'msg_123',
    components: [
        {
            type: 1,
            components: [
                { customId: 'remind_event_123', label: 'Remind Me!', style: 1, type: 2 },
                { customId: 'view_event_123', label: 'View Event', style: 5, type: 2 }
            ]
        }
    ],
    edit: async (payload) => {
        console.log('SUCCESS! Components:', JSON.stringify(payload.components, null, 2));
    }
};

const mockClient = {
    guilds: {
        cache: {
            get: (id) => {
                console.log('Fetching guild:', id);
                return {};
            }
        }
    },
    channels: {
        cache: {
            get: (id) => {
                console.log('Fetching channel:', id);
                return {
                    messages: {
                        fetch: async (msgId) => {
                            console.log('Fetching message:', msgId);
                            return mockMessage;
                        }
                    }
                };
            }
        }
    }
};

setClient(mockClient);

// Override console.error to throw so we can see the full stack trace!
console.error = (msg, err) => {
    throw err || new Error(msg);
};

console.log('Executing live counter update...');
executeLiveCounterUpdate('event_123').catch(err => {
    console.log('ERROR THROWN:');
    console.log(err);
});
