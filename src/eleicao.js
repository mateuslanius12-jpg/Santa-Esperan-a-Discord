// Eleição para prefeito: candidatura (até 6 vagas) -> espera -> votação -> resultado + cargo de prefeito.
// Regra: quem ganha 2 mandatos seguidos fica bloqueado nas próximas N eleições (padrão 4).
// Dados ficam no canal privado "urna-sistema" (o disco do Render grátis é apagado ao reiniciar).
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  AttachmentBuilder, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const cfg = require('./config');
const U = require('./urna')._test; // parseDate, parseColor, brt

const EPH = MessageFlags.Ephemeral;
const elections = new Map(); // id -> { cfg, storeMsgId, voters:Set, counts:[], saving }
let fims = [];               // histórico: { seq, winner('0' = sem vencedor), id, msgId }
const busy = new Set();
let store = null;
let client = null;

/* ------------------------------------------------------------------ utilitários */
const ts = (d) => Math.floor(new Date(d).getTime() / 1000);
const newId = () => Math.random().toString(36).slice(2, 8);
const isStaff = (i) =>
  (cfg.role.staff && i.member.roles.cache.has(cfg.role.staff)) ||
  i.member.permissions.has(PermissionFlagsBits.ManageGuild);

// "2h", "1h30m", "90m", "1d", "0"
function parseDuration(str) {
  const s = (str || '').trim().toLowerCase().replace(/\s+/g, '');
  if (s === '0') return 0;
  if (!s) return null;
  const m = s.match(/^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m(?:in)?)?$/);
  if (!m) return null;
  return ((+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 60000;
}

function fmtDur(ms) {
  if (ms <= 0) return 'imediato';
  const mins = Math.round(ms / 60000);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}min`].filter(Boolean).join(' ');
}

const bloqueio = () => cfg.bloqueioEleicoes || 4;

// Cada tipo de eleição tem cargo, histórico e bloqueio próprios
const TIPOS = {
  prefeito: { label: 'prefeito', role: () => cfg.role.prefeito, env: 'CARGO_PREFEITO' },
  vice: { label: 'vice-prefeito', role: () => cfg.role.vice, env: 'CARGO_VICE' },
};
const tipoOf = (c) => (c && TIPOS[c.tipo] ? c.tipo : 'prefeito');
const maxSeq = (tipo) => fims.filter((f) => f.tipo === tipo).reduce((m, f) => Math.max(m, f.seq), 0);

// Quantas eleições (incluindo a próxima) o usuário ainda está bloqueado. 0 = liberado.
function blockStatus(userId, tipo = 'prefeito') {
  const next = maxSeq(tipo) + 1;
  const wins = new Set(fims.filter((f) => f.tipo === tipo && f.winner === userId).map((f) => f.seq));
  let rem = 0;
  for (const k of wins) {
    if (wins.has(k - 1) && next > k && next <= k + bloqueio()) rem = Math.max(rem, k + bloqueio() - next + 1);
  }
  return rem;
}

/* ------------------------------------------------------------------ armazenamento */
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
  return all.reverse();
}

async function loadAll() {
  elections.clear();
  fims = [];
  const msgs = await fetchAll(store);
  const configs = new Map(), voters = new Map(), counts = new Map();
  for (const m of msgs) {
    const p = m.content.split('|');
    if (p[0] === 'EL2') {
      const att = m.attachments.first();
      if (!att) continue;
      try { configs.set(p[1], { cfg: await (await fetch(att.url)).json(), storeMsgId: m.id }); }
      catch (err) { console.error('Eleição: não consegui ler', p[1], err.message); }
    } else if (p[0] === 'EL2E') {
      if (!voters.has(p[1])) voters.set(p[1], new Set());
      voters.get(p[1]).add(p[2]);
    } else if (p[0] === 'EL2V') {
      if (!counts.has(p[1])) counts.set(p[1], new Map());
      counts.get(p[1]).set(+p[2], (counts.get(p[1]).get(+p[2]) || 0) + 1);
    } else if (p[0] === 'EL2F') {
      fims.push({ seq: +p[1], winner: p[2], id: p[3], tipo: TIPOS[p[4]] ? p[4] : 'prefeito', msgId: m.id });
    }
  }
  for (const [id, c] of configs) {
    const cm = counts.get(id);
    elections.set(id, {
      cfg: c.cfg, storeMsgId: c.storeMsgId, voters: voters.get(id) || new Set(),
      counts: c.cfg.candidates.map((_, idx) => (cm && cm.get(idx)) || 0),
    });
  }
  console.log(`Eleição: ${elections.size} eleição(ões) e ${fims.length} registro(s) de histórico carregados.`);
}

function save(e) {
  e.saving = (e.saving || Promise.resolve()).then(async () => {
    const att = new AttachmentBuilder(Buffer.from(JSON.stringify(e.cfg), 'utf8'), { name: `eleicao2-${e.cfg.id}.json` });
    const msg = await store.send({ content: `EL2|${e.cfg.id}`, files: [att] });
    const old = e.storeMsgId;
    e.storeMsgId = msg.id;
    if (old) store.messages.delete(old).catch(() => {});
  }).catch((err) => console.error('Eleição: erro ao salvar', err));
  return e.saving;
}

// grava/atualiza o resultado da eleição no histórico ('0' = sem vencedor)
async function setFim(electionId, winner, tipo = 'prefeito') {
  const existing = fims.find((f) => f.id === electionId);
  const seq = existing ? existing.seq : maxSeq(tipo) + 1;
  if (existing) {
    store.messages.delete(existing.msgId).catch(() => {});
    fims = fims.filter((f) => f !== existing);
  }
  const msg = await store.send(`EL2F|${seq}|${winner}|${electionId}|${tipo}`);
  fims.push({ seq, winner, id: electionId, tipo, msgId: msg.id });
}

/* ------------------------------------------------------------------ painéis */
function candPayload(e) {
  const c = e.cfg;
  const open = c.phase === 'candidatura';
  const lines = [];
  if (c.description) lines.push(c.description, '');
  lines.push(`👥 Vagas: **${c.candidates.length}/${c.vagas}**`);
  if (open) {
    if (c.candDeadline) lines.push(`⏳ Candidaturas até <t:${ts(c.candDeadline)}:F> (<t:${ts(c.candDeadline)}:R>)`);
    lines.push('Clique em **Candidatar-se** e informe seu **número**, **nome** e **proposta**.');
    lines.push(`ℹ️ Os primeiros a se candidatar ocupam as vagas. Quem exerceu 2 mandatos seguidos de ${TIPOS[tipoOf(c)].label} fica ${bloqueio()} eleições sem poder se candidatar.`);
  } else if (c.phase === 'espera') {
    lines.push(`🔒 **Candidaturas encerradas.** A votação abre <t:${ts(c.voteStartAt)}:R> (<t:${ts(c.voteStartAt)}:F>).`);
  } else if (c.phase === 'votacao') {
    lines.push('🔒 **Candidaturas encerradas.** A votação está aberta!');
  } else if (c.phase === 'cancelada') {
    lines.push(`❌ **Eleição cancelada.** ${c.cancelReason || ''}`);
  } else {
    lines.push('🔒 **Eleição encerrada.**');
  }
  const embed = new EmbedBuilder()
    .setColor(c.color)
    .setTitle(`📋 Candidaturas — ${c.title}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Eleição ${c.id}` });
  if (c.candidates.length) {
    embed.addFields(c.candidates.map((k) => ({
      name: `Nº ${k.num} — ${k.name}`,
      value: `<@${k.userId}>\n${(k.proposal || '').slice(0, 300)}`,
    })));
  }
  const components = open ? [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`el:c:${c.id}`).setLabel('Candidatar-se').setEmoji('📝').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`el:d:${c.id}`).setLabel('Desistir').setStyle(ButtonStyle.Secondary),
  )] : [];
  return { embeds: [embed], components };
}

function votePayload(e, closed = false) {
  const c = e.cfg;
  const lines = [];
  if (c.description) lines.push(c.description, '');
  lines.push(closed ? '🔒 **Votação encerrada.**' : `⏰ Resultado: <t:${ts(c.voteEndAt)}:F> (<t:${ts(c.voteEndAt)}:R>)`);
  lines.push('🔐 Voto secreto — 1 voto por cidadão.');
  const embed = new EmbedBuilder()
    .setColor(c.color)
    .setTitle(`🗳️ Votação — ${c.title}`)
    .setDescription(lines.join('\n'))
    .addFields(c.candidates.map((k) => ({
      name: `Nº ${k.num} — ${k.name}`,
      value: `<@${k.userId}>\n**Por que votar em mim:** ${(k.proposal || '—').slice(0, 800)}`,
    })))
    .setFooter({ text: `Eleição ${c.id}` });
  const rows = [];
  for (let n = 0; n < c.candidates.length; n += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      c.candidates.slice(n, n + 5).map((k, j) =>
        new ButtonBuilder().setCustomId(`el:v:${c.id}:${n + j}`).setLabel(`${k.num} — ${k.name}`.slice(0, 80))
          .setStyle(ButtonStyle.Primary).setDisabled(closed)),
    ));
  }
  return { embeds: [embed], components: rows };
}

async function editOrSend(channelId, msgId, payload, create) {
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch) return null;
  const msg = msgId ? await ch.messages.fetch(msgId).catch(() => null) : null;
  if (msg) { await msg.edit(payload).catch(() => {}); return msg; }
  if (create) return ch.send(payload).catch(() => null);
  return null;
}

async function refreshCand(e) {
  const m = await editOrSend(e.cfg.candChannelId, e.cfg.candMessageId, candPayload(e), e.cfg.phase === 'candidatura');
  if (m) e.cfg.candMessageId = m.id;
}

async function refreshVote(e, closed = false) {
  if (!e.cfg.voteMessageId) return;
  await editOrSend(e.cfg.voteChannelId, e.cfg.voteMessageId, votePayload(e, closed), false);
}

/* ------------------------------------------------------------------ fases */
async function cancel(e, reason) {
  const c = e.cfg;
  c.phase = 'cancelada';
  c.cancelReason = reason;
  await refreshCand(e);
  await refreshVote(e, true);
  await save(e);
}

async function closeCandidacy(e) {
  const c = e.cfg;
  if (c.phase !== 'candidatura' || busy.has(c.id)) return;
  busy.add(c.id);
  try {
    if (c.candidates.length < 2) return await cancel(e, 'Candidaturas insuficientes (mínimo 2).');
    c.candidates.sort((a, b) => +a.num - +b.num);
    c.phase = 'espera';
    c.candClosedAt = new Date().toISOString();
    c.voteStartAt = new Date(Date.now() + c.esperaMs).toISOString();
    await refreshCand(e);
    await save(e);
  } finally { busy.delete(c.id); }
  if (c.esperaMs <= 0) await openVoting(e);
}

async function openVoting(e) {
  const c = e.cfg;
  if (c.phase !== 'espera' || busy.has(c.id)) return;
  busy.add(c.id);
  try {
    if (c.candidates.length < 2) return await cancel(e, 'Candidaturas insuficientes (mínimo 2).');
    c.phase = 'votacao';
    c.voteStartAt = new Date().toISOString();
    c.voteEndAt = new Date(Date.now() + c.duracaoMs).toISOString();
    e.counts = c.candidates.map(() => 0);
    const ch = await client.channels.fetch(c.voteChannelId).catch(() => null);
    const sent = ch ? await ch.send(votePayload(e)).catch((err) => { console.error('Eleição: erro ao postar painel', err.message); return null; }) : null;
    if (sent) c.voteMessageId = sent.id;
    await refreshCand(e);
    await save(e);
  } finally { busy.delete(c.id); }
}

// Dá o cargo ao userId e tira de todo mundo; com userId = null só tira de todos.
async function giveMayorRole(userId, tipo = 'prefeito') {
  const T = TIPOS[tipo];
  if (!T.role()) return null;
  try {
    const guild = await client.guilds.fetch(cfg.guildId);
    await guild.members.fetch();
    const role = guild.roles.cache.get(T.role());
    if (!role) return `⚠️ Não achei o cargo de ${T.label} (confira ${T.env}).`;
    for (const m of [...role.members.values()]) if (m.id !== userId) await m.roles.remove(role).catch(() => {});
    if (!userId) return null;
    const mem = await guild.members.fetch(userId).catch(() => null);
    if (!mem) return '⚠️ O vencedor não está mais no servidor.';
    await mem.roles.add(role);
    return null;
  } catch (err) {
    console.error('Eleição: erro ao dar cargo', err.message);
    return `⚠️ Não consegui mexer no cargo de ${T.label} (o cargo do bot precisa estar ACIMA dele).`;
  }
}

async function announceWinner(e, idx) {
  const c = e.cfg;
  const k = c.candidates[idx];
  c.winnerId = k.userId;
  c.winnerIdx = idx;
  await setFim(c.id, k.userId, tipoOf(c));
  const warn = await giveMayorRole(k.userId, tipoOf(c));
  return warn;
}

async function publishResult(e) {
  const c = e.cfg;
  if (c.phase !== 'votacao' || busy.has(c.id)) return;
  busy.add(c.id);
  try {
    const total = e.counts.reduce((a, b) => a + b, 0);
    const max = Math.max(...e.counts);
    const winners = max > 0 ? c.candidates.map((_, i) => i).filter((i) => e.counts[i] === max) : [];
    const order = c.candidates.map((k, i) => ({ k, v: e.counts[i] })).sort((a, b) => b.v - a.v);
    const medals = ['🥇', '🥈', '🥉'];
    const rows = order.map((o, n) => {
      const pct = total ? Math.round((o.v / total) * 100) : 0;
      const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
      return `${medals[n] || '▫️'} **Nº ${o.k.num} — ${o.k.name}** (<@${o.k.userId}>)\n${bar} **${o.v}** voto${o.v === 1 ? '' : 's'} (${pct}%)`;
    });

    c.phase = 'encerrada';
    c.closedAt = new Date().toISOString();
    let verdict, content = null, warn = null;
    if (!total) {
      verdict = 'Nenhum voto foi registrado. Ninguém foi eleito.';
      await setFim(c.id, '0', tipoOf(c));
    } else if (winners.length === 1) {
      const k = c.candidates[winners[0]];
      verdict = `🏆 **${k.name}** (<@${k.userId}>) é o novo ${TIPOS[tipoOf(c)].label}, com **${max}** voto${max === 1 ? '' : 's'}!`;
      content = `🎉 Parabéns <@${k.userId}>! Você foi eleito ${TIPOS[tipoOf(c)].label}!`;
      warn = await announceWinner(e, winners[0]);
    } else {
      verdict = `🤝 **Empate** entre ${winners.map((i) => `**${c.candidates[i].name}**`).join(' e ')}, com ${max} voto${max === 1 ? '' : 's'} cada. A staff vai definir o desempate.`;
      await setFim(c.id, '0', tipoOf(c));
    }

    const embed = new EmbedBuilder()
      .setColor(c.color)
      .setTitle(`📊 Resultado — ${c.title}`)
      .setDescription(`${verdict}\n\n${rows.join('\n\n')}\n\n🗳️ Total de votos: **${total}**${warn ? `\n\n${warn}` : ''}`)
      .setFooter({ text: `Eleição ${c.id}` })
      .setTimestamp();
    const ch = await client.channels.fetch(c.resultChannelId || c.voteChannelId).catch(() => null);
    if (ch) {
      await ch.send({ content, embeds: [embed], allowedMentions: { users: c.winnerId ? [c.winnerId] : [] } })
        .catch((err) => console.error('Eleição: erro ao postar resultado', err.message));
    }
    await refreshVote(e, true);
    await refreshCand(e);
    await save(e);
  } finally { busy.delete(c.id); }
}

async function tick() {
  const now = Date.now();
  for (const e of [...elections.values()]) {
    const c = e.cfg;
    try {
      if (c.phase === 'candidatura' && c.candDeadline && now >= new Date(c.candDeadline).getTime()) await closeCandidacy(e);
      else if (c.phase === 'espera' && now >= new Date(c.voteStartAt).getTime()) await openVoting(e);
      else if (c.phase === 'votacao' && now >= new Date(c.voteEndAt).getTime()) await publishResult(e);
    } catch (err) { console.error('Eleição: erro no tick', err); }
  }
}

/* ------------------------------------------------------------------ candidatura (botões e formulário) */
function candidateGate(i, e) {
  const c = e.cfg;
  if (c.phase !== 'candidatura' || (c.candDeadline && Date.now() >= new Date(c.candDeadline).getTime())) return 'As candidaturas já estão encerradas.';
  if (cfg.role.cidadao && !i.member.roles.cache.has(cfg.role.cidadao)) return 'Só cidadãos (quem já passou na WL) podem se candidatar.';
  if (c.candidates.some((k) => k.userId === i.user.id)) return 'Você já está candidato(a) nesta eleição.';
  const rem = blockStatus(i.user.id, tipoOf(c));
  if (rem) return `🚫 Você exerceu 2 mandatos seguidos e está bloqueado de se candidatar por mais **${rem}** eleição(ões) (incluindo esta).`;
  if (c.candidates.length >= c.vagas) return 'As vagas já foram preenchidas.';
  return null;
}

async function openCandidateModal(i, id) {
  const e = elections.get(id);
  if (!e) return i.reply({ content: 'Eleição não encontrada.', flags: EPH });
  const err = candidateGate(i, e);
  if (err) return i.reply({ content: err, flags: EPH });
  const nick = ((i.member.nickname || '').replace(/\s*\|.*$/, '')).slice(0, 60);
  const input = (cid, label, style, max, ph, value) => {
    const t = new TextInputBuilder().setCustomId(cid).setLabel(label).setStyle(style).setMaxLength(max).setRequired(true);
    if (ph) t.setPlaceholder(ph);
    if (value) t.setValue(value);
    return new ActionRowBuilder().addComponents(t);
  };
  return i.showModal(new ModalBuilder().setCustomId(`el:cm:${id}`).setTitle('Candidatura').addComponents(
    input('num', 'Número do candidato', TextInputStyle.Short, 4, 'Ex: 13'),
    input('nome', 'Nome do candidato', TextInputStyle.Short, 60, 'Nome do seu personagem', nick),
    input('proposta', 'Proposta (por que votar em você?)', TextInputStyle.Paragraph, 1000, 'Conte o que você vai fazer pela cidade'),
  ));
}

async function submitCandidate(i, id) {
  const e = elections.get(id);
  if (!e) return i.reply({ content: 'Eleição não encontrada.', flags: EPH });
  const err = candidateGate(i, e);
  if (err) return i.reply({ content: err, flags: EPH });
  const c = e.cfg;
  const numRaw = i.fields.getTextInputValue('num').trim();
  const nome = i.fields.getTextInputValue('nome').trim();
  const proposta = i.fields.getTextInputValue('proposta').trim();
  if (!/^\d{1,4}$/.test(numRaw) || parseInt(numRaw, 10) <= 0) return i.reply({ content: '❌ O número precisa ser só dígitos, por exemplo `13`.', flags: EPH });
  const num = String(parseInt(numRaw, 10));
  if (nome.length < 2) return i.reply({ content: '❌ Informe o nome do candidato.', flags: EPH });
  if (proposta.length < 10) return i.reply({ content: '❌ Escreva uma proposta um pouco maior (mínimo 10 letras).', flags: EPH });
  if (c.candidates.some((k) => k.num === num)) return i.reply({ content: `❌ O número **${num}** já está sendo usado por outro candidato. Escolha outro.`, flags: EPH });

  // sem await entre a conferência e o push: evita duas pessoas pegarem a mesma vaga
  c.candidates.push({ num, name: nome, proposal: proposta, userId: i.user.id, at: new Date().toISOString() });
  const full = c.candidates.length >= c.vagas;
  await i.deferReply({ flags: EPH });
  await refreshCand(e);
  await save(e);
  if (full) await closeCandidacy(e);
  return i.editReply(`✅ Candidatura registrada: **Nº ${num} — ${nome}**.${full ? ' As vagas foram preenchidas!' : ''}`);
}

async function withdraw(i, id) {
  const e = elections.get(id);
  if (!e || e.cfg.phase !== 'candidatura') return i.reply({ content: 'As candidaturas já estão encerradas.', flags: EPH });
  const idx = e.cfg.candidates.findIndex((k) => k.userId === i.user.id);
  if (idx < 0) return i.reply({ content: 'Você não é candidato(a) nesta eleição.', flags: EPH });
  e.cfg.candidates.splice(idx, 1);
  await i.deferReply({ flags: EPH });
  await refreshCand(e);
  await save(e);
  return i.editReply('✅ Você desistiu da candidatura.');
}

/* ------------------------------------------------------------------ votar */
async function vote(i, id, idx) {
  const e = elections.get(id);
  if (!e || e.cfg.phase !== 'votacao' || Date.now() >= new Date(e.cfg.voteEndAt).getTime()) {
    return i.reply({ content: '🔒 Esta votação já foi encerrada.', flags: EPH });
  }
  if (cfg.role.cidadao && !i.member.roles.cache.has(cfg.role.cidadao)) {
    return i.reply({ content: 'Só cidadãos (quem já passou na WL) podem votar.', flags: EPH });
  }
  if (e.voters.has(i.user.id)) return i.reply({ content: 'Você já votou nesta eleição. Cada cidadão tem 1 voto.', flags: EPH });
  const cand = e.cfg.candidates[idx];
  if (!cand) return i.reply({ content: 'Opção inválida.', flags: EPH });

  e.voters.add(i.user.id);
  await i.deferReply({ flags: EPH });
  try {
    await store.send(`EL2E|${id}|${i.user.id}`);
    try { await store.send(`EL2V|${id}|${idx}`); } catch { await store.send(`EL2V|${id}|${idx}`); }
    e.counts[idx] += 1;
  } catch (err) {
    console.error('Eleição: falha ao registrar voto', err);
    e.voters.delete(i.user.id);
    return i.editReply('❌ Não consegui registrar o seu voto. Tente novamente.');
  }
  return i.editReply(`✅ Voto registrado em **Nº ${cand.num} — ${cand.name}**. Seu voto é secreto.`);
}

/* ------------------------------------------------------------------ comandos /eleicao */
const PHASE = { candidatura: '📝 candidatura', espera: '⏳ aguardando votação', votacao: '🗳️ votação', encerrada: '🔒 encerrada', cancelada: '❌ cancelada' };

function summary(e) {
  const c = e.cfg;
  const l = [`**${c.title}** (\`${c.id}\`, ${TIPOS[tipoOf(c)].label}) — ${PHASE[c.phase]}`, `Vagas: ${c.candidates.length}/${c.vagas} · Espera: ${fmtDur(c.esperaMs)} · Votação: ${fmtDur(c.duracaoMs)}`];
  if (c.phase === 'candidatura' && c.candDeadline) l.push(`Prazo da candidatura: <t:${ts(c.candDeadline)}:f>`);
  if (c.phase === 'espera') l.push(`Votação abre: <t:${ts(c.voteStartAt)}:f>`);
  if (c.phase === 'votacao') l.push(`Resultado: <t:${ts(c.voteEndAt)}:f> · Votos: ${e.counts.reduce((a, b) => a + b, 0)}`);
  return l.join('\n');
}

