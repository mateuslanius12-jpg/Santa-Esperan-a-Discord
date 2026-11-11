// Urna de votação (eleição para prefeito etc.)
// - Voto secreto, 1 voto por cidadão.
// - Dados guardados num canal privado do próprio Discord (o disco do Render grátis é apagado ao reiniciar).
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  AttachmentBuilder, ChannelType, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const cfg = require('./config');

const EPH = MessageFlags.Ephemeral;
const STORE_NAME = 'urna-sistema';

const elections = new Map(); // id -> { cfg, storeMsgId, voters:Set, counts:number[] }
const publishing = new Set();
let store = null;
let client = null;

/* ------------------------------------------------------------------ utilitários */
const NAMED = {
  vermelho: 0xe11d2e, azul: 0x3b82f6, ciano: 0x0dcbff, verde: 0x22c55e, amarelo: 0xeab308, laranja: 0xf97316,
  roxo: 0x8b5cf6, rosa: 0xec4899, preto: 0x111111, branco: 0xffffff, cinza: 0x6b7280,
};

function parseColor(input) {
  if (!input || !input.trim()) return cfg.color;
  const k = input.trim().toLowerCase();
  if (NAMED[k] !== undefined) return NAMED[k];
  const hex = k.replace('#', '');
  return /^[0-9a-f]{6}$/.test(hex) ? parseInt(hex, 16) : null;
}

// "11/11/2026 20:00" (horário de Brasília, UTC-3) -> Date
function parseDate(str) {
  const m = (str || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})[\sàs,]+(\d{1,2})[:h](\d{2})$/i);
  if (!m) return null;
  let [, d, mo, y, h, mi] = m;
  d = +d; mo = +mo; y = +y; h = +h; mi = +mi;
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, mo - 1, d, h + 3, mi));
  const chk = new Date(date.getTime() - 3 * 3600 * 1000);
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d || h > 23 || mi > 59) return null;
  return date;
}

