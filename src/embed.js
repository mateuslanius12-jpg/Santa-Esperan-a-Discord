const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const { ChannelType } = require('discord.js');
const cfg = require('./config');

const EPH = MessageFlags.Ephemeral;
const isUrl = (s) => /^https?:\/\/\S+$/i.test(s);

const NAMED = {
  vermelho: 0xe11d2e, azul: 0x3b82f6, verde: 0x22c55e, amarelo: 0xeab308, laranja: 0xf97316,
  roxo: 0x8b5cf6, rosa: 0xec4899, preto: 0x111111, branco: 0xffffff, cinza: 0x6b7280,
};

function parseColor(input) {
  if (!input) return cfg.color;
  const k = input.trim().toLowerCase();
  if (NAMED[k] !== undefined) return NAMED[k];
  const hex = k.replace('#', '');
  return /^[0-9a-f]{6}$/.test(hex) ? parseInt(hex, 16) : null;
}

async function run(i) {
  const canal = i.options.getChannel('canal', true);
  const titulo = i.options.getString('titulo');
  const texto = i.options.getString('texto');
  const rodape = i.options.getString('rodape');
  const imagemUrl = i.options.getString('imagem_url');
  const thumbUrl = i.options.getString('thumbnail_url');
  const foto = i.options.getAttachment('foto');
  const cor = parseColor(i.options.getString('cor'));

  if (cor === null) {
    return i.reply({ content: '❌ Cor inválida. Use um hex (`#ff0000`) ou: ' + Object.keys(NAMED).join(', '), flags: EPH });
  }
  if (!titulo && !texto && !foto && !imagemUrl) {
    return i.reply({ content: '❌ Informe pelo menos título, texto ou imagem.', flags: EPH });
  }
  for (const [nome, url] of [['imagem_url', imagemUrl], ['thumbnail_url', thumbUrl]]) {
    if (url && !isUrl(url)) return i.reply({ content: `❌ \`${nome}\` precisa ser um link http(s).`, flags: EPH });
  }

  const embed = new EmbedBuilder().setColor(cor);
  if (titulo) embed.setTitle(titulo);
  // "\n" digitado vira quebra de linha
  if (texto) embed.setDescription(texto.replace(/\\n/g, '\n'));
  if (rodape) embed.setFooter({ text: rodape });
  if (thumbUrl) embed.setThumbnail(thumbUrl);

  const files = [];
  if (foto) {
    const ext = (foto.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const name = `imagem.${ext}`;
    files.push(new AttachmentBuilder(foto.url, { name }));
    embed.setImage(`attachment://${name}`);
  } else if (imagemUrl) {
    embed.setImage(imagemUrl);
  }

  // Botões (até 3): texto + (canal OU link)
  const buttons = [];
  for (let n = 1; n <= 3; n++) {
    const label = i.options.getString(`botao${n}_texto`);
    const ch = i.options.getChannel(`botao${n}_canal`);
    const link = i.options.getString(`botao${n}_link`);
    if (!label && !ch && !link) continue;
    if (!label) return i.reply({ content: `❌ Botão ${n}: faltou o texto.`, flags: EPH });
    let url;
    if (ch) url = `https://discord.com/channels/${i.guildId}/${ch.id}`;
    else if (link && isUrl(link)) url = link;
    else return i.reply({ content: `❌ Botão ${n}: informe um canal ou um link http(s) válido.`, flags: EPH });
    buttons.push(new ButtonBuilder().setLabel(label.slice(0, 80)).setStyle(ButtonStyle.Link).setURL(url));
  }

  const payload = { embeds: [embed], files };
  if (buttons.length) payload.components = [new ActionRowBuilder().addComponents(buttons)];

  // Resposta rápida: criar postagem/enviar pode demorar mais de 3s
  await i.deferReply({ flags: EPH });
  try {
    if (canal.type === ChannelType.GuildForum) {
      // Fórum: cria uma postagem nova (o título do embed vira o título da postagem)
      const post = await canal.threads.create({ name: (titulo || 'Postagem').slice(0, 100), message: payload });
      return i.editReply(`✅ Postagem criada no fórum: ${post}.`);
    }
    // Postagem/tópico já existente: reabre se estiver arquivada
    if (canal.isThread && canal.isThread() && canal.archived) await canal.setArchived(false).catch(() => {});
    await canal.send(payload);
  } catch (err) {
    console.error(err);
    const forumTag = canal.type === ChannelType.GuildForum && /tag/i.test(String(err.message))
      ? '\nEsse fórum exige uma **tag** na postagem; o bot não escolhe tag. Crie o post à mão ou desative "exigir tag" no fórum.' : '';
    return i.editReply(`❌ Não consegui enviar em ${canal}. Verifique as permissões do bot nesse canal (ver canal, enviar mensagens${canal.type === ChannelType.GuildForum ? ', criar postagens' : ' e enviar em tópicos'}).${forumTag}`);
  }
  return i.editReply(`✅ Embed enviado em ${canal}.`);
}

module.exports = { run };
