# Moductus

**O seu dia no PC, num dock só.**

Um sistema pessoal para Windows, open source: fica sempre à mão num dock lateral e é cuidado por um time de agentes de IA, com o modelo que você escolher.

[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-171717)](LICENSE)
[![Release](https://img.shields.io/github/v/release/moductus/moductus?include_prereleases&color=171717)](https://github.com/moductus/moductus/releases)

---

> **Status: pivô em desenho.** O Moductus está deixando de ser uma suíte de utilitários para virar um sistema pessoal com agentes. O desenho (fase 0) está em [docs/](docs/); a fase 1 (a casca) está em construção. Quem quer a suíte de utilitários usa a tag [`v0.4.0`](https://github.com/moductus/moductus/tree/v0.4.0), que guarda o código .NET.

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
| **Sessões de IA** | O que o Claude Code, o Codex e afins estão fazendo em cada projeto, com aprovação pelo dock |
| **Notas** | Markdown que salva sozinho |
| **Arquivos** | Caixa de entrada que os agentes resumem, classificam e lançam |
| **Memória** | O que você e os agentes precisam lembrar |
| **Ferramentas** | Os utilitários da suíte original: Freeze, Ports, Links, Kill, Peek, Awake, Mic |

## Os agentes

| Agente | Cuida de |
|---|---|
| **Demandas** | Tarefas, agenda e foco; briefing da manhã e fechamento do dia |
| **Finanças** | Lançamentos por texto, print ou extrato; orçamento e recorrências |
| **Dev** | GitHub e as sessões de agentes de código |
| **Memória** | Guarda e recupera contexto para os outros agentes |

Cada agente escolhe o próprio modelo: um agente CLI com a assinatura que você já tem (Claude Code, Codex, Gemini) ou uma API (Anthropic, OpenAI ou qualquer endpoint compatível, inclusive modelo local).

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
| [docs/DESIGN.md](docs/DESIGN.md) | Os três temas e os tokens |
| [docs/v0/](docs/v0/) | A suíte de utilitários original, como registro |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Como contribuir durante o pivô |

## A suíte original (v0)

A `v0.4.0` é a última versão da suíte de utilitários: doze módulos acionados por uma tecla líder, em .NET e WPF. O código dela saiu da árvore na fase 1 e fica preservado na tag [`v0.4.0`](https://github.com/moductus/moductus/tree/v0.4.0); os binários continuam [nas releases](https://github.com/moductus/moductus/releases) e o desenho está em [docs/v0/](docs/v0/). Nenhum módulo é descartado no pivô; todos mudam de lugar, como mostra a [seção 7 do PRODUCT.md](docs/PRODUCT.md#7-o-que-vem-do-moductus-v0).

## Licença

[MIT](LICENSE).
