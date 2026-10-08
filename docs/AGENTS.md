# Moductus — Agentes

> Como os agentes do Moductus funcionam: definição, provedores de modelo, ferramentas, aprovação, e como o app acompanha os agentes de código que rodam fora dele. O produto está em [PRODUCT.md](PRODUCT.md); os processos e o banco, em [ARCHITECTURE.md](ARCHITECTURE.md).

**Status:** desenho da fase 0. Itens marcados com **(validar)** dependem de comportamento de ferramenta externa que precisa ser confirmado num spike antes de implementar.

---

## 1. O que é um agente

Um agente é **configuração**, não código. Todos rodam no mesmo runtime, dentro do serviço, e todos têm as mesmas três coisas que o usuário vê: **nome**, **função** e **visual**.

| Campo | O que é | Exemplo (Vigia) |
|---|---|---|
| `id`, `nome`, `apelido` | Identidade e como chamar no chat | `vigia`, "Vigia", `@vigia` |
| `funcao` | Uma frase do que ele faz, mostrada no dock e no Sistema | "Fica de olho nas suas sessões de IA e no seu código" |
| `instrucoes` | Quem é, do que cuida, como responde, o que nunca faz | Texto livre, editável |
| `visual` | Glifo e tom (veja "Visual dos agentes") | glifo `radar`, tom `ardosia` |
| `ferramentas` | Subconjunto do catálogo | `sessoes.*`, `github.*`, `tarefas.criar` |
| `provedor` | Modelo que ele usa, com reserva opcional | `claude-cli`; reserva `openai-compativel` |
| `gatilhos` | Quando trabalha sozinho | `intervalo: 15min`, `evento: sessao.contexto_alto` |
| `memoria` | Escopos de memória que lê e escreve | `dev`, `geral` |

### De fábrica e criados por você

- **De fábrica:** os quatro agentes da seção 2 vêm prontos. Dá para renomear, trocar o visual, ajustar instruções, ferramentas e modelo, ou desligar. Não dá para apagar: "restaurar padrão" volta ao original.
- **Criados por você (fase 7):** um agente novo é preenchido a partir do zero ou duplicando um de fábrica. O Sistema guia pelos campos acima. O visual sai da mesma biblioteca de glifos e tons, e as ferramentas vêm do mesmo catálogo. Ferramenta `externo` continua sempre com aprovação, então nenhum agente criado consegue agir fora do Moductus sem o seu sim.
- **Compartilhar:** um agente se exporta e importa como arquivo `.json`, só com configuração, sem dados nem chaves.

A **memória é compartilhada**, não um agente: qualquer agente guarda e consulta fatos nos escopos que tem, e a área Memória mostra e edita tudo.

---

## 2. Os agentes de fábrica

| | Alba | Lastro | Faina | Vigia |
|---|---|---|---|---|
| **Função** | Cuida do seu dia | Cuida do seu dinheiro | Faz o serviço pesado | Fica de olho nas suas IAs e no seu código |
| **Nome** | Aurora: começa o dia com você | O que sustenta: reserva e equilíbrio | Trabalho árduo, lida | Quem vigia |
| **Glifo** | Sol nascendo sobre a linha | Barras empilhadas | Blocos se encaixando | Radar |
| **Tom** | Âmbar | Musgo | Terracota | Ardósia |

### Alba — o dia a dia
- **Cuida de:** agenda, tarefas, lembretes, rotina e foco.
- **Faz:** transforma frase solta em tarefa ou compromisso com data, hora e prioridade ("ligar pro banco amanhã 15h"); dispara **lembretes** no horário, inclusive recorrentes; monta o **briefing da manhã** (compromissos, o que vence, o que ficou de ontem, e o resumo que os outros agentes mandarem); faz o **fechamento do dia** (o que foi feito, quanto foco, o que passa para amanhã); encaixa tarefas nos horários livres da agenda e sugere o próximo foco.
- **Gatilhos:** horário do briefing e do fechamento, lembrete vencendo, compromisso chegando.
- **Ferramentas:** `agenda.*`, `tarefas.*`, `lembretes.*`, `foco.*`, `notas.*`, `memoria.*`.
- **Agenda:** local no início; Google Agenda e Outlook entram como conexões, com o efeito `externo` para criar ou mudar evento fora do Moductus.
- **É o agente padrão:** mensagem sem destinatário claro vai para a Alba.

