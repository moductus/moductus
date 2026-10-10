# Moductus — Arquitetura

> O que o produto é e por que existe está em [PRODUCT.md](PRODUCT.md); os agentes estão em [AGENTS.md](AGENTS.md). Aqui está **como o app funciona por dentro**.

**Status:** fases 1 (a casca) e 2 (os agentes) implementadas. A fase 1 entregou a casca Tauri com o dock, o painel, o Sistema e a captura, o serviço Node como sidecar supervisionado, o canal WebSocket com token, as configurações de ponta a ponta, os temas, a acessibilidade e o release. A fase 2 ligou o motor dos agentes ao serviço: banco com agentes, sessões e conversas; provedores (Claude Code CLI e APIs compatíveis com a da OpenAI); catálogo de ferramentas e servidor MCP; aprovações com desfazer; runtime com estados, agendador e os vigias do Nuno; receptor dos hooks do Claude Code; GitHub pelo `gh`; notificações. Alba, Tula e Faina conversam, mas só ganham áreas e ferramentas nas fases 3 a 5. Onde o texto descreve algo ainda não feito, ele diz "previsto". A arquitetura do v0 (.NET + WPF) está em [v0/ARCHITECTURE.md](v0/ARCHITECTURE.md).

---

## 1. Visão geral

São três processos, cada um com um papel:

```
┌──────────────────────────────── moductus.exe (Tauri / Rust) ────────────────────────────────┐
│  Casca nativa: janelas, dock (AppBar), atalhos globais, bandeja, mídia, janelas abertas,     │
│  tela cheia, credenciais, autostart, atualização                                            │
│                                                                                             │
│   ┌─ WebView: dock ─┐  ┌─ WebView: painel ─┐  ┌─ WebView: sistema ─┐  ┌─ WebView: captura ─┐ │
│   │  React + TS     │  │  React + TS       │  │  React + TS        │  │  React + TS        │ │
│   └────────┬────────┘  └────────┬──────────┘  └─────────┬──────────┘  └─────────┬──────────┘ │
└────────────┼────────────────────┼───────────────────────┼───────────────────────┼────────────┘
             │  Tauri IPC (comandos nativos)              │
             └───────────── WebSocket local (dados, agentes, eventos) ────────────┘
                                         │
                       ┌─────────────────▼──────────────────┐
                       │  moductus-servico (Node, sidecar)  │
                       │  banco · agentes · provedores ·    │
                       │  ferramentas · MCP · agendador ·   │
                       │  receptor de sessões de IA         │
                       └─────────────────┬──────────────────┘
                                         │
              ┌──────────────────────────┼───────────────────────────┐
              ▼                          ▼                           ▼
       claude / codex / gemini     APIs (Anthropic, OpenAI,     gh, Git, sistema
       (subprocesso CLI)           compatível, local)           de arquivos
```

Na fase 2 só há adaptador para o `claude` (CLI) e para APIs compatíveis com a da OpenAI; `codex` e `gemini` são previstos. O `gh` é o do usuário, com a autenticação dele.

### Por que três processos

- **A casca em Rust** é o que precisa falar com o Windows: posicionar o dock reservando espaço, detectar tela cheia, ler a mídia tocando, listar janelas, guardar credenciais. Fica fina de propósito: nenhuma regra de negócio mora nela.
- **As WebViews** desenham tudo. Cada superfície é uma janela própria (dock, painel lateral, Sistema, captura), todas servindo o mesmo bundle React com rotas diferentes.
- **O serviço em Node** é onde mora o produto: dados, agentes, provedores e ferramentas. É separado da interface por três razões:
  1. Os agentes trabalham em segundo plano mesmo com todas as janelas fechadas.
  2. O ecossistema de agentes (SDK de MCP, Claude Agent SDK, SDKs de provedores) é TypeScript.
  3. Uma falha num agente não derruba a interface; a casca reinicia o serviço.

---

## 2. Stack

