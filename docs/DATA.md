# Moductus — Dados

> O que cada área guarda e como. O produto está em [PRODUCT.md](PRODUCT.md); onde o banco mora e quem acessa, em [ARCHITECTURE.md](ARCHITECTURE.md#5-dados); os agentes, em [AGENTS.md](AGENTS.md).

**Status:** desenho da fase 0. É o modelo de partida: cada fase cria as tabelas da sua área por migração, e campos podem mudar na implementação, mas as regras da seção 1 não mudam.

---

## 1. Regras que valem para tudo

- **Um banco SQLite** (`moductus.db`), uma tabela por entidade, nomes em português, `snake_case`.
- **Identificador:** `id` texto em ULID. Ordena por criação, não colide entre PCs e permite **juntar** dados importados de outro PC sem renumerar.
- **Datas:** `criado_em` e `atualizado_em` em todas as tabelas, em ISO 8601 UTC. Data sem hora (vencimento, data de lançamento) fica como `AAAA-MM-DD`. O fuso do usuário fica em `config`.
- **Dinheiro:** inteiro em **centavos** (`valor_centavos`), com sinal: negativo é saída, positivo é entrada. Moeda em `moeda` (padrão `BRL`). Nunca ponto flutuante.
- **Origem:** toda linha que um agente cria ou muda guarda `origem` (`usuario`, `agente`, `importacao`, `conexao`), `agente_id` e `execucao_id`. É o que alimenta o histórico do agente e o desfazer.
- **Apagar:** apagar manda para a lixeira do Moductus (`apagado_em`); some de vez depois de 30 dias ou quando você esvazia. Lançamentos importados nunca somem sem você mandar.
- **Busca:** texto livre (títulos, notas, memórias, descrições) entra num índice FTS5.
- **Segredos:** nenhum. Chaves e tokens ficam no Gerenciador de Credenciais; o banco guarda só o nome da credencial.
- **Exportação:** cada tabela é marcada como *configuração* ou *dado* — é isso que separa "só configurações" de "configurações e dados" no arquivo de levar para outro PC.

---

## 2. Dia: agenda, tarefas, lembretes e foco (Alba)

### `calendarios`
Fontes de evento: o local, o "Moductus" criado no Google Agenda e os calendários que você escolheu ler.
`id`, `nome`, `origem` (`local`, `google`, `outlook`), `id_externo`, `cor`, `pode_escrever`, `ler`, `sincronizado_em`.

### `eventos`
`id`, `calendario_id`, `titulo`, `descricao`, `inicio`, `fim`, `dia_inteiro`, `local`, `recorrencia` (RRULE do iCalendar), `id_externo`, `etag_externo`, `alertas` (minutos antes, lista), `origem`, `agente_id`, `execucao_id`.
Evento vindo do Google fica em cache aqui para o briefing e para achar horário livre; a fonte da verdade é o Google.

### `listas`
`id`, `nome`, `ordem`, `cor`, `arquivada`. Padrões: Entrada, Trabalho, Pessoal.

### `tarefas`
`id`, `lista_id`, `tarefa_pai_id` (subtarefas, um nível), `titulo`, `notas`, `prioridade` (0 nenhuma a 3 alta), `vence_em` (data), `hora` (opcional; com hora, a Alba cria evento no calendário "Moductus"), `duracao_estimada_min`, `recorrencia` (RRULE), `estado` (`aberta`, `feita`, `cancelada`), `concluida_em`, `ordem`, `origem`, `agente_id`, `execucao_id`, `evento_id`.

### `etiquetas` e `tarefa_etiquetas`
Etiquetas livres (`trabalho`, `casa`, `pr-123`). Ligação muitos para muitos.

### `lembretes`
Lembrete é o que **dispara**; pode estar ligado a uma tarefa, a um evento ou a nada ("beber água às 15h").
`id`, `texto`, `quando`, `recorrencia`, `tarefa_id`, `evento_id`, `estado` (`agendado`, `disparado`, `adiado`, `perdido`), `disparado_em`, `adiado_ate`, `canal` (`dock`, `windows`, `calendario`).
`perdido` é o lembrete que venceu com o PC desligado: aparece como atrasado na volta.

### `sessoes_foco`
`id`, `tarefa_id`, `inicio`, `fim`, `duracao_planejada_min`, `duracao_real_min`, `tipo` (`foco`, `pausa`), `interrompida`.

### `rotinas`
Briefing e fechamento do dia, e o que mais virar ritual.
`id`, `tipo` (`briefing`, `fechamento`), `hora`, `dias_semana`, `ativa`, `ultima_execucao_id`.

---

## 3. Dinheiro (Tula)

### `contas`
`id`, `nome`, `tipo` (`corrente`, `poupanca`, `carteira`, `investimento`, `cartao`), `banco` (código do perfil de importação), `moeda`, `saldo_inicial_centavos`, `saldo_inicial_em`, `ativa`.
Para cartão: `dia_fechamento`, `dia_vencimento`, `limite_centavos`, `conta_pagamento_id`.

### `categorias`
`id`, `nome`, `categoria_pai_id` (um nível: "Casa › Mercado"), `tipo` (`gasto`, `receita`, `transferencia`), `cor`, `arquivada`. Vem com um conjunto padrão em pt-BR.

### `lancamentos`
`id`, `conta_id`, `data`, `descricao` (como você ou o agente escreveu), `descricao_original` (como veio do banco), `valor_centavos`, `categoria_id`, `fatura_id` (cartão), `parcela_numero`, `parcela_total`, `compra_id` (agrupa as parcelas de uma compra), `transferencia_id` (liga os dois lados de uma transferência entre contas), `recorrencia_id`, `divida_id`, `importacao_id`, `id_externo` (FITID do OFX), `impressao` (hash de data, valor e descrição, para não duplicar), `conciliado`, `notas`, `origem`, `agente_id`, `execucao_id`.

### `faturas`
`id`, `conta_id` (cartão), `mes_referencia`, `fecha_em`, `vence_em`, `total_centavos`, `paga`, `pagamento_lancamento_id`.

### `orcamentos`
`id`, `categoria_id`, `mes` (`AAAA-MM`; vazio vale para todo mês), `limite_centavos`, `alerta_percentual` (padrão 80).

### `recorrencias`
Contas fixas e assinaturas: aluguel, internet, streaming.
`id`, `descricao`, `valor_centavos` (estimado), `categoria_id`, `conta_id`, `regra` (RRULE), `proxima_em`, `ativa`, `detectada_automaticamente`.

### `dividas`
`id`, `nome`, `credor`, `tipo` (`cartao`, `emprestimo`, `financiamento`, `cheque_especial`, `pessoal`, `outro`), `saldo_centavos`, `saldo_em` (data do saldo), `juros_mensal_bp` (juros ao mês em pontos-base: 1,99% = 199), `parcela_centavos`, `parcelas_restantes`, `dia_vencimento`, `quitada_em`.
A simulação de quitação (maior juro primeiro ou menor saldo primeiro) é calculada na hora, não guardada.

### `planos`
Metas de economia.
`id`, `nome`, `valor_alvo_centavos`, `prazo`, `conta_id` (onde o dinheiro fica, opcional), `aporte_mensal_sugerido_centavos`, `estado` (`ativo`, `concluido`, `pausado`).

### `plano_movimentos`
`id`, `plano_id`, `data`, `valor_centavos`, `lancamento_id`.

### `importacoes`
`id`, `conta_id`, `arquivo_nome`, `arquivo_hash`, `formato` (`ofx`, `csv`, `xml`), `perfil_id`, `periodo_inicio`, `periodo_fim`, `lancamentos_novos`, `lancamentos_ignorados` (já existiam), `estado`, `erro`.
O mesmo arquivo importado duas vezes é reconhecido pelo hash.

### `perfis_importacao`
Como ler o CSV ou o XML de cada banco: os de fábrica (Nubank, Itaú, Bradesco, Banco do Brasil, Caixa, Santander, Inter, C6, Mercado Pago, PicPay) e os que você mapear.
`id`, `banco`, `tipo_conta` (`conta`, `cartao`), `formato`, `mapeamento` (JSON: coluna ou caminho XML de data, descrição, valor, sinal, identificador), `separador`, `formato_data`, `formato_decimal`, `codificacao`, `de_fabrica`.

### `regras_categoria`
O que a Tula aprendeu: "descrição contém IFOOD → Restaurantes".
`id`, `padrao`, `tipo_padrao` (`contem`, `comeca_com`, `regex`), `categoria_id`, `vezes_aplicada`, `criada_por` (`usuario`, `agente`).

---

## 4. Notas, arquivos e memória (Faina e todos)

### `notas`
`id`, `titulo`, `conteudo` (Markdown), `fixada`, `pasta` (texto livre, opcional), `origem`, `agente_id`.

### `pastas_autorizadas`
Onde a Faina pode mexer.
`id`, `caminho`, `pode_ler`, `pode_organizar`, `pode_mandar_lixeira`, `vigiar` (para os gatilhos), `limite_itens` (Downloads "cheio").
Caminhos do sistema são recusados ao cadastrar, e de novo antes de cada operação.

### `arquivos_entrada`
O que cai na caixa de entrada.
`id`, `caminho`, `nome`, `tamanho`, `hash`, `tipo`, `texto_extraido`, `resumo`, `destino` (`tula`, `nota`, `memoria`, `arquivado`), `estado`.

### `operacoes_arquivo`
O registro que permite desfazer o que a Faina fez.
`id`, `execucao_id`, `tipo` (`mover`, `renomear`, `copiar`, `criar`, `lixeira`), `origem_caminho`, `destino_caminho`, `hash`, `feito_em`, `desfeito_em`.
Uma operação só é desfeita se o arquivo ainda está onde a Faina deixou e com o mesmo hash.

### `memorias`
`id`, `texto`, `escopo` (`geral`, `dia`, `financas`, `arquivos`, `dev`), `tipo` (`fato`, `preferencia`, `pessoa`, `decisao`, `referencia`), `fonte` (conversa, nota, arquivo ou execução de onde veio), `confianca`, `usada_em` (última vez consultada), `expira_em` (opcional), `origem`, `agente_id`.

---

## 5. Dev e sessões de IA (Nuno)

### `projetos`
Pastas onde rodam sessões de IA, reconhecidas pelo `cwd` dos eventos.
`id`, `nome`, `caminho`, `repositorio` (`dono/nome` no GitHub, quando há), `arquivado`.

### `sessoes_ia`
`id`, `projeto_id`, `ferramenta` (`claude-code`, `codex`, `opencode`, `gemini`, `antigravity`), `id_externo` (session id da ferramenta), `modelo`, `estado` (`trabalhando`, `esperando`, `terminou`, `erro`, `parada`), `iniciada_em`, `ultimo_evento_em`, `encerrada_em`, `contexto_usado_tokens`, `contexto_janela_tokens`, `transcript_caminho`.

### `eventos_sessao`
`id`, `sessao_id`, `tipo` (nome do hook), `ferramenta_usada`, `entrada_resumo`, `recebido_em`.
Guarda o resumo, não o conteúdo inteiro; o conteúdo continua no transcript da ferramenta.

### `uso_ia`
Gasto e limites, por dia, ferramenta, modelo e projeto.
`id`, `dia`, `ferramenta`, `modelo`, `projeto_id`, `tokens_entrada`, `tokens_saida`, `tokens_cache`, `custo_estimado_microdolares`, `fonte` (`ferramenta`, `estimativa`).

### `github_itens`
Cache do que o Nuno acompanha no GitHub.
`id`, `repositorio`, `numero`, `tipo` (`pr`, `issue`), `titulo`, `autor`, `estado`, `meu_papel` (`autor`, `revisor`, `atribuido`), `precisa_de_mim`, `ci_estado`, `atualizado_no_github`, `etag`, `url`.

---

## 6. Agentes, conversas e aprovações (todos)

### `agentes`
`id`, `nome`, `funcao`, `instrucoes`, `personagem` (JSON: silhueta, traço, tom), `ferramentas` (lista), `provedor_id`, `provedor_reserva_id`, `gatilhos` (JSON), `escopos_memoria`, `teto_diario_centavos`, `estado` (`ativo`, `pausado`, `dormindo`, `desligado`), `dorme_ate`, `de_fabrica`.

### `provedores`
`id`, `tipo` (`claude-cli`, `codex-cli`, `gemini-cli`, `opencode-cli`, `anthropic`, `openai`, `openai-compativel`, `gemini`), `nome`, `modelo`, `base_url`, `credencial` (nome no Gerenciador de Credenciais), `testado_em`.

### `conversas` e `mensagens`
`conversas`: `id`, `tipo` (`time`, `agente`), `agente_id` (quando é com um agente), `titulo`, `arquivada`.
`mensagens`: `id`, `conversa_id`, `autor` (`usuario` ou o `agente_id`), `conteudo`, `anexos`, `execucao_id`, `criado_em`.

### `execucoes`
Cada vez que um agente trabalha.
`id`, `agente_id`, `gatilho` (`mensagem`, `horario`, `intervalo`, `evento`), `provedor_id`, `inicio`, `fim`, `estado` (`ok`, `erro`, `adiada`), `erro`, `tokens_entrada`, `tokens_saida`, `custo_estimado_microdolares`, `resumo`.

### `chamadas_ferramenta`
`id`, `execucao_id`, `ferramenta`, `efeito` (`leitura`, `interno`, `externo`), `entrada`, `resultado`, `aprovacao_id`, `desfeita_em`.

### `aprovacoes`
`id`, `execucao_id`, `agente_id`, `origem` (`moductus`, `claude-code`, `codex`…), `sessao_id`, `descricao`, `acao` (JSON do que será feito), `estado` (`pendente`, `aprovada`, `negada`, `expirada`), `decidida_em`, `regra_criada_id`.

### `regras_permissao`
"Sempre neste projeto" e as autorizações dadas uma vez.
`id`, `escopo` (`projeto`, `agente`, `conexao`), `projeto_id`, `agente_id`, `ferramenta`, `padrao` (o que a regra cobre), `decisao` (`permitir`, `negar`), `criada_em`, `expira_em`.

---

## 7. Sistema

### `config`
Chave e valor (JSON). Tema, dock (lado, forma, modo), atalhos, fuso, idioma, horários de silêncio, início com o Windows.

### `conexoes`
`id`, `tipo` (`google-agenda`, `outlook`, `github`, `hooks-claude-code`, `hooks-codex`…), `conta` (e-mail ou usuário), `escopos`, `credencial`, `estado`, `ultimo_erro`, `conectada_em`.

### `notificacoes_preferencias`
`id`, `agente_id` (vazio vale para todos), `tipo` (`aprovacao`, `lembrete`, `erro`, `aviso`, `rotina`), `nivel` (`tudo`, `so_o_que_precisa`, `nada`), `canal` (`windows`, `dock`, `ambos`).

### `notificacoes`
O que foi avisado, para o histórico e para não repetir.
`id`, `agente_id`, `tipo`, `titulo`, `corpo`, `referencia` (o que gerou), `criada_em`, `vista_em`, `canal`.

### `onboarding`
`passo`, `estado` (`feito`, `pulado`, `pendente`), `concluido_em`. Inclui as missões do tutorial.

---

## 8. Exportar para outro PC

| Vai em "só configurações" | Vai só em "configurações e dados" | Nunca vai |
|---|---|---|
| `config`, `agentes`, `provedores` (sem credencial), `conexoes` (sem credencial), `notificacoes_preferencias`, `regras_permissao`, `perfis_importacao`, `regras_categoria`, `categorias`, `listas`, `etiquetas`, `rotinas`, `pastas_autorizadas` (como sugestão, reconfirmada no PC novo) | Todas as demais tabelas de dados | Credenciais, `transcript_caminho`, caminhos absolutos que não existem no PC novo, `operacoes_arquivo` |

O arquivo é um `.moductus`: um zip com um manifesto (versão do esquema, PC de origem, data, o que contém) e um JSON por tabela. Com dados, o zip é cifrado com a senha escolhida. A importação roda as migrações necessárias antes de gravar e, ao **juntar**, usa o `id` (ULID) e as impressões (lançamentos, arquivos) para não duplicar.
