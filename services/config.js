const { serverConfig, eventDb } = require('../storage.js');
const { parseIntervals } = require('../utils.js');

/**
 * Retrieves the configured announcement channel ID for a specific guild.
 */
function getAnnouncementChannelId(guildId) {
    const config = serverConfig[guildId];
    if (typeof config === 'object' && config !== null) return config.channelId || process.env.ANNOUNCEMENT_CHANNEL_ID;
    return config || process.env.ANNOUNCEMENT_CHANNEL_ID;
}

/**
 * Retrieves the reminder mode ('public' or 'private') for a specific guild.
 */
function getAnnouncementMode(guildId) {
    const config = serverConfig[guildId];
    if (typeof config === 'object' && config !== null) return config.mode || 'private';
    return 'private';
}

/**
 * Resolves the localized text description of the reminder mode.
 */
function getModeText(mode, locale) {
    const normalized = typeof locale === 'string' ? locale.toLowerCase() : 'en';
    if (mode === 'public') {
        if (normalized.startsWith('es')) return 'Recordatorios de canal público';
        if (normalized.startsWith('de')) return 'Öffentliche Kanal-Erinnerungen';
        if (normalized.startsWith('fr')) return 'Rappels de salon public';
        if (normalized.startsWith('pt')) return 'Lembretes de canal público';
        return 'Public Channel Reminders';
    } else if (mode === 'hybrid') {
        if (normalized.startsWith('es')) return 'Híbrido (Canal público y MD)';
        if (normalized.startsWith('de')) return 'Hybrid (Öffentlicher Kanal & DM)';
        if (normalized.startsWith('fr')) return 'Hybride (Salon public & DM)';
        if (normalized.startsWith('pt')) return 'Híbrido (Canal público e DM)';
        return 'Hybrid (Public Channel & DM)';
    } else {
        if (normalized.startsWith('es')) return 'Recordatorios de MD privado (Opt-in)';
        if (normalized.startsWith('de')) return 'Private DM-Erinnerungen (Opt-in)';
        if (normalized.startsWith('fr')) return 'Rappels de DM privé (Opt-in)';
        if (normalized.startsWith('pt')) return 'Lembretes de DM privado (Opt-in)';
        return 'Private DM Reminders (Opt-in)';
    }
}

/**
 * Retrieves the configured reminder intervals for a specific guild.
 */
function getReminderIntervals(guildId) {
    const config = serverConfig[guildId];
    if (typeof config === 'object' && config !== null && Array.isArray(config.intervals) && config.intervals.length > 0) {
        return config.intervals;
    }
    if (process.env.DEFAULT_INTERVALS) {
        const parsed = parseIntervals(process.env.DEFAULT_INTERVALS);
        if (parsed && parsed.length > 0) return parsed;
    }
    return [{ value: 24, unit: 'h', ms: 24 * 60 * 60 * 1000 }, { value: 1, unit: 'h', ms: 1 * 60 * 60 * 1000 }];
}

function getCalendarEnabled(guildId) {
    const config = serverConfig[guildId];
    if (typeof config === 'object' && config !== null && config.calendarEnabled !== undefined) return config.calendarEnabled;
    return true; 
}

function getThreadsEnabled(guildId) {
    const config = serverConfig[guildId];
    if (typeof config === 'object' && config !== null && config.threadsEnabled !== undefined) return config.threadsEnabled;
    return true; 
}

function getThreadPruneEnabled(guildId) {
    const config = serverConfig[guildId];
    if (typeof config === 'object' && config !== null && config.threadPruneEnabled !== undefined) return config.threadPruneEnabled;
    return true; 
}

function getPingsEnabled(guildId) {
    const config = serverConfig[guildId];
    if (typeof config === 'object' && config !== null && config.pingsEnabled !== undefined) return config.pingsEnabled;
    return true;
}

function getAutoDeleteEnabled(guildId) {
    const config = serverConfig[guildId];
    if (typeof config === 'object' && config !== null && config.autoDeleteEnabled !== undefined) return config.autoDeleteEnabled;
    return false;
}

function isEventSilenced(event) {
    if (!event) return false;
    const silentPattern = /\[silent\]|\[exclude\]/i;
    if (silentPattern.test(event.name || '') || silentPattern.test(event.description || '')) {
        return true;
    }
    if (eventDb[event.id] && eventDb[event.id].remindersDisabled) {
        return true;
    }
    return false;
}

module.exports = {
    getAnnouncementChannelId,
    getAnnouncementMode,
    getModeText,
    getReminderIntervals,
    getCalendarEnabled,
    getThreadsEnabled,
    getThreadPruneEnabled,
    getPingsEnabled,
    getAutoDeleteEnabled,
    isEventSilenced
};