| Camada | Tecnologia | Observação |
|---|---|---|
| Casca | Tauri 2, Rust estável, crate `windows` 0.62 | Plugins: global-shortcut, single-instance, autostart, dialog. O sidecar sobe por `std::process` com Job object, não pelo plugin shell. Updater previsto, desligado por padrão |
| Interface | React 19, TypeScript, Vite | Um bundle, uma rota por janela |
| Estilo | CSS com variáveis (tokens) em `src/tokens` | Nenhum valor visual literal fora dos tokens, conferido por `scripts/lint-visual.mjs`. Tailwind não entrou |
| Animação | Transições CSS com as durações dos tokens | Curta: nada acima de 200 ms. Motion fica para quando uma animação pedir |
| Estado na UI | Hooks do React | Zustand e TanStack Query ficam para quando as áreas tiverem dados |
| Serviço | Node 24 LTS empacotado como sidecar (`node.exe` + um `servico.mjs` do esbuild) | Escolhido no teste de viabilidade (seção 9) |
| Banco | SQLite pelo `node:sqlite` do Node 24, FTS5 para busca (previsto) | Migrações versionadas no repositório |
| Modelos | Claude Code CLI (`claude -p`) e APIs compatíveis com a da OpenAI, atrás da interface `Provedor` | Anthropic, Gemini e Codex CLI são previstos. Ver [AGENTS.md](AGENTS.md#3-provedores-de-modelo) |
| Ferramentas e MCP | Catálogo com schema Zod; servidor MCP HTTP escrito no próprio serviço, sem SDK | Um catálogo só serve as APIs, o MCP e a lista de capacidades |
| GitHub | `gh`, o do usuário | A autenticação é a dele: o Moductus nunca vê o token do GitHub |
| Validação | Zod 4, no pacote `@moductus/contrato` | Mesmo schema na interface e no serviço; a entrada de cada ferramenta também é Zod, e o JSON Schema que as APIs e o MCP recebem sai dela |
| Testes | Vitest (TS; `happy-dom` nos componentes), `cargo test` (Rust), roteiros de tela em PowerShell (`scripts/verificar.ps1`) | Playwright não entrou: os fluxos de tela rodam no app real, com UI Automation. Nenhum teste chama modelo nem rede: o provedor é um falso roteirizado, e saídas reais do CLI e dos hooks entram como fixtures gravadas por versão (ADR-0016) |
| Pacotes | pnpm workspace: raiz (interface), `servico`, `pacotes/contrato` | |

---

## 3. A casca nativa (Rust)

Expõe comandos Tauri pequenos e eventos. Tudo o que ela sabe fazer:

| Capacidade | API do Windows | Usado por |
|---|---|---|
| Dock que reserva espaço | `SHAppBarMessage` (AppBar), lado e monitor configuráveis, com limpeza de reserva órfã (seção 9) | Dock no modo fixo |
| Mostrar ao encostar na borda | Posição do cursor + janela fina na borda | Dock no modo esconder |
| Tela cheia e apresentação | `SHQueryUserNotificationState` | Dock some |
| Mídia tocando | `GlobalSystemMediaTransportControlsSessionManager` (WinRT) | Seção Mídia |
| Janelas abertas | `EnumWindows` + filtros de janela de app, ícone do processo | Seção Apps abertos |
| Prévia de janela | `DwmRegisterThumbnail` numa janela nativa sobre o painel | Apps abertos (herança do Peek) |
| Ocultar a barra do Windows | `SHAppBarMessage(ABM_SETSTATE)`, restaurado ao sair | Opção do dock |
| Microfone mudo | `IAudioEndpointVolume` | Controle Mic |
| Manter acordado | `PowerCreateRequest` / `PowerSetRequest` | Controle Awake |
| Credenciais | Gerenciador de Credenciais (crate `keyring`) | Chaves de API e tokens |
| Tela, OCR | Captura de tela + `Windows.Media.Ocr` | Ferramentas, Arquivos, Finanças |
| Notificação | Toast do Windows (`ToastNotification`, esquema ToastGeneric), com os botões do cartão | Avisos dos agentes (fase 2) |
| Variável do usuário | `HKCU\Environment` + `WM_SETTINGCHANGE` | Token dos hooks do Claude Code (fase 2) |
| Retomada da suspensão | `WM_POWERBROADCAST` (`PBT_APMRESUMEAUTOMATIC`) | Agendador e GitHub (fase 2) |

Os módulos nativos do v0 (`Power.cs`, `DwmThumbnail.cs`, `MicrophoneMute.cs`, `TcpListeners.cs`, `ScreenCapture.cs`, `TextRecognizer.cs`) são a especificação do port: mesmas chamadas, agora pela crate `windows`.

Na fase 1 entraram o dock que reserva espaço (com os modos esconder e inteligente), tela cheia, mídia, microfone, manter acordado e credenciais. Na fase 2 entraram o aviso do Windows com botões, a variável de ambiente do usuário, a retomada da suspensão e o menu do time na bandeja. Janelas abertas, prévia de janela, ocultar a barra do Windows e tela/OCR ficam para as fases que os usam.

### Módulos (`src-tauri/src`)

| Módulo | O que faz |
|---|---|
| `lib.rs` | Monta o app: plugins, comandos, ordem do `setup`, eventos de janela e limpeza na saída |
| `dados.rs` | Pasta de dados: `%APPDATA%\Moductus`, ou a pasta do exe quando há `portable.txt` ao lado |
| `registro.rs` | `moductus.log` na pasta de dados, uma linha `<epoch ms> <texto>` por evento; a interface escreve nele pelo comando `interface_registro`. Nunca recebe segredo (há teste para isso) |
| `appbar.rs` | O dock como AppBar (`SHAppBarMessage`): reserva, `ABN_POSCHANGED`, DPI, `TaskbarCreated`; grava o identificador em `appbar.hwnd` e chama `ABM_REMOVE` com ele ao iniciar e ao sair (seção 9) |
| `dock.rs` | Lado, modo (fixo, esconder, inteligente) e forma (colada, flutuante) do dock; `WS_EX_NOACTIVATE` + `WS_EX_TOOLWINDOW`; modo teclado (Ctrl+Alt+D) |
| `tela_cheia.rs` | `SHQueryUserNotificationState` a cada 500 ms: no modo inteligente o dock some, no fixo só perde o "sempre no topo" |
| `janelas.rs` | Painel ao lado do dock (com a medição de abertura; `painel_mostrar` abre sem alternar, para o clique no aviso do Windows), Sistema (lembra posição em `sistema.json`, 12 áreas, preso à área útil do monitor onde está) e captura |
| `atalhos.rs` | Atalhos globais: Ctrl+Alt+N (Sistema), Ctrl+Alt+D (dock), Ctrl+Alt+Espaço (captura); recusa com motivo o que outro programa já usa |
| `bandeja.rs`, `inicio.rs` | Ícone na bandeja, com o menu do time que o serviço manda pronto (pausar todos ou um agente, o estado de cada um; sem serviço, só os itens fixos); instância única (a segunda execução foca a primeira); autostart, inclusive `--autostart ligar\|desligar` |
| `midia.rs` | Sessão de mídia do Windows por evento, com capa |
| `controles.rs` | Microfone mudo (`IAudioEndpointVolume` com callback) e manter acordado (`PowerSetRequest`) |
| `servico.rs` | Sobe e supervisiona o serviço (seção 4) |
| `config_nativa.rs` | Aplica o que o serviço manda sobre dock, atalhos e autostart, desfazendo tudo se uma parte falhar |
| `credenciais.rs` | Gerenciador de Credenciais (`Cred*`, alvo `Moductus/<nome>`), atendendo pedidos do serviço pelo canal stdio: chaves dos provedores e o token dos hooks |
| `ambiente.rs` | Variáveis do usuário em `HKCU\Environment`: só nomes que começam com `MODUCTUS_`, e o registro leva o nome, nunca o valor. Avisa o Windows depois de gravar, mas terminal já aberto não relê |
| `notificacao.rs` | Aviso do Windows com os botões que o serviço manda; o clique volta ao serviço. Instalado, o atalho do Menu Iniciar dá o AppUserModelID; em `target\release` o aviso sai pelo id do PowerShell; no portable não há aviso, só o ponto no dock |
| `energia.rs` | Escuta `WM_POWERBROADCAST` pela janela do dock e avisa o serviço (`retomou`) |
| `material.rs` | Acrylic ou fundo sólido por janela (ver Temas) |
| `acessibilidade.rs` | Lê "Efeitos de animação" do Windows e avisa as janelas quando muda (`WM_SETTINGCHANGE`) |

### Janelas

As quatro são declaradas no `tauri.conf.json`, todas sem borda do sistema e transparentes, e criadas no início, escondidas, para abrirem sem atraso. Só o dock é criado pelo Tauri antes do `setup`; painel, Sistema e captura têm `"create": false` e nascem no `setup` (`janelas::criar`, com a mesma configuração) depois de o dock reservar a faixa, para que os três WebViews não atrasem o dock. Cada uma carrega o mesmo bundle; `src/main.tsx` lê o rótulo da janela e `src/janelas/Aplicacao.tsx` escolhe a rota (`src/janelas/{dock,painel,sistema,captura}`).

| Janela | Rótulo e tamanho | Detalhe |
|---|---|---|
| Dock | `dock`, 64 px de largura (80 na forma flutuante) | Sempre no topo, fora da barra de tarefas, não ativa ao clicar; fechar o dock encerra o app |
| Painel | `painel`, 372 px | Sempre no topo, encostado no dock, mostrado com `SW_SHOWNOACTIVATE`; ganha foco só quando um campo pede o teclado |
| Sistema | `sistema`, 1200×780 (mínimo 800×520) | Janela normal com barra de título própria; fechar só esconde; lembra posição |
| Captura | `captura`, 640×72 | Centralizada, ganha foco; some ao perder o foco ou com `Esc` |

Medição do custo disso (memória e tempo até o dock) na [seção 7](#medições-da-fase-1).

### Temas e material

Os tokens ficam em `src/tokens` (`temas.css`, `base.css`, `fontes.css`); o tema entra como `data-tema` (`grafite`, `papel`, `vidro`) na raiz de cada janela. O modo automático segue `prefers-color-scheme` ao vivo (Grafite no escuro, Papel no claro). Componente não conhece o nome do tema.

O Vidro pede Acrylic à casca (`tema_material`). `material.rs` só liga o Acrylic com Windows 11, transparência ligada no Windows e economia de bateria desligada; em qualquer outro caso, ou se o efeito falhar, a janela recebe `data-material="solido"` e o CSS usa a versão sólida do Vidro.

### Acessibilidade

- Foco visível (`:focus-visible`) em todo controle; dentro do dock valem setas, `Home`, `End` e `Esc`, e `Tab` dá a volta nas três superfícies sem parar em nada sem nome.
- Movimento reduzido por dois caminhos: `prefers-reduced-motion` e `data-movimento="reduzido"`, que a casca liga a partir de "Efeitos de animação" do Windows.
- Alto contraste por `forced-colors: active` (`src/tokens/alto-contraste.css`, carregado por último).
- Nome acessível em todo controle, conferido nos testes de componente (`src/teste/acessibilidade.ts`) e, no app real, pelo roteiro `acessibilidade` do `verificar.ps1` com UI Automation.

---

## 4. O serviço (Node)

### Módulos internos

```
servico/src/
  main.ts         entrada: monta os serviços, abre o banco, liga o canal com a casca, o WebSocket, o MCP e o receptor dos hooks
  api/            servidor WebSocket para a interface (servidor.ts)
  banco/          conexão (WAL, foreign_keys, busy_timeout), executor de migrações, ULID, carimbo de origem e lixeira de 30 dias
  migracoes/      uma migração por arquivo, de 001-config a 012-execucoes-falha-do-provedor
  casca/          canal stdio com a casca: credenciais, variáveis do usuário (ambiente) e avisos do Windows
  config/         preferências: valida, manda à casca o que é nativo, grava, avisa quem ouve
  primeiro-uso/   os cinco passos do primeiro uso e o tutorial
  outro-pc/       exportar e importar as configurações num arquivo .moductus (zip, até 4 MB)
  provedores/     interface Provedor, registro, provedor falso, claude-cli/, openai-compativel/, detecção do que há no PC, preços
  ferramentas/    catálogo (schema Zod, efeito, desfazer) e as ferramentas de sessoes/, uso/ e github/
  mcp/            servidor MCP HTTP sobre o catálogo, que também atende o PreToolUse do CLI
  agentes/        repositório, runtime, fila por agente, estado (dormir, pausar), execuções e desfazer, roteador, autorizar e vigias/nuno.ts
  agendador/      gatilhos por horário, por intervalo e por evento
  aprovacoes/     cartões de aprovação e regras de permissão
  conversas/      conversa com o time e com cada agente
  notificacoes/   preferências, histórico, aviso do Windows e ponto no dock
  bandeja/        o menu do time que a casca desenha
  sessoes/        receptor HTTP dos hooks, ligação do Claude Code, transcript, contexto e uso, plugin do OpenCode
  conexoes/       as conexões ligadas; github/ lê PRs, issues e CI pelo gh
```

Previstos a partir da fase 3, no mesmo serviço:

```
  areas/          regras de cada área: tarefas, foco, financas, notas, arquivos, memoria
  agentes/vigias/ os vigias da Alba, da Tula e da Faina (só os do Nuno existem)
  conexoes/       Google Agenda e as demais
```

Os quatro agentes de fábrica não têm arquivo: são linhas semeadas pela migração `003-agentes`, com instruções, ferramentas e personagem. O serviço é empacotado pelo esbuild num arquivo só (`servico/dist/servico.mjs`); as dependências de execução são `ws`, `fflate`, `zod` e o pacote `@moductus/contrato`. O banco é o `node:sqlite` do próprio Node 24.

### Regras

- **A regra de negócio mora na área, não no prompt.** A interface e as ferramentas dos agentes chamam a mesma função: hoje `sessoes/`, `conexoes/github` e `aprovacoes/`, e `areas/tarefas` e as demais quando chegarem (fase 3). Assim agente e tela nunca divergem, nada que importa depende de o modelo acertar uma conta ou um formato, e as ferramentas são testáveis sem modelo.
- **Ferramenta é uma área exposta.** Cada ferramenta é um schema Zod, uma função de área e um nível de efeito (`leitura`, `interno`, `externo`). `externo` sempre gera cartão de aprovação e declara o texto dele; `interno` declara como se desfaz (a inversa roda numa transação, só dentro de 24 horas e nunca com a execução ainda rodando); `leitura` executa direto.
- **Um único catálogo** alimenta o tool calling das APIs, o servidor MCP e a lista de capacidades de cada agente (`agentes.capacidades`). O agente só enxerga as ferramentas da lista dele; no MCP elas se chamam `dominio__acao` (`github__comentar`), porque o ponto não vale no nome de uma ferramenta de modelo.

### Comunicação

- **Interface ↔ serviço:** WebSocket em `127.0.0.1`, porta escolhida pelo sistema (o serviço escuta na porta 0 e informa a real) e token gerado pela casca a cada subida do serviço: 32 bytes do `BCryptGenRandom`, em hexadecimal. A casca entrega porta e token às janelas pelo evento `servico` e pelo comando `servico_estado`. A conexão leva o token no parâmetro `token` da URL; o serviço compara em tempo constante e recusa com 401 antes do upgrade. Cada mensagem é validada pelo contrato: requisições e respostas por grupo (`config.*`, `primeiroUso.*`, `agentes.*`, `execucoes.*`, `provedores.*`, `conversas.*`, `aprovacoes.*`, `regras.*`, `sessoes.*`, `github.*`, `conexoes.*`, `notificacoes.*`) e eventos (`sistema.ola`, `config.mudou`, `agentes.mudou`, `conversas.parcial` e os demais `*.mudou`). O método `agentes.restaurarPadrao` está no contrato e responde "ainda não atendido".
- **Versão do protocolo:** o cliente manda a que fala no parâmetro `protocolo` da URL (hoje 2). Sem o parâmetro, o serviço entende que é uma janela da versão 1: aceita a conexão, mas cada pedido dela recebe um erro legível pedindo para abrir o Moductus de novo; só `sistema.ping` continua respondendo (ADR-0020).
- **Interface ↔ casca:** comandos Tauri, só para o que é nativo (dock, painel, Sistema, captura, mídia, microfone, manter acordado, material, atalhos, autostart).
- **Serviço ↔ casca:** linhas JSON pelo stdin e stdout do serviço, cada pedido com um `id` e a resposta com o mesmo `id`. O serviço manda `pronto` (com a porta), `aplicar` (configuração nativa), `credencial` (guardar, ler, apagar), `ambiente` (definir ou apagar uma variável `MODUCTUS_*` do usuário) e `notificacao` (mostrar ou retirar um aviso do Windows, ou perguntar se há tela cheia); o menu do time na bandeja (`bandeja`) vai sem `id`. A casca avisa sem `id` a retomada da suspensão (`retomou`) e os cliques num aviso (`notificacao-clique`) e num item da bandeja (`bandeja-clique`). O stderr vai para o log como `servico: …`. Chave nunca fica em variável persistente nem em log.
- **Agentes em CLI → serviço (MCP):** servidor MCP HTTP em `127.0.0.1`, porta escolhida pelo sistema. Cada execução abre o próprio acesso: um token sorteado (o serviço guarda só o hash) que enxerga apenas as ferramentas daquele agente e deixa de valer quando a execução termina. O CLI recebe o token na variável `MODUCTUS_MCP_ACESSO`, referenciada no `--mcp-config`, e o manda em `Authorization: Bearer`; sem ele, 401 antes de ler o corpo. O mesmo servidor atende `/hooks/pre-tool-use` (ADR-0017). Não depende do SDK de MCP (ADR-0014).
- **Sessões de IA externas → serviço:** receptor HTTP separado do WebSocket e do MCP, em `127.0.0.1:47821` (`MODUCTUS_HOOKS_PORTA` troca), com as rotas `/hooks/claude-code` e `/hooks/opencode`. O token é próprio e estável: fica no Gerenciador de Credenciais e a casca o publica como variável do usuário `MODUCTUS_HOOKS_TOKEN` (ADR-0015), porque o `settings.json` do Claude Code o lê do ambiente. Variável só vale para processo novo; enquanto isso o receptor responde 401 pedindo "abra um terminal novo". O `PermissionRequest` fica segurado até a decisão no dock (no máximo 600 s). Detalhe em [AGENTS.md](AGENTS.md#5-sessões-de-ia-externas).
- **Serviço → GitHub:** pelo `gh` do usuário, sem shell e sem janela, a cada 15 minutos e na retomada da suspensão (GraphQL; o GitHub não devolve ETag nessas buscas).

### O contrato (`pacotes/contrato`)

Um pacote só de schemas Zod e tipos, usado pela interface e pelo serviço: `canal.ts` (envelope de pedido, resposta e evento), `metodos.ts` (cada método com o schema da entrada e da saída, e os eventos), `config.ts` (a configuração e o padrão), `primeiro-uso.ts`, `outro-pc.ts`, um arquivo por domínio da fase 2 (`agentes.ts`, `provedores.ts`, `conversas.ts`, `aprovacoes.ts`, `sessoes.ts`, que também traz GitHub e conexões, e `notificacoes.ts`), `comum.ts` (Id, Instante) e `cliente.ts`, o cliente WebSocket da interface, que reconecta sozinho (250 ms dobrando até 5 s) e troca de endereço quando a casca sobe um serviço novo. `VERSAO_PROTOCOLO` marca mudanças incompatíveis e vale 2 desde a fase 2. Método que o contrato tem e o serviço ainda não atende responde com erro claro (`semAtendente`).

### Supervisor do serviço

`servico.rs` sobe o `node.exe` empacotado ao lado do exe com `servico/servico.mjs` (em desenvolvimento, o `node` do PATH com `servico/dist/servico.mjs`), sem janela de console, passando `MODUCTUS_PASTA`, `MODUCTUS_TOKEN` e `MODUCTUS_PORTABLE` pelo ambiente.

- **Job object** com `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: se a casca morrer de qualquer jeito, o Windows encerra o serviço junto. Nada fica órfão.
- **Reinício:** se o serviço sair, a casca espera 500 ms, dobrando a cada queda seguida até 30 s, e sobe outro com token novo; quem ficou de pé mais de 60 s recomeça a contagem. O dock mostra o estado (`iniciando`, `pronto`, `reiniciando`, `parado`) e as janelas reconectam sozinhas.
- **Saída:** a casca fecha o stdin (o serviço encerra ao ver o fim) e, por garantia, termina o processo.

### Configuração: interface → serviço → casca

A regra mora no serviço, inclusive para o que é nativo:

1. A interface chama `config.definir` com a mudança.
2. O serviço valida pelo contrato e pelas regras (no modo portable, por exemplo, recusa ligar o autostart).
3. Se a mudança toca `dock`, `atalhos` ou `autostart`, o serviço manda `aplicar` à casca e espera até 10 s. `config_nativa.rs` aplica dock e autostart, depois os atalhos, e desfaz tudo se um atalho estiver ocupado por outro programa.
4. Só com o sim da casca o serviço grava no banco e emite `config.mudou`; toda janela aberta se atualiza por esse evento.
5. Ao subir, o serviço reaplica na casca a configuração gravada.

### Migrações

`banco/migracoes.ts` guarda a versão do banco em `PRAGMA user_version`. As migrações ficam em `servico/src/migracoes`, numeradas de 1 em diante sem buraco; cada uma roda na sua própria transação (`BEGIN IMMEDIATE`) e, se falhar, nada dela fica. Banco mais novo que o código é recusado em vez de ser mexido.

| Migração | Fase | O que cria |
|---|---|---|
| `001-config`, `002-onboarding` | 1 | `config`, `onboarding` |
| `003-agentes` | 2 | `provedores`, `agentes` (com os quatro de fábrica), `execucoes`, `chamadas_ferramenta`, `aprovacoes`, `regras_permissao`, `conversas`, `mensagens` |
| `004-sessoes-dev` | 2 | `projetos`, `sessoes_ia`, `eventos_sessao`, `uso_ia`, `github_itens`, `conexoes` |
| `005-notificacoes` | 2 | `notificacoes_preferencias`, `notificacoes` |
| `006` a `012` | 2 | `lida_em` nas conexões; leitura incremental do transcript; `uso_ia_mensagens`; `cobranca` nas execuções; `agendador_disparos`; motivo do sono e fim da pausa nos agentes; motivo da falha do provedor na execução |

Cada tabela nova nasce com o carimbo de origem e, se for cadastro ou configuração, com lixeira ([DATA.md](DATA.md#1-regras-que-valem-para-tudo)). Nenhuma chave estrangeira aponta para tabela com lixeira, e os quatro agentes de fábrica são protegidos por gatilho no banco (ADR-0019).

### Ciclo de vida

1. O Windows inicia `moductus.exe` (autostart).
2. A casca garante instância única, limpa a reserva órfã do dock, cria as janelas escondidas (o dock visível), registra a AppBar e sobe o serviço como sidecar.
3. O serviço abre o banco e aplica as migrações (a limpeza da lixeira roda aí), abre o servidor MCP, monta o runtime (execuções que ficaram "rodando" fecham como erro e os cartões do terminal que esperavam expiram), liga o WebSocket, avisa `pronto` e reaplica a configuração nativa. Depois sobem, cada um isolado dos outros: os vigias do Nuno, o GitHub (lê agora e a cada 15 minutos), o agendador e o receptor dos hooks (sem token ou com a porta ocupada, o resto do serviço segue).
4. As janelas recebem porta e token e se conectam.
5. Se o serviço cair, a casca reinicia com espera crescente e o dock mostra o estado. Na volta da suspensão, a casca avisa e o agendador dispara, uma vez só, o que venceu enquanto o PC dormia.

### Uma execução de agente

1. Algo pede o agente: uma mensagem na conversa, um gatilho do agendador ou um vigia. O pedido entra na fila dele (uma por agente; agentes diferentes rodam em paralelo).
2. Agente `pausado` ou `dormindo` não chama o modelo: o pedido espera na frente da fila. `desligado` recusa.
3. O runtime registra a execução e chama o provedor do agente, ou a reserva, quando o principal falhou há pouco. O adaptador de API roda o ciclo de ferramentas no serviço; o de CLI recebe as ferramentas pelo MCP e só relata o que aconteceu.
4. Cada chamada de ferramenta passa pelo executor da execução: escopo do agente, validação do Zod, cartão de aprovação se for `externo`, registro em `chamadas_ferramenta`.
5. A falha tipada do provedor (`limite`, `fora_do_ar`, `credencial`, `ausente`) põe o agente para dormir; o teto de gasto do dia também. Ele acorda na hora de volta que o provedor deu ou, sem ela, com espera crescente.
6. O fim da execução grava tokens e custo, derruba o sinal que prendia o cartão pendente e avisa as janelas.

---

## 5. Dados

Um arquivo `moductus.db` em `%APPDATA%\Moductus` (ou ao lado do executável com `portable.txt`, como no v0). Na mesma pasta ficam `moductus.log`, `sistema.json` (posição do Sistema) e `appbar.hwnd` (identificador do dock para limpar reserva órfã).

Na mesma pasta ficam também `ligacao-claude-code.json` (como o `settings.json` do Claude Code estava antes de ligar, para desligar devolvê-lo como era), `claude-cli/` (a pasta em que o CLI dos agentes roda, para não herdar o `CLAUDE.md` nem o `.claude/` de um projeto) e `copias/claude-code/` (as cópias de segurança do `settings.json` quando a pasta dele é um link para um repositório de configuração; nos demais casos as cópias ficam ao lado do próprio arquivo).

O banco está na migração 12. A fase 1 criou `config` (preferências, uma linha JSON por chave) e `onboarding` (passos do primeiro uso); a fase 2 criou as tabelas de agentes, sessões de IA, GitHub, conexões e notificações. As demais entram com as áreas.

| Tabela (agrupada) | Conteúdo | Situação |
|---|---|---|
| `config`, `onboarding` | Preferências e passos do primeiro uso | fase 1 |
| `agentes`, `provedores`, `conversas`, `mensagens`, `execucoes`, `chamadas_ferramenta` | Configuração e histórico dos agentes | fase 2 |
| `aprovacoes`, `regras_permissao` | Cartões pendentes e decididos; "sempre neste projeto" e afins | fase 2 |
| `projetos`, `sessoes_ia`, `eventos_sessao`, `uso_ia`, `uso_ia_mensagens` | Sessões externas, o que fizeram e o gasto | fase 2 |
| `github_itens`, `conexoes` | Cache do GitHub e as conexões ligadas | fase 2 |
| `notificacoes_preferencias`, `notificacoes` | O que cada agente avisa e o que já avisou | fase 2 |
| `agendador_disparos` | Até onde o agendador já contou cada gatilho | fase 2 |
| `tarefas`, `listas`, `recorrencias`, `sessoes_foco` | Tarefas, repetição e cada pomodoro | previsto (fase 3) |
| `contas`, `lancamentos`, `categorias`, `orcamentos` | Finanças | previsto (fase 4) |
| `notas`, `arquivos`, `memorias` | Notas com FTS5, caixa de entrada, fatos com origem | previsto (fases 3 e 5) |

Todo registro criado por agente guarda qual agente e qual execução, para o histórico e o desfazer. O modelo completo, campo a campo, está em [DATA.md](DATA.md).

---

## 6. Estrutura do repositório

```
moductus/
├─ src-tauri/          casca em Rust (src/, tauri.conf.json, capabilities/, examples/)
│  └─ binaries/        node.exe do sidecar, copiado no build (fora do Git)
├─ src/                interface React
│  ├─ janelas/         dock, painel, sistema, captura (uma rota por janela)
│  ├─ areas/           uma pasta por área do Sistema
│  ├─ componentes/     base visual: cartão de aprovação, fala do agente, selo e o personagem com a leitura do estado
│  ├─ nativo/          hooks e comandos da casca (eventos.ts, acessibilidade.ts, arquivos.ts)
│  ├─ servico/         conexão com o serviço (useCanal) e os hooks de agentes, aprovações, conversas, notificações e conexões
│  ├─ teste/           apoio dos testes de componente
│  └─ tokens/          design tokens, temas, fontes, alto contraste
├─ servico/            sidecar Node
├─ pacotes/
│  └─ contrato/        schemas Zod e cliente WebSocket compartilhados entre interface e serviço
├─ scripts/            build do sidecar, lint visual (valores literais e classe CSS repetida entre arquivos), fumaça, roteiros de tela e de medição, zip portable
├─ docs/
│  ├─ PRODUCT.md, ARCHITECTURE.md, AGENTS.md, DESIGN.md, DATA.md
│  ├─ design/          canvas e marca
│  └─ v0/              o Moductus suíte de utilitários
└─ .github/workflows/  ci.yml e release.yml
```

O código .NET do v0 saiu da árvore na fase 1; a tag `v0.4.0` preserva a versão final dele.

---

## 7. Build e distribuição

- **CI (`ci.yml`):** GitHub Actions em `windows-latest`, a cada push no `main` e em PR: `pnpm format:check`, `pnpm -r lint` (ESLint e o lint visual), `pnpm -r typecheck`, `pnpm -r test`, `pnpm build`, fumaça do serviço (`pnpm --filter @moductus/servico fumaca`: o bundle sobe e fica pronto), `cargo clippy --all-targets -- -D warnings`, `cargo test` e `pnpm tauri build --no-bundle`.
- **Sidecar:** o `pnpm build` (que o Tauri roda antes de empacotar) gera o `servico.mjs` e copia o `node.exe` que está rodando para `src-tauri/binaries/node-x86_64-pc-windows-msvc.exe` (`scripts/preparar-sidecar.mjs`). O instalador leva os dois.
- **Release (`release.yml`):** numa tag `v*` (que tem de bater com a versão do `tauri.conf.json`), gera o instalador NSIS (`moductus-<versão>-win-x64-setup.exe`, dados em `%APPDATA%\Moductus`) e o zip portable (`moductus-<versão>-win-x64-portable.zip`, montado por `scripts/empacotar-portable.ps1`, com `portable.txt` e dados ao lado do exe), atesta os dois com `actions/attest-build-provenance` e cria a release como rascunho, pré-release quando a tag tem `-`. No `0.5.0-alpha`, o instalador tem 23,6 MB e o zip 35,6 MB; o `node.exe` é a maior parte dos dois.
- **Atualização:** ainda não entrou. Quando entrar (plugin updater do Tauri, manifesto assinado no GitHub Releases), chega desligada, com opt-in nas configurações.
- **Orçamentos medidos a cada release:** memória privada em repouso abaixo de 200 MB somando casca, WebView2 e serviço (o teste de viabilidade mediu cerca de 150 MB em build de debug); dock visível em menos de 1 s após o login; painel abre em menos de 100 ms. Desde a fase 2, o `node.exe` do serviço tem meta própria: até 40 MB a mais que os 32,1 MB da fase 1.

### Medições da fase 1

Feitas em 08/10/2026 no build de release (`pnpm tauri build --no-bundle`, `0.5.0-alpha`), numa máquina com Windows 11 Pro build 26300, AMD Ryzen 5 1600, 16 GB, monitor principal de 2560×1440 com a barra de tarefas no topo, WebView2 154.0.4258.62 e Node 24.9.0 como sidecar. O roteiro é `scripts/medir.ps1`: abre e fecha o app sozinho e não mexe no mouse nem no teclado.

```powershell
taskkill /IM moductus.exe /F
pnpm tauri build --no-bundle
pwsh -NoProfile -File scripts\medir.ps1
```

| Orçamento | Meta | Medido | Situação |
|---|---|---|---|
| Memória privada em repouso | < 200 MB | **341,7 MB** (337,5 MB numa medição anterior; 341,0 e 349,9 MB depois de o dock nascer antes das outras janelas) | ❌ não cumprido; fica para uma etapa dedicada |
| Dock no lugar depois de iniciar | < 1 s | **0,56 s** com a reserva feita (janela visível em 0,10 s); era 1,08 s antes de o dock nascer antes das outras janelas | ✅ |
| Painel abre | < 100 ms | **mediana 12,9 ms**, máximo 21,4 ms (mediana 11,8 ms, máximo 20,4 ms depois da mudança no dock) | ✅ |

**Memória.** Soma dos bytes privados de `moductus.exe` e de todos os descendentes (o `node.exe` do serviço e os processos do WebView2) depois de 60 s parado, com as quatro janelas criadas e só o dock visível:

| Processo | Privado |
|---|---|
| WebView2, processo de GPU | 101,7 MB |
| WebView2, 4 renderizadores (dock, painel, Sistema, captura) | 26–34 MB cada, 118,5 MB juntos |
| WebView2, processo principal | 50,9 MB |
| WebView2, utilitários (rede, armazenamento, áudio etc.) | 23,8 MB |
| `node.exe` do serviço | 32,1 MB |
| `moductus.exe` (casca) | 12,4 MB |
| `conhost.exe` do serviço | 2,2 MB |
| **Total** | **341,7 MB** |

O WebView2 é 86% da conta; casca, serviço e `conhost` juntos ficam em 47 MB. Flags testadas pela variável `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, mesma máquina, a partir de 337,5 MB:

| Flags | Total |
|---|---|
| nenhuma | 337,5 MB |
| `--renderer-process-limit=1` | 308,3 MB |
| `--disable-gpu` | 252,5 MB |
| as duas | 206,7 MB |
| as duas + `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection` | 204,0 MB |

Nem a combinação mais agressiva chega aos 200 MB, e cada flag tem custo (sem GPU, o Acrylic e as animações passam para a CPU; um renderizador só põe as quatro janelas no mesmo processo). **Decisão:** o orçamento de memória não é cumprido na fase 1. Estes números são o ponto de partida de uma etapa futura dedicada, que deve avaliar criar painel, Sistema e captura só quando forem abertos pela primeira vez (hoje as quatro janelas nascem com o app), as flags acima e o custo de cada uma no visual.

**Dock.** Média de 5 execuções seguidas, de `Start-Process` até a janela `Moductus dock` estar visível e a área de trabalho já reservada. Primeira medição: 1.146, 1.147, 1.050, 1.032 e 1.024 ms (média 1.080 ms; 1.128 ms pelo `%APPDATA%\Moductus\moductus.log`, do início até a linha `dock fixado`, gravada depois de a reserva valer). A janela aparecia em cerca de 110 ms, mas a reserva só entrava quando o `setup` do Tauri rodava, e ele roda depois de todas as janelas declaradas no `tauri.conf.json` criarem os seus WebViews. Agora só o dock é criado antes do `setup`, que fixa o dock e depois cria painel, Sistema e captura (`janelas::criar`): 626, 551, 575, 548 e 507 ms (média 562 ms; 641 ms pelo log), com a janela visível em 96 ms na média. Os cerca de 450 ms que sobram entre a janela aparecer e a reserva são a criação do WebView do próprio dock. Numa rodada anterior, a primeira execução do executável recém-compilado levou 1.966 ms (janela visível só em 1.136 ms, partida a frio do disco) e as outras quatro ficaram entre 520 e 568 ms. A medição parte do processo já pedido; o login acrescenta o tempo até o Windows rodar a entrada de autostart, que não depende do app.

**Painel.** A casca marca o instante em `painel_abrir` e fecha a conta quando a interface avisa, por `painel_pronto`, que desenhou a área (depois de dois quadros); o resultado vai para o log como `painel hoje aberto em N ms`. Cinco aberturas pelo roteiro: 21,4, 15,9, 9,8, 7,9 e 12,9 ms. O roteiro `janelas` do `verificar.ps1`, com clique de verdade, mediu 29,1, 8,3, 8,0, 9,6 e 4,7 ms.

### Medições da fase 2

Feitas em 10/10/2026 no build de release (`pnpm tauri build --no-bundle`) de `feat/fase-2-agentes` no commit `e07bb0b`, na mesma máquina da fase 1 (Windows 11 Pro build 26300, AMD Ryzen 5 1600, 16 GB), com WebView2, Node 24.9.0 como sidecar e o Claude Code 2.1.287 logado.

**Método.** A memória é a da fase 1: bytes privados de `moductus.exe` e de todos os descendentes depois de 60 s parado, só o dock visível (`scripts/medir.ps1`), mais o `node.exe` do serviço isolado, que é o número comparável com os 32,1 MB da fase 1. Cada medida foi repetida três vezes, em pasta de dados temporária e banco novo. As latências vêm de um roteiro do verificador (fora do repositório) que fala com o WebView2 de release pelo protocolo de depuração, com os relógios do dock e do painel calibrados contra o do Node (menor tempo de ida e volta de 40 trocas), um POST de verdade no receptor dos hooks com um `PermissionRequest` sintético e 30 amostras depois de uma de aquecimento. A primeira resposta e o teste de provedor chamam o Claude Code real (poucas chamadas curtas).

| Item | Fase 1 | Fase 2 | Meta |
|---|---|---|---|
| `node.exe` do serviço, repouso 60 s, sem agentes, vigias criados | 32,1 MB | **34,6 MB** (34,2 / 34,6 / 34,6), +2,5 MB | até +40 MB ✅ |
| `node.exe` com os 4 agentes ativos e um modelo conectado, repouso 60 s | — | **35,0 MB** (35,0 / 34,2 / 35,0), +2,9 MB; depois de testar o modelo e 2 conversas, com o depurador ligado: 40,1 MB, +8,0 MB | até +40 MB ✅ |
| Total do app (casca, WebView2, serviço), sem agentes | 341,7 MB | **346,9 MB** (345,3 / 351,1 / 346,9) | < 200 MB ❌ (como na fase 1) |
| Total do app com agentes ativos | — | **350,7 MB** (350,7 / 373,6 / 349,1) | idem |
| Hook (POST) até o ponto no dock, no DOM | — | mediana 8,0 ms, pior 107,4 ms | — |
| Hook até o ponto no dock pintado (2 quadros) | — | mediana 16,0 ms, pior 117,2 ms | — |
| Hook até `aprovacoes.mudou` no canal | — | mediana 7,2 ms, pior 106,5 ms | — |
| Hook até o cartão com "Permitir" no painel | — | mediana 29,5 ms, pior 130,1 ms | — |
| Aprovação ida e volta: clique em Permitir até a resposta HTTP do hook | — | mediana 31,5 ms, pior 139,5 ms | — |
| `aprovacoes.decidir` até a resposta HTTP | — | mediana 5,8 ms, pior 108,2 ms | — |
| Primeira resposta: `conversas.enviar` até o primeiro `conversas.parcial` | — | 3.548 e 3.243 ms (2 amostras) | — |
| `conversas.enviar` até a mensagem pronta | — | 4.825 e 4.392 ms | — |
| `provedores.testar` (chamada curta ao Claude Code) | — | 4.759 ms | — |

**Leitura.**

- **Serviço.** Os agentes, o MCP, o receptor e os vigias custam 2,5 MB em repouso e 2,9 MB com o time ativo, muito abaixo dos 40 MB que a fase se permitia. Todo o aumento de memória do app está no `node.exe`; o total ficou a ±5 MB do da fase 1, dentro da variação entre rodadas.
- **Orçamento total.** Segue não cumprido, pelo mesmo motivo da fase 1 (ADR-0013): a etapa dedicada a reduzir a memória do WebView2 continua pendente.
- **Aprovação pelo dock.** Do POST do hook ao cartão com "Permitir" no painel, a mediana é de 29,5 ms, e o clique de volta custa 31,5 ms: o dock não é o gargalo de nenhum pedido de permissão.
- **Piores casos.** Os 100 a 140 ms do pior caso são bimodais (6 a 8 ms contra 50 a 110 ms) e aparecem também do lado do serviço, então são jitter do serviço ou do sistema, e não foram investigados. Uma rodada sem a calibração dos relógios deu mediana de 38,7 ms e pior caso de 163 ms: o número varia com a carga da máquina.
- **Primeira resposta.** A espera de 3 a 5 s é quase toda do CLI: o serviço devolve o `enviar` em menos de 150 ms e transmite o texto assim que o Claude Code o produz.

---

## 8. Questões em aberto

- **Prévia de janela** com `DwmRegisterThumbnail` exige uma janela nativa por cima da WebView; validar no spike da fase 6 antes de prometer.
- **Translucidez (Acrylic)** no tema Vidro: implementada na fase 1 com fallback sólido ([seção 3](#temas-e-material)); o Windows 10 fica sempre no sólido.
- **Vários monitores:** dock em todos ou só no principal — a fase 1 usa só o principal.
- **Memória em release:** 341,7 MB na fase 1 e 346,9 MB na fase 2, acima do orçamento de 200 MB ([seção 7](#medições-da-fase-2)); o serviço custa só 2,5 MB a mais, então reduzir o total continua sendo uma etapa própria, sobre o WebView2.
- **Agentes em outros modelos:** Codex CLI, Gemini CLI e as APIs da Anthropic e do Gemini não têm adaptador; o Codex só entra pela varredura de processos, porque os hooks dele não falam HTTP ([AGENTS.md](AGENTS.md#5-sessões-de-ia-externas)).
- **Varredura de processos** (`claude`, `codex`, `gemini`) para sessões sem hook: descrita, não implementada.
- **Sessão do Claude Code sem ligação por hooks:** o estado depende de a conexão estar ligada e de a variável `MODUCTUS_HOOKS_TOKEN` existir no terminal que abriu a sessão.

---

## 9. Testes de viabilidade

Feitos em 06/10/2026, numa máquina com Windows 10 Pro, monitor de 2560×1080 e barra de tarefas no topo. O código dos testes fica fora do repositório; aqui estão os resultados.

### Dock no Tauri

| O que | Resultado |
|---|---|
| Reservar espaço como AppBar | ✅ A área de trabalho passou de `0,40,2560,1080` para `64,40,2560,1080`; janela maximizada respeitou o dock; convive com a barra de tarefas em outra borda |
| Não roubar foco | ✅ Com `WS_EX_NOACTIVATE`, abrir o dock e clicar num botão dele não tirou o foco da janela em primeiro plano, e o clique chegou ao Rust |
| Sumir em tela cheia | ✅ `SHQueryUserNotificationState` devolveu `QUNS_BUSY`; o dock escondeu e voltou ao fechar a tela cheia, com consulta a cada 500 ms |
| Memória | Cerca de 112 MB privados (291 MB de working set, com a memória compartilhada do WebView2) em 8 processos, build de debug |

**Achado: o Windows não devolve a reserva sozinho.** Se o processo cai, e até no fechamento normal quando a janela já foi destruída antes da limpeza, a faixa fica reservada e a próxima execução empilha outra. A correção, validada:

1. Ao registrar a AppBar, gravar o identificador da janela num arquivo.
2. Ao iniciar, chamar `ABM_REMOVE` com o identificador gravado — funciona mesmo com a janela morta — antes de registrar de novo.
3. Ao sair, fazer o mesmo com o valor guardado, sem depender da janela ainda existir.

Com isso, fechamento normal libera a faixa e uma queda seguida de nova execução não empilha reservas.

### Serviço: Node ou Bun

Serviço mínimo com SQLite (1.000 inserções) e HTTP, mediana de 5 execuções:

| | Subida até pronto | Memória em repouso | Tamanho |
|---|---|---|---|
| Node 22 (`node:sqlite`) | ~555 ms | ~38 MB | 82 MB (`node.exe`) + scripts |
| Bun 1.3 compilado | ~260 ms | ~51 MB | 94 MB, binário único |

**Decisão: Node.** O serviço sobe uma vez por login, então a diferença de subida não pesa; a memória fica ligada o dia inteiro, e os SDKs de agentes e de MCP têm compatibilidade garantida no Node. Usar Node 24 LTS, em que o `node:sqlite` já não é experimental como no 22.

### Mídia e janelas abertas

| O que | Resultado |
|---|---|
| Mídia tocando (`GlobalSystemMediaTransportControlsSessionManager`) | ✅ Sessões em 22 ms, com app de origem, título, artista, estado e capa |
| Janelas abertas (`EnumWindows`) | ✅ Filtro de janela de app (visível, sem dono, não ferramenta, não camuflada pelo DWM) e agrupamento por executável, em menos de 1 ms |

### Aprovação do Claude Code

Resultado em [AGENTS.md](AGENTS.md#5-sessões-de-ia-externas).
