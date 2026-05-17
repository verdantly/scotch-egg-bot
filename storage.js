/**
 * Storage Utility
 * Handles reading, writing, and atomic file saving for the bot's data files.
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'events.json');
const CONFIG_PATH = path.join(__dirname, 'config.json');

const eventDb = {};
const serverConfig = {};

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

// Initialize events database
try {
    if (fs.existsSync(DB_PATH)) {
        const fileContent = fs.readFileSync(DB_PATH, 'utf8');
        if (fileContent.trim() === '') {
            console.warn('events.json is empty. Starting fresh.');
        } else {
            const rawDb = JSON.parse(fileContent);
            // Migration from old format (eventId: messageId)
            for (const [key, value] of Object.entries(rawDb)) {
                if (typeof value === 'string') {
                    eventDb[key] = { messageId: value, users: {} };
                } else {
                    let usersObj = {};
                    if (Array.isArray(value.users)) {
                        value.users.forEach(id => usersObj[id] = true);
                    } else {
                        usersObj = value.users || {};
                    }
                    eventDb[key] = { messageId: value.messageId, users: usersObj };
                }
            }
        }
    }
} catch (err) {
    console.error('Failed to load events database due to corruption or invalid JSON:', err);
    const backupPath = `${DB_PATH}.corrupt.${Date.now()}.bak`;
    try {
        fs.renameSync(DB_PATH, backupPath);
        console.warn(`Backed up corrupted database to: ${backupPath}`);
    } catch (renameErr) {
        console.error('Failed to back up the corrupted database:', renameErr);
    }
    console.warn('Initializing a fresh database so the bot can continue running.');
}

// Initialize server config
try {
    if (fs.existsSync(CONFIG_PATH)) {
        const fileContent = fs.readFileSync(CONFIG_PATH, 'utf8');
        if (fileContent.trim() !== '') {
            // Use Object.assign to keep the reference intact for exports
            Object.assign(serverConfig, JSON.parse(fileContent)); 
        }
    }
} catch (err) {
    console.error('Failed to load config.json:', err);
    // Don't backup config, just start fresh. It's not as critical as user data.
}

/**
 * Safely saves the server configuration to disk using an atomic write process.
 * Prevents data corruption and handles Docker volume EBUSY locks.
 * @returns {Promise<void>}
 */
async function saveConfig() {
    try {
        const data = JSON.stringify(serverConfig, null, 2);
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
        const data = JSON.stringify(eventDb, null, 2);
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