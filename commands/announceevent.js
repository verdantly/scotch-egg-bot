const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { t, getNormalizedLocale } = require('../i18n.js');
const { eventDb } = require('../storage.js');
const { getAnnouncementChannelId } = require('../services/config.js');
const { postAnnouncement } = require('../services/announcements.js');

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
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const userLocale = getNormalizedLocale(interaction.locale);

        const eventIdentifier = interaction.options.getString('event_link_or_id');
        const match = eventIdentifier.match(/(?:\/events\/\d+\/)?(\d{17,19})/);
        const eventId = match ? match[1] : null;

        if (!eventId) {
            return interaction.editReply({ content: t(userLocale, 'announce_invalid_id') });
        }

        if (eventDb[eventId]) {
            return interaction.editReply({ content: t(userLocale, 'announce_already_posted') });
        }

        const event = await interaction.guild.scheduledEvents.fetch(eventId).catch(() => null);
        if (!event) {
            return interaction.editReply({ content: t(userLocale, 'announce_not_found') });
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
            await interaction.editReply({ content: t(userLocale, 'announce_success', { name: event.name }) });
        } catch (err) {
            await interaction.editReply({ content: t(userLocale, 'announce_error') });
        }
    }
};
