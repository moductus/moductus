# Moductus — Arquitetura

> O que o produto é e por que existe está em [PRODUCT.md](PRODUCT.md); os agentes estão em [AGENTS.md](AGENTS.md). Aqui está **como o app funciona por dentro**.

**Status:** fase 1 (a casca) implementada: casca Tauri com o dock, painel, Sistema e captura; serviço Node como sidecar supervisionado; canal WebSocket com token; configurações de ponta a ponta; temas; acessibilidade; release. Agentes, provedores, ferramentas e as áreas com dados chegam a partir da fase 2 — onde o texto descreve algo ainda não feito, ele diz "previsto". A arquitetura do v0 (.NET + WPF) está em [v0/ARCHITECTURE.md](v0/ARCHITECTURE.md).

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
| Validação | Zod 4, no pacote `@moductus/contrato` | Mesmo schema na interface e no serviço; ferramentas e MCP usam o mesmo (previsto) |
| Testes | Vitest (TS; `happy-dom` nos componentes), `cargo test` (Rust), roteiros de tela em PowerShell (`scripts/verificar.ps1`) | Playwright não entrou: os fluxos de tela rodam no app real, com UI Automation |
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
| Notificação | Toast do Windows | Avisos importantes |

Os módulos nativos do v0 (`Power.cs`, `DwmThumbnail.cs`, `MicrophoneMute.cs`, `TcpListeners.cs`, `ScreenCapture.cs`, `TextRecognizer.cs`) são a especificação do port: mesmas chamadas, agora pela crate `windows`.

Na fase 1 entraram o dock que reserva espaço (com os modos esconder e inteligente), tela cheia, mídia, microfone, manter acordado e credenciais. Janelas abertas, prévia de janela, ocultar a barra do Windows, tela/OCR e toast ficam para as fases que os usam.

### Módulos (`src-tauri/src`)

| Módulo | O que faz |
|---|---|
| `lib.rs` | Monta o app: plugins, comandos, ordem do `setup`, eventos de janela e limpeza na saída |
| `dados.rs` | Pasta de dados: `%APPDATA%\Moductus`, ou a pasta do exe quando há `portable.txt` ao lado |
| `registro.rs` | `moductus.log` na pasta de dados, uma linha `<epoch ms> <texto>` por evento; a interface escreve nele pelo comando `interface_registro`. Nunca recebe segredo (há teste para isso) |
| `appbar.rs` | O dock como AppBar (`SHAppBarMessage`): reserva, `ABN_POSCHANGED`, DPI, `TaskbarCreated`; grava o identificador em `appbar.hwnd` e chama `ABM_REMOVE` com ele ao iniciar e ao sair (seção 9) |
| `dock.rs` | Lado, modo (fixo, esconder, inteligente) e forma (colada, flutuante) do dock; `WS_EX_NOACTIVATE` + `WS_EX_TOOLWINDOW`; modo teclado (Ctrl+Alt+D) |
| `tela_cheia.rs` | `SHQueryUserNotificationState` a cada 500 ms: no modo inteligente o dock some, no fixo só perde o "sempre no topo" |
| `janelas.rs` | Painel ao lado do dock (com a medição de abertura), Sistema (lembra posição em `sistema.json`, 12 áreas) e captura |
| `atalhos.rs` | Atalhos globais: Ctrl+Alt+N (Sistema), Ctrl+Alt+D (dock), Ctrl+Alt+Espaço (captura); recusa com motivo o que outro programa já usa |
| `bandeja.rs`, `inicio.rs` | Ícone na bandeja; instância única (a segunda execução foca a primeira); autostart, inclusive `--autostart ligar\|desligar` |
| `midia.rs` | Sessão de mídia do Windows por evento, com capa |
| `controles.rs` | Microfone mudo (`IAudioEndpointVolume` com callback) e manter acordado (`PowerSetRequest`) |
| `servico.rs` | Sobe e supervisiona o serviço (seção 4) |
| `config_nativa.rs` | Aplica o que o serviço manda sobre dock, atalhos e autostart, desfazendo tudo se uma parte falhar |
| `credenciais.rs` | Gerenciador de Credenciais (`Cred*`, alvo `Moductus/<nome>`), atendendo pedidos do serviço pelo canal stdio. O serviço ainda não pede nenhum: entra com os provedores na fase 2 |
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

