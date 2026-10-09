import type { Decisao, FerramentaSessao } from "@moductus/contrato";
import { MENSAGEM_NEGADO, type Desfecho, type ServicoAprovacoes } from "../aprovacoes/aprovacoes.ts";
import type { EventoHook } from "./hooks.ts";
import type { AtenderHook } from "./receptor.ts";
import type { ServicoSessoes } from "./sessoes.ts";

/** Timeout do hook `PermissionRequest` gravado no `settings.json` pela ligação (spec §3, F2-22). */
export const TIMEOUT_HOOK_PERMISSAO_MS = 600_000;

/**
 * O endpoint responde sem decidir um pouco antes de o Claude Code desistir do hook: a resposta
 * vazia deixa o diálogo do terminal valendo, e o cartão expira no dock.
 */
export const PRAZO_PERMISSAO_MS = TIMEOUT_HOOK_PERMISSAO_MS - 10_000;

/** O que o modelo lê quando uma regra "sempre" de negar decide sem cartão. */
export const MENSAGEM_REGRA_NEGA = "Negado por uma regra do Moductus neste projeto";

/**
 * Ferramentas cujo pedido é uma pergunta ao usuário, não uma permissão: a resposta (a opção
 * escolhida, o plano aceito com qual modo) só existe no terminal, então o dock não decide.
 */
const SO_NO_TERMINAL = new Set(["AskUserQuestion", "ExitPlanMode"]);

/**
 * Eventos que só chegam depois de o pedido ter sido respondido no terminal: o turno acabou ou o
 * usuário já escreveu de novo. O que a sessão ainda pedia no dock não vale mais.
 */
const SESSAO_SEGUIU = new Set(["Stop", "UserPromptSubmit"]);

const DE_COMANDO = new Set(["Bash", "PowerShell"]);
const DE_EDICAO = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/**
 * O que o cartão diz, na voz da sessão (DESIGN.md §5): o comando, o arquivo ou o endereço vão no
 * detalhe logo abaixo, inteiros.
 */
export function descreverPedido(ferramenta: string): string {
  if (DE_COMANDO.has(ferramenta)) return "Quer rodar o comando abaixo.";
  if (DE_EDICAO.has(ferramenta)) return "Quer alterar o arquivo abaixo.";
  if (ferramenta === "Read") return "Quer ler o arquivo abaixo.";
  if (ferramenta === "WebFetch") return "Quer abrir o endereço abaixo.";
  return `Quer usar ${ferramenta}.`;
}

/**
 * O corpo da resposta ao `PermissionRequest` (AGENTS.md §5, testado em 06/10). Sem
 * `updatedPermissions`: a regra "sempre" mora no Moductus e é ele quem a aplica no próximo
 * pedido igual, sem gravar nada nas configurações do Claude Code.
 */
export function respostaPermissao(decisao: Decisao, mensagem: string | null): object {
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision:
        decisao === "permitir"
          ? { behavior: "allow" }
          : { behavior: "deny", message: mensagem ?? MENSAGEM_NEGADO },
    },
  };
}

/** Cartão decidido vira resposta; cartão expirado não decide nada (o terminal segue). */
function respostaDo({ aprovacao, mensagem }: Desfecho): object | undefined {
  if (aprovacao.estado === "aprovada") return respostaPermissao("permitir", null);
  if (aprovacao.estado === "negada") return respostaPermissao("negar", mensagem);
  return undefined;
}

export interface OpcoesPermissao {
  /** Até quando segurar a resposta esperando o dock. */
  prazoMs?: number;
}

/**
 * Aprovar pelo dock (AGENTS.md §5, ADR-0009): o `PermissionRequest` de uma sessão interativa
 * passa pelas regras do usuário; sem regra, vira cartão e a resposta HTTP fica segurada até a
 * decisão. Sem decisão no prazo, ou com a conexão caída, o cartão expira e a resposta sai vazia:
 * o diálogo do terminal, que continua na tela, é quem decide.
 */
export async function decidirPermissao(
  aprovacoes: ServicoAprovacoes,
  fonte: FerramentaSessao,
  sessaoId: string,
  evento: EventoHook,
  conexao: AbortSignal,
  { prazoMs = PRAZO_PERMISSAO_MS }: OpcoesPermissao = {},
): Promise<object | undefined> {
  if (!evento.ferramenta || SO_NO_TERMINAL.has(evento.ferramenta)) return undefined;
  const resultado = aprovacoes.pedir({
    fonte,
    sessaoId,
    descricao: descreverPedido(evento.ferramenta),
    acao: {
      ferramenta: evento.ferramenta,
      entrada: evento.entrada,
      rotulo: null,
      rotuloRecusar: null,
      desfazivel: false,
    },
  });
  if (resultado.tipo === "regra") return respostaPermissao(resultado.decisao, MENSAGEM_REGRA_NEGA);

  const { id } = resultado.aprovacao;
  const prazo = new AbortController();
  const relogio = setTimeout(() => prazo.abort(new Error("sem decisão no prazo")), prazoMs);
  try {
    return respostaDo(await aprovacoes.esperar(id, AbortSignal.any([conexao, prazo.signal])));
  } catch (erro) {
    if (!conexao.aborted && !prazo.signal.aborted) throw erro;
    // Ninguém vai ler esta decisão: o cartão expira. Se o usuário decidiu no mesmo instante, vale
    // o que ele decidiu (o cartão já não estava pendente e `esperar` responde na hora).
    aprovacoes.expirar(id);
    return respostaDo(await aprovacoes.esperar(id));
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Quem atende os hooks das sessões de IA: grava o evento na sessão, expira o que ela pedia quando
 * ela seguiu ou terminou, e decide o `PermissionRequest` pelo dock.
 */
export function atenderHooks(
  sessoes: ServicoSessoes,
  aprovacoes: ServicoAprovacoes,
  opcoes: OpcoesPermissao = {},
): AtenderHook {
  return (ferramenta, evento, conexao) => {
    const { sessao } = sessoes.registrar(ferramenta, evento);
    if (sessao.encerradaEm || SESSAO_SEGUIU.has(evento.tipo)) aprovacoes.expirarDaSessao(sessao.id);
    if (evento.tipo !== "PermissionRequest") return undefined;
    return decidirPermissao(aprovacoes, ferramenta, sessao.id, evento, conexao, opcoes);
  };
}
