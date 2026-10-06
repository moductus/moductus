# Moductus — Documento de Produto

> Um sistema pessoal para o Windows: fica sempre à mão num dock lateral, e um time de agentes de IA — com o modelo que você escolher — cuida das suas demandas, finanças, código e memória.

**Status:** pivô em desenho. A suíte de utilitários (`v0.4.0`) foi o produto até aqui; o registro dela está em [v0/](v0/). Este documento descreve o produto novo e é a fonte de verdade a partir de agora.
**Última revisão:** outubro de 2026

---

## Sumário

1. [Tese do produto](#1-tese-do-produto)
2. [Princípios](#2-princípios)
3. [As duas camadas](#3-as-duas-camadas)
4. [O dock](#4-o-dock)
5. [O Sistema](#5-o-sistema)
6. [Os agentes](#6-os-agentes)
7. [O que vem do Moductus v0](#7-o-que-vem-do-moductus-v0)
8. [Atalhos](#8-atalhos)
9. [Privacidade e dados](#9-privacidade-e-dados)
10. [Roadmap](#10-roadmap)
11. [Decisões registradas](#11-decisões-registradas)
12. [Riscos conhecidos](#12-riscos-conhecidos)
13. [Referências](#13-referências)

---

## 1. Tese do produto

> O lugar onde o seu dia acontece no PC: tarefas, foco, dinheiro, código e memória num dock que nunca sai do lado da tela, com agentes que trabalham em segundo plano e avisam quando precisam de você.

O Moductus v0 resolvia "preciso de um utilitário agora". O Moductus novo resolve "preciso acompanhar tudo o que está acontecendo, e alguém para cuidar do que é repetitivo". A diferença muda o produto inteiro:

| | v0 — suíte de utilitários | Agora — sistema pessoal com agentes |
|---|---|---|
| Presença | Aparece e some | Sempre à mão no dock |
| Entrada | Tecla líder | Dock, captura rápida e Sistema |
| Dados | Um `config.json` | Banco local com tarefas, lançamentos, sessões e memórias |
| Rede | Proibida | Só para o provedor de IA e as conexões que você liga |
| Trabalho | Só quando chamado | Agentes rodando em segundo plano |

### Para quem

Para quem passa o dia no PC, trabalha com código e quer um único lugar para o dia: o que fazer, quanto foco já teve, quanto gastou no mês, quais PRs esperam review e o que os agentes de IA estão fazendo em cada projeto.

### Contra quem

- **Niko** ([vitorcgo/Niko](https://github.com/vitorcgo/Niko)) — a referência mais próxima: sistema de vida para Windows, com agentes por área e provedor à escolha. É proprietário (licença proíbe obras derivadas), então serve de referência de produto, nunca de código. O Moductus se diferencia por ser **open source**, por tratar **agentes de código externos** (Claude Code, Codex, Antigravity) como cidadãos de primeira classe, e por usar **agentes CLI com a assinatura que você já paga**.
- **Notion, Todoist, Mobills e afins** — cada um cobre uma área, na nuvem, sem saber das outras.
- **Raycast** — rápido e bonito, mas é lançador; não acompanha o dia.

### Não-objetivos

- Não é um app de nuvem: não tem conta, login nem servidor Moductus.
- Não é um cliente de chat genérico de IA: o chat existe para operar o seu dia, não para conversar sobre qualquer coisa.
- Não é um orquestrador de agentes de código: ele **acompanha e aprova** sessões do Claude Code e afins, não substitui essas ferramentas.
- Não movimenta dinheiro: finanças é registro, orçamento e alerta, nunca pagamento ou transferência.
- Não tem versão paga.

---

## 2. Princípios

1. **Funciona sem IA.** Toda área tem caminho próprio: dá para criar tarefa, lançar gasto e rodar pomodoro sem nenhum provedor ligado. A IA melhora o que já funciona, não é condição para funcionar.
2. **Você escolhe o modelo.** Cada agente pode usar um provedor diferente: um agente CLI (Claude Code, Codex, Gemini, Antigravity) com a sua assinatura, ou uma API (Anthropic, OpenAI ou qualquer endpoint compatível, inclusive modelo local). Trocar de modelo não muda nada no resto do app.
3. **Seus dados ficam com você.** Tudo em um banco local; chaves no Gerenciador de Credenciais do Windows. Rede só para o que você ligou, e cada conexão diz o que envia.
4. **O agente propõe, você aprova.** Ação com efeito fora do Moductus — comentar no GitHub, mover arquivo, enviar mensagem — sempre passa por um cartão de aprovação. Dentro do Moductus (criar tarefa, lançar gasto), o agente age e mostra o que fez, com desfazer.
5. **Sempre à mão, nunca no caminho.** O dock não rouba foco, some em tela cheia e responde instantaneamente. Animação curta, nunca acima de 200 ms.

---

## 3. As duas camadas

O app existe em duas camadas, como um sistema operacional pequeno dentro do Windows:

| Camada | Onde fica | Para que serve |
|---|---|---|
| **Dock** (nível 1) | Lateral da tela, esquerda ou direita | Acompanhar e agir rápido: estado de cada área, sessões de IA, mídia, apps abertos. Cada ícone abre um painel de ações ao lado. |
| **Sistema** (nível 2) | Janela normal, maximizável | O app completo: todas as áreas em tela cheia, conversa com os agentes, configurações. |

Entre as duas existe a **captura rápida**: um campo flutuante, chamado por atalho, que transforma uma frase solta em tarefa, gasto, nota ou memória.

---

## 4. O dock

Uma faixa vertical colada na lateral da tela. De cima para baixo:

| Seção | O que mostra | O que o painel lateral faz |
|---|---|---|
| **Marca** | Logo do Moductus | Abre ou esconde o Sistema |
| **Áreas** | Tarefas, Foco, Finanças, Dev, Notas, Arquivos — cada uma com indicador ao vivo (contagem, tempo restante, % do orçamento) | Ações rápidas da área: marcar tarefa, pausar foco, lançar gasto, abrir PR |
| **Agentes** | O time do Moductus e as **sessões de IA externas**, agrupadas por projeto, com estado: trabalhando, esperando você, terminou, erro | Ver o que cada sessão está fazendo, aprovar ou negar pedido, abrir o projeto no editor |
| **Apps abertos** | As janelas abertas, agrupadas por programa | Prévia ao vivo, focar, fechar |
| **Mídia** | O que está tocando no Windows | Capa, tocar, pausar, avançar |
| **Controles** | Microfone, manter acordado, volume, relógio | Alternar direto, sem painel |

### Comportamento

- **Lado:** esquerda ou direita, por monitor.
- **Forma:** colado na borda ou flutuante, com cantos arredondados. Cada tema traz uma forma padrão, e você pode trocar.
- **Modos:** *fixo* (reserva espaço na tela, como a barra de tarefas, e as janelas maximizadas respeitam o dock), *esconder* (aparece ao encostar o mouse na borda) e *inteligente* (fixo, mas some quando uma janela entra em tela cheia).
- **Tela cheia:** em jogo, vídeo e apresentação, o dock some por completo.
- **Barra de tarefas do Windows:** como o dock mostra os apps abertos, o Moductus oferece colocar a barra do Windows em ocultar automaticamente. Ele nunca mata nem modifica o Explorer; desligar o Moductus devolve a barra como estava.
- **Foco:** passar o mouse ou clicar não tira o foco da janela em que você está; o teclado só vai para o dock quando um painel pede digitação.
- **Avisos:** o ícone ganha um ponto quando a área ou o agente tem algo para você. Avisos importantes também saem como notificação do Windows.

---

## 5. O Sistema

Janela normal com barra lateral de navegação.

| Área | O que faz |
|---|---|
| **Início** | O dia numa tela: blocos configuráveis de tarefas, foco, finanças, PRs e o briefing do agente de demandas |
| **Agentes** | Conversa com o time, com menção direta (`@dev`, `@financas`); histórico de cada agente e o que cada um fez sozinho |
| **Sessões de IA** | Todas as sessões de agentes de código (Claude Code, Codex, Antigravity): projeto, estado, última ação, pedidos pendentes, consumo e limites |
| **Tarefas** | Listas, datas, prioridade, recorrência; entrada em linguagem natural ("ligar pro banco amanhã 15h") |
| **Foco** | Pomodoro com etapas, sessão ligada a uma tarefa, histórico e relatório |
| **Finanças** | Contas, cartões, lançamentos, categorias, orçamento por categoria, recorrentes, importação de extrato (OFX e CSV), relatórios |
| **Dev** | PRs esperando seu review, PRs seus com review a atender, issues e demandas atribuídas a você, CI quebrado — por repositório |
| **Notas** | Notas em markdown que salvam sozinhas; o bloco rápido do v0 vira a nota fixa do topo |
| **Arquivos** | Caixa de entrada: solte um arquivo e o agente resume, classifica, extrai texto (OCR) ou lança em finanças |
| **Memória** | Fatos, decisões, pessoas e referências que os agentes guardaram ou você pediu para guardar; busca e edição |
| **Ferramentas** | Os utilitários herdados do v0 (seção 7) |
| **Configurações** | Provedores de IA por agente, conexões, dock, atalhos, tema (Grafite, Papel, Vidro ou automático pelo Windows), privacidade, backup |

`Ctrl+K` dentro do Sistema abre uma busca global por qualquer item e comando. É a herança da Palette, agora como coadjuvante.

---

## 6. Os agentes

O time inicial tem quatro agentes. Cada um é uma configuração — instruções, ferramentas permitidas, gatilhos e modelo —, não um código separado. O desenho técnico está em [AGENTS.md](AGENTS.md).

| Agente | Cuida de | Trabalha sozinho quando |
|---|---|---|
| **Demandas** | Tarefas, agenda, foco; captura em linguagem natural, priorização, briefing da manhã e fechamento do dia | No horário do briefing e do fechamento; quando uma tarefa vence |
| **Finanças** | Lançamentos por texto, print ou extrato; categorização; orçamento; recorrências | Quando um extrato cai na caixa de entrada; quando uma categoria passa do orçamento |
| **Dev** | PRs, reviews, issues e demandas no seu nome; CI; as sessões de agentes de código | Periodicamente, consultando o GitHub; quando uma sessão de IA pede aprovação |
| **Memória** | Guarda e recupera o que os outros agentes e você precisam lembrar | Sempre que outro agente pede contexto; quando você diz "guarda isso" |

Agentes novos são configurações novas. A interface do Sistema permite criar um agente com instruções próprias e um subconjunto das ferramentas.

---

## 7. O que vem do Moductus v0

O v0 tinha doze módulos. Nenhum é descartado; todos mudam de lugar, e o código nativo é portado para a stack nova.

| Módulo v0 | Vira |
|---|---|
| **Scratch** (bloco de notas) | Área **Notas**; o bloco vira a nota fixa |
| **Shelf** (bandeja de arquivos) | Área **Arquivos**, a caixa de entrada que os agentes processam |
| **Timer** (pomodoro) | Área **Foco**, com histórico e sessão ligada a tarefa |
| **Clips** (histórico do clipboard) | Fonte da **captura rápida** e da **Memória** ("guarda isso") |
| **Peek** (miniatura de janela) | Prévia das janelas na seção **Apps abertos** do dock |
| **Mic** (mudo do microfone) | Controle direto no dock |
| **Awake** (manter acordado) | Controle direto no dock |
| **Palette** | Busca `Ctrl+K` no Sistema; calculadora e lançador continuam lá |
| **Freeze** (congelar a tela, OCR) | **Ferramentas**; o OCR também atende Arquivos e Finanças |
| **Ports**, **Links**, **Kill** | **Ferramentas** |

A **tecla líder** é aposentada como entrada principal. Os atalhos globais da seção 8 cobrem o que importa.

---

## 8. Atalhos

| Atalho | Ação |
|---|---|
| `Ctrl` `Alt` `Espaço` | Captura rápida |
| `Ctrl` `Alt` `N` | Abrir ou esconder o Sistema |
| `Ctrl` `Alt` `D` | Mostrar ou esconder o dock |
| `Ctrl` `Alt` `P` | Iniciar ou pausar o foco |
| `Ctrl` `Alt` `H` | Modo privacidade |
| `Ctrl` `K` | Busca global, dentro do Sistema |
| `Ctrl` `1` a `Ctrl` `9` | Áreas do Sistema |
| `Esc` | Fecha painel, captura ou modal |

Todos configuráveis, com detecção de conflito.

---

## 9. Privacidade e dados

- **Local:** banco SQLite e arquivos em `%APPDATA%\Moductus`, ou ao lado do executável no modo portable.
- **Chaves e tokens:** só no Gerenciador de Credenciais do Windows, nunca no banco nem em texto.
- **Rede:** sai apenas para o provedor de IA configurado e para as conexões ligadas (GitHub, por exemplo). A tela de cada conexão diz o que é enviado.
- **O que vai para o modelo:** cada agente envia só o contexto das próprias ferramentas. Finanças não manda lançamentos para o agente Dev, e vice-versa.
- **Modo privacidade:** esconde valores e textos sensíveis no dock e no Sistema, para compartilhar a tela.
- **Sem telemetria.** Continua valendo do v0.
- **Backup:** exportar e importar o banco inteiro, por arquivo.

---

## 10. Roadmap

### Fase 0 — Desenho
Este documento, [ARCHITECTURE.md](ARCHITECTURE.md), [AGENTS.md](AGENTS.md) e [DESIGN.md](DESIGN.md). Identidade visual nova, com três temas.

### Fase 1 — A casca
Projeto Tauri, dock lateral com os três modos e detecção de tela cheia, Sistema com navegação vazia, banco e migrações, configurações, atalhos, bandeja, autostart. Mídia e os controles diretos (Mic, Awake) já entram aqui: são simples e tornam o dock útil desde o primeiro dia.

### Fase 2 — Os agentes começam a trabalhar
Camada de provedores (um adaptador CLI e um de API para começar), serviço de agentes em segundo plano, ferramentas, cartão de aprovação. **Agente Dev** e **Sessões de IA** primeiro: é o ganho mais rápido e não depende de nenhuma área nova.

### Fase 3 — O dia
Tarefas, Foco, Notas, captura rápida, Início e o **agente Demandas** com briefing e fechamento.

### Fase 4 — O dinheiro
Finanças completa e o **agente Finanças**, com importação de extrato e OCR de comprovante.

### Fase 5 — Memória e arquivos
Memória com busca, Arquivos como caixa de entrada, e o servidor MCP do Moductus aberto para fora — o Claude Code no seu terminal passa a enxergar suas tarefas e notas.

### Fase 6 — Apps abertos
A seção que substitui a barra de tarefas: agrupamento por programa, prévia ao vivo, ocultar a barra do Windows. Fica por último porque é o maior escopo e o que mais briga com o comportamento do Windows.

---

## 11. Decisões registradas

| # | Decisão | Motivo |
|---|---|---|
| 1 | Pivô de suíte de utilitários para sistema pessoal com agentes | O uso real pede acompanhar o dia, não só abrir utilitário |
| 2 | Tauri 2 + React + TypeScript, no lugar de .NET + WPF | Liberdade visual (janelas translúcidas, animação, componentes web) e o ecossistema de agentes, que é mais maduro em TypeScript. Tauri em vez de Electron pelo peso: o app fica sempre rodando |
| 3 | Dock lateral em vez de ilha no topo | Lista vertical acomoda áreas, sessões de IA e apps abertos; monitor largo tem sobra lateral, não vertical |
| 4 | O dock também mostra apps abertos e mídia | Um lugar só para o que está acontecendo no PC |
| 5 | Funciona sem IA | A IA não pode ser ponto único de falha do seu dia |
| 6 | Modelo escolhido por agente, com adaptadores CLI e API | Usar a assinatura que você já paga, ou chave própria, ou modelo local |
| 7 | Ferramentas expostas por MCP | Um catálogo só, que serve tanto aos agentes CLI quanto às APIs, e que agentes externos também podem usar |
| 8 | Rede só para provedor e conexões ligadas, sem telemetria | Substitui o "zero rede" do v0 mantendo o espírito |
| 9 | Ação externa sempre com aprovação | Agente errado não pode comentar, mover ou enviar nada sozinho |
| 10 | SQLite local como fonte de dados | Tarefas, lançamentos e memórias são relacionais e precisam de busca |
| 11 | Licença MIT mantida | Open source é o diferencial frente ao Niko |
| 12 | Nenhum código, texto ou personagem do Niko | A licença dele proíbe obras derivadas; referência é só de produto |
| 13 | Três temas de fábrica — Grafite, Papel e Vidro — sobre a mesma estrutura | Gostos diferentes de sobriedade sem três produtos: o tema troca cor, material, raio e fonte, nunca layout ou comportamento. Detalhe em [DESIGN.md](DESIGN.md) |
| 14 | Visual criado do zero, sem herança do v0 | O visual do v0 não representava o produto novo |

As 21 decisões do v0 estão em [v0/PRODUCT.md](v0/PRODUCT.md#10-decisões-registradas), como registro histórico.

---

## 12. Riscos conhecidos

- **Substituir a barra de tarefas** é o item mais frágil: vários monitores, janelas que não se declaram, apps que dependem da barra. Por isso fica na fase 6 e a barra do Windows nunca é removida, só ocultada.
- **Latência dos agentes CLI:** abrir `claude -p` ou `codex exec` custa segundos por chamada. Agentes em segundo plano toleram; o chat precisa mostrar progresso desde o primeiro instante.
- **Consumo de memória:** WebView2 mais o serviço de agentes. Meta: abaixo de 150 MB em repouso, medido a cada release.
- **Integração com agentes de código** depende de hooks e formatos que essas ferramentas mudam com frequência. Cada integração fica isolada num adaptador.
- **Assinatura de código:** continua sem certificado; o mesmo tratamento do v0 (build pelo Actions com attestation, aviso honesto no README).
- **Curva de Rust:** a camada nativa fica fina de propósito; a maior parte do código é TypeScript.

---

## 13. Referências

- [ARCHITECTURE.md](ARCHITECTURE.md) — como o app funciona por dentro
- [AGENTS.md](AGENTS.md) — agentes, provedores, ferramentas e sessões de IA
- [DESIGN.md](DESIGN.md) — os três temas e os tokens
- [v0/](v0/) — o Moductus suíte de utilitários, como registro
