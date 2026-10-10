# Moductus — Agentes

> Como os agentes do Moductus funcionam: definição, provedores de modelo, ferramentas, aprovação, e como o app acompanha os agentes de código que rodam fora dele. O produto está em [PRODUCT.md](PRODUCT.md); os processos e o banco, em [ARCHITECTURE.md](ARCHITECTURE.md).

**Status:** fases 0 a 2. O que a fase 2 entregou está dito no tempo presente e com o que foi validado: o Nuno e seus vigias, o runtime e os estados dos agentes, o agendador, as conversas, os provedores (Claude Code CLI e APIs compatíveis com a da OpenAI), o catálogo e o servidor MCP, as aprovações com desfazer e as sessões de IA externas. O resto é desenho e vem marcado como **(previsto)**, com a fase. Itens marcados com **(validar)** dependem de comportamento de ferramenta externa que ainda não foi confirmado.

---

## 1. O que é um agente

Um agente é **configuração**, não código. Todos rodam no mesmo runtime, dentro do serviço, e todos têm as mesmas três coisas que o usuário vê: **nome**, **função** e **visual**.

| Campo | O que é | Exemplo (Nuno) |
|---|---|---|
| `id`, `nome`, `apelido` | Identidade e como chamar no chat | `nuno`, "Nuno", `@nuno` |
| `funcao` | Uma frase do que ele faz, mostrada no dock e no Sistema | "Fica de olho nas suas sessões de IA e no seu código" |
| `instrucoes` | Quem é, do que cuida, como responde, o que nunca faz | Texto livre, editável |
| `visual` | Personagem: silhueta, traço e tom (veja "Visual dos agentes") | cápsula, fones, ardósia |
| `ferramentas` | Subconjunto do catálogo | `sessoes.*`, `github.*`, `tarefas.criar` |
| `provedor` | Modelo que ele usa, com reserva opcional | `claude-cli`; reserva `openai-compativel` |
| `gatilhos` | Quando trabalha sozinho | `intervalo: 15min`, `evento: sessao.contexto_alto` |
| `memoria` | Escopos de memória que lê e escreve | `dev`, `geral` |

### De fábrica e criados por você

- **De fábrica:** os quatro agentes da seção 2 vêm prontos. Dá para renomear, trocar o visual, ajustar instruções, ferramentas e modelo, ou desligar. Não dá para apagar: "restaurar padrão" volta ao original (o contrato tem `agentes.restaurarPadrao`, mas o serviço ainda não o atende: **previsto**).
- **Criados por você (fase 7):** um agente novo é preenchido a partir do zero ou duplicando um de fábrica. O Sistema guia pelos campos acima. O personagem é montado das mesmas peças (silhuetas, traços e tons), e as ferramentas vêm do mesmo catálogo. Ferramenta `externo` continua sempre com aprovação, então nenhum agente criado consegue agir fora do Moductus sem o seu sim.
- **Compartilhar:** um agente se exporta e importa como arquivo `.json`, só com configuração, sem dados nem chaves.

A **memória é compartilhada**, não um agente: qualquer agente guarda e consulta fatos nos escopos que tem, e a área Memória mostra e edita tudo.

### Conversas

Existem dois jeitos de falar com os agentes, e os dois enxergam a mesma memória:

- **Com o time:** uma conversa única. Você escreve sem escolher destinatário, o roteamento decide quem responde, e cada resposta vem assinada pelo agente (personagem e nome). Um pedido que envolve mais de um ("separa os comprovantes de setembro e lança tudo") é dividido: a Faina acha os arquivos, a Tula lança, e as duas respondem na mesma conversa.
- **Com cada agente:** uma conversa por agente, para assuntos longos de uma área só.

O que é dito numa conversa vira memória disponível nas outras, respeitando os escopos de cada agente.

---

## 2. Os agentes de fábrica

| | Alba | Tula | Faina | Nuno |
|---|---|---|---|---|
| **Função** | Cuida do seu dia | Cuida do seu dinheiro | Faz o serviço pesado | Fica de olho nas suas IAs e no seu código |
| **Personagem** | Ovo com raios de sol | Pera de coque e óculos | Bloco de bandana | Cápsula de fones |
| **Tom** | Âmbar | Musgo | Terracota | Ardósia |

Na fase 2 só o Nuno tem ferramentas e vigias. Alba, Tula e Faina existem, conversam (com as instruções de fábrica e o que foi dito na conversa) e dormem, pausam e acordam como ele, mas só ganham ferramentas, vigias e gatilhos com as áreas: a Alba na fase 3, a Tula na 4 e a Faina na 5. O que segue é o desenho de cada um.

### Alba — o dia a dia
- **Cuida de:** agenda, tarefas, lembretes, rotina e foco.
- **Faz:** transforma frase solta em tarefa ou compromisso com data, hora e prioridade ("ligar pro banco amanhã 15h"); dispara **lembretes** no horário, inclusive recorrentes; monta o **briefing da manhã** (compromissos, o que vence, o que ficou de ontem, e o resumo que os outros agentes mandarem); faz o **fechamento do dia** (o que foi feito, quanto foco, o que passa para amanhã); encaixa tarefas nos horários livres da agenda e sugere o próximo foco.
- **Gatilhos:** horário do briefing e do fechamento, lembrete vencendo, compromisso chegando.
- **Ferramentas:** `agenda.*`, `tarefas.*`, `lembretes.*`, `foco.*`, `notas.*`, `memoria.*`.
- **Agenda e controle fora do PC:** os agentes só trabalham com o PC ligado. Para o que precisa te alcançar longe dele, a Alba escreve na sua agenda: ao conectar o Google Agenda (Outlook depois), o Moductus cria um calendário próprio, **"Moductus"**, e todo compromisso e lembrete com horário vira um evento com alerta ali. O celular avisa mesmo com o PC desligado.
  - **Escrever no calendário "Moductus":** autorizado uma vez, na conexão; não pede aprovação a cada evento.
  - **Ler os outros calendários:** sim, para montar o dia e achar horário livre.
  - **Criar ou mudar evento nos outros calendários:** `externo`, sempre com aprovação.
  - **Tarefa sem horário:** fica só no Moductus.