async function command(i) {
  if (!isStaff(i)) return i.reply({ content: 'Sem permissão.', flags: EPH });
  const sub = i.options.getSubcommand();

  if (sub === 'criar') {
    const esperaMs = parseDuration(i.options.getString('espera', true));
    const duracaoMs = parseDuration(i.options.getString('duracao', true));
    const prazoRaw = i.options.getString('prazo_candidatura');
    const cor = U.parseColor(i.options.getString('cor'));
    if (esperaMs === null || esperaMs > 14 * 86400000) return i.reply({ content: '❌ `espera` inválida. Exemplos: `2h`, `30m`, `1h30m`, `0` (sem espera).', flags: EPH });
    if (duracaoMs === null || duracaoMs < 5 * 60000 || duracaoMs > 30 * 86400000) return i.reply({ content: '❌ `duracao` inválida (mínimo 5 minutos). Exemplos: `24h`, `12h`, `1d`.', flags: EPH });
    if (cor === null) return i.reply({ content: '❌ Cor inválida. Use um hex, por exemplo `#0dcbff`.', flags: EPH });
    let prazo = null;
    if (prazoRaw) {
      prazo = U.parseDate(prazoRaw);
      if (!prazo || prazo.getTime() <= Date.now()) return i.reply({ content: '❌ `prazo_candidatura` inválido ou já passou. Use `15/11/2026 20:00` (horário de Brasília).', flags: EPH });
    }
    const tipo = i.options.getString('tipo') || 'prefeito';
    const cand = i.options.getChannel('canal_candidatura', true);
    const vota = i.options.getChannel('canal_votacao', true);
    const res = i.options.getChannel('canal_resultado');
    await i.deferReply({ flags: EPH });
    const e = {
      cfg: {
        id: newId(), title: i.options.getString('titulo', true), description: i.options.getString('descricao') || '', color: cor,
        tipo, vagas: i.options.getInteger('vagas', true), esperaMs, duracaoMs, candDeadline: prazo ? prazo.toISOString() : null,
        candChannelId: cand.id, voteChannelId: vota.id, resultChannelId: res ? res.id : null,
        phase: 'candidatura', candidates: [], candMessageId: null, voteMessageId: null, createdBy: i.user.id, createdAt: new Date().toISOString(),
      },
      storeMsgId: null, voters: new Set(), counts: [],
    };
    const sent = await cand.send(candPayload(e)).catch(() => null);
    if (!sent) return i.editReply(`❌ Não consegui enviar o painel em ${cand}. Veja as permissões do bot nesse canal.`);
    e.cfg.candMessageId = sent.id;
    elections.set(e.cfg.id, e);
    await save(e);
    const warn = await giveMayorRole(null, tipo); // nova eleição: tira o cargo de quem tinha
    return i.editReply(`✅ Eleição de ${TIPOS[tipo].label} criada (código **${e.cfg.id}**).${TIPOS[tipo].role() ? `\nO cargo de ${TIPOS[tipo].label} foi retirado de quem tinha.` : ''}${warn ? `\n${warn}` : ''}\nPainel de candidatura em ${cand}. Vagas: ${e.cfg.vagas}.\nDepois que a candidatura fechar, a votação abre em ${fmtDur(esperaMs)} em ${vota} e fica ${fmtDur(duracaoMs)} aberta.`);
  }

  if (sub === 'lista') {
    if (!elections.size) return i.reply({ content: 'Nenhuma eleição criada ainda. Use `/eleicao criar`.', flags: EPH });
    return i.reply({ embeds: [new EmbedBuilder().setColor(cfg.color).setTitle('🗳️ Eleições').setDescription([...elections.values()].map(summary).join('\n\n').slice(0, 4000))], flags: EPH });
  }

  if (sub === 'historico_ver') {
    const tipo = i.options.getString('tipo') || 'prefeito';
    const list = fims.filter((f) => f.tipo === tipo).sort((a, b) => a.seq - b.seq).map((f) => `**#${f.seq}** — ${f.winner === '0' ? 'sem vencedor' : `<@${f.winner}>`}`);
    return i.reply({ embeds: [new EmbedBuilder().setColor(cfg.color).setTitle(`📜 Histórico de ${TIPOS[tipo].label}s`)
      .setDescription((list.join('\n') || 'Vazio.') + `\n\nRegra: 2 mandatos seguidos = bloqueado por ${bloqueio()} eleições.`)], flags: EPH });
  }
  if (sub === 'historico_add') {
    const user = i.options.getUser('usuario', true);
    const n = i.options.getInteger('mandatos', true);
    const tipo = i.options.getString('tipo') || 'prefeito';
    await i.deferReply({ flags: EPH });
    for (let k = 0; k < n; k++) await setFim(`manual-${newId()}`, user.id, tipo);
    return i.editReply(`✅ Registrado: <@${user.id}> com ${n} mandato(s) seguido(s) de ${TIPOS[tipo].label} no histórico.`);
  }
  if (sub === 'historico_limpar') {
    const tipo = i.options.getString('tipo') || 'prefeito';
    await i.deferReply({ flags: EPH });
    for (const f of fims.filter((x) => x.tipo === tipo)) await store.messages.delete(f.msgId).catch(() => {});
    fims = fims.filter((x) => x.tipo !== tipo);
    return i.editReply(`🗑️ Histórico de ${TIPOS[tipo].label} apagado. Ninguém está bloqueado agora.`);
  }

  const e = elections.get(i.options.getString('eleicao', true));
  if (!e) return i.reply({ content: '❌ Eleição não encontrada.', flags: EPH });
  const c = e.cfg;

  if (sub === 'ajustar') {
    if (c.phase === 'encerrada' || c.phase === 'cancelada') return i.reply({ content: '❌ Essa eleição já terminou.', flags: EPH });
    const o = i.options;
    const upd = {};
    if (o.getString('titulo')) upd.title = o.getString('titulo');
    if (o.getString('descricao') !== null) upd.description = o.getString('descricao');
    if (o.getString('cor')) { const cor = U.parseColor(o.getString('cor')); if (cor === null) return i.reply({ content: '❌ Cor inválida.', flags: EPH }); upd.color = cor; }
    if (o.getInteger('vagas') !== null) {
      if (c.phase !== 'candidatura') return i.reply({ content: '❌ As vagas só mudam durante a candidatura.', flags: EPH });
      if (o.getInteger('vagas') < c.candidates.length) return i.reply({ content: `❌ Já existem ${c.candidates.length} candidatos.`, flags: EPH });
      upd.vagas = o.getInteger('vagas');
    }
    if (o.getString('espera') !== null) {
      const v = parseDuration(o.getString('espera'));
      if (v === null || v > 14 * 86400000) return i.reply({ content: '❌ `espera` inválida. Ex: `2h`, `30m`, `0`.', flags: EPH });
      upd.esperaMs = v;
    }
    if (o.getString('duracao') !== null) {
      const v = parseDuration(o.getString('duracao'));
      if (v === null || v < 5 * 60000 || v > 30 * 86400000) return i.reply({ content: '❌ `duracao` inválida (mínimo 5 minutos). Ex: `24h`.', flags: EPH });
      upd.duracaoMs = v;
    }
    if (o.getString('prazo_candidatura') !== null) {
      const raw = o.getString('prazo_candidatura').trim().toLowerCase();
      if (raw === 'nenhum') upd.candDeadline = null;
      else {
        const d = U.parseDate(raw);
        if (!d || d.getTime() <= Date.now()) return i.reply({ content: '❌ Prazo inválido ou já passou. Use `15/11/2026 20:00` ou `nenhum`.', flags: EPH });
        upd.candDeadline = d.toISOString();
      }
    }
    if (!Object.keys(upd).length) return i.reply({ content: 'Nada para mudar. Preencha pelo menos uma opção.', flags: EPH });
    if (c.phase === 'votacao' && upd.duracaoMs !== undefined && new Date(c.voteStartAt).getTime() + upd.duracaoMs <= Date.now()) {
      return i.reply({ content: '❌ Com essa duração o resultado já teria saído. Use `/eleicao encerrar` para encerrar agora.', flags: EPH });
    }
    await i.deferReply({ flags: EPH });
    Object.assign(c, upd);
    if (c.phase === 'espera' && upd.esperaMs !== undefined) c.voteStartAt = new Date(new Date(c.candClosedAt).getTime() + c.esperaMs).toISOString();
    if (c.phase === 'votacao' && upd.duracaoMs !== undefined) c.voteEndAt = new Date(new Date(c.voteStartAt).getTime() + c.duracaoMs).toISOString();
    await refreshCand(e);
    await refreshVote(e);
    await save(e);
    if (c.phase === 'candidatura' && c.candidates.length >= c.vagas) await closeCandidacy(e);
    return i.editReply(`✅ Eleição atualizada.\n${summary(e)}`);
  }

  if (sub === 'fechar_candidatura') {
    if (c.phase !== 'candidatura') return i.reply({ content: '❌ A candidatura não está aberta.', flags: EPH });
    if (c.candidates.length < 2) return i.reply({ content: '❌ Precisa de pelo menos 2 candidatos. Para desistir da eleição use `/eleicao cancelar`.', flags: EPH });
    await i.deferReply({ flags: EPH });
    await closeCandidacy(e);
    return i.editReply('✅ Candidatura encerrada.');
  }
  if (sub === 'abrir_votacao') {
    if (c.phase !== 'espera') return i.reply({ content: '❌ A eleição não está aguardando a votação.', flags: EPH });
    await i.deferReply({ flags: EPH });
    await openVoting(e);
    return i.editReply('✅ Votação aberta agora.');
  }
  if (sub === 'encerrar') {
    if (c.phase !== 'votacao') return i.reply({ content: '❌ A votação não está aberta.', flags: EPH });
    await i.deferReply({ flags: EPH });
    await publishResult(e);
    return i.editReply('✅ Votação encerrada e resultado publicado.');
  }
  if (sub === 'cancelar') {
    if (c.phase === 'encerrada' || c.phase === 'cancelada') return i.reply({ content: '❌ Essa eleição já terminou.', flags: EPH });
    await i.deferReply({ flags: EPH });
    await cancel(e, 'Cancelada pela staff.');
    return i.editReply('✅ Eleição cancelada.');
  }
  if (sub === 'remover') {
    if (c.phase !== 'candidatura' && c.phase !== 'espera') return i.reply({ content: '❌ Só dá para remover candidato antes da votação abrir.', flags: EPH });
    const num = String(i.options.getInteger('numero', true));
    const idx = c.candidates.findIndex((k) => k.num === num);
    if (idx < 0) return i.reply({ content: `❌ Não há candidato com o número ${num}.`, flags: EPH });
    await i.deferReply({ flags: EPH });
    const [rm] = c.candidates.splice(idx, 1);
    await refreshCand(e);
    await save(e);
    return i.editReply(`✅ Candidato **${rm.name}** removido.`);
  }
  if (sub === 'vencedor') {
    if (c.phase !== 'encerrada' || c.winnerId) return i.reply({ content: '❌ Só serve para eleição encerrada sem vencedor (empate ou sem votos).', flags: EPH });
    const num = String(i.options.getInteger('numero', true));
    const idx = c.candidates.findIndex((k) => k.num === num);
    if (idx < 0) return i.reply({ content: `❌ Não há candidato com o número ${num}.`, flags: EPH });
    await i.deferReply({ flags: EPH });
    const warn = await announceWinner(e, idx);
    await save(e);
    const k = c.candidates[idx];
    const ch = await i.client.channels.fetch(c.resultChannelId || c.voteChannelId).catch(() => null);
    if (ch) await ch.send({ content: `🏆 Desempate: <@${k.userId}> (**${k.name}**) é o novo ${TIPOS[tipoOf(c)].label}! 🎉`, allowedMentions: { users: [k.userId] } }).catch(() => {});
    return i.editReply(`✅ ${k.name} definido como ${TIPOS[tipoOf(c)].label}.${warn ? `\n${warn}` : ''}`);
  }
}

