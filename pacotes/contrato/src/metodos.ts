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
import { Aprovacao, PedidoDecidir, PedidoRegra, RegraPermissao } from "./aprovacoes.ts";
import { metodo } from "./canal.ts";
import { EstadoConfig, MudancaConfig } from "./config.ts";
import {
  Conversa,
  FalaParcial,
  Mensagem,
  PaginaMensagens,
  PedidoAbrirConversa,
  PedidoArquivarConversa,
  PedidoEnviar,
  PedidoMensagens,
  ResultadoEnviar,
} from "./conversas.ts";
import { PedidoExportar, PedidoImportar, PreviaImportar, ResultadoExportar } from "./outro-pc.ts";
import { EstadoPrimeiroUso, PedidoConcluirPrimeiroUso, PedidoMarcarTutorial } from "./primeiro-uso.ts";
import {
  MudancaProvedor,
  NovoProvedor,
  PedidoProvedor,
  Provedor,
  ProvedorDetectado,
  ResultadoTesteProvedor,
} from "./provedores.ts";
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

/** Todos os métodos que o serviço atende, com entrada e saída. */
export const METODOS = {
  "sistema.ping": metodo(z.undefined(), z.object({ protocolo: z.number().int(), pid: z.number().int() })),
  "config.obter": metodo(z.undefined(), EstadoConfig),
  "config.definir": metodo(MudancaConfig, EstadoConfig),
  "config.exportar": metodo(PedidoExportar, ResultadoExportar),
  "config.previaImportar": metodo(PedidoImportar, PreviaImportar),
  "config.importar": metodo(PedidoImportar, EstadoConfig),
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
  "agentes.capacidades": metodo(PedidoAgente, z.array(Capacidade)),

  "execucoes.listar": metodo(PedidoExecucoes, PaginaExecucoes),
  "execucoes.obter": metodo(PedidoExecucao, ExecucaoDetalhada),
  "execucoes.desfazer": metodo(PedidoDesfazer, ChamadaFerramenta),

  "provedores.listar": metodo(z.undefined(), z.array(Provedor)),
  "provedores.detectar": metodo(z.undefined(), z.array(ProvedorDetectado)),
  "provedores.criar": metodo(NovoProvedor, Provedor),
  "provedores.definir": metodo(MudancaProvedor, Provedor),
  "provedores.remover": metodo(PedidoProvedor, z.array(Provedor)),
  "provedores.testar": metodo(PedidoProvedor, ResultadoTesteProvedor),

  "conversas.listar": metodo(z.undefined(), z.array(Conversa)),
  "conversas.abrir": metodo(PedidoAbrirConversa, Conversa),
  "conversas.mensagens": metodo(PedidoMensagens, PaginaMensagens),
  "conversas.enviar": metodo(PedidoEnviar, ResultadoEnviar),
  "conversas.arquivar": metodo(PedidoArquivarConversa, Conversa),

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
} as const;

export type NomeEvento = keyof typeof EVENTOS;
export type DadosDe<N extends NomeEvento> = z.infer<(typeof EVENTOS)[N]>;
