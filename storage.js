/**
 * Storage Utility
 * Handles reading, writing, and atomic file saving for the bot's data files.
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'events.json');
const CONFIG_PATH = path.join(__dirname, 'config.json');

const eventDb = Object.create(null);
const serverConfig = Object.create(null);

let errorHandler = (context, err) => {
    console.error(`${context}:`, err);
};

/**
 * Sets the global error handler for storage operations (e.g., to send Discord DMs).
 * @param {Function} handler - The error handler function.
 */
function setStorageErrorHandler(handler) {
    errorHandler = handler;
}

// Tries to parse a potentially corrupted JSON string of events database using a regex-based partial recovery strategy.
function salvageEventsJson(content) {
    const rawDb = {};
    
    try {
        return JSON.parse(content);
    } catch (e) {
        console.warn('Standard JSON parsing failed. Attempting regex-based partial recovery...');
    }

    // Matches: "event_id": { ... } and handles nested objects safely up to 3 levels of braces
    const regex = /"(\d{17,20})"\s*:\s*(\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})/g;
    let match;
    let salvagedCount = 0;
    
    while ((match = regex.exec(content)) !== null) {
        const eventId = match[1];
        const eventJson = match[2];
        try {
            const parsedEvent = JSON.parse(eventJson);
            if (parsedEvent && (parsedEvent.messageId || parsedEvent.users)) {
                rawDb[eventId] = parsedEvent;
                salvagedCount++;
            }
        } catch (parseErr) {
            // Skip this particular record if it's too malformed to parse
        }
    }
    
    console.log(`Partial recovery complete. Successfully salvaged ${salvagedCount} event records.`);
    return rawDb;
}

// Load and restore events database with fallback support
function loadEventsDb() {
    const backupPath = `${DB_PATH}.bak`;
    let fileContent = '';
    let loadedFromBackup = false;

    // 1. Try to read from main events.json
    try {
        if (fs.existsSync(DB_PATH)) {
            fileContent = fs.readFileSync(DB_PATH, 'utf8');
        }
    } catch (err) {
        console.error('Failed to read primary events.json file:', err);
    }

    // 2. Try to parse events.json. If empty or invalid, try backup events.json.bak
    let rawDb = null;
    if (fileContent.trim() !== '') {
        try {
            rawDb = JSON.parse(fileContent);
        } catch (parseErr) {
            console.error('Failed to parse primary events.json. Attempting to load from backup events.json.bak...', parseErr);
        }
    }

    // 3. Fallback to backup if primary failed or was completely empty
    if (!rawDb) {
        try {
            if (fs.existsSync(backupPath)) {
                fileContent = fs.readFileSync(backupPath, 'utf8');
                if (fileContent.trim() !== '') {
                    rawDb = JSON.parse(fileContent);
                    loadedFromBackup = true;
                    console.log('Successfully recovered database from events.json.bak!');
                }
            }
        } catch (backupErr) {
            console.error('Failed to load backup events.json.bak:', backupErr);
        }
    }

    // 4. Fallback to regex salvaging if both standard loads failed but we have some fileContent
    if (!rawDb && fileContent.trim() !== '') {
        try {
            rawDb = salvageEventsJson(fileContent);
            console.warn('Recovered a partial database using regex salvaging.');
        } catch (salvageErr) {
            console.error('Failed regex salvaging of database:', salvageErr);
        }
    }

    // 5. If everything failed completely, start fresh
    if (!rawDb) {
        console.warn('Unable to load or salvage any database. Starting fresh with an empty database.');
        rawDb = {};
    }

    // 6. Migrate and populate eventDb
    for (const [key, value] of Object.entries(rawDb)) {
        if (typeof value === 'string') {
            eventDb[key] = { messageId: value, users: Object.create(null) };
        } else if (value && typeof value === 'object') {
            let usersObj = Object.create(null);
            if (Array.isArray(value.users)) {
                value.users.forEach(id => usersObj[id] = true);
            } else {
                Object.assign(usersObj, value.users || {});
            }
            eventDb[key] = { 
                messageId: value.messageId, 
                users: usersObj,
                guildId: value.guildId,
                reminderMessageIds: value.reminderMessageIds || [],
                skippedUsers: value.skippedUsers || {},
                remindersDisabled: !!value.remindersDisabled
            };
        }
    }

    // If we loaded from a backup, try to save the primary database file now to "heal" it
    if (loadedFromBackup) {
        try {
            fs.writeFileSync(DB_PATH, JSON.stringify(rawDb));
            console.log('Healed primary events.json by writing recovered backup data.');
        } catch (writeErr) {
            console.error('Failed to auto-heal primary events.json file:', writeErr);
        }
    }
}

