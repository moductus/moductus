import { z } from "zod";
import { Id, Instante, PedidoPagina, pagina } from "./comum.ts";
import { Cobranca, MotivoFalhaProvedor } from "./provedores.ts";

/**
 * Agentes, execuções e o histórico com desfazer (AGENTS.md §1, §4, §6 e §7; DATA.md §6 agentes,
 * execucoes e chamadas_ferramenta). Um agente é configuração; o que ele está fazendo agora vem do
 * runtime e chega junto, em `situacao`.
 */

/** Os quatro de fábrica: o id é igual em todo PC (migração 003). */
export const AGENTES_DE_FABRICA = ["alba", "tula", "faina", "nuno"] as const;
export const AgenteDeFabrica = z.enum(AGENTES_DE_FABRICA);
export type AgenteDeFabrica = z.infer<typeof AgenteDeFabrica>;

/** Peças do personagem (DESIGN.md §6): a biblioteca é fechada, mas ainda não está toda nomeada. */
export const Personagem = z.object({
  silhueta: z.string().min(1),
  traco: z.string().min(1),
  tom: z.string().min(1),
});
export type Personagem = z.infer<typeof Personagem>;

/** Ferramenta ou grupo do catálogo: `tarefas.criar`, `agenda.*`. */
export const PadraoFerramenta = z
  .string()
  .regex(/^[a-z][a-z_]*\.([a-z][a-z_]*|\*)$/, "use dominio.acao ou dominio.*");
export type PadraoFerramenta = z.infer<typeof PadraoFerramenta>;

/** Quando o agente trabalha sozinho (AGENTS.md §6): `08:30`, a cada 15 min, `arquivo.chegou`. */
export const Gatilho = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("horario"), hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM") }),
  z.object({ tipo: z.literal("intervalo"), minutos: z.number().int().positive() }),
  z.object({ tipo: z.literal("evento"), nome: z.string().regex(/^[a-z][a-zA-Z_]*\.[a-z][a-zA-Z_]*$/) }),
]);
export type Gatilho = z.infer<typeof Gatilho>;

/** O que o usuário configura num agente. */
export const ConfigAgente = z.object({
  nome: z.string().trim().min(1),
  funcao: z.string().trim().min(1),
  instrucoes: z.string(),
  personagem: Personagem,
  ferramentas: z.array(PadraoFerramenta),
  provedorId: Id.nullable(),
  provedorReservaId: Id.nullable(),
  gatilhos: z.array(Gatilho),
  escoposMemoria: z.array(z.string().min(1)),
  /** Teto de gasto por dia; `null` é sem teto (o padrão). */
  tetoDiarioCentavos: z.number().int().nonnegative().nullable(),
});
export type ConfigAgente = z.infer<typeof ConfigAgente>;

/** Estado guardado (DATA.md §6). */
export const EstadoAgente = z.enum(["ativo", "pausado", "dormindo", "desligado"]);
export type EstadoAgente = z.infer<typeof EstadoAgente>;

/** O que o runtime vê agora; cada um tem uma expressão do personagem (DESIGN.md §6). */
export const AtividadeAgente = z.enum(["ocioso", "trabalhando", "esperando", "erro"]);
export type AtividadeAgente = z.infer<typeof AtividadeAgente>;

/** Por que dorme: falha do provedor, teto diário atingido ou nenhum modelo escolhido. */
export const MotivoSono = z.enum([...MotivoFalhaProvedor.options, "teto", "sem_modelo"]);
export type MotivoSono = z.infer<typeof MotivoSono>;

export const SituacaoAgente = z.object({
  estado: EstadoAgente,
  atividade: AtividadeAgente,
  motivoSono: MotivoSono.nullable(),
  /** Quando acorda; `null` dormindo é "quando o provedor voltar". */
  dormeAte: Instante.nullable(),
  /** Fim da pausa pela bandeja; `null` pausado é "até retomar". */
  pausadoAte: Instante.nullable(),
  /** Pedidos esperando na fila do agente, que rodam ao acordar ou retomar. */
  fila: z.number().int().nonnegative(),
});
export type SituacaoAgente = z.infer<typeof SituacaoAgente>;

export const Agente = ConfigAgente.extend({
  id: Id,
  deFabrica: z.boolean(),
  situacao: SituacaoAgente,
});
export type Agente = z.infer<typeof Agente>;

/** Mudança parcial na configuração de um agente; vale na próxima execução. */
export const MudancaAgente = ConfigAgente.partial().extend({ id: Id });
export type MudancaAgente = z.infer<typeof MudancaAgente>;

export const PedidoAgente = z.object({ id: Id });
export type PedidoAgente = z.infer<typeof PedidoAgente>;

/** Ligar ou desligar: desligado não roda nem os vigias que pedem modelo. */
export const PedidoLigarAgente = z.object({ id: Id, ligado: z.boolean() });
export type PedidoLigarAgente = z.infer<typeof PedidoLigarAgente>;

