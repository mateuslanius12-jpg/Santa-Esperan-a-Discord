require('dotenv').config();
const e = process.env;

module.exports = {
  token: e.DISCORD_TOKEN,
  clientId: e.CLIENT_ID,
  guildId: e.GUILD_ID,

  cityName: e.CITY_NAME || 'Santa Esperança RP',
  fivemAddress: e.FIVEM_ADDRESS,
  connectUrl: e.CONNECT_URL,

  ch: {
    status: e.CANAL_STATUS,
    welcome: e.CANAL_BEMVINDO,
    goodbye: e.CANAL_SAIDA,
    ingame: e.CANAL_ENTRADA_CIDADE,
    wlResult: e.CANAL_WL_RESULTADO,
    wlStaff: e.CANAL_WL_STAFF,
    ticketLogs: e.CANAL_LOGS_TICKET,
    ticketCategory: e.CATEGORIA_TICKETS,
    registerLog: e.CANAL_REGISTRO_LOG, // opcional: avisa a staff de cada registro
  },
  role: {
    semWl: e.CARGO_SEM_WL,
    cidadao: e.CARGO_CIDADAO,
    staff: e.CARGO_STAFF,
    registrado: e.CARGO_REGISTRADO, // opcional: cargo dado a quem registra o nome
  },

  // Cor padrão dos embeds do bot
  color: #00FFFF,

  // Textos editáveis. Use {user} (menção), {name} (nome) e {count} (nº de membros)
  text: {
    welcomeTitle: '👋 Bem-vindo(a) à {server}!',
    welcomeDesc:
      '{user}, que bom ter você aqui!\n\nVocê é o membro **#{count}**.\nPara jogar, faça sua **WL** no canal de whitelist.',
    goodbyeTitle: '😢 Até logo!',
    goodbyeDesc: '**{name}** saiu do servidor. Agora somos **{count}** membros.',
  },

  // Quanto tempo (ms) quem foi reprovado na WL precisa esperar para tentar de novo
  wlCooldownMs: 24 * 60 * 60 * 1000,
  // Pontuação (de 15): >= autoApprove libera sozinho | >= manual vai para análise | abaixo reprova
  wlAutoApprove: 14,
  wlManual: 8,
};
