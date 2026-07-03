const assert = require('assert');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../data/events.json');
const CONFIG_PATH = path.resolve(__dirname, '../data/config.json');

// Backup original fs methods
const originalExistsSync = fs.existsSync;
const originalReadFileSync = fs.readFileSync;
const originalWriteFileSync = fs.writeFileSync;
const originalPromises = fs.promises;

let mockFiles = {};
let storage;

describe('Storage Unit Tests', () => {
    before(() => {
        // Stub fs methods
        fs.existsSync = (p) => {
            if (typeof p === 'string' && (p === DB_PATH || p === CONFIG_PATH || p.endsWith('.bak') || p.endsWith('.tmp'))) {
                return p in mockFiles;
            }
            return originalExistsSync(p);
        };
        fs.readFileSync = (p, encoding) => {
            if (typeof p === 'string' && (p === DB_PATH || p === CONFIG_PATH || p.endsWith('.bak') || p.endsWith('.tmp'))) {
                if (p in mockFiles) return mockFiles[p];
                throw new Error(`ENOENT: no such file or directory, open '${p}'`);
            }
            return originalReadFileSync(p, encoding);
        };
        fs.writeFileSync = (p, content) => {
            if (p === DB_PATH || p === CONFIG_PATH || p.endsWith('.bak') || p.endsWith('.tmp')) {
                mockFiles[p] = content;
                return;
            }
            return originalWriteFileSync(p, content);
        };
        Object.defineProperty(fs, 'promises', {
            value: {
                writeFile: async (p, content) => {
                    if (typeof p === 'string' && (p === DB_PATH || p === CONFIG_PATH || p.endsWith('.bak') || p.endsWith('.tmp'))) {
                        mockFiles[p] = content;
                        return;
                    }
                    return originalPromises.writeFile(p, content);
                },
                rename: async (oldP, newP) => {
                    if (typeof oldP === 'string' && (oldP === DB_PATH || oldP === CONFIG_PATH || oldP.endsWith('.bak') || oldP.endsWith('.tmp'))) {
                        mockFiles[newP] = mockFiles[oldP];
                        delete mockFiles[oldP];
                        return;
                    }
                    return originalPromises.rename(oldP, newP);
                },
                unlink: async (p) => {
                    if (typeof p === 'string' && (p === DB_PATH || p === CONFIG_PATH || p.endsWith('.bak') || p.endsWith('.tmp'))) {
                        delete mockFiles[p];
                        return;
                    }
                    return originalPromises.unlink(p);
                }
            },
            configurable: true,
            writable: true
        });
    });

    after(() => {
        // Restore original fs methods
        fs.existsSync = originalExistsSync;
        fs.readFileSync = originalReadFileSync;
        fs.writeFileSync = originalWriteFileSync;
        Object.defineProperty(fs, 'promises', {
            value: originalPromises,
            configurable: true,
            writable: true
        });
    });

    beforeEach(() => {
        mockFiles = {};
        // Clear require cache for storage.js so we can reload it clean
        delete require.cache[require.resolve('../storage.js')];
    });

    it('should successfully load normal events database and config', () => {
        mockFiles[DB_PATH] = JSON.stringify({
            '123456789012345678': { messageId: 'msg_1', users: { 'user_1': true } }
        });
        mockFiles[CONFIG_PATH] = JSON.stringify({
            '987654321098765432': { channelId: 'channel_1' }
        });

        storage = require('../storage.js');

        assert.ok(storage.eventDb['123456789012345678']);
        assert.strictEqual(storage.eventDb['123456789012345678'].messageId, 'msg_1');
        assert.strictEqual(storage.eventDb['123456789012345678'].users['user_1'], true);
        assert.strictEqual(storage.serverConfig['987654321098765432'].channelId, 'channel_1');
    });

    it('should recover from events.json.bak backup if primary is empty or missing', () => {
        mockFiles[`${DB_PATH}.bak`] = JSON.stringify({
            '123456789012345678': { messageId: 'backup_msg', users: { 'user_bak': true } }
        });
        mockFiles[CONFIG_PATH] = '{}';

        storage = require('../storage.js');

        assert.ok(storage.eventDb['123456789012345678']);
        assert.strictEqual(storage.eventDb['123456789012345678'].messageId, 'backup_msg');
        // Primary file should have been healed automatically
        assert.ok(mockFiles[DB_PATH]);
        assert.strictEqual(JSON.parse(mockFiles[DB_PATH])['123456789012345678'].messageId, 'backup_msg');
    });

    it('should recover using regex salvage if both primary and backup files are corrupted JSON', () => {
        // Malformed/Corrupted JSON content with some readable records
        const corruptedContent = `
            {
                "123456789012345678": {
                    "messageId": "salvaged_msg",
                    "users": {
                        "user_salvage": true
                    }
                },
                "999999999999999999": {
                    "messageId": "broken_msg",
                    "users": { -- Syntax Error Here --
        `;
        mockFiles[DB_PATH] = corruptedContent;
        mockFiles[`${DB_PATH}.bak`] = corruptedContent;
        mockFiles[CONFIG_PATH] = '{}';

        storage = require('../storage.js');

        // It should have successfully extracted the first intact event
        assert.ok(storage.eventDb['123456789012345678']);
        assert.strictEqual(storage.eventDb['123456789012345678'].messageId, 'salvaged_msg');
        assert.strictEqual(storage.eventDb['123456789012345678'].users['user_salvage'], true);
        // It should have skipped the corrupted record
        assert.strictEqual(storage.eventDb['999999999999999999'], undefined);
    });

    it('should save config atomicly and create backup', async () => {
        mockFiles[DB_PATH] = '{}';
        mockFiles[CONFIG_PATH] = '{}';
        storage = require('../storage.js');

        storage.serverConfig['test_guild'] = { channelId: 'test_channel' };
        await storage.saveConfig();

        // Check if config.json was written
        assert.ok(mockFiles[CONFIG_PATH]);
        const saved = JSON.parse(mockFiles[CONFIG_PATH]);
        assert.strictEqual(saved['test_guild'].channelId, 'test_channel');

        // Check if config.json.bak was also written
        assert.ok(mockFiles[`${CONFIG_PATH}.bak`]);
        const backupSaved = JSON.parse(mockFiles[`${CONFIG_PATH}.bak`]);
        assert.strictEqual(backupSaved['test_guild'].channelId, 'test_channel');
    });

    it('should debounced-save database to disk when calling saveDb()', (done) => {
        mockFiles[DB_PATH] = '{}';
        mockFiles[CONFIG_PATH] = '{}';
        storage = require('../storage.js');

        storage.eventDb['test_event'] = { messageId: 'test_msg', users: {} };
        storage.saveDb();

        // Immediately after calling saveDb, it should NOT be written because of 5s debounce
        assert.strictEqual(mockFiles[DB_PATH], '{}');

        // Wait 5.2 seconds and verify it gets saved
        setTimeout(() => {
            try {
                assert.ok(mockFiles[DB_PATH], 'Database was not written after debounce interval');
                const saved = JSON.parse(mockFiles[DB_PATH]);
                assert.strictEqual(saved['test_event'].messageId, 'test_msg');
                done();
            } catch (err) {
                done(err);
            }
        }, 5200);
    }).timeout(6000);

    it('should force immediate save when forceSaveDb() is invoked', async () => {
        mockFiles[DB_PATH] = '{}';
        mockFiles[CONFIG_PATH] = '{}';
        storage = require('../storage.js');

        storage.eventDb['test_event_force'] = { messageId: 'force_msg', users: {} };
        storage.saveDb(); // Queue the debounce

        // Force save immediately
        await storage.forceSaveDb();

        // Verify it was written instantly
        assert.ok(mockFiles[DB_PATH]);
        const saved = JSON.parse(mockFiles[DB_PATH]);
        assert.strictEqual(saved['test_event_force'].messageId, 'force_msg');
    });
});
