const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const { PermissionFlagsBits } = require('discord-api-types/v10');
require('dotenv').config();

if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
    console.error('FATAL ERROR: DISCORD_TOKEN and CLIENT_ID must be defined in your .env file.');
    process.exit(1);
}

const commands = [
    new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('Sets the channel for event announcements and reminders.')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The text channel to use for announcements')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // Only admins can use this
    new SlashCommandBuilder()
        .setName('checkchannel')
        .setDescription('Checks the currently configured channel for event announcements.'),
    new SlashCommandBuilder()
        .setName('announceevent')
        .setDescription('Manually posts an announcement for an existing event.')
        .addStringOption(option =>
            option.setName('event_link_or_id')
                .setDescription('The link to the event or its ID')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    console.log('Started refreshing application (/) commands.');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('Successfully reloaded application (/) commands.');
})();