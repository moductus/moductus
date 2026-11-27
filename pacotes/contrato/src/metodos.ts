import { z } from "zod";
import {
  Agente,
  Capacidade,
  ChamadaFerramenta,
  Execucao,
  ExecucaoDetalhada,
  MudancaAgente,
  PaginaExecucoes,
  PedidoAgente,
  PedidoDesfazer,
  PedidoExecucao,
  PedidoExecucoes,
  PedidoLigarAgente,
  PedidoPausar,
  PedidoRetomar,
} from "./agentes.ts";
import {
  Agenda,
  Calendario,
  EventoAgenda,
  MudancaAgenda,
  MudancaCalendario,
  MudancaEvento,
  NovoEvento,
  PedidoAgenda,
  PedidoAplicarSugestao,
  PedidoEvento,
  SugestaoAplicada,
} from "./agenda.ts";
import { Aprovacao, PedidoDecidir, PedidoRegra, RegraPermissao } from "./aprovacoes.ts";
import { ContagensAreas } from "./areas.ts";
import { AutorizacaoArquivo, PedidoAutorizarArquivo } from "./arquivos.ts";
import { CotacaoBuscada, PedidoBuscarCotacao } from "./cambio.ts";
import { metodo } from "./canal.ts";
import {
  LancamentoCaptura,
  PedidoDesfazerCaptura,
  PedidoEntender,
  PedidoLancar,
  PreviaCaptura,
} from "./captura.ts";
import { Apagados, PedidoPagina } from "./comum.ts";
import { EstadoConfig, MudancaConfig, Privacidade } from "./config.ts";
import {
  Conversa,
  FalaParcial,
  Mensagem,
  PaginaMensagens,
  PedidoAbrirConversa,
  PedidoApagarConversa,
  PedidoArquivarConversa,
  PedidoEnviar,
  PedidoMensagens,
  PedidoPararConversa,
  ResultadoEnviar,
} from "./conversas.ts";
import {
  Divida,
  MudancaDivida,
  NovaDivida,
  PagamentoDivida,
  PedidoDivida,
  PedidoDividas,
  PedidoPagamentoDivida,
  PedidoQuitar,
  PedidoSimulacao,
  Simulacao,
} from "./dividas.ts";
import {
  Categoria,
  ComprovanteLido,
  Conta,
  DefinicaoOrcamento,
  DetalheLancamento,
  Fatura,
  GastoCom,
  Lancamento,
  LancamentoEditado,
  MudancaCategoria,
  MudancaConta,
  MudancaFinancas,
  MudancaLancamento,
  MudancaRecorrente,
  MudancaRegraCategoria,
  NovaCategoria,
  NovaConta,
  NovaRecorrente,
  NovaRegraCategoria,
  NovaTransferencia,
  NovoLancamento,
  Orcamento,
  OrcamentoMes,
  PaginaLancamentos,
  PedidoApagarCategoria,
  PedidoConta,
  PedidoContas,
  PedidoDesfazerRemanejar,
  PedidoFatura,
  PedidoFaturas,
  PedidoGastoCom,
  PedidoLancamento,
  PedidoLerComprovante,
  PedidoLancamentos,
  PedidoMes,
  PedidoOrcamento,
  PedidoPagarFatura,
  PedidoRecorrente,
  PedidoRegraCategoria,
  PedidoRemanejar,
  PedidoSugestaoRecorrente,
  PedidoVencimentos,
  Recorrente,
  RegraCategoria,
  RelatorioMes,
  Remanejamento,
  ResultadoApagarCategoria,
  ResumoMes,
  SugestaoRecorrente,
  Vencimentos,
} from "./financas.ts";
import {
  EstadoFoco,
  HistoricoFoco,
  PedidoEstenderFoco,
  PedidoHistoricoFoco,
  PedidoIniciarFoco,
} from "./foco.ts";
import {
  Importacao,
  ImportacaoConcluida,
  LeituraExtrato,
  PedidoConfirmarImportacao,
  PedidoImportacao,
  PedidoImportacoes,
  PedidoLerExtrato,
  PedidoPerfilImportacao,
  PedidoPreviaImportacao,
  PerfilImportacao,
  PreviaImportacao,
  ProgressoImportacao,
} from "./importacao.ts";
import {
  Lembrete,
  LembretesDeHoje,
  MudancaLembrete,
  MudancaLembretes,
  NovoLembrete,
  PedidoAdiarLembretes,
  PedidoConcluirLembretes,
  PedidoLembretes,
  PedidoListarLembretes,
} from "./lembretes.ts";
import {
  MudancaNota,
  MudancaNotas,
  Nota,
  NovaNota,
  PedidoBuscarNotas,
  PedidoNota,
  PedidoNotas,
  PedidoSalvarNota,
  ResultadoBuscaNota,
  ResultadoSalvarNota,
  ResumoNota,
} from "./notas.ts";
import {
  EstadoNotificacoes,
  MudancaPreferencia,
  Notificacao,
  PaginaNotificacoes,
  PedidoMarcarVistas,
  PedidoRestaurarPreferencia,
} from "./notificacoes.ts";
import { PedidoExportar, PedidoImportar, PreviaImportar, ResultadoExportar } from "./outro-pc.ts";
import {
  MovimentoPlano,
  MudancaPlano,
  NovoPlano,
  PedidoMovimentarPlano,
  PedidoPlano,
  Plano,
  PlanoMovimentado,
} from "./planos.ts";
import { EstadoPrimeiroUso, PedidoConcluirPrimeiroUso, PedidoMarcarTutorial } from "./primeiro-uso.ts";
import {
  MudancaProvedor,
  NovoProvedor,
  PedidoModelosProvedor,
  PedidoProvedor,
  PedidoTesteProvedor,
  Provedor,
  ProvedorDetectado,
  ResultadoModelosProvedor,
  ResultadoTesteProvedor,
} from "./provedores.ts";
import {
  ApresentacaoRotina,
  MudancaRotina,
  PedidoAgirRotina,
  PedidoResponderPergunta,
  Rotina,
  RotinasDeHoje,
} from "./rotinas.ts";
import {
  Conexao,
  EventoSessao,
  ListaSessoes,
  MudancaSessao,
  PedidoConexao,
  PedidoEventosSessao,
  PedidoUso,
  PreviaConexao,
  SituacaoGithub,
  UsoIa,
} from "./sessoes.ts";
import {
  ConclusaoTarefa,
  Etiqueta,
  Lista,
  MudancaLista,
  MudancaTarefa,
  MudancaTarefas,
  NovaLista,
  NovaTarefa,
  PedidoAdiarTarefas,
  PedidoLista,
  PedidoMoverTarefa,
  PedidoOrdenar,
  PedidoTarefa,
  PedidoTarefas,
  Tarefa,
} from "./tarefas.ts";

