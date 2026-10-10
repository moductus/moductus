import type { ItemGithub, SessaoIa } from "@moductus/contrato";
import { haQuanto } from "../tempo.ts";

/**
 * Configurações › Conexões (ConfigConexoes*.dc.html): o que a prévia da ligação do Claude Code
 * mostra e o resumo de cada conexão ligada. O que muda no arquivo é o serviço que diz (a prévia);
 * aqui só se conta e se marca o que é novo, para o usuário ler antes de consentir.
 */

/** A rota dos hooks do Moductus no receptor (servico/src/sessoes/ligacao.ts). */
const ROTA_DO_MODUCTUS = /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}\/hooks\/claude-code$/;

type Objeto = Record<string, unknown>;
const eObjeto = (valor: unknown): valor is Objeto =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

/**
 * Quantos eventos do bloco `hooks` passam a avisar o Moductus: os que têm um hook `http` na rota
 * dele. É o número do botão ("Ligar 8 hooks no Claude Code"). Bloco ilegível conta zero.
 */
export function eventosDoMoductus(depois: string): number {
  let bloco: unknown;
  try {
    bloco = JSON.parse(depois);
  } catch {
    return 0;
  }
  if (!eObjeto(bloco)) return 0;
  return Object.values(bloco).filter(
    (grupos) =>
      Array.isArray(grupos) &&
      grupos.some(
        (g) =>
          eObjeto(g) &&
          Array.isArray(g.hooks) &&
          g.hooks.some((h) => eObjeto(h) && typeof h.url === "string" && ROTA_DO_MODUCTUS.test(h.url)),
      ),
  ).length;
}

export interface LinhaPrevia {
  texto: string;
  /** A linha não existia antes: entra com a ligação. */
  nova: boolean;
}

/**
 * As linhas de depois, marcando as que não estavam antes, pela maior sequência comum entre os
 * dois blocos. O bloco tem poucas centenas de linhas: a conta cabe de sobra.
 */
export function linhasDaPrevia(antes: string | null, depois: string): LinhaPrevia[] {
  const a = antes === null ? [] : antes.split("\n");
  const d = depois.split("\n");
  // comum[i][j]: a maior sequência comum entre a[i..] e d[j..].
  const comum = Array.from({ length: a.length + 1 }, () => new Array<number>(d.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = d.length - 1; j >= 0; j--) {
      comum[i]![j] =
        a[i] === d[j] ? comum[i + 1]![j + 1]! + 1 : Math.max(comum[i + 1]![j]!, comum[i]![j + 1]!);
    }
  }
  const linhas: LinhaPrevia[] = [];
  let i = 0;
  let j = 0;
  while (j < d.length) {
    if (i < a.length && a[i] === d[j]) {
      linhas.push({ texto: d[j]!, nova: false });
      i++;
      j++;
    } else if (i < a.length && comum[i + 1]![j]! >= comum[i]![j + 1]!) {
      i++;
    } else {
      linhas.push({ texto: d[j]!, nova: true });
      j++;
    }
  }
  return linhas;
}

/** O que o Nuno acha no GitHub, em números para a linha da conexão (ConfigConexoes.dc.html). */
export interface ResumoGithub {
  /** "3 PRs para revisar"; "nenhum PR para revisar". */
  esperando: string;
  /** "1 CI quebrado, 2 issues"; "nada quebrado". */
  codigo: string;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function resumoGithub(itens: readonly ItemGithub[]): ResumoGithub {
  const abertos = itens.filter((i) => i.estado === "aberto");
  const revisar = abertos.filter((i) => i.tipo === "pr" && i.meuPapel === "revisor" && i.precisaDeMim).length;
  const quebrados = abertos.filter((i) => i.tipo === "pr" && i.ciEstado === "falhou").length;
  const issues = abertos.filter((i) => i.tipo === "issue" && i.meuPapel === "atribuido").length;
  const partes: string[] = [];
  if (quebrados > 0) partes.push(plural(quebrados, "CI quebrado", "CIs quebrados"));
  if (issues > 0) partes.push(plural(issues, "issue", "issues"));
  return {
    esperando: revisar === 0 ? "nenhum PR para revisar" : `${plural(revisar, "PR", "PRs")} para revisar`,
    codigo: partes.length > 0 ? partes.join(", ") : "nada quebrado",
  };
}

/**
 * "há 2 min · 3 sessões hoje": o último evento que chegou das sessões do Claude Code e quantas
 * começaram hoje. Sem nenhum, o que fazer: as variáveis só valem num terminal aberto depois de ligar.
 */
export function ultimoEventoClaude(sessoes: readonly SessaoIa[], agora: Date): string {
  const doClaude = sessoes.filter((s) => s.ferramenta === "claude-code");
  const ultimo = doClaude
    .map((s) => s.ultimoEventoEm)
    .filter((e): e is string => e !== null)
    .sort()
    .at(-1);
  if (!ultimo) return "nenhum ainda: abra um terminal novo e rode o claude";
  const meiaNoite = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).toISOString();
  const hoje = doClaude.filter((s) => (s.iniciadaEm ?? s.ultimoEventoEm ?? "") >= meiaNoite).length;
  return `${haQuanto(ultimo, agora)} · ${plural(hoje, "sessão hoje", "sessões hoje")}`;
}

/** O comando que o erro do GitHub manda rodar, para o botão de copiar; `null` sem comando. */
export function comandoDoErro(erro: string | null): string | null {
  return erro?.includes("gh auth login") ? "gh auth login" : null;
}

/** "há 4 min · a cada 15 min": quando foi a última leitura e de quanto em quanto tempo o vigia lê. */
export function leituraGithub(atualizadoEm: string | null, agora: Date): string {
  return atualizadoEm ? `${haQuanto(atualizadoEm, agora)} · a cada 15 min` : "ainda não lido · a cada 15 min";
}
