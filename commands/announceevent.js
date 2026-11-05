const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, GuildScheduledEventStatus } = require('discord.js');
const { t, getNormalizedLocale } = require('../i18n.js');
const { eventDb } = require('../storage.js');
const { getAnnouncementChannelId, isEventSilenced } = require('../services/config.js');
const { postAnnouncement } = require('../services/announcements.js');
const { scheduleRemindersForEvent } = require('../services/reminders.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('announceevent')
        .setNameLocalizations({
            'es-ES': 'anunciarevento',
            'de': 'eventankundigen',
            'fr': 'annoncerevenement',
            'pt-BR': 'anunciarevento'
        })
        .setDescription('Manually posts an announcement for an existing event.')
        .setDescriptionLocalizations({
            'es-ES': 'Publica manualmente un anuncio para un evento existente.',
            'de': 'Postet manuell eine Ankündigung für ein existierendes Event.',
            'fr': 'Poste manuellement une annonce pour un événement existant.',
            'pt-BR': 'Publica manualmente um anúncio para um evento existente.'
        })
        .addStringOption(option =>
            option.setName('event_link_or_id')
                .setNameLocalizations({
                    'es-ES': 'enlace_o_id_del_evento',
                    'de': 'event_link_oder_id',
                    'fr': 'lien_ou_id_de_evenement',
                    'pt-BR': 'link_ou_id_do_evento'
                })
                .setDescription('The link to the event or its ID')
                .setDescriptionLocalizations({
                    'es-ES': 'El enlace al evento o su ID',
                    'de': 'Der Link zum Event oder seine ID',
                    'fr': 'Le lien vers l\'événement ou son ID',
                    'pt-BR': 'O link para o evento ou o ID dele'
                })
                .setRequired(true)
                .setAutocomplete(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),
    async autocomplete(interaction) {
        try {
            const focusedValue = (interaction.options.getFocused() || '').toLowerCase();
            let events = interaction.guild?.scheduledEvents?.cache;
            if (!events || events.size === 0) {
                events = await interaction.guild.scheduledEvents.fetch().catch(() => null);
            }
            if (!events) return interaction.respond([]);

            const choices = Array.from(events.values())
                .filter(e => e.status === GuildScheduledEventStatus.Scheduled || e.status === GuildScheduledEventStatus.Active || e.status === 1 || e.status === 2)
                .filter(e => !(eventDb[e.id] && eventDb[e.id].messageId))
                .sort((a, b) => (a.scheduledStartTimestamp || 0) - (b.scheduledStartTimestamp || 0))
                .map(e => {
                    const dateStr = e.scheduledStartTimestamp ? new Date(e.scheduledStartTimestamp).toISOString().slice(0, 10) : '';
                    const label = dateStr ? `${e.name} (${dateStr})` : e.name;
                    return { name: label.substring(0, 100), value: e.id };
                })
                .filter(c => c.name.toLowerCase().includes(focusedValue) || c.value.includes(focusedValue))
                .slice(0, 25);

            await interaction.respond(choices);
        } catch (err) {
            await interaction.respond([]).catch(() => {});
        }
    },
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const userLocale = getNormalizedLocale(interaction.locale);

        const eventIdentifier = interaction.options.getString('event_link_or_id');
        const match = eventIdentifier.match(/(?:\/events\/\d+\/)?(\d{17,19})/);
        const eventId = match ? match[1] : null;

        if (!eventId) {
            return interaction.editReply({ content: t(userLocale, 'announce_invalid_id') });
        }

        if (eventDb[eventId] && eventDb[eventId].messageId) {
            return interaction.editReply({ content: t(userLocale, 'announce_already_posted') });
        }

        const event = await interaction.guild.scheduledEvents.fetch(eventId).catch(() => null);
        if (!event) {
            return interaction.editReply({ content: t(userLocale, 'announce_not_found') });
        }

        if (event.status === GuildScheduledEventStatus.Completed || event.status === GuildScheduledEventStatus.Canceled) {
            return interaction.editReply({ content: t(userLocale, 'remind_inactive') });
        }

        const channelId = getAnnouncementChannelId(interaction.guildId);
        const channel = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : null;
        if (!channel) {
            return interaction.editReply({ content: t(userLocale, 'announce_no_channel') });
        }

        const botPermissions = channel.permissionsFor(interaction.guild.members.me);
        if (!botPermissions.has(PermissionFlagsBits.ViewChannel) || !botPermissions.has(PermissionFlagsBits.SendMessages) || !botPermissions.has(PermissionFlagsBits.EmbedLinks)) {
            return interaction.editReply({ content: t(userLocale, 'settings_bot_no_permissions', { channel: channel.toString() }) });
        }

        try {
            await postAnnouncement(event, channel);
            if (!isEventSilenced(event)) {
                scheduleRemindersForEvent(event);
            }
            await interaction.editReply({ content: t(userLocale, 'announce_success', { name: event.name }) });
        } catch (err) {
            await interaction.editReply({ content: t(userLocale, 'announce_error') });
        }
    }
};
