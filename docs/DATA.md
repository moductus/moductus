# Moductus — Dados

> O que cada área guarda e como. O produto está em [PRODUCT.md](PRODUCT.md); onde o banco mora e quem acessa, em [ARCHITECTURE.md](ARCHITECTURE.md#5-dados); os agentes, em [AGENTS.md](AGENTS.md).

**Status:** as seções 5 a 7 (agentes, sessões de IA, GitHub, conexões, notificações e agendador) descrevem as migrações 003 a 012, entregues na fase 2, e a seção 2 e as notas da seção 4 descrevem as migrações 013 a 025, entregues na fase 3; os nomes de coluna valem como estão nelas, e o banco está na migração 25. A seção 3 (dinheiro) e o resto da seção 4 (pastas, arquivos, memória) ainda são o desenho da fase 0: cada fase cria as tabelas da sua área por migração, e campos podem mudar na implementação, mas as regras da seção 1 não mudam.

---

## 1. Regras que valem para tudo

- **Um banco SQLite** (`moductus.db`), uma tabela por entidade, nomes em português, `snake_case`.
- **Identificador:** `id` texto em ULID. Ordena por criação, não colide entre PCs e permite **juntar** dados importados de outro PC sem renumerar.
- **Datas:** `criado_em` e `atualizado_em` em todas as tabelas, em ISO 8601 UTC com milissegundos e `Z` (`2026-10-09T14:30:00.000Z`). O momento em que algo nasceu é sempre o `criado_em`: não existe `criada_em`, `recebido_em` nem coluna parecida (a data da mensagem, do evento de sessão e da notificação é o `criado_em`). Data sem hora (vencimento, data de lançamento, `dia` do uso) fica como `AAAA-MM-DD`. O fuso do usuário fica em `config`.
- **Dinheiro:** inteiro em **centavos** (`valor_centavos`), com sinal: negativo é saída, positivo é entrada. Moeda em `moeda` (padrão `BRL`). Nunca ponto flutuante.
- **Origem:** toda tabela nova nasce com o **carimbo de origem**: `origem` (`usuario`, `agente`, `importacao`, `conexao`; padrão `usuario`), `agente_id` e `execucao_id`. Diz quem criou ou mudou a linha **por último**, e muda quando o usuário mexe nela; `origem = 'agente'` exige `agente_id`. É o que alimenta o histórico do agente e o desfazer. O carimbo é auditoria, não vínculo: **não tem chave estrangeira**.
- **Vínculo de domínio:** quando a linha *pertence* a um agente ou a uma execução (de quem é a execução, com quem é a conversa, quem pediu a aprovação), a coluna é `do_agente_id` ou `da_execucao_id`, para não colidir com o carimbo e não mudar quando o usuário aprova, desfaz ou edita. Vazio em `do_agente_id` de `mensagens` quer dizer que a fala é do usuário.
- **Apagar:** apagar manda para a lixeira do Moductus (`apagado_em`); some de vez depois de 30 dias ou quando você esvazia. Lançamentos importados nunca somem sem você mandar. Só têm lixeira as tabelas de configuração e de cadastro (hoje `provedores`, `agentes`, `regras_permissao`, `conversas`, `mensagens`, `projetos`, `conexoes`, `listas`, `tarefas`, `etiquetas`, `lembretes`, `calendarios`, `eventos`, `rotinas` e `notas`); histórico (execuções, aprovações, sessões, notificações, foco) não tem. `apagado_em` segue o formato das datas acima e o banco recusa outro; a limpeza roda na subida do serviço.
- **Chaves estrangeiras:** nenhuma chave aponta para tabela com lixeira, exceto a de filha que também tem lixeira e vai junto com o pai (`mensagens` → `conversas`, `tarefas` → `listas` e `tarefas` → `tarefas` na subtarefa, `lembretes` → `tarefas`, `eventos` → `calendarios`). Histórico e configuração guardam o id de agente, provedor, projeto, regra, tarefa, evento ou nota como texto. Assim a lixeira esvazia sem travar e exportar "só configurações" não quebra referências.
- **Agentes de fábrica** (`alba`, `tula`, `faina`, `nuno`, `de_fabrica = 1`) têm id fixo, igual em todo PC, não vão à lixeira, e o banco impede apagar ou desmarcar um deles por gatilho: personalizar é voltar ao padrão, não sumir.
- **Linhas semeadas:** o que o app precisa ter desde o primeiro dia nasce na migração com id fixo, igual em todo PC, para juntar dados de outro PC sem duplicar: os quatro agentes de fábrica, as listas `entrada`, `trabalho` e `pessoal`, o calendário `local`, as rotinas `briefing` e `fechamento` e a nota `bloco_rapido`.
- **Busca:** texto livre entra num índice FTS5, que ignora acento e caixa. As notas já têm o dele (`notas_fts`, seção 4); memórias e arquivos terão.
- **Segredos:** nenhum. Chaves e tokens ficam no Gerenciador de Credenciais; o banco guarda só o nome da credencial.
- **Exportação:** cada tabela é marcada como *configuração* ou *dado* — é isso que separa "só configurações" de "configurações e dados" no arquivo de levar para outro PC.

---

## 2. Dia: agenda, tarefas, lembretes e foco (Alba)

Migrações `013-tarefas` a `025-rotinas-curta` (fase 3); os nomes de coluna valem como estão nelas. Listas, tarefas, etiquetas, lembretes, calendários, eventos, rotinas e notas têm lixeira; foco, a fila de saída, o espelho no Google, o registro das rotinas e as marcas dos vigias são histórico ou controle deste PC e não têm. Instante (`quando`, `inicio` de evento com hora, `termina_em`) é UTC no formato da seção 1; dia é `AAAA-MM-DD` e hora do dia é `HH:MM`, sempre no fuso de `config` (`dia.fuso`). Recorrência é uma RRULE do iCalendar, no subconjunto que o Moductus expande (diário, semanal, mensal e anual; `INTERVAL`, `BYDAY`, `BYMONTHDAY`, `COUNT`, `UNTIL`; ADR-0034). Regra fora dele, vinda do Google, fica como texto e aparece como "repete (definido no Google)".

### `listas`
`id`, `nome`, `ordem`, `cor`, `arquivada`. Três vêm semeadas, com id fixo igual em todo PC: `entrada` (para onde vai a captura sem lista), `trabalho` e `pessoal`. O serviço não as apaga (o banco não tem gatilho para isso).

### `tarefas`
`id`, `lista_id`, `tarefa_pai_id`, `titulo`, `notas` (texto curto da própria tarefa), `nota_id` (a nota ligada, id sem chave), `prioridade` (0 nenhuma a 3 alta), `vence_em` (dia), `hora` (só existe com `vence_em`), `duracao_estimada_min`, `recorrencia`, `estado` (`aberta`, `feita`, `cancelada`), `concluida_em` (só da que está feita), `ordem`, `evento_id` (o bloco que a Alba encaixou na agenda, sem chave), `fechada_em` e `gerada_por`.
- Subtarefa tem um nível só; gatilhos do banco recusam a neta, por qualquer caminho de escrita.
- `fechada_em` (migração `018`) é o instante em que a tarefa foi concluída ou descartada. O lembrete dela vai à lixeira com o mesmo instante, e reabrir traz de volta o que tem a marca.
- `gerada_por` (018) é a recorrente de onde esta nasceu: fechar uma recorrente gera a próxima uma vez só, e reabrir leva a que ninguém tocou.
- "Atrasada" não é coluna: é aberta com `vence_em` antes de hoje.
- Tarefa aberta com dia e hora vira evento no calendário "Moductus" (ver `agenda_espelho`); tarefa sem hora fica só no Moductus.

### `etiquetas` e `tarefa_etiquetas`
Etiquetas livres (`trabalho`, `casa`, `pr-123`). `etiquetas`: `id`, `nome`, `nome_chave`. A `nome_chave` é o nome normalizado (NFC, sem espaço nas pontas, minúsculas em pt-BR) e é única entre as vivas: `Ônibus` e `ônibus` são a mesma etiqueta. `tarefa_etiquetas` (sem lixeira e sem chave): `id`, `tarefa_id`, `etiqueta_id`, com o par único. A ligação fica enquanto uma das pontas está na lixeira e some, por gatilho, quando uma delas sai de vez.

### `lembretes`
Lembrete é o que **dispara**; pode estar ligado a uma tarefa, a um evento ou a nada ("beber água às 15h").
`id`, `texto`, `quando`, `recorrencia`, `inicio_recorrencia`, `tarefa_id`, `evento_id`, `estado` (`agendado`, `disparado`, `adiado`, `perdido`), `disparado_em`, `adiado_ate` (só com `adiado`), `canal` (`windows`, `dock`, `calendario`).
- `tarefa_id` é chave estrangeira: o lembrete da tarefa vai junto com ela.
- Recorrente é uma linha só: o `quando` anda de ocorrência em ocorrência. `inicio_recorrencia` (migração `019`) é de onde a regra conta, como o `DTSTART`: dele vêm a hora local de toda ocorrência (o pulo do horário de verão vale só no dia do pulo) e o `COUNT`. Vazio vale o `quando`.
- `perdido` é o que o relógio só conferiu mais de 2 minutos depois da hora (PC desligado ou suspenso, serviço parado): aparece como atrasado, num aviso só.
- `canal`: `windows` (padrão) avisa no Windows e mostra no painel; `dock` só mostra no painel Hoje; `calendario` toca como alerta do evento no Google e só avisa no Windows se o evento ainda não chegou lá.

### `calendarios`
Fontes de evento: o local, o "Moductus" criado no Google Agenda e os calendários que você escolheu ler.
`id`, `nome`, `fonte` (`local`, `google`, `outlook`; no desenho era `origem`, nome que o carimbo já usa), `id_externo`, `cor`, `espelho`, `pode_escrever`, `ler`, `sincronizado_em`, `token_sincronizacao`. Tem lixeira.
- O local nasce semeado: `id` `local`, nome "Local", `pode_escrever` 1. Só calendário de fora tem `id_externo`.
- `espelho` marca o "Moductus" (no máximo um vivo por fonte), onde a Alba escreve sem pedir; ele sempre tem `pode_escrever`. Nos outros calendários do Google, `pode_escrever` vem do papel da conta na lista (dono ou editor); o resto é só leitura.
- `ler` (padrão 1) diz se a Alba usa o calendário no briefing e no horário livre.
- `token_sincronizacao` é o `nextSyncToken` da última leitura e `sincronizado_em`, a data dela (ADR-0035): situação deste PC. Calendário que some da conta, ou que é desconectado, vai à lixeira sem os eventos e sem o token.

### `eventos`
`id`, `calendario_id` (chave, em NO ACTION), `titulo`, `descricao`, `inicio`, `fim`, `dia_inteiro`, `local`, `recorrencia`, `id_externo`, `etag_externo`, `alertas`, `excecoes`, `fuso`. Tem lixeira.
- Evento com hora guarda `inicio` e `fim` como instantes UTC. O de dia inteiro guarda dias (`AAAA-MM-DD`), com o `fim` no dia seguinte ao último, como o iCalendar e o Google.
- `alertas` é a lista JSON dos minutos antes de cada aviso. `excecoes` (migração `020`), a lista dos inícios que a regra não gera mais: a ocorrência que você cancelou ou mudou de lugar no Google. `fuso` (020) é o fuso em que a regra do recorrente anda (o `timeZone` do evento no Google); vazio é o fuso do usuário.
- Evento vindo do Google fica em cache aqui, para o briefing e para achar horário livre; a fonte da verdade é o Google. O cache sai de vez (sem lixeira) e guarda de 7 dias atrás em diante; o recorrente fica. Evento recusado por você e os de `workingLocation` não entram.
- `id_externo` é único dentro do calendário.
- Um evento passa do calendário local para o "Moductus" e de volta pelo `calendarioId` de `agenda.definirEvento`, e só entre esses dois: a troca cria ou apaga o evento no Google pela fila e limpa o `id_externo`. Evento de outro calendário não muda de calendário nem de horário por aqui; a mudança é um pedido à Alba, com cartão de aprovação.

### `agenda_saida`
Toda escrita no Google passa por aqui (ADR-0035). Uma linha por item: a nova substitui a pendente, e sai quando o envio dá certo. Sem lixeira e sem chave, porque tarefa, lembrete e evento têm lixeira e apagar no Google é justamente o que fica na fila.
`id`, `item_tipo` (`tarefa`, `lembrete`, `evento`), `item_id`, `operacao` (`criar`, `mudar`, `apagar`), `tentativas`, `proxima_tentativa_em`, `ultimo_erro`. Controle deste PC.

### `agenda_espelho`
O que já chegou ao calendário "Moductus" (migração `022`): a `agenda_saida` diz o que falta mandar, esta diz o que foi. Sem lixeira e sem chave. Controle deste PC.
`id`, `item_tipo`, `item_id` (o par é único), `id_externo` (o id do evento no Google, escolhido aqui antes do primeiro envio: repetir o envio depois de uma resposta perdida dá 409, nunca dois eventos), `etag_externo` (vazio é o evento que ainda não chegou), `enviado` (JSON do que foi mandado por último: título, horário, alertas, regra, para saber se o item mudou desde então e para não tomar o eco da própria escrita por mudança sua), `desligado` (você apagou o evento no Google: o espelho daquele item para e a tarefa fica) e `recusado` (o Google recusou o `enviado` de vez: não vai de novo até o item mudar).
O evento leva `extendedProperties.private.moductus_id`, e é por ele que um PC novo acha, no Google, o que outro PC pôs lá. O evento da agenda criado diretamente no "Moductus" é evento do calendário `espelho`, e ele não viaja para outro PC (seção 8).

### `sessoes_foco`
Uma linha por etapa do ciclo. Histórico, sem lixeira.
`id`, `tarefa_id` (id sem chave), `tipo` (`foco`, `pausa`, `pausa_longa`), `inicio`, `fim`, `duracao_planejada_min`, `duracao_real_min`, `interrompida`, `termina_em`, `pausada_em`, `ciclo`, `na_ausencia`.
- `fim` vazio é a etapa em andamento, e só pode haver uma (índice único). A duração real só existe depois de terminar.
- `termina_em` (migração `021`) é o fim planejado, absoluto: o "+5 min" o estica e o tempo parado o empurra ao retomar. É dele que o relógio do dia arma o fim e que a interface conta o tempo sozinha. `pausada_em` é desde quando a etapa está parada.
- `ciclo` é o foco da rodada em que a etapa está ("Ciclo 2 de 4"); a pausa leva o do foco que a antecede, e 0 é a pausa livre.
- `interrompida` é a que acabou antes da hora. `na_ausencia` (021) é a que venceu enquanto o relógio não olhava (serviço parado, PC suspenso) e fechou interrompida por isso: ela encerra a rodada, ao contrário do "Terminar ciclo".
- Enquanto o foco corre, o relógio renova o `atualizado_em` da etapa a cada conferência: é o último momento em que se sabe que o PC estava acordado.

### `rotinas` e `rotinas_registro`
Briefing e fechamento do dia (ADR-0039). Vêm semeadas com id fixo: `briefing` (sem hora) e `fechamento` (18:00).
`rotinas`, com lixeira e configuração: `id`, `tipo` (`briefing`, `fechamento`), `hora` (`HH:MM`; o briefing sem hora sai na primeira atividade do dia; o fechamento sempre tem), `dias_semana` (lista JSON de 1, segunda, a 7, domingo), `ativa`, `curta` (o briefing mais curto, escolhido depois de 3 ignorados seguidos; só o briefing; migração `025`).
Os `dias_semana` são os **dias de trabalho**, um conjunto só: Configurações › O dia grava nas duas rotinas, e a agenda não procura expediente nem horário livre fora deles.
`rotinas_registro`, histórico sem lixeira e deste PC: `id`, `rotina_id`, `dia`, `conteudo` (JSON: a abertura, as linhas e as abertas do que foi mostrado), `acao` (o que você escolheu, ou `ignorado` quando fechou sozinha), `acao_em`, `da_execucao_id` (a execução da Alba que redigiu a abertura; vazio quando saiu a frase de molde). Uma por rotina e dia, e a hora em que apareceu é o `criado_em`. Alimenta o "Ontem" e a regra dos 3 dias ignorados.

### `vigias_marcas`
Até onde cada vigia já olhou, para o serviço que reinicia não repetir nem perder (migração `024`). Sem lixeira, deste PC. `id`, `nome` (único), `valor` (texto). Hoje: `alba.dia` (o último dia que a virada viu), `alba.fechamento` (o dia em que o fechamento saiu) e `alba.ignorados` (a pergunta dos briefings ignorados, o dia dela e a resposta).

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

As notas existem desde a fase 3 (migração `015-notas`); `pastas_autorizadas`, `arquivos_entrada`, `operacoes_arquivo` e `memorias` seguem como desenho da fase 5.

### `notas`
Tem lixeira.
`id`, `titulo`, `conteudo` (Markdown cru, como foi escrito; ADR-0036), `fixada`, `pasta` (texto livre, opcional). Título e conteúdo nascem vazios (`''`), nunca nulos.
- **Bloco rápido:** o bloco do v0 é a nota fixa do topo, semeada com `id` `bloco_rapido` e título "Bloco rápido". Ela não vai à lixeira nem é apagada de vez, e o id dela não muda (restrição e gatilhos do banco, por qualquer caminho de escrita): esvaziar é apagar o texto, não a nota.
- **Versão:** quem salva manda o `atualizado_em` que conhece, e o serviço recusa gravar sobre uma versão mais nova e devolve as duas ("esta nota mudou em outra janela"). A versão só muda quando muda o título ou o conteúdo.
- **Busca:** a tabela virtual `notas_fts` (FTS5, `unicode61 remove_diacritics 2`, então "amanha" acha "amanhã") guarda título, conteúdo e o `id` da nota, só das vivas. Gatilhos a mantêm; mandar à lixeira tira do índice e restaurar põe de volta. É índice, não dado: não entra na marcação nem no arquivo de outro PC.
- A tarefa criada a partir de uma nota guarda o id dela em `tarefas.nota_id`, sem chave.

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
A migração `026-sessoes-ponto-de-entrada` acrescenta `ponto_de_entrada`: o `entrypoint` do transcript como veio (`cli` no terminal, `claude-desktop` no app Desktop), que a área traduz em "onde roda"; valor que ela não conhece fica sem rótulo.

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
`id`, `nome`, `funcao`, `instrucoes`, `personagem` (JSON objeto: silhueta, traço, tom), `ferramentas` (JSON lista), `provedor_id`, `provedor_reserva_id` (diferente do principal), `gatilhos` (JSON lista; vazia até o agendador), `escopos_memoria` (JSON lista), `teto_diario_centavos` (o teto do dia, na moeda de `teto_moeda`; vazio é sem teto), `teto_moeda` (código ISO 4217, padrão `BRL`; migração `017-agentes-teto-moeda`, ADR-0040), `teto_liberado_centavos` e `teto_liberado_ate` (o "Liberar" do cartão de teto: quanto foi solto a mais hoje, por cima do teto, e até quando vale, a meia-noite; só existem juntos e só com teto; situação deste PC e deste dia), `estado` (`ativo`, `pausado`, `dormindo`, `desligado`), `dorme_ate` (só com `dormindo`; vazio é "até o provedor voltar"), `motivo_sono` (`limite`, `fora_do_ar`, `credencial`, `ausente`, `teto`; só com `dormindo`; migração `011-agentes-sono`; agente sem modelo não guarda motivo, aparece como `sem_modelo` pela falta de `provedor_id`), `pausado_ate` (só com `pausado`; vazio é "até retomar"; migração `011-agentes-sono`), `de_fabrica`.
Os quatro de fábrica vêm semeados na migração, com os ids `alba`, `tula`, `faina` e `nuno`, sem provedor (o primeiro uso conecta um modelo e o atribui aos quatro).

### `provedores`
Tem lixeira.
`id`, `tipo` (`claude-cli`, `codex-cli`, `gemini-cli`, `opencode-cli`, `anthropic`, `openai`, `openai-compativel`, `gemini`), `nome`, `modelo`, `base_url`, `credencial` (nome no Gerenciador de Credenciais, nunca a chave), `testado_em`, `caminho` (onde a detecção achou o CLI neste PC, inclusive o `.cmd` do npm; só em provedor de CLI; migração `016-provedores-caminho`).

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
Chave e valor (JSON). Tema, dock (lado, forma, modo), atalhos (sistema, dock, captura e foco), início com o Windows, silêncio (horário, tela cheia e foco), `dia` (fuso, expediente e ciclos do foco; o fuso padrão é o do Windows, ou `America/Sao_Paulo` se ele não informar um conhecido), `cambio` (as cotações do teto de gasto: quanto vale US$ 1 em cada moeda, com a data; nenhuma de fábrica, ADR-0040) e `inicio` (a ordem dos blocos do Início e os que estão escondidos).

### `conexoes`
Tem lixeira. Migração `004-sessoes-dev`.
`id`, `tipo` (hoje `github`, `hooks-claude-code` e `google-agenda`; `outlook` e `hooks-opencode` chegam com as áreas), `conta` (e-mail ou usuário), `escopos` (JSON lista), `credencial` (nome no Gerenciador de Credenciais), `estado`, `ultimo_erro`, `conectada_em`.
`estado` é texto livre no banco; os valores que a interface entende são `ligada`, `desligada` e `erro` (contrato `EstadoLigacao`).
`lida_em` (migração `006-conexoes-lida-em`): a última leitura que deu certo, mesmo sem item nenhum; é a idade do cache que a conexão alimenta (`github_itens`). Situação deste PC, como `estado`, `ultimo_erro` e `conectada_em`: não vai para outro PC.
O detalhe da ligação do Claude Code que a tela de Conexões mostra (`Conexao.ligacao` no contrato: o arquivo, quantos eventos avisam o Moductus, em que porta e a cópia de segurança mais recente) **não é coluna**: o serviço o monta na hora, lendo o `settings.json` e o arquivo `ligacao-claude-code.json` da pasta de dados, e só existe com a conexão ligada.
A conexão `google-agenda` (ADR-0031) guarda em `conta` o e-mail do calendário principal e em `escopos` os que o Google concedeu: os três de ao conectar e, depois do consentimento para escrever nos outros calendários, o quarto (`calendar.events`). No Gerenciador de Credenciais, `Moductus/google-agenda` é um JSON com o refresh token, os escopos e a conta; o token de acesso fica só na memória. O cliente próprio (client ID e secret do usuário) é outra credencial, `Moductus/google-agenda-cliente`, e só se troca com a conexão desligada.

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
| `config`, `agentes`, `provedores` (sem credencial), `conexoes` (sem credencial e sem estado), `notificacoes_preferencias`, `regras_permissao` (as que ainda valem), `perfis_importacao`, `regras_categoria`, `categorias`, `listas`, `etiquetas`, `rotinas`, `calendarios`, `pastas_autorizadas` (como sugestão, reconfirmada no PC novo) | Todas as demais tabelas de dados, entre elas `execucoes`, `chamadas_ferramenta`, `aprovacoes`, `conversas`, `mensagens`, `projetos`, `sessoes_ia`, `eventos_sessao`, `uso_ia`, `github_itens`, `notificacoes`, `onboarding`, `tarefas`, `tarefa_etiquetas`, `lembretes`, `eventos`, `sessoes_foco` e `notas` | Credenciais, `transcript_caminho` e a posição da leitura dele (`transcript_lido_bytes`), `uso_ia_mensagens`, `agendador_disparos`, `agenda_saida`, `agenda_espelho`, `rotinas_registro`, `vigias_marcas`, caminhos absolutos que não existem no PC novo, `operacoes_arquivo`, o que está na lixeira |

A marcação de cada tabela mora em `servico/src/outro-pc/tabelas.ts`, e um teste reprova tabela nova sem marcação (na dúvida, é dado). O que "só configurações" tira, além das tabelas de dado:

- **Credencial:** a coluna `credencial` (o nome no Gerenciador de Credenciais) não sai de nenhuma tabela; no PC novo a conexão e o provedor são refeitos.
- **Situação deste PC:** `conexoes` vai sem `estado`, `ultimo_erro`, `conectada_em`, `lida_em` e `escopos`; chega desligada no PC novo, que pede os escopos dele ao conectar. `provedores` vai sem `caminho`: no PC novo, a detecção acha o CLI de lá. `calendarios` vai sem `sincronizado_em` e `token_sincronizacao`: o PC novo começa com o cache vazio e lê tudo de novo. `agentes` vai sem `teto_liberado_centavos` e `teto_liberado_ate`: o "Liberar" vale só para o gasto de hoje deste PC.
- **Eventos:** só viajam os do calendário local. O evento de calendário de fora é cache deste PC, e a fonte da verdade é o Google, que o PC novo lê de novo; isso vale também para os eventos da agenda criados no calendário "Moductus", que não viajam para outro PC. A etapa de foco em andamento fica de fora; só a terminada é histórico.
- **Regras vencidas:** `regras_permissao` com `expira_em` no passado não saem. As de escopo `projeto` viajam, e a importação descarta as de projeto que não existe no PC novo.
- **Lixeira:** linha com `apagado_em` não sai.

Os agentes saem como estão (a personalização dos de fábrica viaja), com o mesmo id em todo PC.

O arquivo é um `.moductus`: um zip com um manifesto (versão do esquema, PC de origem, data, o que contém), a configuração em `config.json` e um JSON por tabela de configuração (`agentes.json`, `provedores.json`…). Com dados, o zip é cifrado com a senha escolhida. Hoje a exportação "só configurações" já grava essas tabelas; **importá-las** (juntar pelo `id` e pelas impressões de lançamentos e arquivos para não duplicar, depois de rodar as migrações necessárias) ainda não existe.
