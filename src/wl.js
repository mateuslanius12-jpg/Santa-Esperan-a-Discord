const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const cfg = require('./config');
const questions = require('./questions');

const LETTERS = ['A', 'B', 'C', 'D'];
const sessions = new Map(); // userId -> { answers: number[] }
const lastFail = new Map(); // userId -> timestamp da última reprovação
const EPH = MessageFlags.Ephemeral;

// ---------- painel (postado por /painel wl) ----------
function panelPayload() {
  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(`📋 Whitelist — ${cfg.cityName}`)
    .setDescription(
      `Para entrar na cidade você precisa passar na WL.\n\n` +
      `• São **${questions.length} perguntas** de múltipla escolha sobre as regras\n` +
      `• As perguntas aparecem **só para você**\n` +
      `• Leia o regulamento antes de começar\n\n` +
      `Clique no botão abaixo para começar.`,
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('wl:start').setLabel('Fazer WL').setEmoji('📝').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

// ---------- perguntas ----------
function questionPayload(idx) {
  const q = questions[idx];
  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(`Pergunta ${idx + 1}/${questions.length}`)
    .setDescription(`${q.q}\n\n${q.o.map((t, k) => `**${LETTERS[k]})** ${t}`).join('\n\n')}`);
  const row = new ActionRowBuilder().addComponents(
    q.o.map((_, k) =>
      new ButtonBuilder().setCustomId(`wl:a:${idx}:${k}`).setLabel(LETTERS[k]).setStyle(ButtonStyle.Primary)),
  );
  return { embeds: [embed], components: [row] };
}

function finishPayload() {
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('✅ Você respondeu todas as perguntas')
    .setDescription('Clique em **Enviar** para mandar suas respostas para correção.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('wl:send').setLabel('Enviar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('wl:cancel').setLabel('Cancelar').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row] };
}

// ---------- helpers ----------
const isStaff = (i) =>
  (cfg.role.staff && i.member.roles.cache.has(cfg.role.staff)) ||
  i.member.permissions.has(PermissionFlagsBits.ManageGuild);

async function approve(guild, userId) {
  const m = await guild.members.fetch(userId).catch(() => null);
  if (!m) return false;
  if (cfg.role.cidadao) await m.roles.add(cfg.role.cidadao).catch(() => {});
  if (cfg.role.semWl) await m.roles.remove(cfg.role.semWl).catch(() => {});
  return true;
}

async function postResult(client, userId, approved, extra = '') {
  if (!cfg.ch.wlResult) return;
  const ch = await client.channels.fetch(cfg.ch.wlResult).catch(() => null);
  if (!ch) return;
  const embed = new EmbedBuilder()
    .setColor(approved ? 0x22c55e : 0xef4444)
    .setTitle(approved ? '✅ WL aprovada' : '❌ WL reprovada')
    .setDescription(
      approved
        ? `<@${userId}> foi **aprovado(a)** e agora é **Cidadão**! Bem-vindo(a) à cidade! 🎉${extra}`
        : `<@${userId}> **não passou** na WL desta vez. Estude as regras e tente novamente depois.${extra}`,
    )
    .setTimestamp();
  ch.send({ content: `<@${userId}>`, embeds: [embed] }).catch(() => {});
}

function reviewButtons(userId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`wl:ok:${userId}`).setLabel('Liberar').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`wl:iv:${userId}`).setLabel('Entrevista').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`wl:no:${userId}`).setLabel('Não passou').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

// ---------- envio das respostas ----------
async function sendAnswers(i) {
  const s = sessions.get(i.user.id);
  if (!s || s.answers.length < questions.length) {
    return i.update({ content: 'Sessão expirada. Clique em **Fazer WL** de novo.', embeds: [], components: [] });
  }
  sessions.delete(i.user.id);

  const wrong = [];
  let score = 0;
  questions.forEach((q, k) => {
    if (s.answers[k] === q.correct) score++;
    else wrong.push(k);
  });
  const total = questions.length;

  if (score >= cfg.wlAutoApprove) {
    await approve(i.guild, i.user.id);
    await postResult(i.client, i.user.id, true, `\nNota: **${score}/${total}**`);
    return i.update({
      embeds: [new EmbedBuilder().setColor(0x22c55e).setTitle('🎉 Aprovado!').setDescription(`Você acertou **${score}/${total}** e agora é **Cidadão**!`)],
      components: [],
    });
  }

  if (score >= cfg.wlManual) {
    if (cfg.ch.wlStaff) {
      const ch = await i.client.channels.fetch(cfg.ch.wlStaff).catch(() => null);
      if (ch) {
        const embed = new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle('🔎 WL para análise')
          .setThumbnail(i.user.displayAvatarURL())
          .setDescription(
            `**Jogador:** <@${i.user.id}> (${i.user.username})\n**Nota:** ${score}/${total}\n\n` +
            `**Erros:**\n${wrong.map((k) => `• Q${k + 1}: marcou **${LETTERS[s.answers[k]]}** (certa: **${LETTERS[questions[k].correct]}**)`).join('\n')}`,
          )
          .setTimestamp();
        await ch.send({ embeds: [embed], components: [reviewButtons(i.user.id)] }).catch(() => {});
      }
    }
    return i.update({
      embeds: [new EmbedBuilder().setColor(0xf59e0b).setTitle('⏳ Em análise').setDescription(`Você acertou **${score}/${total}**. Sua WL será analisada pela staff — aguarde.`)],
      components: [],
    });
  }

  lastFail.set(i.user.id, Date.now());
  await postResult(i.client, i.user.id, false, `\nNota: **${score}/${total}**`);
  return i.update({
    embeds: [new EmbedBuilder().setColor(0xef4444).setTitle('❌ Reprovado').setDescription(`Você acertou **${score}/${total}**. Estude as regras e tente novamente mais tarde.`)],
    components: [],
  });
}

