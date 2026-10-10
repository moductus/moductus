# Moductus — Documento de Produto

> Um sistema pessoal para o Windows: fica sempre à mão num dock lateral, e um time de agentes de IA — com o modelo que você escolher — cuida das suas demandas, finanças, código e memória.

**Status:** fase 1 concluída (`v0.5.0-alpha`, a casca) e fase 2 implementada (os agentes; sai como `v0.6.0-alpha` com o PR da fase); próxima: fase 3. A suíte de utilitários (`v0.4.0`) foi o produto até aqui; o registro dela está em [v0/](v0/). Este documento descreve o produto novo e é a fonte de verdade a partir de agora.
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

**No começo, é para o autor e colegas.** Sem marketing nem tráfego pago, o público é pequeno e próximo. Isso define as prioridades: app em **português do Brasil**, distribuição pelas releases do GitHub, documentação para quem já é dev, e nada de recurso de crescimento (convite, compartilhamento social, planos). O código continua aberto (MIT).

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

1. **Agentes no centro.** O jeito principal de usar o Moductus é pedir aos agentes e deixar que eles trabalhem sozinhos. Telas e botões existem para acompanhar, corrigir e agir rápido. Conectar um modelo faz parte da configuração inicial.
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
| **Agentes** | Conversa com o time, com menção direta (`@alba`, `@tula`, `@faina`, `@nuno`); histórico de cada agente e o que cada um fez sozinho |
| **Sessões de IA** | Todas as sessões de agentes de código: projeto, estado, última ação, pedidos pendentes, consumo e limites. Hoje o Claude Code (com aprovação pelo dock) e o OpenCode (só informa); Codex, Gemini CLI e Antigravity são previstos |
| **Tarefas** | Listas, datas, prioridade, recorrência; entrada em linguagem natural ("ligar pro banco amanhã 15h") |
| **Foco** | Pomodoro com etapas, sessão ligada a uma tarefa, histórico e relatório |
| **Finanças** | Contas, cartões, lançamentos, categorias, orçamento por categoria, recorrentes, importação de extrato (OFX e CSV), relatórios |
| **Dev** | PRs esperando seu review, PRs seus com review a atender, issues e demandas atribuídas a você, CI quebrado — por repositório |
| **Notas** | Notas em markdown que salvam sozinhas; o bloco rápido do v0 vira a nota fixa do topo |
| **Arquivos** | Caixa de entrada: solte um arquivo e o agente resume, classifica, extrai texto (OCR) ou lança em finanças |
| **Memória** | Fatos, decisões, pessoas e referências que os agentes guardaram ou você pediu para guardar; busca e edição |
| **Ferramentas** | Os utilitários herdados do v0 (seção 7) |
| **Configurações** | Provedores de IA por agente, conexões, dock, atalhos, tema (Grafite, Papel, Vidro ou automático pelo Windows), notificações, privacidade, exportar e importar |

### Primeiro uso

Duas etapas, as duas com "pular" e "fazer depois":

1. **Configuração** (uma vez, logo ao instalar):
   1. Boas-vindas, com a opção **"Já uso em outro PC"**, que importa o arquivo exportado e pula o que ele já traz.
   2. Tema e lado do dock, com prévia ao vivo.
   3. **Conectar um modelo:** escolher entre os CLIs detectados no PC (Claude Code, Codex, Gemini, OpenCode) ou uma API, com um teste de verdade antes de seguir. Na fase 2 só o Claude Code e as APIs compatíveis com a da OpenAI podem ser conectados; os demais aparecem como "em breve".
   4. **Conhecer o time:** os quatro personagens se apresentam, cada um em uma frase.
   5. **Conexões por agente, todas opcionais:** Google Agenda para a Alba, pastas autorizadas para a Faina, hooks das sessões de IA e GitHub para o Nuno, primeiro extrato para a Tula. Na fase 2 funcionam as do Nuno (os hooks do Claude Code e o GitHub); as demais chegam com as áreas.
   6. Notificações (seção abaixo) e início com o Windows.
