const { Events, Collection, MessageFlags } = require('discord.js');
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
                
                let successText = `✅ Successfully opted in to **${optedInCount}** event(s)!\n*${mode === 'public' ? 'You will be pinged in the announcement channel' : 'I will DM you'} at: ${intervalsStr} before they begin.*`;
                if (userLocale === 'es') successText = `✅ ¡Te has inscrito con éxito en **${optedInCount}** evento(s)!\n*${mode === 'public' ? 'Se te mencionará en el canal de anuncios' : 'Te enviaré un mensaje directo'}: ${intervalsStr} antes de que comiencen.*`;
                else if (userLocale === 'de') successText = `✅ Erfolgreich für **${optedInCount}** Event(s) angemeldet!\n*${mode === 'public' ? 'Du wirst im Ankündigungskanal benachrichtigt' : 'Ich werde dir eine DM senden'}: ${intervalsStr} bevor sie beginnen.*`;
                else if (userLocale === 'fr') successText = `✅ Inscrit avec succès à **${optedInCount}** événement(s) !\n*${mode === 'public' ? 'Vous serez mentionné dans le salon d\'annonces' : 'Je vous enverrai un DM'} : ${intervalsStr} avant qu'ils ne commencent.*`;
                else if (userLocale === 'pt') successText = `✅ Inscrito com sucesso em **${optedInCount}** evento(s)!\n*${mode === 'public' ? 'Você será mencionado no canal de anúncios' : 'Eu lhe enviarei uma DM'}: ${intervalsStr} antes de começarem.*`;

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
                
                let cancelText = `✅ Successfully canceled reminders for **${cancelledCount}** event(s).`;
                if (userLocale === 'es') cancelText = `✅ Se cancelaron con éxito los recordatorios para **${cancelledCount}** evento(s).`;
                else if (userLocale === 'de') cancelText = `✅ Erinnerungen für **${cancelledCount}** Event(s) erfolgreich abbestellt.`;
                else if (userLocale === 'fr') cancelText = `✅ Rappels annulés avec succès pour **${cancelledCount}** événement(s).`;
                else if (userLocale === 'pt') cancelText = `✅ Lembretes cancelados com sucesso para **${cancelledCount}** evento(s).`;

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

                if (eventDb[eventId].users[userId]) {
                    return interaction.reply({ content: t(userLocale, 'button_already_opted_in'), flags: MessageFlags.Ephemeral });
                }

                eventDb[eventId].users[userId] = true;
                await saveDb();

                updateLiveCounter(eventId);

                const intervals = getReminderIntervals(interaction.guildId);
                const intervalsStr = intervals.map(i => `${i.value}${i.unit}`).join(', ');

                let replyMsg = '';
                if (mode === 'public') {
                    replyMsg = t(userLocale, 'button_success_public', { name: event.name, intervals: intervalsStr });
                } else if (mode === 'private') {
                    replyMsg = t(userLocale, 'button_success_private', { name: event.name, intervals: intervalsStr });
                } else {
                    replyMsg = t(userLocale, 'button_success_hybrid', { name: event.name, intervals: intervalsStr });
                }

                return interaction.reply({ content: replyMsg, flags: MessageFlags.Ephemeral });
            }

            if (interaction.customId.startsWith('cancel_remind_')) {
                const eventId = interaction.customId.replace('cancel_remind_', '');

                if (!eventDb[eventId] || !eventDb[eventId].users || !eventDb[eventId].users[interaction.user.id]) {
                    return interaction.reply({ content: t(userLocale, 'button_not_opted_in'), flags: MessageFlags.Ephemeral });
                }

                delete eventDb[eventId].users[interaction.user.id];
                await saveDb();

                updateLiveCounter(eventId);

                const event = await interaction.guild.scheduledEvents.fetch(eventId).catch(() => null);
                const eventName = event ? event.name : 'Unknown Event';

                return interaction.reply({ content: t(userLocale, 'button_cancel_success', { name: eventName }), flags: MessageFlags.Ephemeral });
            }
        }
    }
};
