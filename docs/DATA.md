# Moductus — Dados

> O que cada área guarda e como. O produto está em [PRODUCT.md](PRODUCT.md); onde o banco mora e quem acessa, em [ARCHITECTURE.md](ARCHITECTURE.md#5-dados); os agentes, em [AGENTS.md](AGENTS.md).

**Status:** as seções 5 a 7 (agentes, sessões de IA, GitHub, conexões, notificações e agendador) descrevem as migrações 003 a 011, entregues na fase 2; os nomes de coluna valem como estão lá. As seções 2 a 4 ainda são o desenho da fase 0: cada fase cria as tabelas da sua área por migração, e campos podem mudar na implementação, mas as regras da seção 1 não mudam.

---

## 1. Regras que valem para tudo

- **Um banco SQLite** (`moductus.db`), uma tabela por entidade, nomes em português, `snake_case`.
- **Identificador:** `id` texto em ULID. Ordena por criação, não colide entre PCs e permite **juntar** dados importados de outro PC sem renumerar.
- **Datas:** `criado_em` e `atualizado_em` em todas as tabelas, em ISO 8601 UTC com milissegundos e `Z` (`2026-10-09T14:30:00.000Z`). O momento em que algo nasceu é sempre o `criado_em`: não existe `criada_em`, `recebido_em` nem coluna parecida (a data da mensagem, do evento de sessão e da notificação é o `criado_em`). Data sem hora (vencimento, data de lançamento, `dia` do uso) fica como `AAAA-MM-DD`. O fuso do usuário fica em `config`.
- **Dinheiro:** inteiro em **centavos** (`valor_centavos`), com sinal: negativo é saída, positivo é entrada. Moeda em `moeda` (padrão `BRL`). Nunca ponto flutuante.
- **Origem:** toda tabela nova nasce com o **carimbo de origem**: `origem` (`usuario`, `agente`, `importacao`, `conexao`; padrão `usuario`), `agente_id` e `execucao_id`. Diz quem criou ou mudou a linha **por último**, e muda quando o usuário mexe nela; `origem = 'agente'` exige `agente_id`. É o que alimenta o histórico do agente e o desfazer. O carimbo é auditoria, não vínculo: **não tem chave estrangeira**.
- **Vínculo de domínio:** quando a linha *pertence* a um agente ou a uma execução (de quem é a execução, com quem é a conversa, quem pediu a aprovação), a coluna é `do_agente_id` ou `da_execucao_id`, para não colidir com o carimbo e não mudar quando o usuário aprova, desfaz ou edita. Vazio em `do_agente_id` de `mensagens` quer dizer que a fala é do usuário.
- **Apagar:** apagar manda para a lixeira do Moductus (`apagado_em`); some de vez depois de 30 dias ou quando você esvazia. Lançamentos importados nunca somem sem você mandar. Só têm lixeira as tabelas de configuração e de cadastro (hoje `provedores`, `agentes`, `regras_permissao`, `conversas`, `mensagens`, `projetos`, `conexoes`); histórico (execuções, aprovações, sessões, notificações) não tem. `apagado_em` segue o formato das datas acima e o banco recusa outro; a limpeza roda na subida do serviço.
- **Chaves estrangeiras:** nenhuma chave aponta para tabela com lixeira, exceto a de filha que também tem lixeira e vai junto com o pai (`mensagens` → `conversas`). Histórico e configuração guardam o id de agente, provedor, projeto ou regra como texto. Assim a lixeira esvazia sem travar e exportar "só configurações" não quebra referências.
- **Agentes de fábrica** (`alba`, `tula`, `faina`, `nuno`, `de_fabrica = 1`) têm id fixo, igual em todo PC, não vão à lixeira, e o banco impede apagar ou desmarcar um deles por gatilho: personalizar é voltar ao padrão, não sumir.
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

Migração `004-sessoes-dev`. Só `projetos` tem lixeira; sessões, uso e cache do GitHub são histórico e guardam o `projeto_id` como texto, sem chave estrangeira.

### `projetos`
Pastas onde rodam sessões de IA, reconhecidas pelo `cwd` dos eventos. Tem lixeira.
`id`, `nome`, `caminho`, `repositorio` (`dono/nome` no GitHub, quando há), `arquivado`.
O `caminho` é único entre os projetos vivos, sem diferenciar maiúsculas (o Windows não diferencia).

### `sessoes_ia`
`id`, `projeto_id`, `ferramenta` (`claude-code`, `codex`, `opencode`, `gemini`, `antigravity`), `id_externo` (session id da ferramenta), `modelo`, `estado` (`trabalhando`, `esperando`, `terminou`, `erro`, `parada`), `iniciada_em`, `ultimo_evento_em`, `encerrada_em`, `contexto_usado_tokens`, `contexto_janela_tokens`, `transcript_caminho`.
`ferramenta` e `id_externo` juntos são únicos: é assim que o evento de um hook acha a sessão.
A migração `007-transcript-lido` acrescenta a leitura incremental do transcript: `transcript_lido_bytes` (até onde o arquivo foi lido; posição num arquivo deste PC, não vai para outro) e `contexto_avisado_em` (quando saiu o aviso de 80% no trecho atual; volta a vazio na compactação). `contexto_janela_tokens` vem da janela que a ferramenta informa ou da tabela por modelo do serviço; modelo fora dela fica sem janela.

### `eventos_sessao`
`id`, `sessao_id` (a única chave estrangeira desta migração, para `sessoes_ia`), `tipo` (nome do hook), `ferramenta_usada`, `entrada_resumo`. A data do evento é o `criado_em`.
Guarda o resumo, não o conteúdo inteiro; o conteúdo continua no transcript da ferramenta.

### `uso_ia`
Gasto e limites, por dia, ferramenta, modelo e projeto. Uma linha por combinação dessas quatro (modelo e projeto vazios contam como valor).
`id`, `dia` (`AAAA-MM-DD`), `ferramenta`, `modelo`, `projeto_id`, `tokens_entrada`, `tokens_saida`, `tokens_cache`, `custo_estimado_microdolares` (vazio quando não há número honesto), `fonte` (`ferramenta`, `estimativa`).

### `uso_ia_mensagens`
Migração `008-uso-respostas-contadas`. As respostas de modelo cujo uso já entrou em `uso_ia`, pela `chave` única (`message.id` + `requestId` do transcript), no PC inteiro: uma sessão que copia o histórico de outra (`--fork-session`) não conta o mesmo uso de novo. Linhas com mais de 90 dias são podadas. Controle deste PC: não vai para outro em nenhuma modalidade.
`id`, `chave`.

### `github_itens`
Cache do que o Nuno acompanha no GitHub. PR e issue dividem a numeração, então `repositorio` e `numero` são únicos.
`id`, `repositorio`, `numero`, `tipo` (`pr`, `issue`), `titulo`, `autor`, `estado`, `meu_papel` (`autor`, `revisor`, `atribuido`), `precisa_de_mim`, `ci_estado`, `atualizado_no_github`, `etag` (sempre vazio: as buscas que o Nuno usa não devolvem ETag; ADR-0022), `url`.
`estado` e `ci_estado` são texto livre no banco; os valores que a interface entende são os enums do contrato (`pacotes/contrato/src/sessoes.ts`).

---

## 6. Agentes, conversas e aprovações (todos)

Migração `003-agentes`. Nas colunas abaixo, `do_agente_id` e `da_execucao_id` são o vínculo de domínio (§1); o carimbo de origem (`origem`, `agente_id`, `execucao_id`) existe em todas e não é repetido aqui. Há chave estrangeira em cinco colunas só: `aprovacoes.da_execucao_id`, `chamadas_ferramenta.da_execucao_id`, `chamadas_ferramenta.aprovacao_id`, `mensagens.da_execucao_id` e `mensagens.conversa_id`. O resto (`provedor_id`, `do_agente_id`, `sessao_id`, `projeto_id`, `regra_criada_id`) é texto sem chave.

### `agentes`
Tem lixeira.
`id`, `nome`, `funcao`, `instrucoes`, `personagem` (JSON objeto: silhueta, traço, tom), `ferramentas` (JSON lista), `provedor_id`, `provedor_reserva_id` (diferente do principal), `gatilhos` (JSON lista; vazia até o agendador), `escopos_memoria` (JSON lista), `teto_diario_centavos` (vazio: o serviço recusa gravar valor até a moeda do teto ser decidida), `estado` (`ativo`, `pausado`, `dormindo`, `desligado`), `dorme_ate` (só com `dormindo`; vazio é "até o provedor voltar"), `motivo_sono` (`limite`, `fora_do_ar`, `credencial`, `ausente`, `teto`; só com `dormindo`; migração `011-agentes-sono`; agente sem modelo não guarda motivo, aparece como `sem_modelo` pela falta de `provedor_id`), `pausado_ate` (só com `pausado`; vazio é "até retomar"; migração `011-agentes-sono`), `de_fabrica`.
Os quatro de fábrica vêm semeados na migração, com os ids `alba`, `tula`, `faina` e `nuno`, sem provedor (o primeiro uso conecta um modelo e o atribui aos quatro).

### `provedores`
Tem lixeira.
`id`, `tipo` (`claude-cli`, `codex-cli`, `gemini-cli`, `opencode-cli`, `anthropic`, `openai`, `openai-compativel`, `gemini`), `nome`, `modelo`, `base_url`, `credencial` (nome no Gerenciador de Credenciais, nunca a chave), `testado_em`.

### `conversas` e `mensagens`
Têm lixeira. Quem apaga a conversa manda as mensagens junto: mensagem viva segura a conversa na limpeza.
`conversas`: `id`, `tipo` (`time`, `agente`), `do_agente_id` (obrigatório quando `tipo = 'agente'`, vazio quando é `time`), `titulo`, `arquivada`.
`mensagens`: `id`, `conversa_id`, `do_agente_id` (**vazio é o usuário**), `conteudo`, `anexos` (JSON lista), `da_execucao_id` (só quando há agente). A data da fala é o `criado_em`.

### `execucoes`
Cada vez que um agente trabalha. Sem lixeira.
`id`, `do_agente_id`, `gatilho` (`mensagem`, `horario`, `intervalo`, `evento`), `provedor_id`, `inicio`, `fim`, `estado` (`rodando`, `ok`, `erro`, `adiada`), `erro`, `falha_do_provedor` (`limite`, `fora_do_ar`, `credencial`, `ausente`; só com `erro`, quando o provedor derrubou a execução; vazio em erro de outra causa; migração `012-execucoes-falha-do-provedor`), `tokens_entrada`, `tokens_saida`, `custo_estimado_microdolares` (vazio em assinatura ou modelo sem preço conhecido; quando há, é estimativa pela tabela de preços do serviço), `cobranca` (`assinatura`, `por_token`; migração `009-execucoes-cobranca`, vazia sem provedor), `resumo`.
`rodando` existe para as chamadas de ferramenta e as falas já apontarem para a execução enquanto ela acontece.

### `chamadas_ferramenta`
Sem lixeira.
`id`, `da_execucao_id` (vazio só quando quem chama vem de fora do Moductus), `ferramenta`, `efeito` (`leitura`, `interno`, `externo`), `entrada` (JSON), `resultado` (JSON), `aprovacao_id`, `desfeita_em`.

### `aprovacoes`
Pedidos do Moductus e das sessões externas. Sem lixeira.
`id`, `da_execucao_id`, `do_agente_id` (os dois vazios quando o pedido vem de uma sessão do terminal), `fonte` (`moductus`, `claude-code`, `codex`…; no desenho era `origem`, nome que o carimbo já usa), `sessao_id`, `descricao`, `acao` (JSON do que será feito), `estado` (`pendente`, `aprovada`, `negada`, `expirada`), `decidida_em` (vazio enquanto `pendente`), `regra_criada_id`.

### `regras_permissao`
"Sempre neste projeto" e as autorizações dadas uma vez. Tem lixeira; quem lê filtra as apagadas e as vencidas.
`id`, `escopo` (`projeto`, `agente`, `conexao`), `projeto_id` (obrigatório no escopo `projeto`), `do_agente_id` (obrigatório no escopo `agente`), `ferramenta`, `padrao` (o que a regra cobre), `decisao` (`permitir`, `negar`), `expira_em`. A data da regra é o `criado_em`.

---

## 7. Sistema

### `config`
Chave e valor (JSON). Tema, dock (lado, forma, modo), atalhos, fuso, idioma, horários de silêncio, início com o Windows.

### `conexoes`
Tem lixeira. Migração `004-sessoes-dev`.
`id`, `tipo` (hoje `github` e `hooks-claude-code`; `google-agenda`, `outlook`, `hooks-opencode`… chegam com as áreas), `conta` (e-mail ou usuário), `escopos` (JSON lista), `credencial` (nome no Gerenciador de Credenciais), `estado`, `ultimo_erro`, `conectada_em`.
`estado` é texto livre no banco; os valores que a interface entende são `ligada`, `desligada` e `erro` (contrato `EstadoLigacao`).
`lida_em` (migração `006-conexoes-lida-em`): a última leitura que deu certo, mesmo sem item nenhum; é a idade do cache que a conexão alimenta (`github_itens`). Situação deste PC, como `estado`, `ultimo_erro` e `conectada_em`: não vai para outro PC.
O detalhe da ligação do Claude Code que a tela de Conexões mostra (`Conexao.ligacao` no contrato: o arquivo, quantos eventos avisam o Moductus, em que porta e a cópia de segurança mais recente) **não é coluna**: o serviço o monta na hora, lendo o `settings.json` e o arquivo `ligacao-claude-code.json` da pasta de dados, e só existe com a conexão ligada.

### `notificacoes_preferencias`
Configuração, sem lixeira: tirar a preferência é voltar ao padrão. Migração `005-notificacoes`. Uma por agente e tipo (índice único, com o vazio contando como valor). O padrão de fábrica não é gravado: sem linha, vale "só o que precisa de mim" no Windows e no dock, e o Nuno vale "tudo" (`preferenciaPadrao` no contrato).
`id`, `do_agente_id` (vazio vale para todos; a do agente vence a geral), `tipo` (`aprovacao`, `lembrete`, `erro`, `aviso`, `rotina`), `nivel` (`tudo`, `so_o_que_precisa`, `nada`), `canal` (`windows`, `dock`, `ambos`).

### `notificacoes`
O que foi avisado, para o histórico e para não repetir. Sem lixeira.
`id`, `do_agente_id` (vazio é aviso do próprio app), `tipo`, `titulo`, `corpo`, `referencia` (o que gerou o aviso, como `aprovacao:<id>`; um aviso novo da mesma referência não repete enquanto o anterior não foi visto), `vista_em`, `canal`. A data do aviso é o `criado_em`.
Aviso que a preferência não deixa passar (nível `nada`, ou um tipo que "só o que precisa de mim" não cobre, como o `aviso` de contexto de 80% do Nuno quando ele está em "só o que precisa de mim") é gravado já visto (`vista_em` = `criado_em`): fica no histórico, sem ponto no dock e sem aviso do Windows. O horário de silêncio e o silêncio em tela cheia e em foco não são tabela: moram em `config` (`silencio`, desligado de fábrica, 22:00 a 07:30) e só calam o aviso do Windows; o ponto no dock e o registro continuam.

### `agendador_disparos`
Controle deste PC, sem lixeira. Migração `010-agendador-disparos`. Até onde o agendador já contou cada gatilho de horário e de intervalo, para o serviço que reinicia não repetir um disparo nem perder o que venceu com ele parado. Uma linha por agente e gatilho.
`id`, `do_agente_id`, `gatilho` (o JSON do gatilho como está na configuração do agente; mudar o gatilho começa uma contagem nova), `referencia` (no horário, a ocorrência que disparou ou quando o gatilho apareceu; no intervalo, de onde conta o próximo), `disparado_em` (vazio se ainda não disparou). A referência é gravada antes de o runtime ser chamado. Não vai para outro PC.

### `onboarding`
`passo`, `estado` (`feito`, `pulado`, `pendente`), `concluido_em`. Inclui as missões do tutorial.

---

## 8. Exportar para outro PC

| Vai em "só configurações" | Vai só em "configurações e dados" | Nunca vai |
|---|---|---|
| `config`, `agentes`, `provedores` (sem credencial), `conexoes` (sem credencial e sem estado), `notificacoes_preferencias`, `regras_permissao` (as que ainda valem), `perfis_importacao`, `regras_categoria`, `categorias`, `listas`, `etiquetas`, `rotinas`, `pastas_autorizadas` (como sugestão, reconfirmada no PC novo) | Todas as demais tabelas de dados, entre elas `execucoes`, `chamadas_ferramenta`, `aprovacoes`, `conversas`, `mensagens`, `projetos`, `sessoes_ia`, `eventos_sessao`, `uso_ia`, `github_itens`, `notificacoes` e `onboarding` | Credenciais, `transcript_caminho` e a posição da leitura dele (`transcript_lido_bytes`), `uso_ia_mensagens`, `agendador_disparos`, caminhos absolutos que não existem no PC novo, `operacoes_arquivo`, o que está na lixeira |

A marcação de cada tabela mora em `servico/src/outro-pc/tabelas.ts`, e um teste reprova tabela nova sem marcação (na dúvida, é dado). O que "só configurações" tira, além das tabelas de dado:

- **Credencial:** a coluna `credencial` (o nome no Gerenciador de Credenciais) não sai de nenhuma tabela; no PC novo a conexão e o provedor são refeitos.
- **Situação deste PC:** `conexoes` vai sem `estado`, `ultimo_erro` e `conectada_em`; chega desligada no PC novo.
- **Regras vencidas:** `regras_permissao` com `expira_em` no passado não saem. As de escopo `projeto` viajam, e a importação descarta as de projeto que não existe no PC novo.
- **Lixeira:** linha com `apagado_em` não sai.

Os agentes saem como estão (a personalização dos de fábrica viaja), com o mesmo id em todo PC.

O arquivo é um `.moductus`: um zip com um manifesto (versão do esquema, PC de origem, data, o que contém), a configuração em `config.json` e um JSON por tabela de configuração (`agentes.json`, `provedores.json`…). Com dados, o zip é cifrado com a senha escolhida. Hoje a exportação "só configurações" já grava essas tabelas; **importá-las** (juntar pelo `id` e pelas impressões de lançamentos e arquivos para não duplicar, depois de rodar as migrações necessárias) ainda não existe.
