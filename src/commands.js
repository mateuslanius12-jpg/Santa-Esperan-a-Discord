const {
  SlashCommandBuilder, REST, Routes, ChannelType, PermissionFlagsBits,
} = require('discord.js');
const cfg = require('./config');

const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
// /embed também aceita fórum (cria uma postagem nova) e postagens/tópicos já existentes
const EMBED_TYPES = [...TEXT_TYPES, ChannelType.GuildForum, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread];

const embed = new SlashCommandBuilder()
  .setName('embed')
  .setDescription('Cria um embed personalizado enviado pelo bot')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((o) => o.setName('canal').setDescription('Canal, fórum (cria postagem) ou postagem onde o embed será enviado').addChannelTypes(...EMBED_TYPES).setRequired(true))
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
    .addChannelOption((o) => o.setName(`botao${n}_canal`).setDescription(`Botão ${n}: leva para este canal`).addChannelTypes(...EMBED_TYPES, ChannelType.GuildVoice))
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

const tipoOpt = (o) => o.setName('tipo').setDescription('Prefeito ou vice-prefeito (padrão: prefeito)')
  .addChoices({ name: 'Prefeito', value: 'prefeito' }, { name: 'Vice-prefeito', value: 'vice' });

const eleicaoOpt2 = (o) => o.setName('eleicao').setDescription('Qual eleição').setAutocomplete(true).setRequired(true);

const eleicao = new SlashCommandBuilder()
  .setName('eleicao')
  .setDescription('Eleição para prefeito (candidatura + votação)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('criar').setDescription('Cria a eleição (prefeito ou vice) e o painel de candidatura')
    .addStringOption((o) => o.setName('titulo').setDescription('Ex: Eleição para Prefeito').setMaxLength(100).setRequired(true))
    .addChannelOption((o) => o.setName('canal_candidatura').setDescription('Canal do painel de candidatura').addChannelTypes(...TEXT_TYPES).setRequired(true))
    .addChannelOption((o) => o.setName('canal_votacao').setDescription('Canal onde o painel de votar vai aparecer').addChannelTypes(...TEXT_TYPES).setRequired(true))
    .addIntegerOption((o) => o.setName('vagas').setDescription('Quantas vagas de candidato (2 a 6)').setMinValue(2).setMaxValue(6).setRequired(true))
    .addStringOption((o) => o.setName('espera').setDescription('Tempo entre fechar a candidatura e abrir a votação. Ex: 2h, 30m, 0').setRequired(true))
    .addStringOption((o) => o.setName('duracao').setDescription('Quanto tempo a votação fica aberta. Ex: 24h, 12h, 1d').setRequired(true))
    .addChannelOption((o) => o.setName('canal_resultado').setDescription('Canal do resultado (padrão: o da votação)').addChannelTypes(...TEXT_TYPES))
    .addStringOption((o) => o.setName('prazo_candidatura').setDescription('Opcional: fecha a candidatura nesta data. Ex: 15/11/2026 20:00'))
    .addStringOption((o) => o.setName('cor').setDescription('Cor do embed. Ex: #0dcbff').setMaxLength(20))
    .addStringOption((o) => o.setName('descricao').setDescription('Texto no topo dos painéis').setMaxLength(1000))
    .addStringOption(tipoOpt))
  .addSubcommand((s) => s.setName('ajustar').setDescription('Muda vagas, tempos, prazo, título, cor ou descrição')
    .addStringOption(eleicaoOpt2)
    .addIntegerOption((o) => o.setName('vagas').setDescription('Novas vagas (2 a 6)').setMinValue(2).setMaxValue(6))
    .addStringOption((o) => o.setName('espera').setDescription('Nova espera. Ex: 2h'))
    .addStringOption((o) => o.setName('duracao').setDescription('Nova duração da votação. Ex: 24h'))
    .addStringOption((o) => o.setName('prazo_candidatura').setDescription('Novo prazo (15/11/2026 20:00) ou nenhum'))
    .addStringOption((o) => o.setName('titulo').setDescription('Novo título').setMaxLength(100))
    .addStringOption((o) => o.setName('cor').setDescription('Nova cor').setMaxLength(20))
    .addStringOption((o) => o.setName('descricao').setDescription('Nova descrição').setMaxLength(1000)))
  .addSubcommand((s) => s.setName('fechar_candidatura').setDescription('Encerra a candidatura agora').addStringOption(eleicaoOpt2))
  .addSubcommand((s) => s.setName('abrir_votacao').setDescription('Abre a votação agora (pula a espera)').addStringOption(eleicaoOpt2))
  .addSubcommand((s) => s.setName('encerrar').setDescription('Encerra a votação agora e publica o resultado').addStringOption(eleicaoOpt2))
  .addSubcommand((s) => s.setName('cancelar').setDescription('Cancela a eleição').addStringOption(eleicaoOpt2))
  .addSubcommand((s) => s.setName('remover').setDescription('Remove um candidato (antes da votação)')
    .addStringOption(eleicaoOpt2)
    .addIntegerOption((o) => o.setName('numero').setDescription('Número do candidato').setRequired(true)))
  .addSubcommand((s) => s.setName('vencedor').setDescription('Define o vencedor após empate ou sem votos')
    .addStringOption(eleicaoOpt2)
    .addIntegerOption((o) => o.setName('numero').setDescription('Número do candidato vencedor').setRequired(true)))
  .addSubcommand((s) => s.setName('lista').setDescription('Lista as eleições'))
  .addSubcommand((s) => s.setName('historico_ver').setDescription('Mostra o histórico de prefeitos/vices').addStringOption(tipoOpt))
  .addSubcommand((s) => s.setName('historico_add').setDescription('Registra um prefeito de antes do bot')
    .addUserOption((o) => o.setName('usuario').setDescription('Quem foi prefeito').setRequired(true))
    .addIntegerOption((o) => o.setName('mandatos').setDescription('Mandatos seguidos até agora (1 ou 2)').setMinValue(1).setMaxValue(2).setRequired(true))
    .addStringOption(tipoOpt))
  .addSubcommand((s) => s.setName('historico_limpar').setDescription('Apaga o histórico de prefeitos/vices').addStringOption(tipoOpt));

async function register() {
  const rest = new REST({ version: '10' }).setToken(cfg.token);
  await rest.put(Routes.applicationGuildCommands(cfg.clientId, cfg.guildId), {
    body: [embed.toJSON(), painel.toJSON(), urna.toJSON(), eleicao.toJSON()],
  });
  console.log('Comandos registrados.');
}

module.exports = { register };