### Lastro — finanças
- **Cuida de:** gastos, dívidas, planos e orçamento.
- **Faz:**
  - **Gastos:** lança por texto ("45 de mercado no débito"), por print ou comprovante (OCR local, depois o modelo estrutura) e por extrato OFX ou CSV; categoriza; acompanha orçamento por categoria e recorrências.
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
- **Limites:** só mexe nas pastas que você autorizou; nunca apaga de vez (tudo vai para a Lixeira); comando de sistema é sempre `externo`.
- **Gatilhos:** Downloads passou de um limite, arquivo caiu em Arquivos, limpeza semanal agendada.
- **Ferramentas:** `arquivos.*`, `documentos.*`, `ocr.ler`, `comando.executar` (`externo`), `memoria.*`.

### Vigia — dev e sessões de IA
- **Cuida de:** as sessões de agentes de código e o seu trabalho no GitHub.
- **Faz:**
  - **Sessões:** acompanha Claude Code, Codex, OpenCode, Gemini CLI e Antigravity por projeto (trabalhando, esperando você, terminou, erro, parada) e leva os pedidos de permissão ao dock.
  - **Lembrete de contexto:** avisa quando uma sessão passa de 80% da janela de contexto e sugere compactar ou encerrar. O contexto é calculado pelo uso de tokens que a própria ferramenta registra (no Claude Code, o transcript da sessão) **(validar por ferramenta)**.
  - **Gasto:** tokens e custo estimado por sessão, por projeto e por dia, sempre marcados como estimativa quando não vêm da ferramenta.
  - **Limites:** janela de uso e limite semanal onde a ferramenta expõe; sem fonte, mostra só a estimativa local e diz isso.
  - **GitHub:** PRs esperando seu review, PRs seus com review a atender, issues e demandas atribuídas a você, CI quebrado; resume PR e cria tarefa a partir de review.
- **Gatilhos:** eventos de sessão, contexto alto, limite perto, intervalo de 15 min para o GitHub.
- **Ferramentas:** `sessoes.*`, `uso.*`, `github.*` (via `gh`, com a sua autenticação), `tarefas.criar`.
- **Efeito externo** (comentar, aprovar PR, responder pedido de permissão em nome de regra): sempre por cartão de aprovação ou regra que você criou.

### Roteamento

1. Menção explícita (`@lastro`) escolhe o agente.
2. Sem menção, regras simples por palavra e contexto: valor em reais vai para Lastro, link de PR ou nome de sessão vai para Vigia, arquivo ou pasta vai para Faina.
3. Sem regra, um classificador barato (o modelo da Alba, prompt curto) decide; a Alba é o padrão.

---

### Visual dos agentes

O agente tem rosto, mas sóbrio: **um glifo geométrico dentro de um quadrado arredondado**, no tom do agente. Sem mascote, sem expressão facial, sem animação decorativa.