- **É o agente padrão:** mensagem sem destinatário claro vai para a Alba.

### Tula — finanças
- **Cuida de:** gastos, dívidas, planos e orçamento.
- **Faz:**
  - **Gastos:** lança por texto ("45 de mercado no débito"), por print ou comprovante (OCR local, depois o modelo estrutura) e por extrato; categoriza; acompanha orçamento por categoria e recorrências.
  - **Extratos:** aceita **OFX** (1.x e 2.x), **CSV** e **XML**. O OFX é padrão e entra direto. CSV e XML variam por banco, então cada banco popular ganha um **perfil de importação** pronto: Nubank, Itaú, Bradesco, Banco do Brasil, Caixa, Santander, Inter, C6, Mercado Pago e PicPay, para conta e fatura de cartão quando o banco separa as duas. Arquivo de banco sem perfil passa por um mapeamento guiado de colunas, que fica salvo para a próxima vez. Lançamento repetido é reconhecido pelo identificador do OFX ou por data, valor e descrição, e não entra duas vezes.
  - **Dívidas:** cadastra saldo, juros e parcelas; mostra o custo total de cada uma; simula a ordem de quitação (maior juro primeiro ou menor saldo primeiro) e quanto cada real extra adianta.
  - **Planos:** metas de economia com prazo, quanto separar por mês, e acompanhamento do que foi cumprido.
  - **Relatórios:** mês, categoria, comparação com meses anteriores; responde "quanto gastei com X".
- **Gatilhos:** extrato em Arquivos, categoria perto do limite, parcela ou recorrência vencendo, fim do mês.
- **Ferramentas:** `financas.*`, `dividas.*`, `planos.*`, `arquivos.ler_texto`, `memoria.*` (escopo finanças).
- **Nunca:** paga, transfere, acessa banco ou recomenda investimento. Organiza e calcula; a decisão é sua.

### Faina — o serviço pesado
- **Cuida de:** arquivos e tarefas trabalhosas no PC.
- **Faz:**
  - **Organizar:** separa Downloads por tipo e data, renomeia em lote, move para as pastas certas, junta o que está espalhado.
  - **Limpar:** acha temporários, duplicados e arquivos grandes esquecidos, e manda para a Lixeira.
  - **Criar:** documentos, planilhas e resumos a partir de arquivos, notas e da caixa de entrada; conversões de formato.
  - **Processar:** o que cai em Arquivos (extrair texto, resumir, classificar, entregar ao agente certo).
- **Como trabalha:** sempre **plano → prévia → aprovação → execução → registro**. A prévia mostra cada arquivo que muda e para onde vai; a execução fica no histórico com **desfazer**.
- **Limites:** só mexe em arquivos seus, nas pastas que você autorizou (Downloads, Documentos, Área de Trabalho e Imagens são sugeridas no primeiro uso; nenhuma vem ligada sem o seu sim). **Nunca toca em nada do sistema nem em nada que possa afetar o uso do computador:**
  - pastas do Windows, de programas e de dados de programas (`Windows`, `Program Files`, `ProgramData`, `AppData`), mesmo que você autorize a pasta acima delas;
  - registro, serviços, drivers, inicialização, configurações do sistema, processos em execução, instalar e desinstalar programas;
  - arquivos abertos por outro programa e pastas de sincronização em conflito;
  - nunca apaga de vez: tudo vai para a Lixeira.

  A Faina não tem ferramenta de comando de sistema.
- **Gatilhos:** Downloads passou de um limite, arquivo caiu em Arquivos, limpeza semanal agendada.
- **Ferramentas:** `arquivos.*` (só dentro das pastas autorizadas), `documentos.*`, `ocr.ler`, `memoria.*`.

