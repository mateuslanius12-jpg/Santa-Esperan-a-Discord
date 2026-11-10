const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType,
  PermissionFlagsBits, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const cfg = require('./config');

const EPH = MessageFlags.Ephemeral;
const TYPES = {
  suporte: { label: 'Suporte', emoji: '🛠️' },
  denuncia: { label: 'Denúncia', emoji: '🚨' },
  vip: { label: 'VIP / Loja', emoji: '💎' },
  outros: { label: 'Outros', emoji: '📩' },
};

function panelPayload() {
  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(`🎫 Atendimento — ${cfg.cityName}`)
    .setDescription('Precisa de ajuda? Escolha o assunto abaixo para abrir um ticket privado com a staff.');
  const row = new ActionRowBuilder().addComponents(
    Object.entries(TYPES).map(([id, t]) =>
      new ButtonBuilder().setCustomId(`ticket:open:${id}`).setLabel(t.label).setEmoji(t.emoji).setStyle(ButtonStyle.Primary)),
  );
  return { embeds: [embed], components: [row] };
}

const isStaff = (i) =>
  (cfg.role.staff && i.member.roles.cache.has(cfg.role.staff)) ||
  i.member.permissions.has(PermissionFlagsBits.ManageGuild);

const openerOf = (channel) => (channel.topic || '').startsWith('ticket:') ? channel.topic.split(':')[1] : null;

async function open(i, typeId) {
  const type = TYPES[typeId] || TYPES.outros;
  const existing = i.guild.channels.cache.find((c) => c.topic === `ticket:${i.user.id}`);
  if (existing) return i.reply({ content: `Você já tem um ticket aberto: ${existing}`, flags: EPH });

  await i.deferReply({ flags: EPH });

  const V = PermissionFlagsBits.ViewChannel;
  const allow = [V, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles];
  const overwrites = [
    { id: i.guild.id, deny: [V] },
    { id: i.user.id, allow },
    { id: i.client.user.id, allow: [...allow, PermissionFlagsBits.ManageChannels] },
  ];
  if (cfg.role.staff) overwrites.push({ id: cfg.role.staff, allow });

  const safeName = i.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || i.user.id;
  const channel = await i.guild.channels.create({
    name: `${typeId}-${safeName}`,
    type: ChannelType.GuildText,
    parent: cfg.ch.ticketCategory || null,
    topic: `ticket:${i.user.id}`,
    permissionOverwrites: overwrites,
  });

  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(`${type.emoji} Ticket — ${type.label}`)
    .setDescription(`Olá <@${i.user.id}>! Descreva seu problema com o máximo de detalhes (e provas, se for denúncia). A staff vai te atender em breve.`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:claim').setLabel('Assumir').setEmoji('✋').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Fechar').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
  await channel.send({
    content: `<@${i.user.id}>${cfg.role.staff ? ` <@&${cfg.role.staff}>` : ''}`,
    embeds: [embed],
    components: [row],
  });
  return i.editReply({ content: `✅ Ticket criado: ${channel}` });
}

async function close(i) {
  const opener = openerOf(i.channel);
  if (!opener) return i.reply({ content: 'Isto não é um ticket.', flags: EPH });
  if (!isStaff(i) && i.user.id !== opener) return i.reply({ content: 'Sem permissão.', flags: EPH });

  await i.reply('🔒 Fechando o ticket em 5 segundos…');

  // transcrição simples (últimas 100 mensagens)
  if (cfg.ch.ticketLogs) {
    const logCh = await i.client.channels.fetch(cfg.ch.ticketLogs).catch(() => null);
    if (logCh) {
      const msgs = await i.channel.messages.fetch({ limit: 100 }).catch(() => null);
      const lines = msgs
        ? [...msgs.values()].reverse().map((m) =>
            `[${m.createdAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] ${m.author.username}: ${m.content || (m.embeds.length ? '[embed]' : '')}`)
        : [];
      const file = new AttachmentBuilder(Buffer.from(lines.join('\n') || 'sem mensagens', 'utf8'), { name: `${i.channel.name}.txt` });
      const embed = new EmbedBuilder()
        .setColor(0x6b7280)
        .setTitle('🎫 Ticket fechado')
        .setDescription(`**Canal:** ${i.channel.name}\n**Aberto por:** <@${opener}>\n**Fechado por:** <@${i.user.id}>`)
        .setTimestamp();
      await logCh.send({ embeds: [embed], files: [file] }).catch(() => {});
    }
  }

  setTimeout(() => i.channel.delete().catch(() => {}), 5000);
}

async function handle(i) {
  const [, action, arg] = i.customId.split(':');
  if (action === 'open') return open(i, arg);
  if (action === 'close') return close(i);
  if (action === 'claim') {
    if (!isStaff(i)) return i.reply({ content: 'Só a staff pode assumir.', flags: EPH });
    return i.reply({ embeds: [new EmbedBuilder().setColor(0x22c55e).setDescription(`✋ <@${i.user.id}> assumiu este ticket.`)] });
  }
}

module.exports = { handle, panelPayload };
