# Moductus

**O seu dia no PC, num dock só.**

Um sistema pessoal para Windows, open source: fica sempre à mão num dock lateral e é cuidado por um time de agentes de IA, com o modelo que você escolher.

[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-171717)](LICENSE)
[![Release](https://img.shields.io/github/v/release/moductus/moductus?include_prereleases&color=171717)](https://github.com/moductus/moductus/releases)

---

> **Status: alfa dos agentes (fase 2).** A última versão publicada é a `v0.5.0-alpha`, a casca; a `v0.6.0-alpha` sai com o PR da fase 2. O Moductus está deixando de ser uma suíte de utilitários para virar um sistema pessoal com agentes. A fase 1 entregou a casca: o dock que reserva espaço na lateral, os painéis, o Sistema com as 12 áreas navegáveis, a captura rápida, mídia, microfone, manter acordado, os três temas, atalhos, autostart e as configurações. A fase 2 ligou os agentes: o **Nuno** acompanha as sessões do Claude Code e o GitHub, e você aprova os pedidos de permissão pelo dock; os quatro agentes conversam com o modelo que você conectar (o Claude Code, com a sua assinatura, ou uma API compatível com a da OpenAI), dormem quando o modelo acaba e só agem fora do Moductus com o seu sim. Tarefas, finanças, notas, arquivos e memória, com os dados de cada área, chegam a partir da fase 3. Quem quer a suíte de utilitários usa a tag [`v0.4.0`](https://github.com/moductus/moductus/tree/v0.4.0), que guarda o código .NET.

## Instalar

Windows 10 ou 11, 64 bits. Baixe da [página de releases](https://github.com/moductus/moductus/releases) um dos dois:

- **Instalador** (`moductus-v0.5.0-alpha-win-x64-setup.exe`): instalador NSIS; dados e configurações ficam em `%APPDATA%\Moductus`.
- **Portable** (`moductus-v0.5.0-alpha-win-x64-portable.zip`): extraia numa pasta e rode `moductus.exe`. O `portable.txt` ao lado do exe faz o Moductus guardar tudo naquela pasta; apague-o para usar `%APPDATA%\Moductus`. No modo portable o autostart fica desligado.

Os dois arquivos levam attestation do GitHub Actions, que liga o binário ao commit que o gerou. Atualização automática ainda não existe: baixe a versão nova pela mesma página.

O dock aparece na borda esquerda e reserva o espaço dele, como a barra de tarefas. **Sair do Moductus**, no ícone da bandeja, encerra o Moductus e devolve o espaço. Atalhos de fábrica: `Ctrl+Alt+N` abre o Sistema, `Ctrl+Alt+D` alterna o dock entre visível, com o teclado e escondido, `Ctrl+Alt+Espaço` abre a captura.

## Rodar em desenvolvimento

Pré-requisitos: [Node 24](https://nodejs.org/) ou mais novo, [pnpm 10](https://pnpm.io/installation) (a versão exata está em `packageManager` no `package.json`), [Rust estável](https://rustup.rs/) com o alvo MSVC e o [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (já vem no Windows 11). Os pré-requisitos do Tauri no Windows estão em [tauri.app](https://tauri.app/start/prerequisites/).

```powershell
git clone https://github.com/moductus/moductus.git
cd moductus
pnpm install
node scripts/preparar-sidecar.mjs
pnpm tauri dev
```

Os agentes pedem duas coisas do seu PC, e só se você for usá-los de verdade: o Claude Code (`claude`) com login, para o Moductus usar a sua assinatura, e o [GitHub CLI](https://cli.github.com) (`gh`) com `gh auth login`, para o Nuno ler os seus PRs. Para desenvolver e testar nenhum dos dois faz falta: os testes usam um provedor falso e nunca chamam modelo nem rede.

O `preparar-sidecar.mjs` copia o seu `node.exe` para `src-tauri/binaries/` (fora do Git, ~80 MB): o Tauri exige o binário do sidecar para compilar, mesmo em desenvolvimento. Basta rodar uma vez, ou de novo ao trocar de versão do Node. O `pnpm tauri dev` gera o serviço, sobe o Vite em `http://localhost:1420` e abre o app; em desenvolvimento a casca roda o serviço com o `node` do PATH.

Build de release, sem e com instalador:

```powershell
pnpm tauri build --no-bundle
pnpm tauri build
```

O primeiro deixa `src-tauri/target/release/moductus.exe`; o segundo, o instalador em `src-tauri/target/release/bundle/nsis/`. O zip portable sai de `pwsh -File scripts/empacotar-portable.ps1 -Versao v0.5.0-alpha -Destino artefatos`, depois do `pnpm tauri build`.

### Testes

Os mesmos passos do CI, da raiz:

```powershell
pnpm format:check
pnpm -r lint
pnpm -r typecheck
pnpm -r test
pnpm build
pnpm --filter @moductus/servico fumaca
cd src-tauri
cargo clippy --all-targets -- -D warnings
cargo test
```

Os comandos e as regras para contribuir estão no [CONTRIBUTING.md](CONTRIBUTING.md).

### Roteiros na tela real

O que depende do Windows de verdade (reserva de espaço, foco, tela cheia, atalhos globais, UI Automation) é conferido por roteiros em PowerShell contra o app compilado. **Eles mexem no mouse e no teclado, abrem janelas de teste e cobrem a tela por alguns segundos: não use o PC enquanto rodam.**

```powershell
pnpm tauri build --debug --no-bundle
pwsh -File scripts/verificar.ps1 -Roteiro appbar
```

Os roteiros são `appbar`, `modos`, `telacheia`, `janelas`, `atalhos`, `inicio`, `midia`, `controles`, `servico`, `teclado` e `acessibilidade`; sem `-Roteiro`, roda todos. O `scripts/medir.ps1` mede memória, tempo até o dock e abertura do painel no build de release, sem mexer no mouse (mas abre e fecha o app algumas vezes); os números estão no [ARCHITECTURE.md](docs/ARCHITECTURE.md#medições-da-fase-1), e os da fase 2 em [medições da fase 2](docs/ARCHITECTURE.md#medições-da-fase-2).

## O que é

Tarefas, foco, dinheiro, código e memória num lugar que nunca sai do lado da tela, com agentes que trabalham em segundo plano e avisam quando precisam de você.

O app existe em duas camadas:

- **O dock**, na lateral da tela: o estado de cada área ao vivo, as sessões de IA de cada projeto, a mídia tocando, os apps abertos. Cada ícone abre um painel de ações rápidas ao lado.
- **O Sistema**, uma janela normal: o app completo, com todas as áreas, a conversa com os agentes e as configurações.

Entre os dois, a **captura rápida** transforma uma frase solta em tarefa, gasto, nota ou memória.

## As áreas

| Área | O que faz |
|---|---|
| **Tarefas** | Listas, datas, recorrência, entrada em linguagem natural |
| **Foco** | Pomodoro ligado à tarefa, com histórico |
| **Finanças** | Contas, lançamentos, orçamento, recorrentes, importação de extrato |
| **Dev** | PRs esperando você, reviews a atender, issues atribuídas, CI quebrado |
| **Sessões de IA** | O que o Claude Code e o OpenCode estão fazendo em cada projeto, com aprovação do Claude Code pelo dock |
| **Notas** | Markdown que salva sozinho |
| **Arquivos** | Caixa de entrada que os agentes resumem, classificam e lançam |
| **Memória** | O que você e os agentes precisam lembrar |
| **Ferramentas** | Os utilitários da suíte original: Freeze, Ports, Links, Kill, Peek, Awake, Mic |

Na fase 2 funcionam Sessões de IA e Dev, a conversa com os agentes e as configurações de modelos, conexões e notificações; as demais áreas chegam nas fases 3 a 6.

## Os agentes

| Agente | Função | Cuida de |
|---|---|---|
| **Alba** | Cuida do seu dia | Agenda, tarefas, lembretes e rotina; briefing da manhã e fechamento do dia |
| **Tula** | Cuida do seu dinheiro | Gastos, dívidas, planos de economia e orçamento |
| **Faina** | Faz o serviço pesado | Organizar, limpar e criar arquivos e documentos no PC, com prévia e desfazer |
| **Nuno** | Fica de olho nas suas IAs e no seu código | Sessões do Claude Code e do OpenCode (Codex e outros: previstos), com contexto e gasto; PRs e issues |

Os quatro vêm de fábrica; no futuro, você cria os seus. Na fase 2 só o Nuno tem ferramentas e trabalha sozinho; Alba, Tula e Faina conversam e ganham as delas com as áreas.

Cada agente escolhe o próprio modelo. Hoje: o Claude Code, com a assinatura que você já tem, ou uma API compatível com a da OpenAI (a própria OpenAI, OpenRouter, Ollama e outros, inclusive modelo local). Codex, Gemini CLI e as APIs da Anthropic e do Gemini são previstos.

## Princípios

- **Agentes no centro.** Você pede, eles fazem e avisam; as telas servem para acompanhar e agir rápido.
- **Você escolhe o modelo.** Por agente, e trocar não muda nada no resto do app.
- **Seus dados ficam com você.** Banco local, chaves no Gerenciador de Credenciais do Windows, sem conta e sem servidor. Rede só para o que você ligar. Sem telemetria.
- **O agente propõe, você aprova.** Nada sai do Moductus — comentário, mensagem, arquivo movido — sem o seu sim.

## Visual

Três temas de fábrica sobre a mesma estrutura: **Grafite** (escuro e monocromático), **Papel** (claro e calmo) e **Vidro** (translúcido, integrado ao Windows 11). Ou automático, seguindo o modo do Windows.

## Stack

Tauri 2 com uma casca fina em Rust para o que é nativo do Windows, interface em React e TypeScript, e um serviço em segundo plano em TypeScript para dados, agentes e ferramentas (com servidor MCP).

## Documentação

| Documento | O que responde |
|---|---|
| [docs/PRODUCT.md](docs/PRODUCT.md) | O que o produto é, por que existe, roadmap e decisões |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Como funciona por dentro: processos, casca nativa, serviço, dados |
| [docs/AGENTS.md](docs/AGENTS.md) | Agentes, provedores de modelo, ferramentas, aprovação, sessões de IA |
| [docs/DESIGN.md](docs/DESIGN.md) | Os três temas, os tokens, os personagens e a marca |
| [docs/DATA.md](docs/DATA.md) | O que cada área guarda e como |
| [docs/v0/](docs/v0/) | A suíte de utilitários original, como registro |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Como contribuir durante o pivô |

## A suíte original (v0)

A `v0.4.0` é a última versão da suíte de utilitários: doze módulos acionados por uma tecla líder, em .NET e WPF. O código dela saiu da árvore na fase 1 e fica preservado na tag [`v0.4.0`](https://github.com/moductus/moductus/tree/v0.4.0); os binários continuam [nas releases](https://github.com/moductus/moductus/releases) e o desenho está em [docs/v0/](docs/v0/). Nenhum módulo é descartado no pivô; todos mudam de lugar, como mostra a [seção 7 do PRODUCT.md](docs/PRODUCT.md#7-o-que-vem-do-moductus-v0).

## Licença

[MIT](LICENSE).