/** Pausar pela bandeja: um agente ou, sem `agenteId`, o time todo; `ate: null` é até retomar. */
export const PedidoPausar = z.object({ agenteId: Id.optional(), ate: Instante.nullable() });
export type PedidoPausar = z.infer<typeof PedidoPausar>;

export const PedidoRetomar = z.object({ agenteId: Id.optional() });
export type PedidoRetomar = z.infer<typeof PedidoRetomar>;

/** Nível de efeito de uma ferramenta (AGENTS.md §4). */
export const Efeito = z.enum(["leitura", "interno", "externo"]);
export type Efeito = z.infer<typeof Efeito>;

/** Uma linha de `/capacidades`: o que o agente pode fazer e com que efeito. */
export const Capacidade = z.object({
  nome: z.string().min(1),
  descricao: z.string(),
  efeito: Efeito,
});
export type Capacidade = z.infer<typeof Capacidade>;

export const TipoGatilho = z.enum(["mensagem", "horario", "intervalo", "evento"]);
export type TipoGatilho = z.infer<typeof TipoGatilho>;

export const EstadoExecucao = z.enum(["rodando", "ok", "erro", "adiada"]);
export type EstadoExecucao = z.infer<typeof EstadoExecucao>;

/**
 * Cada vez que um agente trabalha. Custo vazio quando não há número honesto (assinatura, modelo
 * sem preço conhecido): a interface diz isso em vez de mostrar zero, e `cobranca` diz qual dos
 * dois é. Custo preenchido é sempre estimativa, pela tabela de preços do serviço. `cobranca`
 * vazia: a execução não chegou a um provedor (agente sem modelo). Assinatura nunca tem custo.
 */
const CamposExecucao = z.object({
  id: Id,
  agenteId: Id,
  gatilho: TipoGatilho,
  provedorId: Id.nullable(),
  inicio: Instante.nullable(),
  fim: Instante.nullable(),
  estado: EstadoExecucao,
  erro: z.string().nullable(),
  /**
   * O motivo, quando o erro foi do provedor (o classificador que põe o agente para dormir); vazio
   * em erro de outra causa (ferramenta, prazo, cancelado), que se mostra como veio.
   */
  falhaDoProvedor: MotivoFalhaProvedor.nullable(),
  tokensEntrada: z.number().int().nonnegative().nullable(),
  tokensSaida: z.number().int().nonnegative().nullable(),
  custoEstimadoMicrodolares: z.number().int().nonnegative().nullable(),
  cobranca: Cobranca.nullable(),
  resumo: z.string().nullable(),
});

/** Assinatura não tem custo por token: um número ali seria inventado (AGENTS.md §5 "Consumo"). */
const assinaturaSemCusto = (e: { cobranca: Cobranca | null; custoEstimadoMicrodolares: number | null }) =>
  e.cobranca !== "assinatura" || e.custoEstimadoMicrodolares === null;
const MENSAGEM_ASSINATURA_COM_CUSTO = {
  path: ["custoEstimadoMicrodolares"],
  message: "execução por assinatura não tem custo estimado",
};

export const Execucao = CamposExecucao.refine(assinaturaSemCusto, MENSAGEM_ASSINATURA_COM_CUSTO);
export type Execucao = z.infer<typeof Execucao>;

export const ChamadaFerramenta = z.object({
  id: Id,
  execucaoId: Id.nullable(),
  ferramenta: z.string().min(1),
  efeito: Efeito,
  entrada: z.unknown(),
  resultado: z.unknown(),
  aprovacaoId: Id.nullable(),
  criadoEm: Instante,
  desfeitaEm: Instante.nullable(),
  /** Até quando dá para desfazer; `null` quando não dá (leitura, externo, já desfeita). */
  desfazerAte: Instante.nullable(),
});
export type ChamadaFerramenta = z.infer<typeof ChamadaFerramenta>;

export const ExecucaoDetalhada = CamposExecucao.extend({ chamadas: z.array(ChamadaFerramenta) }).refine(
  assinaturaSemCusto,
  MENSAGEM_ASSINATURA_COM_CUSTO,
);
export type ExecucaoDetalhada = z.infer<typeof ExecucaoDetalhada>;

/** Histórico: de um agente ou, sem `agenteId`, do time todo. */
export const PedidoExecucoes = PedidoPagina.extend({ agenteId: Id.optional() });
export type PedidoExecucoes = z.infer<typeof PedidoExecucoes>;

export const PaginaExecucoes = pagina(Execucao);
export type PaginaExecucoes = z.infer<typeof PaginaExecucoes>;

export const PedidoExecucao = z.object({ id: Id });
export type PedidoExecucao = z.infer<typeof PedidoExecucao>;

/** Desfazer uma chamada `interno` pelo histórico; fora do prazo volta erro dizendo por quê. */
export const PedidoDesfazer = z.object({ chamadaId: Id });
export type PedidoDesfazer = z.infer<typeof PedidoDesfazer>;