- **Glifo:** traço único, mesma espessura dos ícones do app, legível a 16 px. É ele que diferencia um agente do outro, mais do que a cor.
- **Tom:** cor de identidade em baixa saturação, usada só no fundo do quadrado (10–18% de opacidade) e no glifo. Cada tema tem a variante escura e a clara, em [DESIGN.md](DESIGN.md#6-agentes).
- **Estado:** mostrado por um anel e pela legenda, nunca só pela cor. `ocioso` sem anel; `trabalhando` com anel girando devagar; `esperando você` com anel cheio no tom de aviso; `aviso` com ponto; `erro` com anel tracejado no tom de perigo; `desligado` com o quadrado esmaecido.
- **Agentes criados por você** escolhem glifo e tom da mesma biblioteca.

---

## 3. Provedores de modelo

Uma interface só, `Provedor`, com dois tipos de adaptador. Cada agente escolhe o seu.

```ts
interface Provedor {
  id: string;
  executar(pedido: PedidoAgente, sinal: AbortSignal): AsyncIterable<EventoAgente>;
  // EventoAgente: texto parcial, chamada de ferramenta, resultado, uso de tokens, fim, erro
}
```

### Adaptadores CLI — usam a assinatura que você já tem

O serviço inicia o CLI como subprocesso, envia o pedido e lê a saída estruturada. O CLI roda o próprio ciclo de agente; as ferramentas do Moductus chegam a ele pelo **servidor MCP** do Moductus.

| Provedor | Comando base | Ferramentas | Observação |
|---|---|---|---|
| Claude Code | `claude -p --output-format stream-json --verbose` | `--mcp-config` apontando para o MCP do Moductus, `--allowedTools` restrito às ferramentas do agente | Instruções via `--append-system-prompt`; continuidade com `--resume`; aprovação pelo hook `PreToolUse`, porque no `-p` o `PermissionRequest` não dispara (seção 5.1) |
| Codex | `codex exec --json` | Servidor MCP na configuração do Codex **(validar formato por flag)** | |
| Gemini CLI | `gemini -p` com saída JSON **(validar flag)** | MCP na configuração do Gemini | |
| Antigravity | **(validar)** o que ele expõe fora do editor | | Se não houver CLI, entra só como sessão acompanhada (seção 5) |

**Vantagem:** nenhum custo extra de API, e o modelo mais forte que você já paga.
**Custo:** segundos de latência por chamada e pouco controle fino do ciclo. Por isso o serviço mantém **no máximo um subprocesso por agente** e enfileira os pedidos.

### Adaptadores de API — chave própria ou modelo local

O serviço roda o ciclo de agente ele mesmo: manda mensagens e ferramentas, executa as chamadas de ferramenta, devolve o resultado, repete até o fim.

| Provedor | Configuração |
|---|---|
| Anthropic | Chave; modelo escolhido na lista |
| OpenAI | Chave; modelo |
| **Compatível com OpenAI** | `base_url` + chave opcional. Cobre OpenRouter, Groq, Ollama, LM Studio, vLLM e outros |
| Gemini | Chave; modelo |

As chaves ficam no Gerenciador de Credenciais; o serviço pede à casca na hora do uso.

### Primeiro uso e falha de provedor

- **Primeiro uso:** a configuração inicial pede para conectar pelo menos um modelo, CLI ou API, e já o atribui aos quatro agentes. Dá para trocar por agente depois.
- **Provedor fora do ar ou sem limite de uso:** a execução fica marcada, o agente mostra o erro no dock e tenta de novo no próximo gatilho. Os dados e as telas continuam acessíveis, e o que você fizer à mão nesse meio-tempo os agentes enxergam quando voltarem.
- **Provedor reserva (opcional):** cada agente pode ter um segundo provedor, usado quando o principal falha.

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
- o **servidor MCP do Moductus**, que os adaptadores CLI recebem por configuração e que, na fase 5, fica disponível para qualquer agente externo (o Claude Code no seu terminal passa a ver suas tarefas e notas);
- a lista `/capacidades` mostrada na interface.

### Níveis de efeito

| Efeito | Exemplo | Comportamento |
|---|---|---|
| `leitura` | listar tarefas, buscar memória | Executa direto |
| `interno` | criar tarefa, lançar gasto | Executa direto, aparece no histórico do agente com **desfazer** |
| `externo` | comentar em PR, mover arquivo, enviar e-mail | Gera **cartão de aprovação** no dock e no Sistema; só executa com seu sim |

Cartões pendentes ficam no banco: fechar o app não perde o pedido, e o cartão expira se a situação mudou (o PR foi fechado, o arquivo sumiu).

### Escopo

Cada agente só recebe as ferramentas da sua lista. O contexto enviado ao modelo é montado pelas ferramentas que ele chama, não por um despejo do banco: a Vigia nunca vê seus lançamentos.

---

## 5. Sessões de IA externas

A seção **Agentes** do dock e a área **Sessões de IA** mostram os agentes de código que rodam fora do Moductus, agrupados por projeto: o que estão fazendo, se pedem aprovação, quando terminaram.

### Como os eventos chegam

O serviço abre um endpoint HTTP local (`127.0.0.1`, porta fixa configurável, token) e cada ferramenta é ligada a ele pelo mecanismo que oferece. O Moductus instala essa ligação com o seu consentimento, na tela de conexões, e mostra exatamente o que vai mudar na configuração da ferramenta.

| Ferramenta | Mecanismo | O que dá para saber |
|---|---|---|
| **Claude Code** | Hooks do tipo `http` no `settings.json` do usuário, apontando direto para o endpoint, com o token no cabeçalho `Authorization` lido de variável de ambiente (`allowedEnvVars`): `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification`, `Stop`, `SessionEnd`. Nenhum script intermediário | Projeto (`cwd`), sessão, ferramenta e comando em uso, pedido de permissão, fim de turno, ociosidade (`Notification` com `idle_prompt`) |
| **Aprovar pelo dock** | O hook `PermissionRequest` segura a resposta HTTP até você decidir no dock e devolve `decision.behavior` `allow` ou `deny`, com mensagem | Aprovar ou negar sem voltar ao terminal. Validado (seção 5.1) |
| **Codex** | `notify` na configuração do Codex chama o comando do Moductus ao fim de cada turno **(validar se há eventos mais finos)** | Projeto, fim de turno, última mensagem |
| **OpenCode** | Sistema de plugins e eventos do OpenCode **(validar)** | Projeto, estado da sessão, ferramenta em uso |
| **Outros** | Varredura de processos (`claude`, `codex`, `gemini`) com diretório de trabalho | Só "está rodando neste projeto" |

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

**Consequências para o desenho:**
- Sessões interativas do Claude Code são aprovadas pelo `PermissionRequest`.
- O adaptador CLI do Moductus (seção 3), que roda `claude -p`, aprova pelo `PreToolUse`: o hook decide sozinho as ferramentas do próprio Moductus pelo nível de efeito, e manda ao dock só o que for `externo`.
- O primeiro comando Bash de uma sessão levou cerca de 14 s entre a aprovação e a execução, enquanto o segundo foi imediato. A explicação provável é o Claude Code preparando o shell na primeira chamada, não o hook.

### Consumo e limites

O Claude Code não expõe uso nem limites por hook ou por arquivo local. Sessões de IA mostram o que dá para contar pelos eventos (sessões, turnos, ferramentas usadas) e o uso de limites fica fora até existir uma fonte estável. Codex, Gemini e Antigravity **(validar)**. Sem fonte confiável, a área não inventa número.

---

## 6. Execução em segundo plano

- O **agendador** dispara gatilhos por horário (`08:30`), por intervalo (`15min`) e por evento interno (`arquivo.chegou`, `sessao.pediu_aprovacao`, `orcamento.estourou`).
- Cada disparo vira uma **execução** registrada: agente, gatilho, provedor, ferramentas chamadas, tokens, duração, resultado. O histórico do agente no Sistema lê essa tabela.
- Execuções do mesmo agente são **em fila**; agentes diferentes rodam em paralelo.
- Falha de provedor (sem rede, limite de uso, CLI ausente) não perde o gatilho: a execução fica marcada, o ícone do agente no dock mostra o erro e o próximo gatilho tenta de novo.
- **Silêncio por padrão:** agente só gera aviso quando há algo para você decidir ou saber. O resultado de rotina fica no histórico.

---

## 7. Estados visíveis do agente

Cada agente tem um estado que o dock e o Sistema mostram: `ocioso`, `trabalhando`, `esperando você`, `aviso`, `erro`, `desligado`. Os estados refletem execuções reais, nunca animação decorativa.