2. **Tutorial** (depois da configuração, no próprio app, sem vídeo):
   - um tour curto pelo dock, um painel, o Sistema e a captura rápida (`Ctrl+Alt+Espaço`);
   - uma lista **"Primeiros passos"** no Início, com uma missão por agente ("peça um lembrete à Alba", "mande um extrato para a Tula", "peça à Faina para olhar seus Downloads", "abra uma sessão do Claude Code e veja o Nuno acompanhar"), incluindo um cartão de aprovação de treino;
   - some quando completa e volta pelo menu de ajuda.

### Notificações

Você decide, por agente e por tipo (aprovação, lembrete, erro, aviso e rotina):

- **Níveis:** *tudo*, *só o que precisa de mim* (pedidos de aprovação, lembretes e erros) ou *nada*. De fábrica, os agentes vêm em *só o que precisa de mim* e o **Nuno em *tudo***, porque o que ele observa (contexto de uma sessão passando de 80%, CI quebrado, sessão esperando) é aviso, não pedido. Com *só o que precisa de mim*, o aviso de contexto alto fica só no histórico.
- **Onde:** aviso do Windows, só o ponto no dock, ou os dois. O pedido de aprovação sai do Windows com os mesmos botões do cartão (Negar, Sempre aqui, Permitir); clicar no corpo do aviso abre o painel do time. O aviso não repete o comando inteiro, porque a tela de bloqueio o mostraria. A cópia portable não mostra aviso do Windows, só o ponto no dock.
- **Silêncio:** horário sem aviso (desligado de fábrica; a sugestão é das 22:00 às 07:30), tela cheia e apresentação, e foco (o Foco chega na fase 3; durante ele ainda passam aprovações e lembretes). O silêncio cala só o aviso do Windows: o ponto no dock e o histórico continuam.
- Com *nada*, o agente continua trabalhando e registrando; o aviso fica no histórico, já visto, e você vê tudo no dock quando quiser.

`Ctrl+K` dentro do Sistema abre uma busca global por qualquer item e comando. É a herança da Palette, agora como coadjuvante.

---

## 6. Os agentes

O Moductus vem com quatro agentes de fábrica, e cada um tem **nome, função e visual**. Por dentro, cada agente é uma configuração (instruções, ferramentas, gatilhos e modelo), não um código separado. O desenho técnico está em [AGENTS.md](AGENTS.md).

| Agente | Função | Cuida de | Trabalha sozinho quando |
|---|---|---|---|
| **Alba** | Cuida do seu dia | Agenda, tarefas, lembretes, rotina e foco; briefing da manhã e fechamento do dia | No horário do briefing e do fechamento; lembrete ou compromisso chegando |
| **Tula** | Cuida do seu dinheiro | Gastos, dívidas, planos de economia e orçamento | Extrato na caixa de entrada; categoria perto do limite; parcela vencendo |
| **Faina** | Faz o serviço pesado | Organizar, limpar e criar arquivos e documentos no PC, sempre com prévia e desfazer | Downloads acumulando; arquivo na caixa de entrada; limpeza agendada |
| **Nuno** | Fica de olho nas suas IAs e no seu código | Sessões do Claude Code, Codex, OpenCode e afins; contexto, gasto e limites; PRs e issues | Sessão pedindo aprovação ou com contexto alto; GitHub a cada 15 min; limite perto, quando houver fonte |

**Visual:** cada agente é um personagem, com corpo, rosto e um traço próprio (os raios de sol da Alba, o coque e os óculos da Tula, a bandana da Faina, os fones do Nuno), no seu tom: âmbar, musgo, terracota e ardósia. A expressão do rosto mostra o estado. É para o time parecer gente trabalhando com você, não uma máquina.