function brt(date) {
  const x = new Date(date.getTime() - 3 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(x.getUTCDate())}/${p(x.getUTCMonth() + 1)}/${x.getUTCFullYear()} ${p(x.getUTCHours())}:${p(x.getUTCMinutes())}`;
}

const ts = (date) => Math.floor(date.getTime() / 1000);

// Cada linha: Nome | Descrição | Texto do botão
function parseCandidates(text) {
  const out = [];
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const [name, desc, label] = line.split('|').map((s) => s.trim());
    if (!name) return { error: 'Tem uma linha de candidato sem nome.' };
    out.push({
      name: name.slice(0, 60),
      desc: (desc || '').slice(0, 300),
      label: (label || `Votar em ${name}`).slice(0, 80),
    });
  }
  if (out.length < 2 || out.length > 10) return { error: 'Coloque de 2 a 10 candidatos (um por linha).' };
  return { candidates: out };
}

const candidatesToText = (list) => list.map((c) => `${c.name} | ${c.desc} | ${c.label}`).join('\n');
const newId = () => Math.random().toString(36).slice(2, 8);
const totalVotes = (e) => e.counts.reduce((a, b) => a + b, 0);
const isStaff = (i) =>
  (cfg.role.staff && i.member.roles.cache.has(cfg.role.staff)) ||
  i.member.permissions.has(PermissionFlagsBits.ManageGuild);

/* ------------------------------------------------------------------ armazenamento (canal privado) */
async function ensureStore(guild) {
  await guild.channels.fetch();
  let ch = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === STORE_NAME);
  if (!ch) {
    ch = await guild.channels.create({
      name: STORE_NAME,
      type: ChannelType.GuildText,
      topic: 'Dados da urna. NÃO apague nem escreva aqui.',
      permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }],
    });
  }
  return ch;
}

async function fetchAll(ch) {
  const all = [];
  let before;
  for (;;) {
    const batch = await ch.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return all.reverse(); // do mais antigo para o mais novo
}

async function loadAll() {
  elections.clear();
  const msgs = await fetchAll(store);
  const pendVoters = new Map();
  const pendCounts = new Map();
  const configs = new Map();

  for (const m of msgs) {
    const parts = m.content.split('|');
    if (parts[0] === 'ELEICAO') {
      const att = m.attachments.first();
      if (!att) continue;
      try {
        const data = await (await fetch(att.url)).json();
        configs.set(parts[1], { cfg: data, storeMsgId: m.id });
      } catch (err) {
        console.error('Urna: não consegui ler a eleição', parts[1], err.message);
      }
    } else if (parts[0] === 'ELEITOR') {
      if (!pendVoters.has(parts[1])) pendVoters.set(parts[1], new Set());
      pendVoters.get(parts[1]).add(parts[2]);
    } else if (parts[0] === 'VOTO') {
      if (!pendCounts.has(parts[1])) pendCounts.set(parts[1], new Map());
      const mp = pendCounts.get(parts[1]);
      mp.set(+parts[2], (mp.get(+parts[2]) || 0) + 1);
    }
  }

  for (const [id, c] of configs) {
    const counts = c.cfg.candidates.map((_, idx) => (pendCounts.get(id) && pendCounts.get(id).get(idx)) || 0);
    elections.set(id, { cfg: c.cfg, storeMsgId: c.storeMsgId, voters: pendVoters.get(id) || new Set(), counts });
  }
  console.log(`Urna: ${elections.size} eleição(ões) carregada(s).`);
}

async function save(e) {
  const att = new AttachmentBuilder(Buffer.from(JSON.stringify(e.cfg), 'utf8'), { name: `eleicao-${e.cfg.id}.json` });
  const msg = await store.send({ content: `ELEICAO|${e.cfg.id}`, files: [att] });
  const old = e.storeMsgId;
  e.storeMsgId = msg.id;
  if (old) store.messages.delete(old).catch(() => {});
}

/* ------------------------------------------------------------------ mensagens públicas */
function publicPayload(e, closed = false) {
  const c = e.cfg;
  const when = new Date(c.publishAt);
  const lines = [];
  if (c.description) lines.push(c.description, '');
  lines.push(closed ? '🔒 **Votação encerrada.**' : `⏰ Resultado: <t:${ts(when)}:F> (<t:${ts(when)}:R>)`);
  lines.push('🔐 Voto secreto — 1 voto por cidadão.');

  const embed = new EmbedBuilder()
    .setColor(c.color)
    .setTitle(`🗳️ ${c.title}`)
    .setDescription(lines.join('\n'))
    .addFields(c.candidates.map((k, i) => ({ name: `${i + 1}. ${k.name}`, value: k.desc || '—' })))
    .setFooter({ text: `Eleição ${c.id}` });

  const rows = [];
  for (let n = 0; n < c.candidates.length; n += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      c.candidates.slice(n, n + 5).map((k, j) =>
        new ButtonBuilder().setCustomId(`urna:v:${c.id}:${n + j}`).setLabel(k.label).setStyle(ButtonStyle.Primary).setDisabled(closed)),
    ));
  }
  return { embeds: [embed], components: rows };
}

async function refreshPublic(e, closed = false) {
  const c = e.cfg;
  const ch = await client.channels.fetch(c.channelId).catch(() => null);
  if (!ch) return;
  const msg = c.messageId ? await ch.messages.fetch(c.messageId).catch(() => null) : null;
  if (msg) {
    await msg.edit(publicPayload(e, closed)).catch(() => {});
  } else if (!closed) {
    const sent = await ch.send(publicPayload(e)).catch(() => null);
    if (sent) c.messageId = sent.id;
  }
}

/* ------------------------------------------------------------------ votar */
async function vote(i, id, idx) {
  const e = elections.get(id);
  if (!e || e.cfg.status !== 'aberta' || Date.now() >= new Date(e.cfg.publishAt).getTime()) {
    return i.reply({ content: '🔒 Esta votação já foi encerrada.', flags: EPH });
  }
  if (cfg.role.cidadao && !i.member.roles.cache.has(cfg.role.cidadao)) {
    return i.reply({ content: 'Só cidadãos (quem já passou na WL) podem votar.', flags: EPH });
  }
  if (e.voters.has(i.user.id)) {
    return i.reply({ content: 'Você já votou nesta eleição. Cada cidadão tem 1 voto.', flags: EPH });
  }
  const cand = e.cfg.candidates[idx];
  if (!cand) return i.reply({ content: 'Opção inválida.', flags: EPH });

  e.voters.add(i.user.id); // marca na hora (evita voto duplo por clique rápido)
  await i.deferReply({ flags: EPH });
  try {
    await store.send(`ELEITOR|${id}|${i.user.id}`);
    try {
      await store.send(`VOTO|${id}|${idx}`);
    } catch {
      await store.send(`VOTO|${id}|${idx}`); // uma nova tentativa
    }
    e.counts[idx] += 1;
  } catch (err) {
    console.error('Urna: falha ao registrar voto', err);
    e.voters.delete(i.user.id);
    return i.editReply('❌ Não consegui registrar o seu voto. Tente novamente.');
  }
  return i.editReply(`✅ Voto registrado em **${cand.name}**. Seu voto é secreto.`);
}

/* ------------------------------------------------------------------ apuração */
async function publish(e) {
  const c = e.cfg;
  if (publishing.has(c.id)) return;
  publishing.add(c.id);
  try {
    const total = totalVotes(e);
    const max = Math.max(...e.counts);
    const winners = max > 0 ? c.candidates.filter((_, i) => e.counts[i] === max) : [];
    const order = c.candidates.map((k, i) => ({ k, v: e.counts[i] })).sort((a, b) => b.v - a.v);
    const medals = ['🥇', '🥈', '🥉'];

    const rows = order.map((o, n) => {
      const pct = total ? Math.round((o.v / total) * 100) : 0;
      const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
      return `${medals[n] || '▫️'} **${o.k.name}**\n${bar} **${o.v}** voto${o.v === 1 ? '' : 's'} (${pct}%)`;
    });

    let verdict;
    if (!total) verdict = 'Nenhum voto foi registrado.';
    else if (winners.length === 1) verdict = `🏆 **${winners[0].name}** venceu com **${max}** voto${max === 1 ? '' : 's'}!`;
    else verdict = `🤝 **Empate** entre ${winners.map((w) => `**${w.name}**`).join(' e ')}, com ${max} voto${max === 1 ? '' : 's'} cada.`;

    const embed = new EmbedBuilder()
      .setColor(c.color)
      .setTitle(`📊 Resultado — ${c.title}`)
      .setDescription(`${verdict}\n\n${rows.join('\n\n')}\n\n🗳️ Total de votos: **${total}**`)
      .setFooter({ text: `Eleição ${c.id}` })
      .setTimestamp();

    const ch = await client.channels.fetch(c.resultChannelId || c.channelId).catch(() => null);
    if (ch) await ch.send({ embeds: [embed] }).catch((err) => console.error('Urna: erro ao postar resultado', err.message));
    else console.error('Urna: canal de resultado não encontrado para', c.id);

    c.status = 'encerrada';
    c.closedAt = new Date().toISOString();
    await refreshPublic(e, true);
    await save(e);
  } finally {
    publishing.delete(c.id);
  }
}

async function tick() {
  for (const e of elections.values()) {
    if (e.cfg.status === 'aberta' && Date.now() >= new Date(e.cfg.publishAt).getTime()) {
      await publish(e).catch((err) => console.error('Urna: erro ao publicar', err));
    }
  }
}

/* ------------------------------------------------------------------ formulário */
function buildModal(customId, c) {
  const title = c ? 'Editar eleição' : 'Nova eleição';
  const input = (id, label, style, max, req, ph, value) => {
    const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(max).setRequired(req);
    if (ph) t.setPlaceholder(ph);
    if (value) t.setValue(value);
    return new ActionRowBuilder().addComponents(t);
  };
  return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(
    input('titulo', 'Título', TextInputStyle.Short, 100, true, 'Eleição para Prefeito', c && c.title),
    input('descricao', 'Descrição (opcional)', TextInputStyle.Paragraph, 1000, false, 'Texto que aparece no topo da urna', c && c.description),
    input('cor', 'Cor do embed (opcional)', TextInputStyle.Short, 20, false, '#0dcbff ou azul', c && '#' + c.color.toString(16).padStart(6, '0')),
    input('data', 'Resultado em (dia e hora de Brasília)', TextInputStyle.Short, 20, true, '11/11/2026 20:00', c && brt(new Date(c.publishAt))),
    input('candidatos', 'Candidatos (Nome | Descrição | Botão)', TextInputStyle.Paragraph, 4000, true,
      'João Silva | Plano para a cidade | Votar no João\nMaria Souza | Plano de segurança | Votar na Maria', c && candidatesToText(c.candidates)),
  );
}

function readModal(i) {
  const titulo = i.fields.getTextInputValue('titulo').trim();
  const descricao = (i.fields.getTextInputValue('descricao') || '').trim();
  const cor = parseColor(i.fields.getTextInputValue('cor'));
  const data = parseDate(i.fields.getTextInputValue('data'));
  const cands = parseCandidates(i.fields.getTextInputValue('candidatos'));
  if (cor === null) return { error: '❌ Cor inválida. Use um hex (`#0dcbff`) ou: ' + Object.keys(NAMED).join(', ') };
  if (!data) return { error: '❌ Data inválida. Use o formato `11/11/2026 20:00` (horário de Brasília).' };
  if (cands.error) return { error: `❌ ${cands.error}` };
  return { titulo, descricao, cor, data, candidates: cands.candidates };
}