// ---------- roteador ----------
async function handle(i) {
  const [, action, a, b] = i.customId.split(':');

  // Botões na DM (resposta da entrevista) — não têm i.guild
  if (action === 'ivyes' || action === 'ivre') {
    const guild = i.client.guilds.cache.get(a);
    const ch = guild && cfg.ch.wlStaff ? await i.client.channels.fetch(cfg.ch.wlStaff).catch(() => null) : null;
    const yes = action === 'ivyes';
    if (ch) {
      ch.send({
        embeds: [new EmbedBuilder()
          .setColor(yes ? 0x22c55e : 0xf59e0b)
          .setDescription(yes ? `✅ <@${b}> **confirmou** que consegue na data da entrevista.` : `🔁 <@${b}> pediu para **remarcar** a entrevista.`)],
      }).catch(() => {});
    }
    return i.update({ content: yes ? '✅ Confirmado! Até lá.' : '🔁 Pedido enviado. A staff vai entrar em contato.', embeds: [], components: [] });
  }

  switch (action) {
    case 'start': {
      const m = i.member;
      if (cfg.role.cidadao && m.roles.cache.has(cfg.role.cidadao)) {
        return i.reply({ content: 'Você já é **Cidadão**!', flags: EPH });
      }
      if (cfg.role.semWl && !m.roles.cache.has(cfg.role.semWl)) {
        return i.reply({ content: 'Só quem tem o cargo **Sem WL** pode fazer a WL.', flags: EPH });
      }
      const failed = lastFail.get(i.user.id);
      if (failed && Date.now() - failed < cfg.wlCooldownMs) {
        const h = Math.ceil((cfg.wlCooldownMs - (Date.now() - failed)) / 3_600_000);
        return i.reply({ content: `Você poderá tentar de novo em cerca de **${h}h**.`, flags: EPH });
      }
      sessions.set(i.user.id, { answers: [] });
      return i.reply({ ...questionPayload(0), flags: EPH });
    }

    case 'a': { // wl:a:<idx>:<letra>
      const s = sessions.get(i.user.id);
      const idx = Number(a);
      if (!s || s.answers.length !== idx) {
        return i.update({ content: 'Sessão expirada. Clique em **Fazer WL** de novo.', embeds: [], components: [] });
      }
      s.answers.push(Number(b));
      if (s.answers.length >= questions.length) return i.update(finishPayload());
      return i.update(questionPayload(s.answers.length));
    }

    case 'send':
      return sendAnswers(i);

    case 'cancel':
      sessions.delete(i.user.id);
      return i.update({ content: 'WL cancelada. Você pode começar de novo quando quiser.', embeds: [], components: [] });

    case 'ok': { // wl:ok:<userId> — staff libera
      if (!isStaff(i)) return i.reply({ content: 'Sem permissão.', flags: EPH });
      await approve(i.guild, a);
      await postResult(i.client, a, true);
      const embed = EmbedBuilder.from(i.message.embeds[0]).setColor(0x22c55e).addFields({ name: 'Decisão', value: `✅ Liberado por <@${i.user.id}>` });
      return i.update({ embeds: [embed], components: [reviewButtons(a, true)] });
    }

    case 'no': { // wl:no:<userId>
      if (!isStaff(i)) return i.reply({ content: 'Sem permissão.', flags: EPH });
      lastFail.set(a, Date.now());
      await postResult(i.client, a, false);
      const embed = EmbedBuilder.from(i.message.embeds[0]).setColor(0xef4444).addFields({ name: 'Decisão', value: `❌ Não passou — por <@${i.user.id}>` });
      return i.update({ embeds: [embed], components: [reviewButtons(a, true)] });
    }

    case 'iv': { // wl:iv:<userId> — abre modal para dia/horário
      if (!isStaff(i)) return i.reply({ content: 'Sem permissão.', flags: EPH });
      const modal = new ModalBuilder().setCustomId(`wl:ivm:${a}`).setTitle('Marcar entrevista').addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('dia').setLabel('Dia').setPlaceholder('Ex: Sábado, 15/11').setStyle(TextInputStyle.Short).setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('hora').setLabel('Horário').setPlaceholder('Ex: 20:00').setStyle(TextInputStyle.Short).setRequired(true),
        ),
      );
      return i.showModal(modal);
    }

    case 'ivm': { // modal enviado: manda DM para o jogador
      const dia = i.fields.getTextInputValue('dia');
      const hora = i.fields.getTextInputValue('hora');
      const user = await i.client.users.fetch(a).catch(() => null);
      if (!user) return i.reply({ content: 'Não encontrei o jogador.', flags: EPH });
      const embed = new EmbedBuilder()
        .setColor(cfg.color)
        .setTitle('🎤 Entrevista da WL')
        .setDescription(`Sua WL passou para a fase de **entrevista**!\n\n📅 **Dia:** ${dia}\n🕒 **Horário:** ${hora}\n\nVocê consegue nesse horário?`);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`wl:ivyes:${i.guildId}:${a}`).setLabel('Sim, consigo').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`wl:ivre:${i.guildId}:${a}`).setLabel('Remarcar').setStyle(ButtonStyle.Secondary),
      );
      try {
        await user.send({ embeds: [embed], components: [row] });
      } catch {
        return i.reply({ content: '⚠️ Não consegui enviar DM (o jogador está com a DM fechada). Avise por outro canal.', flags: EPH });
      }
      return i.reply({ content: `✅ Entrevista marcada para **${dia}** às **${hora}** e enviada na DM de <@${a}>.`, flags: EPH });
    }
  }
}

module.exports = { handle, panelPayload };
