# PokeDeck 4 Premium Eco — v2.4 · Múltiplas lives em abas

Aplicativo **independente e não oficial** para Windows com quatro perfis do [PokeIdle](https://pokeidle.io/app), cookies separados, interface premium e Twitch/Kick capturados diretamente dos cliques no jogo.

## Para quem recebe o aplicativo pronto (SEM Node.js)

Distribua o arquivo **`PokeDeck4-Premium-Eco-Setup-2.4.0-x64.exe`**, que deve ser GERADO pela etapa de compilação descrita abaixo. Ele já inclui o Electron/Chromium, dependências e código do aplicativo; o usuário final **não precisa instalar Node.js, executar `.bat`, abrir terminal, descompactar código-fonte ou rodar `npm`**.

1. O usuário baixa o arquivo `...Setup-...exe` **de uma origem de confiança**.
2. Executa o instalador, escolhe a pasta e conclui a instalação.
3. Abre **PokeDeck 4** pelo menu Iniciar ou pelo atalho da área de trabalho.
4. Faz login nas contas na primeira execução. As quatro sessões ficam isoladas e persistentes.

Um instalador Windows é um executável (`.exe`), mas **não é aquele antigo arquivo `INICIAR.bat`**, nem requer ferramentas de desenvolvimento. Ele precisa ser compilado; **o ZIP de código-fonte não é o instalador**.

**Assinatura digital:** o instalador não está assinado. O Windows SmartScreen pode exibir aviso de publicador desconhecido. Para distribuir comercialmente ou em escala, use certificado de assinatura de código de um emissor reconhecido, revise segurança e termos do jogo; não peça para pessoas desativarem o antivírus.

## Como obter o Setup automaticamente, sem instalar Node no seu PC

O repositório contém `.github/workflows/windows-installer.yml`. Ao publicá-lo no GitHub, o serviço **GitHub Actions usa uma máquina Windows temporária** para baixar Node e compilar o programa. Node roda só nesse servidor de compilação.

1. Crie um repositório GitHub para **o conteúdo desta pasta**, preservando `.github/workflows/windows-installer.yml`.
2. Envie os arquivos e diretórios do projeto para a raiz do repositório (`src`, `assets`, `tests`, `package.json`, `.github`, etc.). A pasta `.github` deve ser enviada também.
3. Abra a aba **Actions** do repositório, selecione **Instalador Windows PokeDeck 4** e clique em **Run workflow**.
4. Quando a execução terminar com sucesso, abra o resultado em **Artifacts → PokeDeck4-Instalador-Windows** e baixe o ZIP do artefato de compilação. Nele estará o **Setup `.exe`** pronto para os usuários finais.
5. Compartilhe **somente o Setup** com os usuários, preferencialmente por uma página de release oficial do seu repositório ou site.

Para o desenvolvedor que preferir compilar localmente **em Windows**: `npm install`, `npm run check`, `npm run dist:win`. O instalador aparece em `dist/`. `DEV_GERAR_INSTALADOR_COM_NODE.bat` é somente um atalho **de desenvolvedor** para isso.

## Como funcionam as lives

- Clique em um botão/link para uma live **dentro do próprio PokeIdle**. Se a ação abrir uma página Twitch/Kick via `window.open`, link `target=_blank` ou navegação de página, o PokeDeck captura a URL do canal e cria **uma NOVA aba LIVE no painel da conta que fez o clique**, sem janela de streaming fora do app.
- Cada clique cria uma aba com ID próprio. É possível manter até **12 abas de lives** entre os quatro perfis para evitar abertura acidental ilimitada. Uma segunda live **não substitui a primeira**.
- Voltar à aba **JOGO** ou navegar para outra live **não fecha nem recarrega** as lives anteriores. Seus WebContents permanecem abertos e o aplicativo solicita ao Electron que evite throttling de fundo quando `LIVES CONTÍNUAS` está ligado.
- Cada aba de live tem **♫** para mutar/desmutar somente aquela transmissão e **×** para encerrar somente aquela transmissão, liberando seus recursos.
- `LIVES CONTÍNUAS` vem ativado por padrão. `ECONOMIZAR LIVES` permite que o Chromium reduza tarefas dos players ocultos; isso pode suspender reprodução em segundo plano. **ECO LIGADO** para o jogo também vem ativado por padrão.
- Login e cookies da Twitch/Kick usam a mesma partição isolada **da conta PokeIdle que originou cada live**. O aplicativo não injeta scripts de automação no site nem manipula contadores de pontos.

**Limitações importantes:** manter a `WebContentsView` viva e reduzir o throttling **não garante reprodução contínua efetiva** em todas as situações: os players da Twitch/Kick, o Chromium e o Windows podem suspender vídeo quando não estiver visível, minimizado ou com pouco recurso. O estado “Página aberta” NÃO confirma que o vídeo está reproduzindo. As recompensas/bônus são validados **exclusivamente pelas regras e servidores** do PokeIdle/Twitch/Kick; o PokeDeck não pode garantir creditá-los. Para o bônus Twitch, o próprio PokeIdle informa que é preciso vincular sua Twitch no jogo e assistir a streamer oficial. Teste na sua conta se a contagem de bônus continua após trocar de aba.

**Sobre desempenho:** cada live simultânea precisa de rede, memória e decodificação de mídia. Manter lives ativas aumenta o consumo; diminuir a qualidade do player (ex.: 360p/480p), desativar chat quando possível e manter apenas as lives necessárias são medidas úteis. O `backgroundThrottling:false` de uma view pode afetar os outros conteúdos da janela Electron; prioridade de reprodução e menor CPU possível são objetivos parcialmente conflitantes.

**Captura de links:** apenas URLs HTTPS de canais Twitch/Kick reconhecidos são transformados em abas; links de OAuth e outras páginas de autenticação podem abrir diálogos normais se necessário. Se uma transmissão for integrada por um `<iframe>` dentro do PokeIdle e não abrir link, o PokeDeck não a extrai automaticamente: ela continua dentro do próprio site.

## Preferências e dados

- `4 CONTAS / 01 / 02 / 03 / 04 / ⛶`: layout em mosaico ou conta em destaque.
- **JOGO** / abas **TWITCH · canal** / **KICK · canal**: seleção das abas dentro de cada conta.
- **LIVES CONTÍNUAS**: priorizar reprodução de lives carregadas em outras abas (ligado por padrão; maior consumo possível).
- **ECO LIGADO**: throttling de jogo/contas inativas (ligado por padrão).
- **☾**: ocultar o painel da conta sem fazer logout; não fecha lives.
- **♫** na conta: silenciar áudio do **jogo** dessa conta; **♫** em uma aba: silenciar só aquela live.
- **↻**: recarregar aba selecionada da conta.
- **×** na aba: encerrar somente essa live.

Mantidos de versões anteriores: `appId = br.independente.pokedeck4`, `productName = PokeDeck 4` e `persist:pokeidle-account-1` a `persist:pokeidle-account-4`. Atualizar o aplicativo não foi projetado para apagar perfis. Não marque opção para remover dados de usuário em desinstalações e não apague a pasta local de perfis. Cookies/sessões também podem expirar no servidor.

## Validação

O comando `npm run check` testa sintaxe, partições persistentes, estrutura das múltiplas abas, preferências, separação de janelas, filtro de URLs e configuração da compilação. **Não equivale a testar vídeo/recompensas reais dentro das suas contas Windows.**

Não distribuímos senhas, cookies de usuários, client secreto ou automação de prêmios. Projeto independente sem vínculo oficial com PokeIdle, Twitch ou Kick.


## v2.4 – Trocar Google em apenas uma conta

O novo botão **G↻** no cabeçalho de cada painel limpa somente dados do Google
(`google.com`) pertencentes ao perfil selecionado. Confirme a ação e, depois
que o jogo recarregar, selecione **Entrar com Google** e escolha outro e-mail.

- As 4 sessões `persist:pokeidle-account-N` continuam com os mesmos nomes e dados.
- Não apaga cookies do `pokeidle.io`, Twitch, Kick, nem perfis de outras contas.
- Fecha somente janelas de autenticação da conta correspondente; lives ficam abertas.
- Google pode bloquear autenticação OAuth em navegadores incorporados, mesmo após
  limpar cookies. Erros como `disallowed_useragent` requerem um fluxo de login
  compatível com navegador externo provido pelo serviço de origem; o PokeDeck
  não consegue contornar essa restrição.
