import { z } from "zod";
import { Id, Instante } from "./comum.ts";
import { FerramentaSessao } from "./sessoes.ts";

/**
 * Cartões de aprovação e regras de permissão (AGENTS.md §4 e §5; DATA.md §6 aprovacoes e
 * regras_permissao; DESIGN.md §5). O mesmo cartão serve ao pedido de um agente do Moductus e ao
 * `PermissionRequest` de uma sessão do Claude Code no terminal.
 */

/** De onde veio o pedido: um agente do Moductus ou uma sessão externa. */
export const FonteAprovacao = z.enum(["moductus", ...FerramentaSessao.options]);
export type FonteAprovacao = z.infer<typeof FonteAprovacao>;

export const EstadoAprovacao = z.enum(["pendente", "aprovada", "negada", "expirada"]);
export type EstadoAprovacao = z.infer<typeof EstadoAprovacao>;

/**
 * O que será feito com o sim. Os botões são verbo com objeto, nunca "OK" (AGENTS.md "Voz dos
 * agentes"); só o cartão de uma sessão do terminal usa os genéricos do DESIGN.md §5.
 */
export const AcaoAprovacao = z.object({
  ferramenta: z.string().min(1),
  entrada: z.unknown(),
  /** Botão de permitir ("Mover 38 arquivos"); `null`, só nas sessões do terminal, é "Permitir". */
  rotulo: z.string().trim().min(1).nullable(),
  /** Botão de recusar ("Manter", "Depois"); `null` é "Negar". */
  rotuloRecusar: z.string().trim().min(1).nullable(),
  desfazivel: z.boolean(),
});
export type AcaoAprovacao = z.infer<typeof AcaoAprovacao>;

export const Aprovacao = z
  .object({
    id: Id,
    fonte: FonteAprovacao,
    /** Agente e execução que pediram; vazios quando o pedido vem de uma sessão do terminal. */
    agenteId: Id.nullable(),
    execucaoId: Id.nullable(),
    sessaoId: Id.nullable(),
    /** O que vai acontecer e o tamanho, na voz do agente. */
    descricao: z.string().min(1),
    acao: AcaoAprovacao,
    estado: EstadoAprovacao,
    criadoEm: Instante,
    decididaEm: Instante.nullable(),
    regraCriadaId: Id.nullable(),
    /**
     * Dá para decidir com "sempre": o pedido tem comando, caminho ou endereço a comparar e, no
     * terminal, a sessão tem projeto (e o arquivo fica dentro dele). Sem isso, o cartão não
     * oferece "Sempre neste projeto". Calculado pelo serviço, não gravado.
     */
    admiteSempre: z.boolean(),
  })
  .superRefine((aprovacao, ctx) => {
    // Pedido de agente do Moductus diz o que o sim faz; "Permitir" fica para o terminal.
    if (aprovacao.fonte === "moductus" && aprovacao.acao.rotulo === null) {
      ctx.addIssue({
        code: "custom",
        path: ["acao", "rotulo"],
        message: "pedido de agente precisa do botão com verbo e objeto",
      });
    }
  });
export type Aprovacao = z.infer<typeof Aprovacao>;

/** "Sempre neste projeto" (sessões) ou "sempre para este agente" (Moductus). */
export const EscopoSempre = z.enum(["projeto", "agente"]);
export type EscopoSempre = z.infer<typeof EscopoSempre>;

export const Decisao = z.enum(["permitir", "negar"]);
export type Decisao = z.infer<typeof Decisao>;

export const PedidoDecidir = z.object({
  id: Id,
  decisao: Decisao,
  /** Cria uma regra que decide os próximos pedidos iguais sem cartão. */
  sempre: EscopoSempre.optional(),
  /** Devolvida a quem pediu ao negar ("Negado pelo dock do Moductus" se vazia). */
  mensagem: z.string().trim().min(1).optional(),
});
export type PedidoDecidir = z.infer<typeof PedidoDecidir>;

export const EscopoRegra = z.enum(["projeto", "agente", "conexao"]);
export type EscopoRegra = z.infer<typeof EscopoRegra>;

export const RegraPermissao = z.object({
  id: Id,
  escopo: EscopoRegra,
  projetoId: Id.nullable(),
  agenteId: Id.nullable(),
  ferramenta: z.string().min(1),
  /** O que a regra cobre dentro da ferramenta. */
  padrao: z.string().min(1),
  decisao: Decisao,
  criadoEm: Instante,
  expiraEm: Instante.nullable(),
});
export type RegraPermissao = z.infer<typeof RegraPermissao>;

export const PedidoRegra = z.object({ id: Id });
export type PedidoRegra = z.infer<typeof PedidoRegra>;
