const { sendDMsWithRateLimit } = require('./index.js');

// 1. Mock the external modules so they don't perform actual actions during tests
jest.mock('discord.js', () => {
    return {
        Client: jest.fn().mockImplementation(() => ({
            on: jest.fn(),
            login: jest.fn(),
            users: { fetch: jest.fn() },
            guilds: { cache: { values: jest.fn(() => []) } },
            isReady: jest.fn(() => true)
        })),
        GatewayIntentBits: {},
        Events: {},
        EmbedBuilder: jest.fn(),
        ActionRowBuilder: jest.fn(),
        ButtonBuilder: jest.fn(),
        ButtonStyle: {},
        ChannelType: {}
    };
});

jest.mock('fs', () => ({
    existsSync: jest.fn(() => false),
    readFileSync: jest.fn(() => '{}'),
    promises: { writeFile: jest.fn() },
    renameSync: jest.fn()
}));

jest.mock('node-schedule', () => ({
    scheduleJob: jest.fn(),
    scheduledJobs: {},
    gracefulShutdown: jest.fn()
}));

describe('Scotch Egg Bot Core Logic', () => {
    beforeEach(() => {
        jest.useFakeTimers(); // Fakes setTimeout so we don't actually wait 500ms
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('sendDMsWithRateLimit ignores bots and tracks failed DMs', async () => {
        const mockUser1 = { id: 'user1', bot: false, send: jest.fn().mockResolvedValue(true), tag: 'UserOne' };
        const mockUser2 = { id: 'user2', bot: false, send: jest.fn().mockRejectedValue(new Error('DMs closed')), tag: 'UserTwo' };
        const mockUser3 = { id: 'user3', bot: true, send: jest.fn() }; // Bot account, should be skipped

        const sendPromise = sendDMsWithRateLimit([mockUser1, mockUser2, mockUser3], { content: 'Test Reminder' });
        jest.runAllTimers(); // Fast-forward all delays
        const failedIds = await sendPromise;

        expect(mockUser1.send).toHaveBeenCalledTimes(1);
        expect(mockUser3.send).not.toHaveBeenCalled(); // Verified bot was skipped
        expect(failedIds).toContain('user2'); // Verified failure was caught
    });
});