async function submitCreate(i) {
  const [, , canalId, resId] = i.customId.split(':');
  const r = readModal(i);
  if (r.error) return i.reply({ content: r.error, flags: EPH });
  if (r.data.getTime() <= Date.now()) return i.reply({ content: '❌ Essa data já passou. Escolha uma data futura.', flags: EPH });

  await i.deferReply({ flags: EPH });
  const ch = await i.client.channels.fetch(canalId).catch(() => null);
  if (!ch) return i.editReply('❌ Não achei o canal da urna.');

  const e = {
    cfg: {
      id: newId(), title: r.titulo, description: r.descricao, color: r.cor, candidates: r.candidates,
      publishAt: r.data.toISOString(), status: 'aberta', channelId: canalId, resultChannelId: resId !== '0' ? resId : null,
      messageId: null, createdBy: i.user.id, createdAt: new Date().toISOString(),
    },
    storeMsgId: null, voters: new Set(), counts: r.candidates.map(() => 0),
  };
  try {
    const sent = await ch.send(publicPayload(e));
    e.cfg.messageId = sent.id;
  } catch {
    return i.editReply(`❌ Não consegui enviar a urna em ${ch}. Veja as permissões do bot nesse canal.`);
  }
  elections.set(e.cfg.id, e);
  await save(e);
  return i.editReply(`✅ Urna criada em ${ch} (código **${e.cfg.id}**).\nResultado: <t:${ts(r.data)}:F>.\nPara mudar o horário: \`/urna horario\`.`);
}

