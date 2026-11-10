const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const cfg = require('./config');

const FOOTER = 'Atualiza a cada 30s • status-auto';
let message = null;
let lastPlayers = null; // Set de nomes (para avisar entrada/saída no jogo)

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchServer() {
  if (!cfg.fivemAddress) return { online: false };
  const base = `http://${cfg.fivemAddress}`;
  try {
    const [info, players] = await Promise.all([
      getJson(`${base}/info.json`),
      getJson(`${base}/players.json`),
    ]);
    return {
      online: true,
      players,
      max: Number(info?.vars?.sv_maxClients) || 0,
    };
  } catch {
    return { online: false };
  }
}

function buildPayload(s) {
  const embed = new EmbedBuilder()
    .setTitle(`📡 Status de ${cfg.cityName}`)
    .setColor(s.online ? 0x22c55e : 0xef4444)
    .setFooter({ text: FOOTER })
    .setTimestamp();

  if (s.online) {
    embed.addFields(
      { name: 'Status', value: '🟢 **Online**', inline: true },
      { name: 'Jogadores', value: `👥 **${s.players.length}**${s.max ? ` / ${s.max}` : ''}`, inline: true },
    );
  } else {
    embed.addFields(
      { name: 'Status', value: '🔴 **Offline**', inline: true },
      { name: 'Jogadores', value: '👥 **0**', inline: true },
    );
  }

  const components = [];
  if (cfg.connectUrl && /^https?:\/\//.test(cfg.connectUrl)) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Conectar na cidade').setStyle(ButtonStyle.Link).setURL(cfg.connectUrl),
      ),
    );
  }
  return { embeds: [embed], components };
}

async function findExisting(channel, client) {
  const msgs = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  if (!msgs) return null;
  return msgs.find((m) => m.author.id === client.user.id && m.embeds[0]?.footer?.text === FOOTER) || null;
}

async function announceInGame(client, s) {
  if (!s.online) return;
  const current = new Set(s.players.map((p) => p.name));
  if (lastPlayers && cfg.ch.ingame) {
    const ch = await client.channels.fetch(cfg.ch.ingame).catch(() => null);
    if (ch) {
      for (const n of current) {
        if (!lastPlayers.has(n)) ch.send({ embeds: [new EmbedBuilder().setColor(0x22c55e).setDescription(`🟢 **${n}** entrou na cidade.`)] }).catch(() => {});
      }
      for (const n of lastPlayers) {
        if (!current.has(n)) ch.send({ embeds: [new EmbedBuilder().setColor(0xef4444).setDescription(`🔴 **${n}** saiu da cidade.`)] }).catch(() => {});
      }
    }
  }
  lastPlayers = current;
}

async function tick(client) {
  const s = await fetchServer();
  await announceInGame(client, s);

  if (!cfg.ch.status) return;
  const channel = await client.channels.fetch(cfg.ch.status).catch(() => null);
  if (!channel) return;

  const payload = buildPayload(s);
  try {
    if (!message) message = await findExisting(channel, client);
    if (message) await message.edit(payload);
    else message = await channel.send(payload);
  } catch {
    message = null; // mensagem apagada: recria no próximo ciclo
  }
}

function start(client) {
  tick(client);
  setInterval(() => tick(client), 30_000);
}

module.exports = { start };