O que existe desde a fase 1, em `servico/src`:

```
servico/src/
  main.ts         entrada: abre o banco, liga o canal com a casca e o WebSocket, avisa "pronto"
  api/            servidor WebSocket para a interface (servidor.ts)
  banco/          conexão (WAL, foreign_keys, busy_timeout) e o executor de migrações
  migracoes/      uma migração por arquivo: 001-config, 002-onboarding
  casca/          canal stdio com a casca (pedidos com id e resposta)
  config/         preferências: valida, manda à casca o que é nativo, grava, avisa quem ouve
  primeiro-uso/   os cinco passos do primeiro uso e o tutorial
  outro-pc/       exportar e importar as configurações num arquivo .moductus (zip, até 4 MB)
```

Previstos a partir da fase 2, no mesmo serviço:

```
  areas/          regras de cada área: tarefas, foco, financas, notas, arquivos, memoria, dev
  agentes/        runtime, roteador, definição dos agentes, histórico
  provedores/     adaptadores CLI e API (ver AGENTS.md)
  ferramentas/    catálogo de ferramentas com schema Zod e nível de efeito
  mcp/            servidor MCP do Moductus, sobre o catálogo de ferramentas
  sessoes/        receptor de eventos do Claude Code, Codex e afins
  agendador/      gatilhos por horário e por intervalo
  conexoes/       GitHub (via gh e API), depois as demais
```

O serviço é empacotado pelo esbuild num arquivo só (`servico/dist/servico.mjs`); as dependências de execução são `ws`, `fflate` e o pacote `@moductus/contrato`. O banco é o `node:sqlite` do próprio Node 24.

### Regras

- **A regra de negócio mora na área, não no prompt.** `areas/tarefas` cria, lista e conclui tarefas; a interface e as ferramentas dos agentes chamam a mesma função. Assim agente e tela nunca divergem, nada que importa depende de o modelo acertar uma conta ou um formato, e as ferramentas são testáveis sem modelo.
- **Ferramenta é uma área exposta.** Cada ferramenta é um schema Zod, uma função de área e um nível de efeito (`leitura`, `interno`, `externo`). `externo` sempre gera cartão de aprovação.
- **Um único catálogo** alimenta o tool calling das APIs, o servidor MCP e a lista de capacidades mostrada na interface.

### Comunicação