async function submitEdit(i) {
  const id = i.customId.split(':')[2];
  const e = elections.get(id);
  if (!e || e.cfg.status !== 'aberta') return i.reply({ content: '❌ Essa eleição não está aberta.', flags: EPH });
  const r = readModal(i);
  if (r.error) return i.reply({ content: r.error, flags: EPH });
  if (r.candidates.length !== e.cfg.candidates.length && (totalVotes(e) > 0 || e.voters.size > 0)) {
    return i.reply({ content: '❌ Já existem votos, então não dá para mudar a **quantidade** de candidatos. Dá para mudar nomes, descrições e botões.', flags: EPH });
  }
  if (r.data.getTime() <= Date.now()) return i.reply({ content: '❌ Essa data já passou. Para encerrar agora use `/urna encerrar`.', flags: EPH });

  await i.deferReply({ flags: EPH });
  if (r.candidates.length !== e.cfg.candidates.length) e.counts = r.candidates.map(() => 0);
  Object.assign(e.cfg, {
    title: r.titulo, description: r.descricao, color: r.cor, candidates: r.candidates, publishAt: r.data.toISOString(),
  });
  await refreshPublic(e);
  await save(e);
  return i.editReply('✅ Eleição atualizada.');
}

/* ------------------------------------------------------------------ comandos /urna */
async function command(i) {
  if (!isStaff(i)) return i.reply({ content: 'Sem permissão.', flags: EPH });
  const sub = i.options.getSubcommand();

  if (sub === 'criar') {
    const canal = i.options.getChannel('canal', true);
    const res = i.options.getChannel('canal_resultado');
    return i.showModal(buildModal(`urna:mc:${canal.id}:${res ? res.id : '0'}`, null));
  }

  if (sub === 'lista') {
    if (!elections.size) return i.reply({ content: 'Nenhuma eleição criada ainda. Use `/urna criar`.', flags: EPH });
    const lines = [...elections.values()].map((e) => {
      const c = e.cfg;
      const st = c.status === 'aberta' ? '🟢 aberta' : '🔒 encerrada';
      return `**${c.title}** (\`${c.id}\`) — ${st}\nCanal: <#${c.channelId}> · Resultado: <t:${ts(new Date(c.publishAt))}:f> · Votos: ${totalVotes(e)}`;
    });
    return i.reply({ embeds: [new EmbedBuilder().setColor(cfg.color).setTitle('🗳️ Eleições').setDescription(lines.join('\n\n'))], flags: EPH });
  }

  const id = i.options.getString('eleicao', true);
  const e = elections.get(id);
  if (!e) return i.reply({ content: '❌ Eleição não encontrada.', flags: EPH });

  if (sub === 'editar') {
    if (e.cfg.status !== 'aberta') return i.reply({ content: '❌ Essa eleição já foi encerrada.', flags: EPH });
    return i.showModal(buildModal(`urna:me:${id}`, e.cfg));
  }

  if (sub === 'horario') {
    if (e.cfg.status !== 'aberta') return i.reply({ content: '❌ Essa eleição já foi encerrada.', flags: EPH });
    const d = parseDate(i.options.getString('data', true));
    if (!d) return i.reply({ content: '❌ Data inválida. Use `11/11/2026 20:00` (horário de Brasília).', flags: EPH });
    if (d.getTime() <= Date.now()) return i.reply({ content: '❌ Essa data já passou. Para encerrar agora use `/urna encerrar`.', flags: EPH });
    await i.deferReply({ flags: EPH });
    e.cfg.publishAt = d.toISOString();
    await refreshPublic(e);
    await save(e);
    return i.editReply(`✅ O resultado de **${e.cfg.title}** agora sai em <t:${ts(d)}:F> (<t:${ts(d)}:R>).`);
  }

  if (sub === 'encerrar') {
    if (e.cfg.status !== 'aberta') return i.reply({ content: '❌ Essa eleição já foi encerrada.', flags: EPH });
    await i.deferReply({ flags: EPH });
    await publish(e);
    return i.editReply('✅ Votação encerrada e resultado publicado.');
  }

  if (sub === 'excluir') {
    await i.deferReply({ flags: EPH });
    const ch = await i.client.channels.fetch(e.cfg.channelId).catch(() => null);
    if (ch && e.cfg.messageId) await ch.messages.delete(e.cfg.messageId).catch(() => {});
    if (e.storeMsgId) await store.messages.delete(e.storeMsgId).catch(() => {});
    elections.delete(id);
    return i.editReply('🗑️ Eleição removida.');
  }
}

