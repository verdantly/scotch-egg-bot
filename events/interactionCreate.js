const { Events, Collection, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, GuildScheduledEventStatus } = require('discord.js');
const { getFormattedTimeString } = require('../utils.js');
const { t, getNormalizedLocale } = require('../i18n.js');
const { eventDb, saveDb } = require('../storage.js');
const { updateLiveCounter } = require('../services/reminders.js');
const { getAnnouncementMode, getReminderIntervals, isEventSilenced } = require('../services/config.js');

const buttonCooldowns = new Map();

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) return;

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(`Error executing ${interaction.commandName}:`, error);
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
                }
            }
            return;
        }

        try {

        if (interaction.isStringSelectMenu()) {
            if (!buttonCooldowns.has('select_menu')) {
                buttonCooldowns.set('select_menu', new Collection());
            }

            const now = Date.now();
            const timestamps = buttonCooldowns.get('select_menu');
            const cooldownAmount = 5000; 

            if (timestamps.has(interaction.user.id)) {
                const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;
                if (now < expirationTime) {
                    const expiredTimestamp = Math.round(expirationTime / 1000);
                    return interaction.reply({ 
                        content: `Please wait! You are interacting too fast. You can use this menu again <t:${expiredTimestamp}:R>.`, 
                        flags: MessageFlags.Ephemeral 
                    });
                }
            }
            timestamps.set(interaction.user.id, now);
            setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

            const userLocale = getNormalizedLocale(interaction.locale);
            
            if (interaction.customId === 'list_optin_select') {
                await interaction.deferUpdate();
                const eventIdsToOptIn = interaction.values;
                const userId = interaction.user.id;
                let optedInCount = 0;
                
                for (const eventId of eventIdsToOptIn) {
                    if (!eventDb[eventId]) eventDb[eventId] = { users: {} };
                    if (!eventDb[eventId].users) eventDb[eventId].users = {};
                    
                    if (!eventDb[eventId].users[userId]) {
                        eventDb[eventId].users[userId] = true;
                        optedInCount++;
                        updateLiveCounter(eventId);
                    }
                }
                
                if (optedInCount > 0) await saveDb();
                
                const mode = getAnnouncementMode(interaction.guildId);
                const intervals = getReminderIntervals(interaction.guildId);
                const intervalsStr = intervals.map(i => `${i.value}${i.unit}`).join(', ');
                
                let successText = `Ã¢Å“â€¦ Successfully opted in to **${optedInCount}** event(s)!\n*${mode === 'public' ? 'You will be pinged in the announcement channel' : 'I will DM you'} at: ${intervalsStr} before they begin.*`;
                if (userLocale === 'es') successText = `Ã¢Å“â€¦ Ã‚Â¡Te has inscrito con ÃƒÂ©xito en **${optedInCount}** evento(s)!\n*${mode === 'public' ? 'Se te mencionarÃƒÂ¡ en el canal de anuncios' : 'Te enviarÃƒÂ© un mensaje directo'}: ${intervalsStr} antes de que comiencen.*`;
                else if (userLocale === 'de') successText = `Ã¢Å“â€¦ Erfolgreich fÃƒÂ¼r **${optedInCount}** Event(s) angemeldet!\n*${mode === 'public' ? 'Du wirst im AnkÃƒÂ¼ndigungskanal benachrichtigt' : 'Ich werde dir eine DM senden'}: ${intervalsStr} bevor sie beginnen.*`;
                else if (userLocale === 'fr') successText = `Ã¢Å“â€¦ Inscrit avec succÃƒÂ¨s ÃƒÂ  **${optedInCount}** ÃƒÂ©vÃƒÂ©nement(s) !\n*${mode === 'public' ? 'Vous serez mentionnÃƒÂ© dans le salon d\'annonces' : 'Je vous enverrai un DM'} : ${intervalsStr} avant qu'ils ne commencent.*`;
                else if (userLocale === 'pt') successText = `Ã¢Å“â€¦ Inscrito com sucesso em **${optedInCount}** evento(s)!\n*${mode === 'public' ? 'VocÃƒÂª serÃƒÂ¡ mencionado no canal de anÃƒÂºncios' : 'Eu lhe enviarei uma DM'}: ${intervalsStr} antes de comeÃƒÂ§arem.*`;

                await interaction.editReply({ content: `${interaction.message.content}\n\n${successText}`, components: [] });
            }

            if (interaction.customId === 'list_cancel_select') {
                await interaction.deferUpdate();
                const eventIdsToCancel = interaction.values;
                const userId = interaction.user.id;
                let cancelledCount = 0;
                
                for (const eventId of eventIdsToCancel) {
                    if (eventDb[eventId] && eventDb[eventId].users && eventDb[eventId].users[userId]) {
                        delete eventDb[eventId].users[userId];
                        cancelledCount++;
                        updateLiveCounter(eventId);
                    }
                }
                
                if (cancelledCount > 0) await saveDb();
                
                let cancelText = `Ã¢Å“â€¦ Successfully canceled reminders for **${cancelledCount}** event(s).`;
                if (userLocale === 'es') cancelText = `Ã¢Å“â€¦ Se cancelaron con ÃƒÂ©xito los recordatorios para **${cancelledCount}** evento(s).`;
                else if (userLocale === 'de') cancelText = `Ã¢Å“â€¦ Erinnerungen fÃƒÂ¼r **${cancelledCount}** Event(s) erfolgreich abbestellt.`;
                else if (userLocale === 'fr') cancelText = `Ã¢Å“â€¦ Rappels annulÃƒÂ©s avec succÃƒÂ¨s pour **${cancelledCount}** ÃƒÂ©vÃƒÂ©nement(s).`;
                else if (userLocale === 'pt') cancelText = `Ã¢Å“â€¦ Lembretes cancelados com sucesso para **${cancelledCount}** evento(s).`;

                await interaction.editReply({ content: `${interaction.message.content}\n\n${cancelText}`, components: [] });
            }
            return;
        }

        if (interaction.isButton()) {
            if (interaction.customId.startsWith('remind_') || interaction.customId.startsWith('cancel_remind_')) {
                if (!buttonCooldowns.has('remind_btn')) {
                    buttonCooldowns.set('remind_btn', new Collection());
                }

                const now = Date.now();
                const timestamps = buttonCooldowns.get('remind_btn');
                const cooldownAmount = 3000; 
                const userLocale = getNormalizedLocale(interaction.locale);

                if (timestamps.has(interaction.user.id)) {
                    const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;
                    if (now < expirationTime) {
                        const expiredTimestamp = Math.round(expirationTime / 1000);
                        return interaction.reply({ 
                            content: t(userLocale, 'button_cooldown', { time: `<t:${expiredTimestamp}:R>` }), 
                            flags: MessageFlags.Ephemeral 
                        });
                    }
                }
                timestamps.set(interaction.user.id, now);
                setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);
            }

            if (interaction.customId.startsWith('upcoming_page_') || interaction.customId.startsWith('myreminders_page_')) {
                if (!buttonCooldowns.has('pagination')) {
                    buttonCooldowns.set('pagination', new Collection());
                }

                const now = Date.now();
                const timestamps = buttonCooldowns.get('pagination');
                const cooldownAmount = 2000;
                const userLocale = getNormalizedLocale(interaction.locale);

                if (timestamps.has(interaction.user.id)) {
                    const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;
                    if (now < expirationTime) {
                        const expiredTimestamp = Math.round(expirationTime / 1000);
                        return interaction.reply({ 
                            content: `Please wait! You are turning pages too fast. You can use this button again <t:${expiredTimestamp}:R>.`, 
                            flags: MessageFlags.Ephemeral 
                        });
                    }
                }
                timestamps.set(interaction.user.id, now);
                setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);
            }

            const userLocale = getNormalizedLocale(interaction.locale);

            if (interaction.customId === 'mock_remind') {
                return interaction.reply({ content: t(userLocale, 'button_mock_remind'), flags: MessageFlags.Ephemeral });
            }
            if (interaction.customId === 'mock_cancel') {
                return interaction.reply({ content: t(userLocale, 'button_mock_cancel'), flags: MessageFlags.Ephemeral });
            }

            if (interaction.customId.startsWith('upcoming_page_')) {
                await interaction.deferUpdate();
                const page = parseInt(interaction.customId.replace('upcoming_page_', ''), 10);
                const upcomingCmd = require('../commands/upcoming.js');
                const payload = await upcomingCmd.generateUpcomingPage(interaction, page);
                await interaction.editReply(payload);
                return;
            }

            if (interaction.customId.startsWith('myreminders_page_')) {
                await interaction.deferUpdate();
                const page = parseInt(interaction.customId.replace('myreminders_page_', ''), 10);
                const myremindersCmd = require('../commands/myreminders.js');
                const payload = await myremindersCmd.generateMyRemindersPage(interaction, page);
                await interaction.editReply(payload);
                return;
            }

            if (interaction.customId.startsWith('remind_')) {
                const eventId = interaction.customId.replace('remind_', '');
                
                if (eventDb[eventId] && eventDb[eventId].remindersDisabled) {
                    return interaction.reply({ content: t(userLocale, 'button_reminders_disabled'), flags: MessageFlags.Ephemeral });
                }

                const event = await interaction.guild.scheduledEvents.fetch(eventId).catch(() => null);
                if (!event) {
                    return interaction.reply({ content: t(userLocale, 'button_event_not_found'), flags: MessageFlags.Ephemeral });
                }

                if (isEventSilenced(event)) {
                    return interaction.reply({ content: t(userLocale, 'button_reminders_disabled'), flags: MessageFlags.Ephemeral });
                }

                const mode = getAnnouncementMode(interaction.guildId);
                if (mode === 'private' || mode === 'hybrid') {
                    try {
                        const testMsg = await interaction.user.send(t(userLocale, 'button_dm_test'));
                        await testMsg.delete().catch(() => {});
                    } catch (err) {
                        return interaction.reply({ content: t(userLocale, 'button_dm_closed'), flags: MessageFlags.Ephemeral });
                    }
                }

                if (!eventDb[eventId]) {
                    eventDb[eventId] = { users: {} };
                }
                if (!eventDb[eventId].users) {
                    eventDb[eventId].users = {};
                }

                const userId = interaction.user.id;

                let replyMsg = '';
                if (eventDb[eventId].users[userId]) {
                    delete eventDb[eventId].users[userId];
                    replyMsg = t(userLocale, 'remind_removed');
                } else {
                    eventDb[eventId].users[userId] = true;
                    const intervals = getReminderIntervals(interaction.guildId);
                    const intervalsStr = intervals.map(i => `${i.value}${i.unit}`).join(', ');
                    if (mode === 'public') {
                        replyMsg = t(userLocale, 'remind_set_public', { intervals: intervalsStr });
                    } else {
                        replyMsg = t(userLocale, 'remind_set_private', { intervals: intervalsStr });
                    }
                }
                
                await saveDb();
                updateLiveCounter(eventId);
                
                return interaction.reply({ content: replyMsg, flags: MessageFlags.Ephemeral });
            }

    if (interaction.customId.startsWith('cancel_remind_')) {
        const eventId = interaction.customId.replace('cancel_remind_', '');
        
        if (eventDb[eventId]) {
            const users = eventDb[eventId].users || {};
            const userId = interaction.user.id;
            
            try {
                if (users[userId]) {
                    // Check if event is recurring
                    const guildId = eventDb[eventId].guildId;
                    const guild = guildId ? interaction.client.guilds.cache.get(guildId) : null;
                    const event = guild ? await guild.scheduledEvents.fetch(eventId).catch(() => null) : null;
                    
                    if (event && event.recurrenceRule && (event.status === GuildScheduledEventStatus.Scheduled || event.status === GuildScheduledEventStatus.Active)) {
                        // It is a recurring event series! Show interactive prompt
                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`cancel_occ_${eventId}`).setLabel(t(userLocale, 'cancel_button_next')).setStyle(ButtonStyle.Danger),
                            new ButtonBuilder().setCustomId(`cancel_series_${eventId}`).setLabel(t(userLocale, 'cancel_button_series')).setStyle(ButtonStyle.Secondary)
                        );
                        
                        let promptText = `\n\n⚠️ ${t(userLocale, 'cancel_recurring_prompt')}`;
                        let newContent = `${interaction.message.content}${promptText}`;
                        if (newContent.length > 2000) {
                            newContent = `${interaction.message.content.substring(0, 2000 - promptText.length)}...${promptText}`;
                        }
                        await interaction.update({ content: newContent, components: [row] });
                    } else {
                        // Standard event cancellation (or fallback if event fetch fails)
                        delete eventDb[eventId].users[userId];
                        if (eventDb[eventId].skippedUsers) {
                            delete eventDb[eventId].skippedUsers[userId];
                        }
                        await saveDb();
                        updateLiveCounter(eventId); // Fire asynchronously
                        
                        let cancelNotice = `*(${t(userLocale, 'cancel_remind_success')})*`;
                        let newContent = `${interaction.message.content}\n\n${cancelNotice}`;
                        if (newContent.length > 2000) {
                            newContent = `${interaction.message.content.substring(0, 1950)}...\n\n${cancelNotice}`;
                        }
                        await interaction.update({ content: newContent, components: [] });
                    }
                } else {
                    let notOptedNotice = `*(${t(userLocale, 'cancel_remind_not_opted')})*`;
                    let newContent = `${interaction.message.content}\n\n${notOptedNotice}`;
                    if (newContent.length > 2000) {
                        newContent = `${interaction.message.content.substring(0, 1930)}...\n\n${notOptedNotice}`;
                    }
                    await interaction.update({ content: newContent, components: [] });
                }
            } catch (error) {
                console.error('Failed to handle cancel_remind interaction:', error);
            }
        } else {
            let inactiveNotice = `*(${t(userLocale, 'remind_inactive')})*`;
            let newContent = `${interaction.message.content}\n\n${inactiveNotice}`;
            if (newContent.length > 2000) {
                newContent = `${interaction.message.content.substring(0, 1950)}...\n\n${inactiveNotice}`;
            }
            await interaction.update({ content: newContent, components: [] });
        }
    }

    if (interaction.customId.startsWith('cancel_occ_')) {
        const eventId = interaction.customId.replace('cancel_occ_', '');
        if (eventDb[eventId]) {
            const userId = interaction.user.id;
            try {
                const guildId = eventDb[eventId].guildId;
                const guild = guildId ? interaction.client.guilds.cache.get(guildId) : null;
                const event = guild ? await guild.scheduledEvents.fetch(eventId).catch(() => null) : null;
                const startTime = event ? event.scheduledStartTimestamp : Date.now();
                
                if (!eventDb[eventId].skippedUsers) {
                    eventDb[eventId].skippedUsers = {};
                }
                eventDb[eventId].skippedUsers[userId] = startTime;
                await saveDb();
                
                const timeString = getFormattedTimeString(startTime, null, 'f');
                const cancelNotice = t(userLocale, 'cancel_next_success', { time: timeString });
                
                // Remove prompt text and append success notice
                let newContent = interaction.message.content;
                const promptRegex = /\n\n⚠️.*$/;
                newContent = newContent.replace(promptRegex, '');
                newContent = `${newContent}\n\n${cancelNotice}`;
                if (newContent.length > 2000) {
                    newContent = `${newContent.substring(0, 1950)}...\n\n${cancelNotice}`;
                }
                await interaction.update({ content: newContent, components: [] });
            } catch (error) {
                console.error('Failed to handle cancel_occ interaction:', error);
            }
        }
    }

    if (interaction.customId.startsWith('cancel_series_')) {
        const eventId = interaction.customId.replace('cancel_series_', '');
        if (eventDb[eventId]) {
            const userId = interaction.user.id;
            try {
                if (eventDb[eventId].users && eventDb[eventId].users[userId]) {
                    delete eventDb[eventId].users[userId];
                }
                if (eventDb[eventId].skippedUsers) {
                    delete eventDb[eventId].skippedUsers[userId];
                }
                await saveDb();
                updateLiveCounter(eventId); // Fire asynchronously
                
                const cancelNotice = t(userLocale, 'cancel_series_success');
                
                // Remove prompt text and append success notice
                let newContent = interaction.message.content;
                const promptRegex = /\n\n⚠️.*$/;
                newContent = newContent.replace(promptRegex, '');
                newContent = `${newContent}\n\n${cancelNotice}`;
                if (newContent.length > 2000) {
                    newContent = `${newContent.substring(0, 1950)}...\n\n${cancelNotice}`;
                }
                await interaction.update({ content: newContent, components: [] });
            } catch (error) {
                console.error('Failed to handle cancel_series interaction:', error);
            }
        }
    }
        }
        } catch (error) {
            console.error(`Unhandled error for interaction ${interaction?.customId || interaction?.commandName}:`, error);
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'An unexpected error occurred while processing your request.', flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: 'An unexpected error occurred while processing your request.', flags: MessageFlags.Ephemeral });
                }
            } catch (err) {
                // Ignore if we can't send error reply
            }
        }
    }
};