### Nuno — dev e sessões de IA
- **Cuida de:** as sessões de agentes de código e o seu trabalho no GitHub.
- **Faz:**
  - **Sessões:** acompanha o Claude Code (por hooks) e o OpenCode (por plugin, só informando) por projeto (trabalhando, esperando você, terminou, erro, parada) e leva os pedidos de permissão do Claude Code ao dock. Codex, Gemini CLI e Antigravity ficam para a varredura de processos (**prevista**, seção 5).
  - **Lembrete de contexto:** avisa quando uma sessão passa de 80% da janela de contexto e sugere compactar ou encerrar. O contexto é calculado pelo uso de tokens que a própria ferramenta registra: no Claude Code, o transcript da sessão; nas outras não há fonte validada. O aviso sai como notificação do tipo `aviso`, que o nível "só o que precisa de mim" não deixa passar (nasce visto, sem ponto nem aviso do Windows); por isso o padrão de fábrica do Nuno é "tudo" ([PRODUCT.md](PRODUCT.md#notificações)).
  - **Gasto:** tokens por sessão, por projeto e por dia, lidos do transcript. O custo só aparece quando há número honesto: assinatura não tem custo, e modelo sem preço conhecido também não.
  - **Limites:** janela de uso e limite semanal quando a ferramenta expõe. Hoje nenhuma expõe uma fonte estável, então a área diz que não sabe em vez de inventar (seção 5, "Consumo e limites").
  - **GitHub:** PRs esperando seu review, PRs seus com review a atender, issues e demandas atribuídas a você, CI quebrado. Pedido de review feito a um time aparece na lista, mas só pedido direto conta como "precisa de você". Resume o item que passou a precisar de você; criar tarefa a partir de review chega com a fase 3 (`tarefas.criar`).
- **Gatilhos:** eventos de sessão, contexto alto e a leitura do GitHub a cada 15 min, tudo como vigia, sem modelo (seção 6). Limite perto fica para quando houver fonte.
- **Ferramentas:** `sessoes.listar` e `sessoes.eventos`, `uso.por_dia`, `github.pendencias`, `github.listar`, `github.detalhe` e `github.atualizar` (todas `leitura`) e `github.comentar` (`externo`). O GitHub é lido pelo `gh`, com a sua autenticação. `tarefas.criar` chega com a fase 3.
- **Efeito externo** (comentar, aprovar PR, responder pedido de permissão em nome de regra): sempre por cartão de aprovação ou regra que você criou.

### Roteamento

1. Menção explícita (`@tula`) escolhe o agente.
2. Sem menção, regras simples por palavra e contexto: valor em reais vai para a Tula, link de PR ou nome de sessão vai para o Nuno, arquivo ou pasta vai para Faina.
3. Sem regra, um classificador barato (o modelo da Alba, prompt curto) decide; a Alba é o padrão.

---

### Voz dos agentes

Baseada em guias de escrita de interface (Microsoft, Google Conversation Design, GitHub Primer, Nielsen Norman) e em como apps de referência escrevem em cada área (Monzo e YNAB em finanças, Sunsama e Akiflow no planejamento do dia, Hazel e CleanMyMac em arquivos, GitHub e Vercel em dev). As fontes estão no fim desta seção.

**Regras da família, valem para os quatro:**
- Até duas frases por fala; número antes de adjetivo.
- Primeira pessoa para o que o agente fez ("Movi", "Achei"); "você" para o usuário, sem nome próprio a cada fala.
- Sem emoji, sem "ops", sem exclamação em alerta, sem humor em erro, espera ou dinheiro.
- Má notícia: primeiro o impacto, depois o motivo, depois a saída. Nunca insinua que a culpa é sua.
- Desculpa só quando o erro foi do próprio agente, e uma vez.
- Pedido de aprovação diz o que vai acontecer, o tamanho (quantos, quanto) e se dá para desfazer; o botão é um verbo com o objeto ("Mover 38 arquivos"), nunca "OK".

| | Traços | Nunca |
|---|---|---|
| **Alba** | Calma, organizada, antecipa, prioriza | Lota a agenda sem perguntar; cobra ("você não fez…") |
| **Tula** | Objetiva, acolhedora, precisa nos números, sem julgamento | Diz "gastou demais", "descontrole" ou "culpa"; recomenda investimento; brinca com dívida |
| **Faina** | Prática, cuidadosa, precisa no escopo | Apaga de vez; age fora das pastas autorizadas; mexe sem mostrar a lista antes |
| **Nuno** | Técnico, conciso, com contexto, sem alarme falso | Faz push, merge ou comentário sem ordem; arredonda custo |

**Falas de exemplo:**

| | Alba | Tula | Faina | Nuno |
|---|---|---|---|---|
| **Abertura** | "Bom dia. Hoje: 3 reuniões, 5 tarefas, foco livre das 14h às 16h." | "Semana em dia: R$ 420 de R$ 600 usados." | "Downloads tem 2,1 GB em instaladores antigos." | "2 sessões ativas, 61% do limite semanal usado, 1 PR esperando review." |
| **Feito** | "Lembrete criado para quinta, 9h." | "Parcela do cartão registrada. Faltam 4." | "Organizei 214 arquivos em 6 pastas. Dá para desfazer até amanhã." | "O CI do #142 passou depois do segundo push." |
| **Aprovação** | "A tarefa X não cabe hoje. Passo para amanhã de manhã?" [Passar para amanhã] [Manter] | "Achei 3 assinaturas que não vejo em uso. Quer revisar?" [Revisar assinaturas] | "Vou mover 38 arquivos (1,4 GB) para a Lixeira. A lista está abaixo." [Mover 38 arquivos] [Ver lista] | "A sessão do Codex chegou a 85% do contexto. Compacto agora?" [Compactar] [Depois] |
| **Má notícia** | "O dia está cheio: 7h planejadas para 5h livres. Sugiro tirar duas tarefas." | "Mercado passou R$ 80 do previsto. Dá para cobrir com o que sobrou de lazer. Quer remanejar?" | "12 arquivos ficaram de fora porque estavam abertos em outro programa." | "Você está em 90% do limite semanal. No ritmo de hoje, acaba quinta às 15h." |
| **Erro** | "Não consegui ler o Google Agenda. Os eventos de hoje podem estar incompletos; tento de novo em 5 minutos." | "O extrato veio num formato que não reconheço. Nada foi alterado. Pode me mandar em CSV?" | "Não tenho acesso a esta pasta. Parei sem alterar nada." | "Não consegui ler os registros do OpenCode: o arquivo está bloqueado. Tento de novo no próximo ciclo." |

### Briefing da manhã e fechamento do dia

Inspirados no planejamento e no fechamento diários do Sunsama e do Akiflow e no ritual de fim de expediente de Cal Newport. Chegam com a Alba, na fase 3: nada disto existe ainda.

**Briefing da manhã**
- **Quando:** na primeira atividade do dia no PC (desbloquear ou voltar da suspensão depois das 5h), uma vez por dia; horário fixo como alternativa para quem deixa o PC ligado.
- **Onde:** o painel Hoje se abre a partir do dock. Notificação do Windows só se ele ficar fechado por 10 minutos.
- **Tamanho:** até 6 linhas mais as ações; leitura de menos de 30 segundos. Agente sem novidade não aparece.
- **Ordem:**
  1. **Alba, o dia:** reuniões e a próxima delas, blocos livres, as 3 prioridades; avisa se o dia está cheio.
  2. **Ontem:** "4 ficaram abertas" [Trazer para hoje] [Revisar].
  3. **Tula:** a semana contra o previsto e o que vence em até 3 dias, numa linha.
  4. **Nuno:** uso do limite, PRs esperando você, CI quebrado, numa linha.
  5. **Faina:** só aprovações pendentes.
  6. Ações: [Começar o dia] [Ajustar plano].

**Fechamento do dia**
- **Quando:** no horário de parar (padrão 18h, ajustável no briefing), com adiar 30 minutos. Se o PC suspender antes, o fechamento aparece na manhã seguinte como "Ontem", no topo do briefing.
- **Duração:** cerca de 2 minutos.
- **Ordem:**
  1. **Alba:** o que foi feito; o que ficou aberto, com [Amanhã] [Outra data] [Descartar].
  2. **Alba:** amanhã numa linha (primeiro compromisso e prioridade).
  3. **Tula:** gasto do dia e "lançar algo que faltou?".
  4. **Nuno:** sessões ainda abertas, PRs e CI a observar, uso do limite.
  5. **Faina:** o que fez no dia e o que ainda dá para desfazer.
  6. [Encerrar o dia]: responde "Dia encerrado." e silencia os agentes até a manhã, exceto aprovações e lembretes.

**Se você ignorar**
- Nada se acumula: briefing e fechamento fecham sozinhos e reaparecem resumidos na próxima vez.
- Pendência não replanejada vai para hoje e é marcada no briefing seguinte.
- Depois de 3 dias ignorados seguidos, a Alba pergunta uma vez: "Deixo o briefing mais curto ou desligo?". Desligado, os avisos de prazo, limite e orçamento continuam.

**Fontes:** [Microsoft Style Guide](https://learn.microsoft.com/en-us/style-guide/brand-voice-above-all-simple-human) · [Microsoft, escrita no Windows](https://learn.microsoft.com/windows/uwp/design/style/writing-style) · [Google, persona](https://developers.google.com/assistant/conversation-design/create-a-persona) · [Google, erros](https://developers.google.com/assistant/conversation-design/errors) · [NN/g, dimensões de tom](https://www.nngroup.com/articles/tone-of-voice-dimensions/) · [GitHub Primer, conteúdo](https://primer.style/foundations/content) · [Monzo, tom de voz](https://monzo.com/tone-of-voice/) · [YNAB](https://www.ynab.com/blog/3-steps-to-reset-your-budget-after-a-period-of-heavy-spending) · [Hazel, prévia de regra](https://www.noodlesoft.com/manual/hazel/work-with-folders-rules/create-edit-rules/preview-a-rule) · [Vercel, gasto](https://vercel.com/docs/spend-management) · [Sunsama](https://www.sunsama.com/features/daily-planning-and-shutdown) · [Akiflow, rituais](https://akiflow.featurebase.app/en/help/articles/0805246-rituals) · [Cal Newport, ritual de fechamento](https://calnewport.com/drastically-reduce-stress-with-a-work-shutdown-ritual/)

### Visual dos agentes

Cada agente é um **personagem**: corpo, rosto e um traço próprio, para que o time pareça gente trabalhando com você e não uma máquina. O desenho continua sóbrio, com formas simples, cores chapadas no tom do agente, sem contorno e sem detalhe que não leia pequeno.

| Agente | Silhueta | Traço próprio |
|---|---|---|
| **Alba** | Ovo, levemente inclinado | Três raios de sol sobre a cabeça |
| **Tula** | Pera, base larga e estável | Coque no alto e óculos redondos |
| **Faina** | Bloco arredondado, robusto | Bandana com nó de lado |
| **Nuno** | Cápsula alta | Fones de ouvido |

- **Rosto:** dois olhos e uma boca, e só. A **expressão é o estado**: descansando, focado (olhos baixos, trabalhando), atento (olhos grandes, sobrancelhas erguidas, esperando você), preocupado (erro) e dormindo (olhos fechados, desligado). A legenda de texto acompanha sempre, para nunca depender só do desenho.
- **Tamanhos:** só a cabeça no dock e em listas (16 a 32 px); meio corpo nos painéis; corpo inteiro na página do agente no Sistema.
- **Movimento:** respiração lenta em repouso e um piscar de vez em quando; tudo para quando o Windows pede menos animação. Nada de pulos, confetes ou falas em balão.
- **Agentes criados por você** montam o personagem a partir de uma biblioteca fechada de silhuetas, traços e tons, para o time continuar coerente.
- Valores de cor e medidas em [DESIGN.md](DESIGN.md#6-agentes).

---

## 3. Provedores de modelo

Uma interface só, `Provedor`, com dois tipos de adaptador. Cada agente escolhe o seu, e trocar vale na próxima execução: a que está rodando termina no modelo antigo.

```ts
interface Provedor {
  readonly id: string;
  executar(pedido: PedidoDoAgente, sinal: AbortSignal): AsyncIterable<EventoAgente>;
  // EventoAgente: texto parcial, chamada de ferramenta, resultado, uso de tokens,
  // fim (com o que passar em continuarDe para seguir a sessão) ou erro tipado
}
```

O erro tipado diz ao runtime que o agente deve dormir: `limite`, `fora_do_ar`, `credencial` ou `ausente`. Só `limite` e `fora_do_ar` carregam hora de volta, e só quando o provedor a informa. Nos testes e no CI o provedor é sempre o `falso`, roteirizado (ADR-0016): nenhum teste chama modelo de verdade.

### Adaptadores CLI — usam a assinatura que você já tem

O serviço inicia o CLI como subprocesso, envia o pedido e lê a saída estruturada. O CLI roda o próprio ciclo de agente; as ferramentas do Moductus chegam a ele pelo **servidor MCP** do Moductus.

| Provedor | Situação | Comando base | Ferramentas | Observação |
|---|---|---|---|---|
| Claude Code | Implementado e validado na 2.1.287 (mínima: 2.1.257) | `claude -p --output-format stream-json --verbose --include-partial-messages` | `--mcp-config` apontando para o MCP do Moductus, `--allowedTools` só com as ferramentas do agente, `--tools ""` e `--strict-mcp-config` | Instruções via `--append-system-prompt`; continuidade com `--resume`; aprovação pelo hook `PreToolUse` do serviço, porque no `-p` o `PermissionRequest` não dispara (seção 5.1) |
| Codex | Previsto | `codex exec --json` | Servidor MCP na configuração do Codex **(validar formato por flag)** | Sem adaptador |
| Gemini CLI | Previsto | `gemini -p` com saída JSON **(validar flag)** | MCP na configuração do Gemini | Sem adaptador |
| Antigravity | Previsto | **(validar)** o que ele expõe fora do editor | | Se não houver CLI, entra só como sessão acompanhada (seção 5) |

**Vantagem:** nenhum custo extra de API, e o modelo mais forte que você já paga.
**Custo:** segundos de latência por chamada (de 3 a 5 s até a resposta, quase todos do CLI; [ARCHITECTURE.md](ARCHITECTURE.md#medições-da-fase-2)) e pouco controle fino do ciclo. Por isso o serviço mantém **no máximo um subprocesso por agente** e enfileira os pedidos.

**Como o Claude Code roda para um agente** (ADR-0017):
- Numa pasta do Moductus (`claude-cli/` nos dados), sem **nenhuma ferramenta nativa**: Bash, Edit e Write ficam de fora, e se uma aparecer o `PreToolUse` do serviço nega com motivo legível. O agente age só pelo catálogo, com nível de efeito e desfazer.
- Sem a configuração do usuário: `--setting-sources ""` e `CLAUDE_CODE_DISABLE_CLAUDE_MDS` e `CLAUDE_CODE_DISABLE_AUTO_MEMORY` no ambiente. Hooks, plugins, permissões, `CLAUDE.md` e memória do PC não entram (no teste, 34 mil tokens de entrada com a configuração contra 16 mil sem ela). O ambiente também não leva nenhum `MODUCTUS_*`, exceto o acesso da execução.
- Sem variável que cobre por token: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` e as de Bedrock e Vertex saem do ambiente, para "assinatura" ser verdade (ADR-0024).
- A chamada `externo` espera o cartão no executor da execução, e o `--mcp-config` leva `timeout` de 24 h: sem ele o Claude Code desiste do MCP aos 60 s. Cartão decidido depois de a execução acabar não roda.
- O `PreToolUse` é um hook `http` passado por `--settings` a cada execução, no mesmo servidor do MCP e com o mesmo token; se o serviço engasgar, a porta continua fechada pelo `--tools ""` e pelo `--allowedTools`.
- Sessão que o CLI não acha mais no `--resume` recomeça do zero; trocar o provedor do agente não leva a sessão antiga para o novo. Limite de uso do CLI vira erro `limite`, com o horário de volta quando ele informa.
- `claude.cmd` instalado pelo npm não é atendido: o adaptador chama o executável sem shell. A detecção marca esse Claude como impedimento (`instalado_pelo_npm`) e diz para instalar pelo instalador nativo (ADR-0025).

### Adaptadores de API — chave própria ou modelo local

O serviço roda o ciclo de agente ele mesmo: manda mensagens e ferramentas, executa as chamadas de ferramenta, devolve o resultado, repete até o fim (no máximo 25 voltas).

| Provedor | Situação | Configuração |
|---|---|---|
| OpenAI | Implementado | Chave; modelo; o endereço é sempre `api.openai.com` |
| **Compatível com OpenAI** | Implementado | `base_url` + chave opcional. Cobre OpenRouter, Groq, Ollama, LM Studio, vLLM e outros. `base_url` com usuário e senha na URL é recusado |
| Anthropic | Previsto | Chave; modelo escolhido na lista |
| Gemini | Previsto | Chave; modelo |

Cota esgotada da OpenAI e o 402 do OpenRouter são tratados como `credencial` (dependem de você, não de esperar); recusa de moderação não põe o agente para dormir. As chaves ficam no Gerenciador de Credenciais; o serviço pede à casca na hora do uso. O roteiro com um Ollama de verdade fica por conta do humano (o adaptador é testado contra um servidor falso local).

### Detecção e teste

A tela de modelos e o primeiro uso procuram `claude`, `codex`, `gemini` e `opencode` no PATH, perguntam a versão e, quando o CLI sabe dizer, se há login. Nada disso chama o modelo. Só os CLIs com adaptador podem ser usados; os outros aparecem como "em breve". Testar é uma chamada curta de verdade (prazo de 60 s) e só grava `testado_em` se passar. O provedor testado vira o principal dos agentes que ainda não têm modelo.

### Primeiro uso e falha de provedor

- **Primeiro uso:** a configuração inicial pede para conectar pelo menos um modelo, CLI ou API, e já o atribui aos quatro agentes. Dá para trocar por agente depois, em Configurações › Modelos (principal, reserva e teto). Trocar de modelo no primeiro uso é uma operação do serviço, atômica: testa o novo e só então tira o antigo (ADR-0025).
- **Provedor fora do ar, limite de uso estourado, chave recusada ou CLI ausente:** o agente **dorme**: o personagem fecha os olhos, o dock mostra quando ele volta (o fim da janela de uso, quando a ferramenta informa) e nenhuma nova chamada ao modelo é feita até lá. Sem hora de volta, o serviço tenta de novo com espera crescente (1 minuto, dobrando a cada falha, até 30 minutos), e mudar a configuração do provedor acorda quem dormia por ele. O motivo fica guardado (`limite`, `fora_do_ar`, `credencial`, `ausente`, `teto`) e vale depois de reiniciar. Os vigias continuam: evento de sessão chega e fica anotado, e tudo o que precisar de modelo fica enfileirado para quando ele acordar. Os dados e as telas continuam acessíveis. A pergunta que esperava resposta quando o serviço parou volta à fila ao subir.
- **Como o dock mostra:** limite de uso é sono tranquilo, com a hora de volta; falha do provedor (fora do ar, chave recusada, CLI ausente) é **erro**, com cara preocupada e ponto vermelho no dock até o modelo voltar; teto de gasto pede uma decisão sua, com ponto amarelo (ADR-0026).
- **Teto de gasto (opcional):** dá para definir um teto diário por agente; ao atingir, o agente dorme do mesmo jeito até o dia seguinte. Sem teto por padrão. **Na fase 2 o teto fica desligado:** o custo é medido em microdólares e o teto em centavos, e a moeda do teto ainda não foi decidida; o serviço recusa gravar um valor e a tela mostra "moeda a decidir".
- **Provedor reserva (opcional):** cada agente pode ter um segundo provedor, usado quando o principal falha (inclusive depois de uma falha parcial, com o histórico da conversa); o principal é tentado de novo depois de 15 minutos.

---

## 4. Ferramentas e aprovação

### Catálogo

Cada ferramenta é declarada uma vez:

```ts
ferramenta({
  nome: "financas.lancar",
  descricao: "Registra um gasto ou receita",
  entrada: z.object({ valor: z.number(), descricao: z.string(), categoria: z.string().optional(), data: z.string().optional() }),
  efeito: "interno",              // leitura | interno | externo
  executar: (entrada, ctx) => areas.financas.lancar(entrada, ctx),
});
```

O mesmo catálogo gera:
- o tool calling dos adaptadores de API;
- o **servidor MCP do Moductus**, que os adaptadores CLI recebem por configuração e que, na fase 5, fica disponível para qualquer agente externo (o Claude Code no seu terminal passa a ver suas tarefas e notas). Hoje ele só atende as execuções dos próprios agentes, cada uma com o seu token;
- a lista de capacidades de cada agente (`agentes.capacidades`).

Na fase 2 o catálogo tem as ferramentas do Nuno (seção 2). Nos modelos o ponto do nome vira `__` (`github.comentar` é `github__comentar`), porque é o que o MCP aceita.

### Níveis de efeito

| Efeito | Exemplo | Comportamento |
|---|---|---|
| `leitura` | listar tarefas, buscar memória | Executa direto |
| `interno` | criar tarefa, lançar gasto | Executa direto, aparece no histórico do agente e **tem de declarar como se desfaz**. Desfazer vale por 24 horas, roda numa transação e não é feito com a execução ainda rodando |
| `externo` | comentar em PR, mover arquivo, enviar e-mail | Gera **cartão de aprovação** no dock e no Sistema, com o texto que a própria ferramenta declara; só executa com seu sim |

Cartões pendentes ficam no banco: fechar o app não perde o pedido. O cartão expira quando a situação mudou: a execução que o pediu acabou, o serviço reiniciou (quem segurava a resposta era o que caiu), a sessão do terminal seguiu ou foi encerrada, ou a ferramenta já não vale. O cartão decidido a tempo vira o resultado da chamada; "Sempre neste projeto" cria uma regra que decide os próximos pedidos **iguais** sem cartão (comando exato, caminho absoluto ou domínio; nenhum padrão libera a ferramenta inteira).

### Escopo

Cada agente só recebe as ferramentas da sua lista. O contexto enviado ao modelo é montado pelas ferramentas que ele chama, não por um despejo do banco: o Nuno nunca vê seus lançamentos.

---

## 5. Sessões de IA externas

A seção **Agentes** do dock e a área **Sessões de IA** mostram os agentes de código que rodam fora do Moductus, agrupados por projeto: o que estão fazendo, se pedem aprovação, quando terminaram.

### Como os eventos chegam

O serviço abre um endpoint HTTP local (`127.0.0.1:47821`; `MODUCTUS_HOOKS_PORTA` troca a porta) com um token próprio e estável, publicado como variável do usuário `MODUCTUS_HOOKS_TOKEN`, e cada ferramenta é ligada a ele pelo mecanismo que oferece. O Moductus instala essa ligação com o seu consentimento, em Configurações › Conexões: a prévia mostra só o bloco `hooks` do `settings.json`, antes e depois, e ligar ou desligar mexe apenas nos hooks do Moductus (os seus e o resto do arquivo voltam byte a byte como estavam), com cópia de segurança. Variável de ambiente só vale para terminal novo: depois de ligar, abra um terminal novo, ou o endpoint responde 401 pedindo isso.

| Ferramenta | Mecanismo | O que dá para saber |
|---|---|---|
| **Claude Code** | Hooks do tipo `http` no `settings.json` do usuário, apontando direto para o endpoint, com o token no cabeçalho `Authorization` lido de variável de ambiente (`allowedEnvVars`): `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification`, `Stop`, `SessionEnd`. Nenhum script intermediário | Projeto (`cwd`), sessão, ferramenta e comando em uso, pedido de permissão, fim de turno, ociosidade (`Notification` com `idle_prompt`) |
| **Aprovar pelo dock** | O hook `PermissionRequest` segura a resposta HTTP até você decidir no dock e devolve `decision.behavior` `allow` ou `deny`, com mensagem | Aprovar ou negar sem voltar ao terminal. Validado (seção 5.1). O cartão oferece Negar, "Sempre neste projeto" e Permitir; no aviso do Windows o rótulo do meio é "Sempre aqui". A regra vale só no Moductus: o hook não devolve `updatedPermissions`, então o Claude Code continua perguntando no terminal, e o Moductus responde sozinho ao próximo pedido igual (ADR-0023) |
| **Codex** | Sem ligação própria. O `notify` só avisa o fim de cada turno (`agent-turn-complete`, com `cwd`, `thread-id` e a última mensagem) e roda um comando, nunca HTTP. Os hooks do Codex, que mandam `session_id`, `cwd`, `hook_event_name`, `tool_name` e `tool_input` no mesmo formato dos do Claude Code (`PreToolUse`, `PermissionRequest`, `Stop` e outros) também rodam só comando, com o JSON na entrada padrão, e exigem que você revise e confie neles no `/hooks`; sem um script intermediário que o Moductus teria de instalar e manter, não há como chegar ao endpoint. Fica para uma varredura de processos, **prevista e ainda sem código**: hoje o Codex não aparece nas Sessões de IA | Só "está rodando neste projeto"
| **OpenCode** | Plugin de um arquivo em `~/.config/opencode/plugins/moductus.js`, que o OpenCode carrega sozinho. Traduz os eventos dele para os dos hooks e posta em `/hooks/opencode` com o token da variável de ambiente. Validado no OpenCode 1.18.29 (eventos `session.*`, `permission.asked`, `message.part.updated`). Só informa: aprovar pelo dock não vale para ele, e sessão filha (subagente) não vira sessão (o pedido de permissão dela aparece na sessão pai). O plugin e a ligação estão prontos no serviço, mas a instalação pela tela de Conexões e um token independente do Claude Code (hoje `MODUCTUS_HOOKS_TOKEN` só existe com a conexão do Claude Code ligada) ainda não existem | Projeto, sessão, estado, ferramenta e comando em uso, pedido de permissão, fim de turno
| **Outros** | Varredura de processos (`claude`, `codex`, `gemini`) com diretório de trabalho: **prevista, não existe no código** | Só "está rodando neste projeto" |

### Estados mostrados

`trabalhando` · `esperando você` · `terminou` · `erro` · `parada` (sem evento há muito tempo)

### 5.1 Resultado do teste de viabilidade

Feito em 06/10/2026 com o Claude Code 2.1, hooks `http` apontando para um servidor local que simulava o dock, esperando 3 s antes de responder.

| Situação | Resultado |
|---|---|
| Eventos chegando ao endpoint | ✅ Todos, com o token no cabeçalho |
| Sessão interativa, `PermissionRequest` | ✅ O Claude Code esperou a resposta; `allow` executou o comando, `deny` bloqueou e o modelo recebeu a mensagem "Negado pelo dock do Moductus" sem tentar contornar. O diálogo do terminal continua na tela enquanto o dock decide |
| Modo `claude -p`, `PermissionRequest` | ❌ Não dispara: comando que pede permissão é negado direto |
| Modo `claude -p`, `PreToolUse` com `permissionDecision` | ✅ Espera a resposta; `allow` executa, `deny` bloqueia com o motivo |
| Comandos considerados seguros (`echo`) | Não pedem permissão, então não geram `PermissionRequest`; aparecem só em `PreToolUse` e `PostToolUse` |

**O que a fase 2 implementou disso:** o cartão do dock responde o `PermissionRequest` com `allow` ou `deny` e uma mensagem; sem decisão em 600 s, com a conexão caída, ou quando a sessão segue (chega outro evento dela, como o fim do turno ou um novo prompt) ou é encerrada, o cartão expira e a resposta sai vazia, deixando o diálogo do terminal valer. Tudo isso é coberto por teste ponta a ponta com a sessão simulada. O roteiro com uma sessão real e o `settings.json` do usuário fica para o humano, no PR da fase, e deve conferir se o Claude Code derruba a conexão do hook quando a resposta é dada no terminal.

**Consequências para o desenho:**
- Sessões interativas do Claude Code são aprovadas pelo `PermissionRequest`.
- O adaptador CLI do Moductus (seção 3), que roda `claude -p`, aprova pelo `PreToolUse`: o hook decide sozinho as ferramentas do próprio Moductus pelo nível de efeito, e manda ao dock só o que for `externo`.
- O primeiro comando Bash de uma sessão levou cerca de 14 s entre a aprovação e a execução, enquanto o segundo foi imediato. A explicação provável é o Claude Code preparando o shell na primeira chamada, não o hook.

### Consumo e limites

- **Uso de tokens (Claude Code):** o hook informa o `transcript_path`, e o transcript registra o uso de cada resposta do modelo (`message.usage`: entrada, saída e cache). O Moductus lê o arquivo de forma incremental, só dentro da pasta `projects` do Claude Code, conta cada resposta uma vez no PC (cópias de histórico por `--fork-session` não contam de novo) e soma por dia, ferramenta, modelo e projeto em `uso_ia`, com `fonte` = `ferramenta`. Custo fica vazio na assinatura. As execuções dos próprios agentes do Moductus não entram por aqui: o CLI delas não recebe o token dos hooks.
- **Contexto:** os tokens que a última resposta leu, e depois de uma compactação o tamanho que o Claude Code anotou nela. A janela vem da própria ferramenta quando ela informa no transcript; sem isso, de uma tabela por modelo versionada no serviço, conferida na documentação de modelos da Anthropic. Modelo fora da tabela fica sem janela: a área diz que não sabe e o aviso dos 80% não sai (ADR-0021).
- **Limites de uso** (janela de 5 horas, limite semanal): o Claude Code não expõe por hook nem por arquivo local, e ficam fora até existir uma fonte estável. Para Codex, OpenCode, Gemini e Antigravity não há fonte validada, então ficam fora também. Sem fonte confiável, a área não inventa número.

---

## 6. Execução em segundo plano

### Sempre vivos

Os agentes ficam **sempre prontos**: o serviço sobe no login, independe das janelas (fechar o Sistema ou esconder o dock não para nada) e só encerra quando você sai do Moductus ou desliga o PC.

"Vivo" não quer dizer um modelo pensando o tempo todo. Cada agente tem **vigias**, código comum que roda o tempo inteiro sem gastar token, e o modelo só é acordado quando um vigia acha algo que pede julgamento:

| Agente | Vigias sempre ligados | Quando acorda o modelo |
|---|---|---|
| **Alba** | Relógio de lembretes e compromissos, virada do dia | Montar briefing e fechamento; entender uma captura |
| **Tula** | Pasta de extratos, vencimento de parcelas e recorrências, limite de categoria | Ler e categorizar extrato; explicar um estouro |
| **Faina** | Tamanho de Downloads, caixa de entrada de Arquivos, agenda de limpeza | Montar o plano e a prévia de organização |
| **Nuno** | Endpoint dos hooks das sessões de IA (tempo real), uso de contexto, GitHub a cada 15 min (as buscas não devolvem ETag, ADR-0022) | Resumir o item do GitHub que passou a precisar de você; priorizar quando há duas ou mais pendências |

Só os vigias do Nuno existem na fase 2; os outros chegam com as áreas.

- **O despertar do Nuno é contido:** uma pendência sozinha que não seja do GitHub já aparece no dock sem modelo. O modelo só acorda para resumir ou priorizar, **sem ferramentas** e com prazo, e o texto vindo do GitHub, que qualquer um escreve, chega marcado como dado: uma instrução escondida num PR não tem ferramenta nenhuma para usar. Sem modelo, a pauta fica e o próximo evento tenta de novo.
- **Lembrete não depende de modelo (Alba, fase 3):** dispara no horário mesmo sem rede, sem provedor ou com limite estourado.
- **PC suspenso ou desligado:** ao voltar (evento de retomada do Windows), cada vigia recupera o que perdeu: lembretes vencidos aparecem como atrasados, o GitHub é consultado na hora, e o briefing sai se a manhã ainda não passou. Na fase 2, a casca avisa a retomada e o agendador dispara o que venceu, uma vez só, depois de esperar a rede voltar; o GitHub é lido na hora. Lembretes e briefing chegam com a Alba.
- **Pausar:** pelo menu do ícone na bandeja dá para pausar todos os agentes ou um só, por 30 minutos, 1 hora ou até amanhã (reunião, apresentação), e retomar na hora; o menu mostra o estado de cada um. Os vigias continuam anotando e entregam tudo ao retomar.
- **Custo de ficar vivo:** vigias contam no orçamento de memória do serviço e não fazem consulta de rede mais frequente que o intervalo configurado.

### Agendador e execuções

- O **agendador** dispara gatilhos por horário (`08:30`), por intervalo (`15min`) e por evento interno (`arquivo.chegou`, `sessao.pediu_aprovacao`, `orcamento.estourou`). Até onde cada gatilho foi contado fica no banco: o serviço que reinicia não repete um disparo e dispara, uma vez, o que venceu com ele parado (marcado como atrasado). Os quatro agentes de fábrica ainda não têm gatilhos; eles chegam com as áreas.
- Cada disparo vira uma **execução** registrada: agente, gatilho, provedor, ferramentas chamadas, tokens, duração, resultado. O histórico do agente no Sistema lê essa tabela.
- Execuções do mesmo agente são **em fila**; agentes diferentes rodam em paralelo.
- Falha de provedor (sem rede, limite de uso, CLI ausente) não perde o gatilho: a execução fica marcada, o ícone do agente no dock mostra o erro e o próximo gatilho tenta de novo.
- **Silêncio por padrão:** agente só gera aviso quando há algo para você decidir ou saber. O resultado de rotina fica no histórico.

---

## 7. Estados visíveis do agente

O serviço guarda quatro estados do agente (`ativo`, `pausado`, `dormindo`, `desligado`) e diz, para o `ativo`, o que ele faz agora. O dock e o Sistema leem tudo isso como uma situação e a escrevem do mesmo jeito em todo lugar (um formatador só, o mesmo texto no painel, na página do agente e na conversa; ADR-0026). Os estados refletem execuções reais, nunca animação decorativa.

| Situação | Expressão | Status escrito | Ponto no dock |
|---|---|---|---|
| Ativo, sem fazer nada | descansando | `ocioso` | — |
| Ativo, rodando uma execução | focado | `trabalhando` | — |
| Ativo, com cartão ou pergunta esperando você | atento | `esperando você` | — |
| Ativo, a última execução deu erro | preocupado | `erro` | vermelho |
| Dormindo por limite de uso | olhos fechados | `dormindo`, com "Volta seg 9:00" | — |
| Dormindo por falha do provedor (fora do ar, chave recusada, CLI ausente) | preocupado | `erro`, com "tenta de novo às 14:05" (a hora é sempre HH:MM, inclusive a cheia; ou "tentando de novo" quando a hora chegou) | vermelho |
| Dormindo por teto de gasto | preocupado | `parado`, com "Chegou ao teto de hoje" | amarelo |
| Sem modelo | olhos fechados | `dormindo`, com o convite "Conectar um modelo" | — |
| Pausado | olhos fechados | `pausado`, com "Em pausa até 14:30" ou "até você retomar" | — |
| Desligado | olhos fechados, a 55% | `desligado` | — |

Quando há mais de uma coisa, o ponto vermelho vale mais que o amarelo, e o amarelo vale por teto, sessão esperando e aviso. O dock só acende o ponto de quem tem pedido pendente. A fila de pedidos que esperam o agente voltar aparece junto ("2 pedidos na fila").
