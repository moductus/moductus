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
| Serviço | Node 22+ empacotado como sidecar | Alternativa a avaliar: Bun compilado em binário único |
| Banco | SQLite (`node:sqlite` ou `better-sqlite3`), FTS5 para busca | Migrações versionadas no repositório |
| Validação | Zod | Mesmo schema para API interna, ferramentas e MCP |
| Testes | Vitest (TS), `cargo test` (Rust), Playwright para fluxos da UI | |
| Pacotes | pnpm workspace | |

---

## 3. A casca nativa (Rust)

Expõe comandos Tauri pequenos e eventos. Tudo o que ela sabe fazer:

| Capacidade | API do Windows | Usado por |
|---|---|---|
| Dock que reserva espaço | `SHAppBarMessage` (AppBar), lado e monitor configuráveis | Dock no modo fixo |
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

- **As áreas não sabem de IA.** `areas/tarefas` cria, lista e conclui tarefas; a interface e as ferramentas dos agentes chamam a mesma função. É o que garante o princípio "funciona sem IA".
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
- **Orçamentos medidos a cada release:** memória em repouso abaixo de 150 MB; dock visível em menos de 1 s após o login; painel abre em menos de 100 ms.

---

## 8. Questões em aberto

- **Node empacotado ou Bun compilado** para o serviço: Bun gera binário único e sobe mais rápido; Node tem compatibilidade garantida com os SDKs. Decidir com um spike medindo tamanho e memória.
- **Prévia de janela** com `DwmRegisterThumbnail` exige uma janela nativa por cima da WebView; validar no spike da fase 6 antes de prometer.
- **Translucidez (Mica/Acrylic)** no dock: Tauri expõe efeitos de janela no Windows 11; definir o fallback sólido para o Windows 10.
- **Vários monitores:** dock em todos ou só no principal — começar pelo principal.