/** Todos os métodos que o serviço atende, com entrada e saída. */
export const METODOS = {
  "sistema.ping": metodo(z.undefined(), z.object({ protocolo: z.number().int(), pid: z.number().int() })),
  "config.obter": metodo(z.undefined(), EstadoConfig),
  "config.definir": metodo(MudancaConfig, EstadoConfig),
  "config.exportar": metodo(PedidoExportar, ResultadoExportar),
  "config.previaImportar": metodo(PedidoImportar, PreviaImportar),
  "config.importar": metodo(PedidoImportar, EstadoConfig),
  /** "Buscar cotação" (ADR-0040): consulta a fonte e devolve sem gravar; grava o que for confirmado. */
  "cambio.buscar": metodo(PedidoBuscarCotacao, CotacaoBuscada),
  "primeiroUso.obter": metodo(z.undefined(), EstadoPrimeiroUso),
  "primeiroUso.concluir": metodo(PedidoConcluirPrimeiroUso, EstadoPrimeiroUso),
  "primeiroUso.marcar": metodo(PedidoMarcarTutorial, EstadoPrimeiroUso),

  "agentes.listar": metodo(z.undefined(), z.array(Agente)),
  "agentes.obter": metodo(PedidoAgente, Agente),
  "agentes.definir": metodo(MudancaAgente, Agente),
  "agentes.restaurarPadrao": metodo(PedidoAgente, Agente),
  "agentes.ligar": metodo(PedidoLigarAgente, Agente),
  "agentes.pausar": metodo(PedidoPausar, z.array(Agente)),
  "agentes.retomar": metodo(PedidoRetomar, z.array(Agente)),
  /** "Tentar agora": só quem dorme por falha do provedor; limite de uso e teto recusam com o motivo. */
  "agentes.acordar": metodo(PedidoAgente, Agente),
  /** "Liberar" no teto de hoje (ADR-0040): só quem dorme pelo teto; solta mais até a meia-noite. */
  "agentes.liberarTeto": metodo(PedidoAgente, Agente),
  "agentes.capacidades": metodo(PedidoAgente, z.array(Capacidade)),

  "execucoes.listar": metodo(PedidoExecucoes, PaginaExecucoes),
  "execucoes.obter": metodo(PedidoExecucao, ExecucaoDetalhada),
  "execucoes.desfazer": metodo(PedidoDesfazer, ChamadaFerramenta),

  "provedores.listar": metodo(z.undefined(), z.array(Provedor)),
  "provedores.detectar": metodo(z.undefined(), z.array(ProvedorDetectado)),
  "provedores.criar": metodo(NovoProvedor, Provedor),
  "provedores.definir": metodo(MudancaProvedor, Provedor),
  "provedores.remover": metodo(PedidoProvedor, z.array(Provedor)),
  "provedores.testar": metodo(PedidoTesteProvedor, ResultadoTesteProvedor),
  /** "Testar" no formulário: os modelos do endereço (`GET /models`), sem chamar modelo nenhum. */
  "provedores.modelos": metodo(PedidoModelosProvedor, ResultadoModelosProvedor),

  "conversas.listar": metodo(z.undefined(), z.array(Conversa)),
  "conversas.abrir": metodo(PedidoAbrirConversa, Conversa),
  "conversas.mensagens": metodo(PedidoMensagens, PaginaMensagens),
  "conversas.enviar": metodo(PedidoEnviar, ResultadoEnviar),
  "conversas.arquivar": metodo(PedidoArquivarConversa, Conversa),
  "conversas.apagar": metodo(PedidoApagarConversa, z.array(Conversa)),
  "conversas.parar": metodo(PedidoPararConversa, z.number().int().nonnegative()),

  "aprovacoes.pendentes": metodo(z.undefined(), z.array(Aprovacao)),
  "aprovacoes.decidir": metodo(PedidoDecidir, Aprovacao),
  "regras.listar": metodo(z.undefined(), z.array(RegraPermissao)),
  "regras.remover": metodo(PedidoRegra, z.array(RegraPermissao)),

  "sessoes.listar": metodo(z.undefined(), ListaSessoes),
  "sessoes.eventos": metodo(PedidoEventosSessao, z.array(EventoSessao)),
  "sessoes.uso": metodo(PedidoUso, z.array(UsoIa)),

  "github.obter": metodo(z.undefined(), SituacaoGithub),
  "github.atualizar": metodo(z.undefined(), SituacaoGithub),

  "conexoes.listar": metodo(z.undefined(), z.array(Conexao)),
  "conexoes.previa": metodo(PedidoConexao, PreviaConexao),
  "conexoes.ligar": metodo(PedidoConexao, Conexao),
  "conexoes.desligar": metodo(PedidoConexao, Conexao),

  "notificacoes.obter": metodo(z.undefined(), EstadoNotificacoes),
  "notificacoes.definir": metodo(MudancaPreferencia, EstadoNotificacoes),
  "notificacoes.restaurar": metodo(PedidoRestaurarPreferencia, EstadoNotificacoes),
  "notificacoes.listar": metodo(PedidoPagina, PaginaNotificacoes),
  "notificacoes.naoVistas": metodo(z.undefined(), z.array(Notificacao)),
  "notificacoes.marcarVistas": metodo(PedidoMarcarVistas, z.array(Notificacao)),

  // O dia (fase 3): a regra de cada um mora na área do serviço (`servico/src/areas`).
  "listas.listar": metodo(z.undefined(), z.array(Lista)),
  "listas.criar": metodo(NovaLista, Lista),
  "listas.definir": metodo(MudancaLista, Lista),
  "listas.ordenar": metodo(PedidoOrdenar, z.array(Lista)),
  /** Manda à lixeira; as tarefas vão junto. As três padrão não saem. */
  "listas.apagar": metodo(PedidoLista, z.array(Lista)),

  "tarefas.listar": metodo(PedidoTarefas, z.array(Tarefa)),
  "tarefas.obter": metodo(PedidoTarefa, Tarefa),
  "tarefas.criar": metodo(NovaTarefa, Tarefa),
  "tarefas.definir": metodo(MudancaTarefa, Tarefa),
  "tarefas.concluir": metodo(PedidoTarefa, ConclusaoTarefa),
  "tarefas.reabrir": metodo(PedidoTarefa, Tarefa),
  /** "Descartar" do fechamento: fica como cancelada, fora das abertas. */
  "tarefas.cancelar": metodo(PedidoTarefa, Tarefa),
  "tarefas.adiar": metodo(PedidoAdiarTarefas, z.array(Tarefa)),
  "tarefas.mover": metodo(PedidoMoverTarefa, Tarefa),
  "tarefas.ordenar": metodo(PedidoOrdenar, z.array(Tarefa)),
  /** Manda à lixeira com as subtarefas e o lembrete ligado; volta o que foi. */
  "tarefas.apagar": metodo(PedidoTarefa, Apagados),
  "tarefas.etiquetas": metodo(z.undefined(), z.array(Etiqueta)),

  "lembretes.listar": metodo(PedidoListarLembretes, z.array(Lembrete)),
  "lembretes.hoje": metodo(z.undefined(), LembretesDeHoje),
  "lembretes.criar": metodo(NovoLembrete, Lembrete),
  "lembretes.definir": metodo(MudancaLembrete, Lembrete),
  "lembretes.adiar": metodo(PedidoAdiarLembretes, z.array(Lembrete)),
  /** "Feito": o recorrente volta com o próximo horário; o de uma vez sai. */
  "lembretes.concluir": metodo(PedidoConcluirLembretes, MudancaLembretes),
  "lembretes.cancelar": metodo(PedidoLembretes, Apagados),

  "agenda.calendarios": metodo(z.undefined(), z.array(Calendario)),
  "agenda.definirCalendario": metodo(MudancaCalendario, Calendario),
  /** Os dias pedidos: as ocorrências e os blocos livres. */
  "agenda.consultar": metodo(PedidoAgenda, Agenda),
  "agenda.obterEvento": metodo(PedidoEvento, EventoAgenda),
  "agenda.criarEvento": metodo(NovoEvento, EventoAgenda),
  "agenda.definirEvento": metodo(MudancaEvento, EventoAgenda),
  "agenda.apagarEvento": metodo(PedidoEvento, Apagados),
  /** Aplicar o encaixe da Alba: só com o clique, `interno`, com desfazer de 24 h. */
  "agenda.aplicarSugestao": metodo(PedidoAplicarSugestao, SugestaoAplicada),

  "foco.obter": metodo(z.undefined(), EstadoFoco),
  "foco.iniciar": metodo(PedidoIniciarFoco, EstadoFoco),
  /** O atalho do foco (Ctrl+Alt+P): inicia se está parado, pausa se está rodando, retoma se pausado. */
  "foco.alternar": metodo(z.undefined(), EstadoFoco),
  "foco.pausar": metodo(z.undefined(), EstadoFoco),
  "foco.retomar": metodo(z.undefined(), EstadoFoco),
  "foco.estender": metodo(PedidoEstenderFoco, EstadoFoco),
  /**
   * "Terminar ciclo": fecha a etapa agora (antes da hora, fica interrompida) sem começar outra; no
   * foco, a pausa fica proposta em `proxima`, e na pausa a rodada se encerra.
   */
  "foco.terminar": metodo(z.undefined(), EstadoFoco),
  "foco.pularPausa": metodo(z.undefined(), EstadoFoco),
  "foco.historico": metodo(PedidoHistoricoFoco, HistoricoFoco),

  "notas.listar": metodo(PedidoNotas, z.array(ResumoNota)),
  "notas.obter": metodo(PedidoNota, Nota),
  "notas.criar": metodo(NovaNota, Nota),
  "notas.salvar": metodo(PedidoSalvarNota, ResultadoSalvarNota),
  "notas.definir": metodo(MudancaNota, Nota),
  /** Manda à lixeira; o bloco rápido não vai. */
  "notas.apagar": metodo(PedidoNota, Apagados),
  "notas.buscar": metodo(PedidoBuscarNotas, z.array(ResultadoBuscaNota)),

  "rotinas.listar": metodo(z.undefined(), z.array(Rotina)),
  "rotinas.definir": metodo(MudancaRotina, Rotina),
  "rotinas.hoje": metodo(z.undefined(), RotinasDeHoje),
  "rotinas.agir": metodo(PedidoAgirRotina, ApresentacaoRotina),
  "rotinas.responder": metodo(PedidoResponderPergunta, Rotina),

  "captura.entender": metodo(PedidoEntender, PreviaCaptura),
  "captura.lancar": metodo(PedidoLancar, LancamentoCaptura),
  "captura.desfazer": metodo(PedidoDesfazerCaptura, LancamentoCaptura),

  "areas.contagens": metodo(z.undefined(), ContagensAreas),

  // O dinheiro (fase 4): a regra de cada um mora em `servico/src/areas/financas`.
  "financas.contas": metodo(PedidoContas, z.array(Conta)),
  "financas.obterConta": metodo(PedidoConta, Conta),
  "financas.criarConta": metodo(NovaConta, Conta),
  "financas.definirConta": metodo(MudancaConta, Conta),
  /** Manda à lixeira; conta com lançamento só arquiva (`definirConta` com `ativa: false`). */
  "financas.apagarConta": metodo(PedidoConta, Apagados),
  "financas.faturas": metodo(PedidoFaturas, z.array(Fatura)),
  /** Registra o pagamento que você fez no banco: transferência da conta de pagamento, fatura paga. */
  "financas.pagarFatura": metodo(PedidoPagarFatura, Fatura),
  "financas.desfazerPagamento": metodo(PedidoFatura, Fatura),

  "financas.lancamentos": metodo(PedidoLancamentos, PaginaLancamentos),
  "financas.obterLancamento": metodo(PedidoLancamento, DetalheLancamento),
  /** A parcelada volta com as N parcelas, uma por fatura. */
  "financas.lancar": metodo(NovoLancamento, z.array(Lancamento).min(1)),
  "financas.transferir": metodo(NovaTransferencia, z.array(Lancamento).length(2)),
  "financas.definirLancamento": metodo(MudancaLancamento, LancamentoEditado),
  /** Manda à lixeira; o outro lado da transferência vai junto. */
  "financas.apagarLancamento": metodo(PedidoLancamento, Apagados),
  "financas.restaurarLancamento": metodo(PedidoLancamento, z.array(Lancamento).min(1)),

  "financas.categorias": metodo(z.undefined(), z.array(Categoria)),
  "financas.criarCategoria": metodo(NovaCategoria, Categoria),
  "financas.definirCategoria": metodo(MudancaCategoria, Categoria),
  "financas.apagarCategoria": metodo(PedidoApagarCategoria, ResultadoApagarCategoria),
  "financas.regras": metodo(z.undefined(), z.array(RegraCategoria)),
  "financas.criarRegra": metodo(NovaRegraCategoria, RegraCategoria),
  "financas.definirRegra": metodo(MudancaRegraCategoria, RegraCategoria),
  "financas.apagarRegra": metodo(PedidoRegraCategoria, Apagados),

  "financas.orcamento": metodo(PedidoMes, OrcamentoMes),
  "financas.definirOrcamento": metodo(DefinicaoOrcamento, Orcamento),
  /** Tira o limite: a categoria volta a não ter orçamento (no mês, ou em todo mês). */
  "financas.removerOrcamento": metodo(PedidoOrcamento, Apagados),
  "financas.remanejar": metodo(PedidoRemanejar, Remanejamento),
  "financas.desfazerRemanejar": metodo(PedidoDesfazerRemanejar, OrcamentoMes),

  "financas.recorrentes": metodo(z.undefined(), z.array(Recorrente)),
  "financas.criarRecorrente": metodo(NovaRecorrente, Recorrente),
  "financas.definirRecorrente": metodo(MudancaRecorrente, Recorrente),
  "financas.apagarRecorrente": metodo(PedidoRecorrente, Apagados),
  "financas.sugestoesRecorrentes": metodo(z.undefined(), z.array(SugestaoRecorrente)),
  "financas.aceitarRecorrente": metodo(PedidoSugestaoRecorrente, Recorrente),
  /** Recusada não volta; devolve as que sobraram. */
  "financas.recusarRecorrente": metodo(PedidoSugestaoRecorrente, z.array(SugestaoRecorrente)),

  "financas.resumo": metodo(PedidoMes, ResumoMes),
  "financas.relatorio": metodo(PedidoMes, RelatorioMes),
  "financas.gastoCom": metodo(PedidoGastoCom, GastoCom),
  "financas.vencimentos": metodo(PedidoVencimentos, Vencimentos),
  /** Lê a imagem no próprio PC e devolve a prévia; nada é lançado daqui (ADR-0043). */
  "financas.lerComprovante": metodo(PedidoLerComprovante, ComprovanteLido),

  "dividas.listar": metodo(PedidoDividas, z.array(Divida)),
  "dividas.obter": metodo(PedidoDivida, Divida),
  "dividas.criar": metodo(NovaDivida, Divida),
  "dividas.definir": metodo(MudancaDivida, Divida),
  "dividas.apagar": metodo(PedidoDivida, Apagados),
  "dividas.registrarPagamento": metodo(PedidoPagamentoDivida, PagamentoDivida),
  "dividas.quitar": metodo(PedidoQuitar, Divida),
  /** Calculada na hora, nada gravado. */
  "dividas.simular": metodo(PedidoSimulacao, Simulacao),

  "planos.listar": metodo(z.undefined(), z.array(Plano)),
  "planos.obter": metodo(PedidoPlano, Plano),
  "planos.criar": metodo(NovoPlano, Plano),
  "planos.definir": metodo(MudancaPlano, Plano),
  "planos.apagar": metodo(PedidoPlano, Apagados),
  /** Guardar (positivo) ou retirar (negativo). */
  "planos.movimentar": metodo(PedidoMovimentarPlano, PlanoMovimentado),
  "planos.movimentos": metodo(PedidoPlano, z.array(MovimentoPlano)),

  /** O caminho escolhido no diálogo ou arrastado vira uma autorização de uso único (ADR-0044). */
  "arquivos.autorizar": metodo(PedidoAutorizarArquivo, AutorizacaoArquivo),

  "importacao.ler": metodo(PedidoLerExtrato, LeituraExtrato),
  "importacao.previa": metodo(PedidoPreviaImportacao, PreviaImportacao),
  /** Lança numa transação, com a importação em cada lançamento. */
  "importacao.confirmar": metodo(PedidoConfirmarImportacao, ImportacaoConcluida),
  /** Larga a prévia sem lançar nada. */
  "importacao.cancelar": metodo(PedidoImportacao, Apagados),
  /** Tira só o que a importação trouxe. */
  "importacao.desfazer": metodo(PedidoImportacao, Importacao),
  "importacao.listar": metodo(PedidoImportacoes, z.array(Importacao)),
  "importacao.perfis": metodo(z.undefined(), z.array(PerfilImportacao)),
  "importacao.apagarPerfil": metodo(PedidoPerfilImportacao, Apagados),
} as const;

