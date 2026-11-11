const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');
const cfg = require('./config');

const EPH = MessageFlags.Ephemeral;
const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ]{2,15}$/; // só letras (com acento), sem espaço
const ID_IN_NICK = /\|\s*(\d{1,7})\s*$/;      // "Nome Sobrenome | 123"
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

// ---------- painel (postado por /painel tipo:Registro) ----------
function panelPayload() {
  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(`📝 Registro de personagem — ${cfg.cityName}`)
    .setDescription(
      '**Como registrar:**\n' +
      '1️⃣ Crie o seu personagem **dentro do jogo**.\n' +
      '2️⃣ Clique no botão **Registrar nome** abaixo.\n' +
      '3️⃣ Preencha o **1º nome**, o **2º nome** e o seu **ID** do jogo.\n\n' +
      'Seu apelido aqui no Discord vai ficar assim: **Nome Sobrenome | ID**',
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('reg:open').setLabel('Registrar nome').setEmoji('📝').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

// ---------- botão: abre o formulário ----------
async function open(i) {
  const m = i.member;
  if (cfg.role.cidadao && !m.roles.cache.has(cfg.role.cidadao)) {
    return i.reply({ content: 'Só quem já passou na WL (**Cidadão**) pode registrar o nome.', flags: EPH });
  }
  if (ID_IN_NICK.test(m.nickname || '')) {
    return i.reply({ content: 'Você já está registrado. Para alterar, fale com a staff.', flags: EPH });
  }

  const modal = new ModalBuilder().setCustomId('reg:modal').setTitle('Registrar personagem').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('nome').setLabel('1º nome').setPlaceholder('Ex: João')
        .setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(15).setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('sobrenome').setLabel('2º nome (sobrenome)').setPlaceholder('Ex: Silva')
        .setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(15).setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('id').setLabel('Seu ID no jogo').setPlaceholder('Ex: 123')
        .setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(6).setRequired(true),
    ),
  );
  return i.showModal(modal);
}

// ---------- formulário enviado ----------
async function submit(i) {
  await i.deferReply({ flags: EPH });

  const nomeRaw = i.fields.getTextInputValue('nome').trim();
  const sobreRaw = i.fields.getTextInputValue('sobrenome').trim();
  const idRaw = i.fields.getTextInputValue('id').trim();

  if (!NAME_RE.test(nomeRaw) || !NAME_RE.test(sobreRaw)) {
    return i.editReply('❌ O 1º nome e o 2º nome precisam ter só letras (sem espaço, número ou símbolo), de 2 a 15 letras cada.');
  }
  if (!/^\d{1,6}$/.test(idRaw) || parseInt(idRaw, 10) <= 0) {
    return i.editReply('❌ O ID precisa ser só números, por exemplo `123`.');
  }

  const nome = cap(nomeRaw);
  const sobrenome = cap(sobreRaw);
  const id = String(parseInt(idRaw, 10));
  const apelido = `${nome} ${sobrenome} | ${id}`;

  if (apelido.length > 32) {
    return i.editReply(`❌ O Discord só aceita apelidos de até 32 letras e o seu ficaria com ${apelido.length} (\`${apelido}\`). Use nomes mais curtos.`);
  }

  // Evita ID ou nome repetido (confere os apelidos já registrados)
  await i.guild.members.fetch();
  const outroId = i.guild.members.cache.find((m) => {
    if (m.id === i.user.id || !m.nickname) return false;
    const mt = m.nickname.match(ID_IN_NICK);
    return mt && mt[1] === id;
  });
  if (outroId) {
    return i.editReply(`❌ O ID **${id}** já está registrado por <@${outroId.id}>. Confira o seu ID no jogo.`);
  }
  const prefixo = `${nome} ${sobrenome} |`.toLowerCase();
  const outroNome = i.guild.members.cache.find(
    (m) => m.id !== i.user.id && m.nickname && m.nickname.toLowerCase().startsWith(prefixo),
  );
  if (outroNome) {
    return i.editReply(`❌ O nome **${nome} ${sobrenome}** já está em uso por <@${outroNome.id}>.`);
  }

  // Muda o apelido e dá o cargo de registrado (se configurado)
  let apelidoOk = true;
  try {
    await i.member.setNickname(apelido, 'Registro de personagem');
  } catch {
    apelidoOk = false;
  }
  if (cfg.role.registrado) await i.member.roles.add(cfg.role.registrado).catch(() => {});

  // Log para a staff
  if (cfg.ch.registerLog) {
    const ch = await i.client.channels.fetch(cfg.ch.registerLog).catch(() => null);
    if (ch) {
      const embed = new EmbedBuilder()
        .setColor(apelidoOk ? 0x22c55e : 0xf59e0b)
        .setTitle('📝 Novo registro')
        .setThumbnail(i.user.displayAvatarURL())
        .setDescription(
          `**Discord:** <@${i.user.id}> (${i.user.username})\n**Personagem:** ${nome} ${sobrenome}\n**ID:** ${id}\n` +
          `**Apelido:** ${apelidoOk ? apelido : '⚠️ não consegui alterar (ver permissões do bot)'}`,
        )
        .setTimestamp();
      ch.send({ embeds: [embed] }).catch(() => {});
    }
  }

  if (!apelidoOk) {
    return i.editReply(
      `✅ Registro recebido: **${nome} ${sobrenome}** (ID **${id}**).\n` +
      '⚠️ Mas não consegui mudar o seu apelido (o cargo do bot precisa estar acima do seu, ou você é o dono do servidor). Avise a staff.',
    );
  }
  return i.editReply(`✅ Registrado! Seu apelido agora é **${apelido}**.`);
}

async function handle(i) {
  if (i.customId === 'reg:open') return open(i);
  if (i.customId === 'reg:modal') return submit(i);
}

module.exports = { handle, panelPayload };
