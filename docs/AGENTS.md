# Moductus — Agentes

> Como os agentes do Moductus funcionam: definição, provedores de modelo, ferramentas, aprovação, e como o app acompanha os agentes de código que rodam fora dele. O produto está em [PRODUCT.md](PRODUCT.md); os processos e o banco, em [ARCHITECTURE.md](ARCHITECTURE.md).

**Status:** desenho da fase 0. Itens marcados com **(validar)** dependem de comportamento de ferramenta externa que precisa ser confirmado num spike antes de implementar.

---

## 1. O que é um agente

Um agente é **configuração**, não código. Todos rodam no mesmo runtime, dentro do serviço.

| Campo | Exemplo (agente Dev) |
|---|---|
| `id`, `nome`, `apelido` | `dev`, "Dev", `@dev` |
| `instrucoes` | Quem é, do que cuida, como responde, o que nunca faz |
| `ferramentas` | Subconjunto do catálogo: `github.prs_para_revisar`, `github.issues_atribuidas`, `sessoes.listar`, `tarefas.criar`… |
| `provedor` | `claude-cli` com modelo padrão, ou `openai-compativel` apontando para um endpoint |
| `gatilhos` | `intervalo: 15min`, `evento: sessao.pediu_aprovacao` |
| `memoria` | Quais escopos de memória pode ler e escrever |

Os quatro agentes iniciais vêm de fábrica e podem ser editados. Criar um agente novo é preencher esses campos no Sistema.

---

## 2. Os agentes iniciais

### Demandas
- **Cuida de:** tarefas, agenda, foco, notas.
- **Faz:** transforma frase solta em tarefa com data e prioridade; monta o **briefing da manhã** (o que vence hoje, o que ficou de ontem, PRs e contas do dia, vindos dos outros agentes); faz o **fechamento do dia** (o que foi feito, quanto foco, o que passa para amanhã); sugere o que fazer no próximo foco.
- **Gatilhos:** horário do briefing e do fechamento, tarefa vencendo.
- **Ferramentas:** `tarefas.*`, `foco.*`, `notas.*`, `memoria.buscar`, leitura de resumo dos outros agentes.

### Finanças
- **Cuida de:** contas, lançamentos, categorias, orçamento, recorrências.
- **Faz:** lança gasto por texto ("45 de mercado no débito"), por print ou comprovante (OCR local, depois o modelo estrutura), por extrato OFX ou CSV caído na caixa de entrada; categoriza; avisa quando uma categoria passa do orçamento ou uma recorrência está para vencer; responde "quanto gastei com X".
- **Gatilhos:** arquivo de extrato em Arquivos, orçamento estourado, recorrência próxima.
- **Ferramentas:** `financas.*`, `arquivos.ler_texto`, `memoria.buscar` (escopo finanças).
- **Nunca:** paga, transfere ou acessa banco. Só registra.

### Dev
- **Cuida de:** GitHub e as sessões de agentes de código.
- **Faz:** lista PRs esperando seu review, PRs seus com review ainda não atendido, issues e demandas atribuídas a você, CI quebrado; resume um PR; avisa quando uma sessão de IA pede aprovação ou termina; cria tarefa a partir de um review.
- **Gatilhos:** intervalo (padrão 15 min), eventos de sessão.
- **Ferramentas:** `github.*` (via `gh`, com a sua autenticação), `sessoes.*`, `tarefas.criar`.
- **Efeito externo** (comentar, aprovar PR, marcar thread): sempre por cartão de aprovação.

### Memória
- **Cuida de:** o que precisa ser lembrado entre conversas e entre agentes.
- **Faz:** guarda fatos com origem e data ("o vencimento do cartão é dia 10"); responde aos outros agentes quando pedem contexto; consolida memórias duplicadas; você pode editar e apagar tudo pela área Memória.
- **Ferramentas:** `memoria.*`, `notas.buscar`, `arquivos.buscar`.
- **Busca:** FTS5 primeiro. Busca por similaridade (embeddings) fica para depois, e só com provedor que ofereça embeddings ou modelo local.

### Roteamento

1. Menção explícita (`@financas`) escolhe o agente.
2. Sem menção, regras simples por palavra e contexto (valor em reais vai para Finanças, link de PR vai para Dev).
3. Sem regra, um classificador barato (o modelo do agente Demandas, prompt curto) decide; Demandas é o padrão.

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
| Claude Code | `claude -p --output-format stream-json --verbose` | `--mcp-config` apontando para o MCP do Moductus, `--allowedTools` restrito às ferramentas do agente | Instruções via `--append-system-prompt`; continuidade com `--resume` |
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

### Sem provedor

Agente sem provedor continua existindo: os gatilhos rodam a parte determinística (o briefing vira uma lista sem texto corrido, o Dev lista PRs sem resumo) e o chat aceita os comandos que não precisam de modelo (`/foco 25`, `/hoje`, `/capacidades`, `/relatorio`).

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

Cada agente só recebe as ferramentas da sua lista. O contexto enviado ao modelo é montado pelas ferramentas que ele chama, não por um despejo do banco: o agente Dev nunca vê seus lançamentos.

---

## 5. Sessões de IA externas

A seção **Agentes** do dock e a área **Sessões de IA** mostram os agentes de código que rodam fora do Moductus, agrupados por projeto: o que estão fazendo, se pedem aprovação, quando terminaram.

### Como os eventos chegam

O serviço abre um endpoint HTTP local (`127.0.0.1`, porta fixa configurável, token) e cada ferramenta é ligada a ele pelo mecanismo que oferece. O Moductus instala essa ligação com o seu consentimento, na tela de conexões, e mostra exatamente o que vai mudar na configuração da ferramenta.

| Ferramenta | Mecanismo | O que dá para saber |
|---|---|---|
| **Claude Code** | Hooks no `settings.json` do usuário: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SessionEnd`. Cada hook roda um comando pequeno do Moductus que repassa o JSON do evento ao endpoint | Projeto (diretório), sessão, ferramenta em uso, pedido de permissão, fim de turno |
| **Aprovar pelo dock** | O hook de permissão espera a decisão do Moductus e devolve permitir ou negar **(validar evento e formato de resposta da versão atual)** | Aprovar ou negar sem voltar ao terminal; se o Moductus não responder a tempo, cai no fluxo normal do terminal |
| **Codex** | `notify` na configuração do Codex chama o comando do Moductus ao fim de cada turno **(validar se há eventos mais finos)** | Projeto, fim de turno, última mensagem |
| **Outros** | Varredura de processos (`claude`, `codex`, `gemini`) com diretório de trabalho | Só "está rodando neste projeto" |

### Estados mostrados

`trabalhando` · `esperando você` · `terminou` · `erro` · `parada` (sem evento há muito tempo)

### Consumo e limites

Uso e limites de cada ferramenta (janela de 5 horas, semana) aparecem em Sessões de IA quando a ferramenta expõe esse dado de forma local e estável **(validar fonte por ferramenta)**. Sem fonte confiável, a área não inventa número.

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
