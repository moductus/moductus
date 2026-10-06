# Moductus — Arquitetura

> O que o produto é e por que existe está em [PRODUCT.md](PRODUCT.md); os agentes estão em [AGENTS.md](AGENTS.md). Aqui está **como o app funciona por dentro**.

**Status:** desenho da fase 0. Nada aqui está implementado ainda; a arquitetura do v0 (.NET + WPF) está em [v0/ARCHITECTURE.md](v0/ARCHITECTURE.md).

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
| Casca | Tauri 2, Rust estável, crate `windows` | Plugins oficiais: global-shortcut, single-instance, autostart, updater, shell (sidecar) |
| Interface | React 19, TypeScript, Vite | Um bundle, várias janelas por rota |
| Estilo | CSS com variáveis (tokens) + Tailwind | Tokens definidos na fase 0 de identidade |
| Animação | Motion | Curta: nada acima de 200 ms |
| Estado na UI | Zustand + TanStack Query | Query para dados do serviço, Zustand para estado de janela |
| Serviço | Node 24 LTS empacotado como sidecar | Escolhido no teste de viabilidade (seção 9) |
| Banco | SQLite (`node:sqlite` ou `better-sqlite3`), FTS5 para busca | Migrações versionadas no repositório |
| Validação | Zod | Mesmo schema para API interna, ferramentas e MCP |
| Testes | Vitest (TS), `cargo test` (Rust), Playwright para fluxos da UI | |
| Pacotes | pnpm workspace | |

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

### Janelas

| Janela | Tipo | Detalhe |
|---|---|---|
| Dock | Sem borda, sempre no topo, fora da barra de tarefas, não ativa ao clicar | Largura fixa (~56–64 px); translúcida quando o sistema permite |
| Painel | Sem borda, sempre no topo, ao lado do dock | Abre ao passar o mouse ou clicar; ganha foco só se tiver campo de texto |
| Sistema | Janela normal com barra de título própria | Maximizável, na barra de tarefas, lembra posição |
| Captura | Sem borda, centralizada, ganha foco | Some ao perder foco ou com `Esc` |

As janelas são criadas no início e escondidas, para abrirem sem atraso.

---

## 4. O serviço (Node)

### Módulos internos

```
servico/
  banco/          conexão, migrações, repositórios por área
  areas/          regras de cada área: tarefas, foco, financas, notas, arquivos, memoria, dev
  agentes/        runtime, roteador, definição dos agentes, histórico
  provedores/     adaptadores CLI e API (ver AGENTS.md)
  ferramentas/    catálogo de ferramentas com schema Zod e nível de efeito
  mcp/            servidor MCP do Moductus, sobre o catálogo de ferramentas
  sessoes/        receptor de eventos do Claude Code, Codex e afins
  agendador/      gatilhos por horário e por intervalo
  conexoes/       GitHub (via gh e API), depois as demais
  api/            WebSocket para a interface
```

### Regras

- **A regra de negócio mora na área, não no prompt.** `areas/tarefas` cria, lista e conclui tarefas; a interface e as ferramentas dos agentes chamam a mesma função. Assim agente e tela nunca divergem, nada que importa depende de o modelo acertar uma conta ou um formato, e as ferramentas são testáveis sem modelo.
- **Ferramenta é uma área exposta.** Cada ferramenta é um schema Zod, uma função de área e um nível de efeito (`leitura`, `interno`, `externo`). `externo` sempre gera cartão de aprovação.
- **Um único catálogo** alimenta o tool calling das APIs, o servidor MCP e a lista de capacidades mostrada na interface.

### Comunicação

- **Interface ↔ serviço:** WebSocket em `127.0.0.1`, porta aleatória e token gerado pela casca ao iniciar o serviço. A casca entrega porta e token às janelas. Mensagens: requisição e resposta para dados, e um canal de eventos (tarefa mudou, agente começou, sessão pediu aprovação).
- **Interface ↔ casca:** comandos Tauri, só para o que é nativo (posicionar dock, mídia, janelas abertas, credenciais).
- **Serviço ↔ casca:** o serviço pede segredos à casca pelo mesmo canal; chave nunca fica em variável persistente nem em log.
- **Sessões de IA externas → serviço:** HTTP local num endpoint dedicado, ver [AGENTS.md](AGENTS.md#5-sessões-de-ia-externas).

### Ciclo de vida

1. O Windows inicia `moductus.exe` (autostart).
2. A casca garante instância única, cria as janelas escondidas e sobe o serviço como sidecar.
3. O serviço abre o banco, aplica migrações, liga o agendador e o receptor de sessões.
4. O dock aparece.
5. Se o serviço cair, a casca reinicia com espera crescente e o dock mostra o estado.

---

## 5. Dados

Um arquivo `moductus.db` em `%APPDATA%\Moductus` (ou ao lado do executável com `portable.txt`, como no v0).

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

Todo registro criado por agente guarda qual agente e qual execução, para o histórico e o desfazer.

---

## 6. Estrutura do repositório

```
moductus/
├─ src-tauri/          casca em Rust
├─ src/                interface React
│  ├─ janelas/         dock, painel, sistema, captura
│  ├─ areas/           uma pasta por área do Sistema
│  ├─ componentes/     base visual
│  └─ tokens/          design tokens
├─ servico/            sidecar Node
├─ pacotes/
│  └─ contrato/        tipos e schemas compartilhados entre interface e serviço
├─ docs/
│  ├─ PRODUCT.md
│  ├─ ARCHITECTURE.md
│  ├─ AGENTS.md
│  └─ v0/              o Moductus suíte de utilitários
└─ .github/workflows/  build, testes e release
```

O código .NET do v0 sai da árvore quando a fase 1 começar; a tag `v0.4.0` preserva a versão final dele.

---

## 7. Build e distribuição

- **CI:** GitHub Actions em `windows-latest`: `pnpm` (tipos, lint, Vitest), `cargo test`, build do Tauri.
- **Release:** instalador NSIS e zip portable, com attestation do Actions, como no v0.
- **Atualização:** plugin updater do Tauri, opt-in nas configurações, manifesto assinado publicado no GitHub Releases.
- **Orçamentos medidos a cada release:** memória privada em repouso abaixo de 200 MB somando casca, WebView2 e serviço (o teste de viabilidade mediu cerca de 150 MB em build de debug); dock visível em menos de 1 s após o login; painel abre em menos de 100 ms.

---

## 8. Questões em aberto

- **Prévia de janela** com `DwmRegisterThumbnail` exige uma janela nativa por cima da WebView; validar no spike da fase 6 antes de prometer.
- **Translucidez (Acrylic)** no tema Vidro: só dá para validar no Windows 11; o teste de viabilidade rodou no Windows 10, onde vale o fallback sólido.
- **Vários monitores:** dock em todos ou só no principal — começar pelo principal.
- **Memória em release:** os números da seção 9 são de build de debug; medir de novo no primeiro build de release da fase 1.

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
