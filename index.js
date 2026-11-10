const http = require('http');
const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const cfg = require('./src/config');
const commands = require('./src/commands');
const status = require('./src/status');
const welcome = require('./src/welcome');
const wl = require('./src/wl');
const tickets = require('./src/tickets');
const embed = require('./src/embed');

// ---- Servidor HTTP (o Render exige uma porta aberta; o UptimeRobot pinga aqui) ----
const PORT = process.env.PORT || 3000;
http
  .createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bot online ✅');
  })
  .listen(PORT, () => console.log(`HTTP na porta ${PORT}`));

if (!cfg.token || !cfg.clientId || !cfg.guildId) {
  console.error('Faltam DISCORD_TOKEN, CLIENT_ID ou GUILD_ID nas variáveis de ambiente.');
  process.exit(1);
}

// GuildMembers é um intent privilegiado: ative em Developer Portal > Bot > Server Members Intent
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once(Events.ClientReady, async (c) => {
  console.log(`Logado como ${c.user.tag}`);
  try { await commands.register(); } catch (e) { console.error('Erro ao registrar comandos:', e); }
  status.start(client);
});

welcome.register(client);

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isChatInputCommand()) {
      if (i.commandName === 'embed') return await embed.run(i);
      if (i.commandName === 'painel') {
        const tipo = i.options.getString('tipo', true);
        const payload = tipo === 'wl' ? wl.panelPayload() : tickets.panelPayload();
        await i.channel.send(payload);
        return await i.reply({ content: '✅ Painel enviado neste canal.', flags: MessageFlags.Ephemeral });
      }
      return;
    }
    if (i.isButton() || i.isModalSubmit()) {
      if (i.customId.startsWith('wl:')) return await wl.handle(i);
      if (i.customId.startsWith('ticket:')) return await tickets.handle(i);
    }
  } catch (err) {
    console.error(err);
    const msg = { content: '❌ Ocorreu um erro. Tente novamente.', flags: MessageFlags.Ephemeral };
    if (i.replied || i.deferred) i.followUp(msg).catch(() => {});
    else if (i.isRepliable()) i.reply(msg).catch(() => {});
  }
});

client.login(cfg.token);
