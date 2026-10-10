import { EstadoSessao, type SessaoIa } from "@moductus/contrato";
import { z } from "zod";
import { porcentagem } from "../../sessoes/contexto.ts";
import type { ServicoSessoes } from "../../sessoes/sessoes.ts";
import { ferramenta, type Ferramenta } from "../ferramenta.ts";

/**
 * As ferramentas `sessoes.*` do Nuno (AGENTS.md §2): as sessões de IA por projeto, com estado,
 * contexto e o que fizeram por último. Tudo leitura, da mesma área que o dock e a tela Sessões
 * de IA leem.
 */

/** Eventos de uma sessão que vão ao modelo de uma vez. */
export const EVENTOS_MAXIMO = 50;

/** A sessão como o modelo lê: projeto pelo nome, contexto em % ou `null` quando não se sabe. */
function sessaoParaModelo(s: SessaoIa, nomes: ReadonlyMap<string, string>) {
  return {
    id: s.id,
    ferramenta: s.ferramenta,
    projeto: s.projetoId ? (nomes.get(s.projetoId) ?? null) : null,
    estado: s.estado,
    modelo: s.modelo,
    contexto: s.contexto
      ? {
          porcentagem: porcentagem(s.contexto.usadoTokens, s.contexto.janelaTokens),
          usadoTokens: s.contexto.usadoTokens,
          janelaTokens: s.contexto.janelaTokens,
        }
      : null,
    ultimoEvento: s.ultimoEvento
      ? { tipo: s.ultimoEvento.tipo, resumo: s.ultimoEvento.entradaResumo, em: s.ultimoEvento.recebidoEm }
      : null,
    iniciadaEm: s.iniciadaEm,
    ultimoEventoEm: s.ultimoEventoEm,
    encerradaEm: s.encerradaEm,
  };
}

export function ferramentasSessoes(sessoes: ServicoSessoes): Ferramenta[] {
  return [
    ferramenta({
      nome: "sessoes.listar",
      descricao:
        "As sessões de IA do usuário (Claude Code, Codex, OpenCode, Gemini CLI, Antigravity) abertas e as do último dia, por projeto: estado (trabalhando, esperando = esperando o usuário, terminou, erro, parada = sem evento há 30 minutos), % do contexto e o último evento. Contexto vazio quer dizer que não se sabe: não estime.",
      entrada: z.object({
        estado: EstadoSessao.optional().describe("Só as sessões neste estado"),
      }),
      efeito: "leitura",
      executar: ({ estado }) => {
        const lista = sessoes.listar();
        const nomes = new Map(lista.projetos.map((p) => [p.id, p.nome]));
        return {
          sessoes: lista.sessoes
            .filter((s) => !estado || s.estado === estado)
            .map((s) => sessaoParaModelo(s, nomes)),
        };
      },
    }),
    ferramenta({
      nome: "sessoes.eventos",
      descricao:
        "Os eventos mais recentes de uma sessão de IA (o mais novo primeiro): ferramenta usada e um resumo em uma linha do comando, arquivo ou mensagem.",
      entrada: z.object({
        sessaoId: z.string().min(1).describe("O id da sessão, como sessoes.listar devolve"),
        limite: z.number().int().min(1).max(EVENTOS_MAXIMO).optional().describe("Quantos eventos; padrão 20"),
      }),
      efeito: "leitura",
      executar: ({ sessaoId, limite }) =>
        sessoes.eventos({ sessaoId, limite: limite ?? 20 }).map((e) => ({
          tipo: e.tipo,
          ferramenta: e.ferramentaUsada,
          resumo: e.entradaResumo,
          em: e.recebidoEm,
        })),
    }),
  ];
}
