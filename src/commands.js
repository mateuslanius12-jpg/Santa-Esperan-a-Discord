const {
  SlashCommandBuilder, REST, Routes, ChannelType, PermissionFlagsBits,
} = require('discord.js');
const cfg = require('./config');

const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const embed = new SlashCommandBuilder()
  .setName('embed')
  .setDescription('Cria um embed personalizado enviado pelo bot')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((o) => o.setName('canal').setDescription('Canal onde o embed será enviado').addChannelTypes(...TEXT_TYPES).setRequired(true))
  .addStringOption((o) => o.setName('titulo').setDescription('Título do embed').setMaxLength(256))
  .addStringOption((o) => o.setName('texto').setDescription('Texto (use \\n para pular linha)').setMaxLength(4000))
  .addStringOption((o) => o.setName('cor').setDescription('Cor: #ff0000 ou vermelho, azul, verde, amarelo, roxo...').setMaxLength(20))
  .addAttachmentOption((o) => o.setName('foto').setDescription('Imagem grande (envie do seu computador)'))
  .addStringOption((o) => o.setName('imagem_url').setDescription('Imagem grande por link'))
  .addStringOption((o) => o.setName('thumbnail_url').setDescription('Imagem pequena (canto) por link'))
  .addStringOption((o) => o.setName('rodape').setDescription('Texto do rodapé').setMaxLength(2048));

for (let n = 1; n <= 3; n++) {
  embed
    .addStringOption((o) => o.setName(`botao${n}_texto`).setDescription(`Botão ${n}: texto`).setMaxLength(80))
    .addChannelOption((o) => o.setName(`botao${n}_canal`).setDescription(`Botão ${n}: leva para este canal`).addChannelTypes(...TEXT_TYPES, ChannelType.GuildForum, ChannelType.GuildVoice))
    .addStringOption((o) => o.setName(`botao${n}_link`).setDescription(`Botão ${n}: ou leva para este link`));
}

const painel = new SlashCommandBuilder()
  .setName('painel')
  .setDescription('Posta um painel neste canal (WL, tickets ou registro)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((o) =>
    o.setName('tipo').setDescription('Qual painel').setRequired(true)
      .addChoices({ name: 'Whitelist (WL)', value: 'wl' }, { name: 'Tickets', value: 'ticket' }, { name: 'Registro de nome', value: 'registro' }));

async function register() {
  const rest = new REST({ version: '10' }).setToken(cfg.token);
  await rest.put(Routes.applicationGuildCommands(cfg.clientId, cfg.guildId), {
    body: [embed.toJSON(), painel.toJSON()],
  });
  console.log('Comandos registrados.');
}

module.exports = { register };
