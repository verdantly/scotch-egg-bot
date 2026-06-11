const assert = require('assert');
const { parseIntervals, getFormattedTimeString, formatDuration, generateGoogleCalendarLink } = require('../utils.js');

describe('Utils Unit Tests', () => {
    describe('parseIntervals()', () => {
        it('should correctly parse standard time strings', () => {
            const result = parseIntervals('24h, 1h, 15m');
            assert.strictEqual(result.length, 3);
            assert.deepStrictEqual(result[0], { value: 24, unit: 'h', ms: 24 * 60 * 60 * 1000 });
            assert.deepStrictEqual(result[1], { value: 1, unit: 'h', ms: 60 * 60 * 1000 });
            assert.deepStrictEqual(result[2], { value: 15, unit: 'm', ms: 15 * 60 * 1000 });
        });

        it('should handle loose spacing and casing', () => {
            const result = parseIntervals('  24H ,  15M  ');
            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].value, 24);
            assert.strictEqual(result[0].unit, 'h');
            assert.strictEqual(result[1].value, 15);
            assert.strictEqual(result[1].unit, 'm');
        });

        it('should deduplicate identical values', () => {
            const result = parseIntervals('1h, 60m, 1h');
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].value, 1);
            assert.strictEqual(result[0].unit, 'h');
        });

        it('should sort intervals from longest to shortest', () => {
            const result = parseIntervals('15m, 24h, 1h');
            assert.strictEqual(result[0].value, 24);
            assert.strictEqual(result[1].value, 1);
            assert.strictEqual(result[2].value, 15);
        });

        it('should cap the list at 5 elements', () => {
            const result = parseIntervals('1d, 12h, 6h, 3h, 1h, 30m, 15m');
            assert.strictEqual(result.length, 5);
        });

        it('should ignore values over 30 days', () => {
            const result = parseIntervals('31d, 1d');
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].value, 1);
        });

        it('should return an empty array for invalid inputs', () => {
            const result = parseIntervals('invalid input');
            assert.deepStrictEqual(result, []);
        });
    });

    describe('getFormattedTimeString()', () => {
        it('should output a standard Discord date string', () => {
            const timestamp = 1780272000000; // 2026-06-01T00:00:00.000Z
            const result = getFormattedTimeString(timestamp, null, 'F');
            assert.ok(result.startsWith('<t:1780272000:F>'));
        });

        it('should handle legacy getFormattedTimeString(timestamp, format) signature', () => {
            const timestamp = 1780272000000;
            const result = getFormattedTimeString(timestamp, 'f');
            assert.ok(result.startsWith('<t:1780272000:f>'));
        });

        it('should handle start and end time ranges on the same day', () => {
            const start = 1780272000000; // 2026-06-01T00:00:00.000Z
            const end = 1780279200000;   // 2026-06-01T02:00:00.000Z
            const result = getFormattedTimeString(start, end, 'F');
            assert.ok(result.includes('<t:1780272000:F>'));
            assert.ok(result.includes('to <t:1780279200:t>')); // uses 't' for same day end
        });

        it('should handle start and end time ranges on different days', () => {
            const start = 1780272000000; // 2026-06-01T00:00:00.000Z
            const end = 1780358400000;   // 2026-06-02T00:00:00.000Z
            const result = getFormattedTimeString(start, end, 'F');
            assert.ok(result.includes('<t:1780272000:F>'));
            assert.ok(result.includes('to <t:1780358400:F>')); // uses format 'F' for different day end
        });

        it('should append relative countdown if within one week', () => {
            const now = Date.now();
            const oneDayLater = now + (24 * 60 * 60 * 1000);
            const result = getFormattedTimeString(oneDayLater, null, 'F');
            assert.ok(result.includes(':R>'));
        });
    });

    describe('formatDuration()', () => {
        it('should return correct hours and minutes formatting', () => {
            const start = 1000000;
            const end = start + (2 * 60 * 60 * 1000) + (30 * 60 * 1000);
            assert.strictEqual(formatDuration(start, end), '2 hours 30 minutes');
        });

        it('should format single hour/minute correctly', () => {
            const start = 1000000;
            assert.strictEqual(formatDuration(start, start + (1 * 60 * 60 * 1000)), '1 hour');
            assert.strictEqual(formatDuration(start, start + (1 * 60 * 1000)), '1 minute');
        });

        it('should return null if no end time or non-positive duration', () => {
            assert.strictEqual(formatDuration(1000, null), null);
            assert.strictEqual(formatDuration(2000, 1000), null);
        });
    });

    describe('generateGoogleCalendarLink()', () => {
        const mockEvent = {
            id: '12345',
            name: 'Special Meeting',
            guildId: '98765',
            scheduledStartTimestamp: 1780272000000,
            scheduledEndTimestamp: 1780275600000,
            entityMetadata: { location: 'Meeting Room A' },
            description: 'Discussing bot design'
        };

        it('should generate an action=TEMPLATE calendar URL', () => {
            const url = generateGoogleCalendarLink(mockEvent);
            assert.ok(url.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE'));
            assert.ok(url.includes('text=Special%20Meeting'));
            assert.ok(url.includes('location=Meeting%20Room%20A'));
            assert.ok(url.includes('dates='));
        });

        it('should fall back to voice channel name if present', () => {
            const voiceEvent = {
                ...mockEvent,
                entityMetadata: null,
                channel: { name: '🔊 Voice Chat' }
            };
            const url = generateGoogleCalendarLink(voiceEvent);
            assert.ok(url.includes('location=%F0%9F%94%8A%20Voice%20Chat%20(Discord%20Voice%2FStage)'));
        });

        it('should strictly guarantee length under 512 characters', () => {
            const longDescEvent = {
                ...mockEvent,
                description: 'A'.repeat(1000)
            };
            const url = generateGoogleCalendarLink(longDescEvent);
            assert.ok(url.length <= 512, `URL was too long: ${url.length} chars`);
        });
    });
});