- **Interface ↔ serviço:** WebSocket em `127.0.0.1`, porta escolhida pelo sistema (o serviço escuta na porta 0 e informa a real) e token gerado pela casca a cada subida do serviço: 32 bytes do `BCryptGenRandom`, em hexadecimal. A casca entrega porta e token às janelas pelo evento `servico` e pelo comando `servico_estado`. A conexão leva o token no parâmetro `token` da URL; o serviço compara em tempo constante e recusa com 401 antes do upgrade. Cada mensagem é validada pelo contrato: requisição e resposta (`config.obter`, `config.definir`, `config.exportar`, `config.importar`, `primeiroUso.*`…) e eventos (`sistema.ola`, `config.mudou`, `primeiroUso.mudou`).
- **Interface ↔ casca:** comandos Tauri, só para o que é nativo (dock, painel, Sistema, captura, mídia, microfone, manter acordado, material, atalhos, autostart).
- **Serviço ↔ casca:** linhas JSON pelo stdin e stdout do serviço, cada pedido com um `id` e a resposta com o mesmo `id`. O serviço manda `pronto` (com a porta), `aplicar` (configuração nativa) e `credencial` (guardar, ler, apagar); o stderr vai para o log como `servico: …`. Chave nunca fica em variável persistente nem em log.
- **Sessões de IA externas → serviço:** HTTP local num endpoint dedicado, ver [AGENTS.md](AGENTS.md#5-sessões-de-ia-externas) (previsto).

### O contrato (`pacotes/contrato`)

Um pacote só de schemas Zod e tipos, usado pela interface e pelo serviço: `canal.ts` (envelope de pedido, resposta e evento), `metodos.ts` (cada método com o schema da entrada e da saída, e os eventos), `config.ts` (a configuração e o padrão), `primeiro-uso.ts`, `outro-pc.ts` e `cliente.ts`, o cliente WebSocket da interface, que reconecta sozinho (250 ms dobrando até 5 s) e troca de endereço quando a casca sobe um serviço novo. `VERSAO_PROTOCOLO` marca mudanças incompatíveis.

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

### Ciclo de vida

1. O Windows inicia `moductus.exe` (autostart).
2. A casca garante instância única, limpa a reserva órfã do dock, cria as janelas escondidas (o dock visível), registra a AppBar e sobe o serviço como sidecar.
3. O serviço abre o banco, aplica migrações, liga o WebSocket, avisa `pronto` e reaplica a configuração nativa. (Agendador e receptor de sessões: previstos.)
4. As janelas recebem porta e token e se conectam.
5. Se o serviço cair, a casca reinicia com espera crescente e o dock mostra o estado.

---

## 5. Dados

Um arquivo `moductus.db` em `%APPDATA%\Moductus` (ou ao lado do executável com `portable.txt`, como no v0). Na mesma pasta ficam `moductus.log`, `sistema.json` (posição do Sistema) e `appbar.hwnd` (identificador do dock para limpar reserva órfã).

Na fase 1 o banco tem só `config` (preferências, uma linha JSON por chave) e `onboarding` (passos do primeiro uso). As tabelas abaixo entram com as áreas e os agentes.

| Tabela (agrupada) | Conteúdo |
|---|---|
| `tarefas`, `listas`, `recorrencias` | Tarefas e repetição |
| `sessoes_foco` | Cada pomodoro, ligado ou não a uma tarefa |
| `contas`, `lancamentos`, `categorias`, `orcamentos` | Finanças |
| `notas` | Markdown, com FTS5 |
| `arquivos` | Itens da caixa de entrada, texto extraído, destino |
| `memorias` | Fatos com origem, agente, data e FTS5 |
| `agentes`, `conversas`, `mensagens`, `execucoes` | Configuração e histórico dos agentes |
| `aprovacoes` | Cartões pendentes e decididos |
| `sessoes_ia`, `eventos_sessao` | Sessões externas e o que fizeram |
| `config` | Preferências (substitui o `config.json` do v0) |

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
│  ├─ componentes/     base visual
│  ├─ nativo/          hooks e comandos da casca (eventos.ts, acessibilidade.ts, arquivos.ts)
│  ├─ servico/         conexão com o serviço (useCanal)
│  ├─ teste/           apoio dos testes de componente
│  └─ tokens/          design tokens, temas, fontes, alto contraste
├─ servico/            sidecar Node
├─ pacotes/
│  └─ contrato/        schemas Zod e cliente WebSocket compartilhados entre interface e serviço
├─ scripts/            build do sidecar, lint visual, fumaça, roteiros de tela e de medição, zip portable
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
- **Orçamentos medidos a cada release:** memória privada em repouso abaixo de 200 MB somando casca, WebView2 e serviço (o teste de viabilidade mediu cerca de 150 MB em build de debug); dock visível em menos de 1 s após o login; painel abre em menos de 100 ms.

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

---

## 8. Questões em aberto

- **Prévia de janela** com `DwmRegisterThumbnail` exige uma janela nativa por cima da WebView; validar no spike da fase 6 antes de prometer.
- **Translucidez (Acrylic)** no tema Vidro: implementada na fase 1 com fallback sólido ([seção 3](#temas-e-material)); o Windows 10 fica sempre no sólido.
- **Vários monitores:** dock em todos ou só no principal — a fase 1 usa só o principal.
- **Memória em release:** medida na fase 1 em 341,7 MB, acima do orçamento de 200 MB ([seção 7](#medições-da-fase-1)); reduzir é uma etapa própria.

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