async function autocomplete(i) {
  const focus = String(i.options.getFocused() || '').toLowerCase();
  const list = [...elections.values()]
    .filter((e) => `${e.cfg.title} ${e.cfg.id}`.toLowerCase().includes(focus))
    .slice(-25).reverse()
    .map((e) => ({ name: `${e.cfg.title} (${e.cfg.id}) — ${e.cfg.phase}`.slice(0, 100), value: e.cfg.id }));
  return i.respond(list);
}

/* ------------------------------------------------------------------ roteador */
async function handle(i) {
  const p = i.customId.split(':');
  if (i.isButton()) {
    if (p[1] === 'c') return openCandidateModal(i, p[2]);
    if (p[1] === 'd') return withdraw(i, p[2]);
    if (p[1] === 'v') return vote(i, p[2], Number(p[3]));
  }
  if (i.isModalSubmit() && p[1] === 'cm') return submitCandidate(i, p[2]);
}

async function start(c, storeChannel) {
  client = c;
  store = storeChannel;
  await loadAll();
  setInterval(() => tick().catch((err) => console.error('Eleição tick:', err)), 15_000);
  tick().catch(() => {});
}

module.exports = {
  start, command, autocomplete, handle,
  _test: { parseDuration, fmtDur, blockStatus, elections, setCtx: (s, c) => { store = s; client = c; }, loadAll, tick, getFims: () => fims, candPayload, votePayload },
};
