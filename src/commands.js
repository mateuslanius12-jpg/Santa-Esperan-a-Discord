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

const eleicaoOpt = (o) => o.setName('eleicao').setDescription('Qual eleição').setAutocomplete(true).setRequired(true);

const urna = new SlashCommandBuilder()
  .setName('urna')
  .setDescription('Urna de votação (eleição)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('criar').setDescription('Cria uma eleição')
    .addChannelOption((o) => o.setName('canal').setDescription('Canal onde a urna será publicada').addChannelTypes(...TEXT_TYPES).setRequired(true))
    .addChannelOption((o) => o.setName('canal_resultado').setDescription('Canal do resultado (padrão: o mesmo da urna)').addChannelTypes(...TEXT_TYPES)))
  .addSubcommand((s) => s.setName('editar').setDescription('Edita título, descrição, cor, candidatos e botões').addStringOption(eleicaoOpt))
  .addSubcommand((s) => s.setName('horario').setDescription('Muda o dia e a hora da publicação do resultado')
    .addStringOption(eleicaoOpt)
    .addStringOption((o) => o.setName('data').setDescription('Ex: 11/11/2026 20:00 (horário de Brasília)').setRequired(true)))
  .addSubcommand((s) => s.setName('encerrar').setDescription('Encerra agora e publica o resultado').addStringOption(eleicaoOpt))
  .addSubcommand((s) => s.setName('lista').setDescription('Lista as eleições'))
  .addSubcommand((s) => s.setName('excluir').setDescription('Remove uma eleição').addStringOption(eleicaoOpt));

async function register() {
  const rest = new REST({ version: '10' }).setToken(cfg.token);
  await rest.put(Routes.applicationGuildCommands(cfg.clientId, cfg.guildId), {
    body: [embed.toJSON(), painel.toJSON(), urna.toJSON()],
  });
  console.log('Comandos registrados.');
}

module.exports = { register };
