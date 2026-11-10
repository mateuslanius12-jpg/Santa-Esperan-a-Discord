# Bot da Cidade (único)

Um bot só com: **status da cidade**, **boas-vindas / até logo**, **WL**, **tickets** e **/embed**.

## 1. Criar o bot no Discord
1. https://discord.com/developers/applications → **New Application**.
2. Aba **Bot** → **Reset Token** → copie (é o `DISCORD_TOKEN`).
3. Na mesma aba, ligue **Server Members Intent** (obrigatório p/ boas-vindas e dar cargos).
4. Aba **General Information** → copie o **Application ID** (é o `CLIENT_ID`).
5. Convite: `https://discord.com/oauth2/authorize?client_id=SEU_CLIENT_ID&scope=bot%20applications.commands&permissions=8` (permissão Administrador) e adicione ao servidor.
6. **Importante:** o cargo do bot precisa estar **acima** dos cargos "Cidadão" e "Sem WL" na lista de cargos.
7. Ative o Modo Desenvolvedor (Discord > Configurações > Avançado) e copie os IDs (botão direito) de servidor, canais, categoria e cargos.

## 2. Subir no GitHub
1. Crie um repositório (pode ser privado) e envie estes arquivos. **Nunca suba o `.env`** (o `.gitignore` já protege).
2. Os IDs/token vão só no Render (passo 3).

## 3. Hospedar no Render
1. https://render.com → **New +** → **Web Service** → conecte o repositório.
2. **Runtime:** Node · **Build Command:** `npm install` · **Start Command:** `npm start` · **Instance:** Free.
3. Em **Environment**, crie as variáveis do arquivo `.env.example` (nome e valor).
4. **Deploy.** Os comandos `/embed` e `/painel` são registrados sozinhos ao ligar.
5. Para não dormir: no UptimeRobot, crie um monitor HTTP apontando para a URL do Render (`https://seu-bot.onrender.com`), a cada 5 min.

## 4. Configurar na cidade
- **Status:** coloque `FIVEM_ADDRESS` (IP:porta do servidor) e `CANAL_STATUS`. O bot cria o embed e o edita a cada 30s. A porta do FiveM (ex.: 30120 TCP) precisa estar acessível pela internet. **Desligue o bot do Discord do próprio txAdmin** (Settings > Discord) para não ter dois bots/embeds de status.
- **WL:** no canal de whitelist use `/painel tipo:Whitelist`. Só quem tem **Sem WL** consegue fazer.
  - 14–15 acertos: libera sozinho (cargo Cidadão, tira Sem WL, avisa em `CANAL_WL_RESULTADO`)
  - 8–13: vai para `CANAL_WL_STAFF` com botões **Liberar / Entrevista / Não passou**
  - 0–7: reprova (espera 24h para tentar de novo)
  - Perguntas e respostas certas: `src/questions.js` · notas/cooldown: `src/config.js`
- **Tickets:** no canal de atendimento use `/painel tipo:Tickets`. Define `CATEGORIA_TICKETS`, `CARGO_STAFF` e `CANAL_LOGS_TICKET` (transcrição ao fechar).
- **Boas-vindas / até logo:** `CANAL_BEMVINDO` e `CANAL_SAIDA`. Quem entra recebe o cargo **Sem WL** automaticamente. Textos editáveis em `src/config.js`.
- **/embed:** campos `canal`, `titulo`, `texto` (use `\n` para pular linha), `cor` (`#ff0000` ou vermelho/azul/verde…), `foto` (upload) ou `imagem_url`, `thumbnail_url`, `rodape` e até 3 botões (`botaoN_texto` + `botaoN_canal` **ou** `botaoN_link`).

## Observações
- No plano grátis do Render, o disco é temporário: o bot não depende de arquivos (o embed de status é reencontrado no canal ao reiniciar). Sessões de WL em andamento e o cooldown de 24h zeram se o bot reiniciar.
- Se `CANAL_ENTRADA_CIDADE` estiver preenchido, o bot também avisa quem entra/sai **dentro do jogo**.