export type Metodos = typeof METODOS;
export type NomeMetodo = keyof Metodos;
export type EntradaDe<M extends NomeMetodo> = z.infer<Metodos[M]["entrada"]>;
export type SaidaDe<M extends NomeMetodo> = z.infer<Metodos[M]["saida"]>;

/** Eventos que o serviço emite, com os dados de cada um. */
export const EVENTOS = {
  "sistema.ola": z.object({ protocolo: z.number().int() }),
  "config.mudou": EstadoConfig,
  "primeiroUso.mudou": EstadoPrimeiroUso,

  "agentes.mudou": Agente,
  "execucoes.mudou": Execucao,
  "provedores.mudou": z.array(Provedor),
  "conversas.mudou": Conversa,
  "conversas.mensagem": Mensagem,
  "conversas.parcial": FalaParcial,
  "aprovacoes.mudou": Aprovacao,
  "regras.mudou": z.array(RegraPermissao),
  "sessoes.mudou": MudancaSessao,
  "github.mudou": SituacaoGithub,
  "conexoes.mudou": Conexao,
  "notificacoes.mudou": EstadoNotificacoes,
  "notificacoes.nova": Notificacao,
  /** O que ainda não foi visto e pede o ponto no dock, a cada mudança. */
  "notificacoes.naoVistas": z.array(Notificacao),

  "listas.mudou": z.array(Lista),
  "tarefas.mudou": MudancaTarefas,
  "lembretes.mudou": MudancaLembretes,
  /** O lembrete do painel Hoje, a cada mudança: também quando o próximo entra nos 30 min antes. */
  "lembretes.hoje": LembretesDeHoje,
  "agenda.mudou": MudancaAgenda,
  "agenda.calendarios": z.array(Calendario),
  "foco.mudou": EstadoFoco,
  "notas.mudou": MudancaNotas,
  "rotinas.mudou": z.array(Rotina),
  /**
   * Um briefing ou fechamento que acabou de aparecer: abre o painel Hoje. Volta com a mesma vez
   * quando a frase da Alba chega e troca a de molde.
   */
  "rotinas.apareceu": ApresentacaoRotina,
  "areas.contagens": ContagensAreas,

  /** O que mudou no dinheiro, de qualquer caminho: as janelas recarregam as partes que vieram. */
  "financas.mudou": MudancaFinancas,
  "importacao.progresso": ProgressoImportacao,
  /** O modo privacidade ligou ou desligou (atalho, bandeja ou Configurações): as janelas mascaram. */
  "privacidade.mudou": Privacidade,
} as const;

export type NomeEvento = keyof typeof EVENTOS;
export type DadosDe<N extends NomeEvento> = z.infer<(typeof EVENTOS)[N]>;
