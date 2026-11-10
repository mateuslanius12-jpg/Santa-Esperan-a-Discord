const { Events, EmbedBuilder } = require('discord.js');
const cfg = require('./config');

function fill(str, member) {
  return str
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{name}', member.user.username)
    .replaceAll('{count}', String(member.guild.memberCount))
    .replaceAll('{server}', member.guild.name);
}

function register(client) {
  client.on(Events.GuildMemberAdd, async (member) => {
    if (member.user.bot) return;

    // Todo mundo que entra começa como "Sem WL"
    if (cfg.role.semWl) await member.roles.add(cfg.role.semWl).catch(() => {});

    if (!cfg.ch.welcome) return;
    const ch = await client.channels.fetch(cfg.ch.welcome).catch(() => null);
    if (!ch) return;
    const embed = new EmbedBuilder()
      .setColor(cfg.color)
      .setTitle(fill(cfg.text.welcomeTitle, member))
      .setDescription(fill(cfg.text.welcomeDesc, member))
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setTimestamp();
    ch.send({ content: `<@${member.id}>`, embeds: [embed] }).catch(() => {});
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    if (member.user?.bot || !cfg.ch.goodbye) return;
    const ch = await client.channels.fetch(cfg.ch.goodbye).catch(() => null);
    if (!ch) return;
    const embed = new EmbedBuilder()
      .setColor(0x6b7280)
      .setTitle(fill(cfg.text.goodbyeTitle, member))
      .setDescription(fill(cfg.text.goodbyeDesc, member))
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setTimestamp();
    ch.send({ embeds: [embed] }).catch(() => {});
  });
}

module.exports = { register };