// Load and restore server config with backup fallback support
function loadServerConfig() {
    const backupPath = `${CONFIG_PATH}.bak`;
    let fileContent = '';
    let loadedFromBackup = false;

    // 1. Try to read from main config.json
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            fileContent = fs.readFileSync(CONFIG_PATH, 'utf8');
        }
    } catch (err) {
        console.error('Failed to read primary config.json file:', err);
    }

    let parsedConfig = null;
    if (fileContent.trim() !== '') {
        try {
            parsedConfig = JSON.parse(fileContent);
        } catch (parseErr) {
            console.error('Failed to parse primary config.json. Trying backup...', parseErr);
        }
    }

    // 2. Try to read from backup config.json.bak
    if (!parsedConfig) {
        try {
            if (fs.existsSync(backupPath)) {
                fileContent = fs.readFileSync(backupPath, 'utf8');
                if (fileContent.trim() !== '') {
                    parsedConfig = JSON.parse(fileContent);
                    loadedFromBackup = true;
                    console.log('Successfully recovered configuration from config.json.bak!');
                }
            }
        } catch (backupErr) {
            console.error('Failed to load backup config.json.bak:', backupErr);
        }
    }

    // 3. Populate config reference
    if (parsedConfig) {
        Object.assign(serverConfig, parsedConfig);
    } else {
        console.warn('Unable to load server config. Starting fresh with default settings.');
    }

    // If loaded from backup, write back to primary to auto-heal
    if (loadedFromBackup && parsedConfig) {
        try {
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(parsedConfig));
            console.log('Healed primary config.json by writing recovered backup data.');
        } catch (writeErr) {
            console.error('Failed to auto-heal primary config.json file:', writeErr);
        }
    }
}

// Trigger initial loads at module import time
loadEventsDb();
loadServerConfig();

/**
 * Safely saves the server configuration to disk using an atomic write process.
 * Prevents data corruption and handles Docker volume EBUSY locks.
 * @returns {Promise<void>}
 */
async function saveConfig() {
    try {
        const data = JSON.stringify(serverConfig);
        const tempPath = `${CONFIG_PATH}.tmp`;
        await fs.promises.writeFile(tempPath, data);
        try {
            await fs.promises.rename(tempPath, CONFIG_PATH);
        } catch (renameErr) {
            if (renameErr.code === 'EBUSY' || renameErr.code === 'EXDEV') {
                await fs.promises.writeFile(CONFIG_PATH, data);
                await fs.promises.unlink(tempPath).catch(() => {});
            } else throw renameErr;
        }
        // Write the backup copy to config.json.bak
        await fs.promises.writeFile(`${CONFIG_PATH}.bak`, data).catch(() => {});
    } catch (err) {
        errorHandler('Failed to save config', err);
    }
}

let savePromise = Promise.resolve();
let saveTimeout = null;

/**
 * Core execution function for safely saving the events database to disk.
 * @returns {Promise<void>}
 */
async function executeSave() {
    try {
        const data = JSON.stringify(eventDb);
        const tempPath = `${DB_PATH}.tmp`;
        await fs.promises.writeFile(tempPath, data);
        try {
            await fs.promises.rename(tempPath, DB_PATH);
        } catch (renameErr) {
            if (renameErr.code === 'EBUSY' || renameErr.code === 'EXDEV') {
                await fs.promises.writeFile(DB_PATH, data);
                await fs.promises.unlink(tempPath).catch(() => {});
            } else throw renameErr;
        }
        // Write the backup copy to events.json.bak
        await fs.promises.writeFile(`${DB_PATH}.bak`, data).catch(() => {});
    } catch (err) {
        errorHandler('Failed to save events database (events.json)', err);
    }
}

/**
 * Queues a save operation for the events database. 
 * Batches multiple calls within a 5-second window into a single disk write to preserve SD card life.
 */
async function saveDb() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
        savePromise = savePromise.then(executeSave);
        saveTimeout = null;
    }, 5000);
}

/**
 * Flushes any pending database save operations to disk immediately.
 * @returns {Promise<void>}
 */
async function forceSaveDb() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
        savePromise = savePromise.then(executeSave);
    }
    return savePromise;
}

module.exports = {
    eventDb, serverConfig, saveConfig, saveDb, forceSaveDb, setStorageErrorHandler
};