**Sempre vivos:** os agentes rodam em segundo plano desde o login, mesmo com todas as janelas fechadas, vigiando lembretes, sessões de IA, PRs e arquivos sem gastar token; o modelo só é chamado quando há algo para pensar. Detalhe em [AGENTS.md](AGENTS.md#sempre-vivos).

**Agentes seus (fase 7):** dá para criar um agente do zero ou duplicando um de fábrica, escolhendo nome, função, visual, modelo, ferramentas e gatilhos. Os de fábrica podem ser renomeados, ajustados ou desligados, e voltam ao padrão quando você quiser.

**Memória** não é um agente: é compartilhada, todos guardam e consultam nela, e a área Memória mostra e edita tudo.

### Conversas

Duas formas, a mesma memória: **com o time**, uma conversa única em que o roteamento escolhe quem responde e cada resposta vem assinada pelo agente; e **com cada agente**, uma conversa por agente para assuntos longos. O que você diz numa vale nas outras.

### Fora do PC

O Moductus é o seu assistente **no PC**: quando você sai dele, os agentes param junto. O que precisa te alcançar longe da máquina vai para a sua agenda: com o Google Agenda conectado, compromissos e lembretes com horário viram eventos num calendário "Moductus", e o celular avisa. Não existe servidor, app de celular nem mensagem por WhatsApp.

### Quando o modelo acaba

Limite de uso estourado, provedor fora do ar, chave recusada ou teto de gasto atingido: o agente **dorme** até poder voltar, e o dock mostra quando. Limite de uso é sono tranquilo; falha do provedor aparece como erro, com ponto vermelho; teto pede uma decisão sua, com ponto amarelo. O teto diário fica desligado até a moeda dele ser decidida. Os vigias continuam (lembrete dispara), e o que precisar do modelo fica na fila para quando ele acordar.

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
- **O que vai para o modelo:** cada agente envia só o contexto das próprias ferramentas. A Tula não manda lançamentos para o Nuno, e vice-versa.
- **Modo privacidade:** esconde valores e textos sensíveis no dock e no Sistema, para compartilhar a tela.
- **Sem telemetria.** Continua valendo do v0.
- **Levar para outro PC:** os dados ficam em cada máquina. Para levar o Moductus de um PC para outro, você **exporta um arquivo** num e **importa** no outro:
  - **Só configurações** (padrão): tema, dock, atalhos, agentes (nomes, instruções, ferramentas, gatilhos, modelos escolhidos), regras de aprovação, perfis de importação de banco, conexões sem as credenciais.
  - **Configurações e dados:** tudo acima, mais tarefas, notas, memória, finanças e histórico. Sai protegido por uma senha que você escolhe.
  - **Nunca vai no arquivo:** chaves, tokens e senhas. No PC novo, o Moductus lista as conexões que precisam ser refeitas.
  - Importar num PC que já tem dados pergunta se **substitui** ou **junta**; juntar não duplica o que já existe.
  - Cada PC decide o que importa: dá para levar as configurações para o PC do trabalho sem levar as finanças.
- **Backup:** o mesmo arquivo, com configurações e dados, serve de backup.

---

## 10. Roadmap

### Fase 0 — Desenho ✓
Este documento, [ARCHITECTURE.md](ARCHITECTURE.md), [AGENTS.md](AGENTS.md) e [DESIGN.md](DESIGN.md). Identidade visual nova, com três temas.

### Fase 1 — A casca ✓ (`v0.5.0-alpha`)
Projeto Tauri, dock lateral com os três modos e detecção de tela cheia, Sistema com navegação vazia, banco e migrações, configurações, atalhos, bandeja, autostart. Mídia e os controles diretos (Mic, Awake) já entram aqui: são simples e tornam o dock útil desde o primeiro dia. Entram também a configuração do primeiro uso e exportar e importar configurações.

### Fase 2 — Os agentes começam a trabalhar ✓ (`v0.6.0-alpha`, no PR da fase)
Camada de provedores (Claude Code CLI e API compatível com a da OpenAI), catálogo de ferramentas e servidor MCP, cartão de aprovação com desfazer, runtime com estados (dormir quando o modelo acaba, pausar pela bandeja), agendador, conversa com o time e com cada agente, notificações. O **Nuno** e as **Sessões de IA** primeiro: o Claude Code é acompanhado por hooks e aprovado pelo dock, o OpenCode por plugin, e o GitHub é lido pelo `gh`. O primeiro uso conecta e testa um modelo de verdade, e a missão do Nuno nos Primeiros passos fecha com a primeira sessão do Claude Code. Alba, Tula e Faina existem e conversam; ganham ferramentas e vigias nas fases 3 a 5. Ficaram fora: os adaptadores do Codex, do Gemini CLI e das APIs da Anthropic e do Gemini, a varredura de processos para sessões sem hook e a moeda do teto de gasto.

### Fase 3 — O dia
Agenda (local e Google Agenda, com o calendário "Moductus"), Tarefas, lembretes, Foco, Notas, captura rápida, Início, o tutorial com as missões e a **Alba** com briefing e fechamento.

### Fase 4 — O dinheiro
Finanças completa (gastos, dívidas e planos) e a **Tula**, com importação de extrato e OCR de comprovante.

### Fase 5 — Memória, arquivos e a Faina
Memória com busca, Arquivos como caixa de entrada, a **Faina** organizando, limpando e criando com prévia e desfazer, e o servidor MCP do Moductus aberto para fora — o Claude Code no seu terminal passa a enxergar suas tarefas e notas.

### Fase 6 — Apps abertos
A seção que substitui a barra de tarefas: agrupamento por programa, prévia ao vivo, ocultar a barra do Windows. Fica para o fim porque é o maior escopo e o que mais briga com o comportamento do Windows.

### Fase 7 — Agentes seus
Criar, duplicar, exportar e importar agentes, com nome, função, visual, modelo, ferramentas e gatilhos próprios.

---

## 11. Decisões registradas

| # | Decisão | Motivo |
|---|---|---|
| 1 | Pivô de suíte de utilitários para sistema pessoal com agentes | O uso real pede acompanhar o dia, não só abrir utilitário |
| 2 | Tauri 2 + React + TypeScript, no lugar de .NET + WPF | Liberdade visual (janelas translúcidas, animação, componentes web) e o ecossistema de agentes, que é mais maduro em TypeScript. Tauri em vez de Electron pelo peso: o app fica sempre rodando |
| 3 | Dock lateral em vez de ilha no topo | Lista vertical acomoda áreas, sessões de IA e apps abertos; monitor largo tem sobra lateral, não vertical |
| 4 | O dock também mostra apps abertos e mídia | Um lugar só para o que está acontecendo no PC |
| 5 | Agentes no centro do produto, não camada opcional | O valor do Moductus está no que os agentes fazem sozinhos; tratar a IA como opcional diluiria o produto. Substitui o "funciona sem IA" do primeiro desenho |
| 6 | Modelo escolhido por agente, com adaptadores CLI e API | Usar a assinatura que você já paga, ou chave própria, ou modelo local |
| 7 | Ferramentas expostas por MCP | Um catálogo só, que serve tanto aos agentes CLI quanto às APIs, e que agentes externos também podem usar |
| 8 | Rede só para provedor e conexões ligadas, sem telemetria | Substitui o "zero rede" do v0 mantendo o espírito |
| 9 | Ação externa sempre com aprovação | Agente errado não pode comentar, mover ou enviar nada sozinho |
| 10 | SQLite local como fonte de dados | Tarefas, lançamentos e memórias são relacionais e precisam de busca |
| 11 | Licença MIT mantida | Open source é o diferencial frente ao Niko |
| 12 | Nenhum código, texto ou personagem do Niko | A licença dele proíbe obras derivadas; referência é só de produto |
| 13 | Três temas de fábrica — Grafite, Papel e Vidro — sobre a mesma estrutura | Gostos diferentes de sobriedade sem três produtos: o tema troca cor, material, raio e fonte, nunca layout ou comportamento. Detalhe em [DESIGN.md](DESIGN.md) |
| 14 | Visual criado do zero, sem herança do v0 | O visual do v0 não representava o produto novo |
| 15 | Quatro agentes de fábrica — Alba, Tula, Faina e Nuno —, cada um com nome, função e visual | Nomes de gente, sem descrever a função: personalidade suficiente para reconhecer de relance, sóbria o bastante para não virar mascote. Nenhum reutiliza os do Niko |
| 16 | Memória compartilhada em vez de um agente de memória | Todo agente precisa lembrar; um intermediário só adicionaria latência e mais uma chamada de modelo |
| 17 | Agentes criados pelo usuário na fase 7, com ação externa sempre aprovada | O valor do agente próprio não pode abrir uma porta que os de fábrica não abrem |
| 18 | Agentes como personagens, com corpo e rosto | Tira a sensação de máquina; a expressão comunica o estado de relance. Substitui o glifo geométrico do primeiro desenho |
| 19 | Agentes sempre vivos, com vigias sem modelo e modelo sob demanda | Lembrete e PR não podem esperar o usuário abrir o app, e ficar vivo não pode custar token o dia inteiro |
| 20 | Marca "Borda e ponto": a linha do dock e o ponto de um agente presente | Conta o produto em dois elementos e continua legível a 16 px na bandeja. Especificação em [DESIGN.md](DESIGN.md#7-marca) |
| 21 | Levar para outro PC por arquivo exportado (só configurações ou configurações e dados), sem sincronização | Mantém tudo local e sem servidor; cada PC escolhe o que importa. Credenciais nunca saem da máquina |
| 22 | Agentes só trabalham com o PC ligado; o que precisa sair do PC vai para um calendário "Moductus" no Google Agenda | O produto é um assistente no PC. A agenda do usuário já é o canal que chega ao celular |
| 23 | Conversa com o time e conversa com cada agente, sobre a mesma memória | Pedido que cruza áreas tem um lugar só; assunto longo tem o seu |
| 24 | Onboarding de configuração seguido de tutorial com missões por agente | O valor depende de conexões que o usuário precisa fazer; o tutorial ensina usando o próprio app |
| 25 | Notificações configuráveis por agente e tipo, inclusive desligadas | Interrupção é decisão do usuário |
| 26 | Extratos em OFX, CSV e XML, com perfis de importação dos bancos mais populares | OFX é padrão; CSV e XML variam por banco e precisam de perfil |
| 27 | A Faina nunca toca no sistema nem em nada que afete o uso do PC, e não tem comando de sistema | Um agente que organiza arquivos não pode quebrar a máquina |
| 28 | Público inicial: o autor e colegas; app só em pt-BR | Sem tráfego pago, o público é pequeno e próximo; esforço vai para o produto |
| 29 | Sem limite de gasto: o agente dorme até o modelo voltar, com teto diário opcional | Não perder trabalho nem gastar escondido |
| 30 | Voz da família (curta, números primeiro, sem emoji nem humor em alerta) e traços próprios por agente | Baseado em guias de escrita de interface e em apps de referência de cada área; ver [AGENTS.md](AGENTS.md#voz-dos-agentes) |
| 31 | Briefing na primeira atividade do dia, até 6 linhas; fechamento no horário de parar, cerca de 2 minutos; nada se acumula se for ignorado | Ritual curto o bastante para virar hábito; ver [AGENTS.md](AGENTS.md#briefing-da-manhã-e-fechamento-do-dia) |
| 32 | Modelo de dados com ULID, dinheiro em centavos, origem em toda linha e separação entre configuração e dado | Permite juntar dados de outro PC, desfazer o que o agente fez e exportar só configurações; ver [DATA.md](DATA.md) |
| 33 | "Sempre neste projeto", no cartão de aprovação de uma sessão externa, cria uma regra do Moductus que vale para os próximos pedidos iguais; o Moductus não escreve nas permissões do Claude Code. No aviso do Windows o rótulo é "Sempre aqui" | O `settings.json` do usuário só recebe os hooks; permissão é do usuário. Decidido pelo orquestrador (ADR-0023) |
| 34 | Os agentes do Moductus rodam o Claude Code só com as ferramentas do catálogo, sem a configuração do usuário e sem variável que cobre por token | O agente age só pelo que tem nível de efeito e desfazer, e "assinatura" precisa ser verdade. Decidido pelo orquestrador (ADR-0017 e ADR-0024) |
| 35 | Notificações: o Nuno vem em *tudo*, os outros agentes em *só o que precisa de mim*; *nada* registra o aviso já visto; o silêncio cala só o aviso do Windows | Interrupção é decisão do usuário, mas o que o Nuno observa é aviso por natureza. Decidido pelo orquestrador (ADR-0027) |
| 36 | Número sem fonte confiável não aparece: janela de contexto vem da ferramenta ou de uma tabela de modelos versionada, limites de uso ficam fora, custo é vazio em assinatura | Um aviso de 80% sobre uma janela errada é pior que nenhum aviso. Decidido pelo orquestrador (ADR-0021) |
| 37 | Trocar o modelo de um agente vale na próxima execução; a sessão do CLI não segue para outro provedor; no primeiro uso, trocar de modelo substitui o anterior | Evita dois modelos configurados sem querer e conversa que mistura provedores. Decidido pelo orquestrador (ADR-0025) |

**Em aberto, do humano:** a moeda do teto diário de gasto (hoje o custo é medido em dólar e o teto fica desligado), um botão "Tentar agora" para acordar um agente que dorme por falha (pede `agentes.acordar` no contrato) e a largura do painel (o canvas desenhou 400 px; a casca usa 372 px).

As 21 decisões do v0 estão em [v0/PRODUCT.md](v0/PRODUCT.md#10-decisões-registradas), como registro histórico.

---

## 12. Riscos conhecidos

- **Substituir a barra de tarefas** é o item mais frágil: vários monitores, janelas que não se declaram, apps que dependem da barra. Por isso fica na fase 6 e a barra do Windows nunca é removida, só ocultada.
- **Latência dos agentes CLI:** abrir `claude -p` ou `codex exec` custa segundos por chamada. Agentes em segundo plano toleram; o chat precisa mostrar progresso desde o primeiro instante. Medido na fase 2: de 3 a 5 s até a primeira resposta, quase todos do CLI.
- **Consumo de memória:** WebView2 mais o serviço de agentes. Meta: abaixo de 200 MB de memória privada em repouso, medido a cada release (o teste de viabilidade mediu cerca de 150 MB em build de debug). Em release, a fase 1 mediu 341,7 MB e a fase 2, 346,9 MB: o serviço dos agentes custa só 2,5 MB, e o peso é do WebView2, então reduzir é uma etapa própria ([ARCHITECTURE.md](ARCHITECTURE.md#medições-da-fase-2)).
- **Integração com agentes de código** depende de hooks e formatos que essas ferramentas mudam com frequência. Cada integração fica isolada num adaptador. A fase 2 validou o Claude Code 2.1.287 e o OpenCode 1.18.29; os hooks do Codex só rodam comando, então ele não entra sem um script intermediário.
- **Assinatura de código:** continua sem certificado; o mesmo tratamento do v0 (build pelo Actions com attestation, aviso honesto no README).
- **Curva de Rust:** a camada nativa fica fina de propósito; a maior parte do código é TypeScript.

---

## 13. Referências

- [ARCHITECTURE.md](ARCHITECTURE.md) — como o app funciona por dentro
- [AGENTS.md](AGENTS.md) — agentes, provedores, ferramentas e sessões de IA
- [DESIGN.md](DESIGN.md) — os três temas e os tokens
- [DATA.md](DATA.md) — o que cada área guarda e como
- [v0/](v0/) — o Moductus suíte de utilitários, como registro