async function autocomplete(i) {
  const sub = i.options.getSubcommand(false);
  const focus = String(i.options.getFocused() || '').toLowerCase();
  const only = sub && sub !== 'excluir';
  const list = [...elections.values()]
    .filter((e) => (!only || e.cfg.status === 'aberta') && `${e.cfg.title} ${e.cfg.id}`.toLowerCase().includes(focus))
    .slice(0, 25)
    .map((e) => ({ name: `${e.cfg.title} (${e.cfg.id}) — ${e.cfg.status}`.slice(0, 100), value: e.cfg.id }));
  return i.respond(list);
}

/* ------------------------------------------------------------------ roteador de botões e formulários */
async function handle(i) {
  const parts = i.customId.split(':');
  if (i.isButton() && parts[1] === 'v') return vote(i, parts[2], Number(parts[3]));
  if (i.isModalSubmit()) {
    if (!isStaff(i)) return i.reply({ content: 'Sem permissão.', flags: EPH });
    if (parts[1] === 'mc') return submitCreate(i);
    if (parts[1] === 'me') return submitEdit(i);
  }
}

async function start(c) {
  client = c;
  const guild = await c.guilds.fetch(cfg.guildId);
  store = await ensureStore(guild);
  await loadAll();
  setInterval(() => tick().catch((err) => console.error('Urna tick:', err)), 15_000);
  tick().catch(() => {});
}

module.exports = {
  start, command, autocomplete, handle,
  _test: { parseDate, parseCandidates, parseColor, brt, publicPayload, vote, publish, loadAll, save, elections,
    setStore: (s, c) => { store = s; client = c; } },
};
