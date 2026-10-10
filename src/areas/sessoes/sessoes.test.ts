import type { EventoSessao, ListaSessoes, SessaoIa, UsoIa } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  caminhoNoProjeto,
  contextoDaSessao,
  estadoDaSessao,
  ferramentasAcompanhadas,
  formatarTokens,
  gastoDeHoje,
  juntarSessao,
  periodoDoGrafico,
  semanaDeUso,
  ultimaAcao,
} from "./sessoes.ts";

const AGORA = new Date("2026-10-09T14:00:00");

const sessao = (extra: Partial<SessaoIa> = {}): SessaoIa => ({
  id: "s1",
  projetoId: "p1",
  ferramenta: "claude-code",
  idExterno: "x",
  modelo: "claude-opus-4-5",
  estado: "trabalhando",
  iniciadaEm: "2026-10-09T12:00:00.000Z",
  ultimoEventoEm: "2026-10-09T13:59:00.000Z",
  encerradaEm: null,
  contexto: null,
  ultimoEvento: null,
  ...extra,
});

const evento = (extra: Partial<EventoSessao>): EventoSessao => ({
  id: "e1",
  sessaoId: "s1",
  tipo: "PreToolUse",
  ferramentaUsada: null,
  entradaResumo: null,
  recebidoEm: "2026-10-09T13:59:00.000Z",
  ...extra,
});

const uso = (extra: Partial<UsoIa> = {}): UsoIa => ({
  dia: "2026-10-09",
  ferramenta: "claude-code",
  modelo: "claude-opus-4-5",
  projetoId: "p1",
  tokensEntrada: 1000,
  tokensSaida: 200,
  tokensCache: 0,
  custoEstimadoMicrodolares: null,
  fonte: "ferramenta",
  ...extra,
});

describe("estado e contexto da sessão", () => {
  it("parada diz desde quando; os outros estados têm texto e tom fixos", () => {
    const parada = sessao({ estado: "parada", ultimoEventoEm: "2026-10-09T12:00:00" });
    expect(estadoDaSessao(parada, AGORA)).toEqual({ texto: "parada há 2 h", tom: "apagado" });
    expect(estadoDaSessao(sessao({ estado: "esperando" }), AGORA)).toEqual({
      texto: "esperando você",
      tom: "aviso",
    });
    expect(estadoDaSessao(sessao({ estado: "erro" }), AGORA).tom).toBe("perigo");
  });

  it("sem número da ferramenta, diz que não sabe e não acende o aviso", () => {
    expect(contextoDaSessao(sessao())).toEqual({ pct: null, texto: "não sei", alto: false });
  });

  it("arredonda para baixo como o serviço: 79,9% fica em 79% e sem aviso; 80% avisa", () => {
    const quase = sessao({ contexto: { usadoTokens: 159_800, janelaTokens: 200_000 } });
    expect(contextoDaSessao(quase)).toEqual({ pct: 79, texto: "79%", alto: false });
    const oitenta = sessao({ contexto: { usadoTokens: 160_000, janelaTokens: 200_000 } });
    expect(contextoDaSessao(oitenta)).toEqual({ pct: 80, texto: "80%", alto: true });
  });
});

describe("última ação", () => {
  it("o arquivo aparece a partir da pasta do projeto, com o verbo da ferramenta", () => {
    const e = evento({ ferramentaUsada: "Edit", entradaResumo: "V:\\moductus\\src-tauri\\src\\appbar.rs" });
    expect(ultimaAcao(e, "V:\\moductus")).toBe("Editando src-tauri/src/appbar.rs");
  });

  it("pedido de permissão do Bash mostra o comando", () => {
    const e = evento({ tipo: "PermissionRequest", ferramentaUsada: "Bash", entradaResumo: "npm test" });
    expect(ultimaAcao(e, null)).toBe("Pediu para rodar npm test");
  });

  it("ferramenta sem verbo, fim de turno e sem evento", () => {
    expect(ultimaAcao(evento({ ferramentaUsada: "mcp__x__y" }), null)).toBe("Usando mcp__x__y");
    expect(ultimaAcao(evento({ tipo: "Stop" }), null)).toBe("Terminou o turno");
    expect(ultimaAcao(null, null)).toBeNull();
  });

  it("caminho fora do projeto fica inteiro; prefixo parecido não conta", () => {
    expect(caminhoNoProjeto("V:\\outro\\a.ts", "V:\\moductus")).toBe("V:\\outro\\a.ts");
    expect(caminhoNoProjeto("V:\\moductus2\\a.ts", "V:\\moductus")).toBe("V:\\moductus2\\a.ts");
    expect(caminhoNoProjeto("v:/Moductus/a.ts", "V:\\moductus\\")).toBe("a.ts");
  });
});

describe("gasto de hoje", () => {
  const s = sessao();

  it("sem custo, mostra os tokens do projeto e da ferramenta de hoje", () => {
    const linhas = [uso(), uso({ modelo: "claude-haiku-4-5", tokensSaida: 800 }), uso({ dia: "2026-10-08" })];
    expect(gastoDeHoje(linhas, s, "2026-10-09")).toEqual({
      texto: "3 mil tokens",
      rotulo: "3 mil tokens",
      vazio: false,
    });
  });

  it("outro projeto ou ferramenta não entra; sem linha, sem uso (nunca zero)", () => {
    const linhas = [uso({ projetoId: "p2" }), uso({ ferramenta: "codex" })];
    expect(gastoDeHoje(linhas, s, "2026-10-09")).toEqual({
      texto: "sem uso",
      rotulo: "sem uso registrado hoje",
      vazio: true,
    });
  });

  it("estimativa sai marcada; custo só quando todas as linhas têm preço", () => {
    expect(gastoDeHoje([uso({ fonte: "estimativa" })], s, "2026-10-09").texto).toBe("≈ 1,2 mil tokens");
    const comPreco = [uso({ custoEstimadoMicrodolares: 1_860_000 })];
    expect(gastoDeHoje(comPreco, s, "2026-10-09")).toMatchObject({ texto: "≈ US$ 1,86" });
    const misturado = [...comPreco, uso({ modelo: "sem-tabela" })];
    expect(gastoDeHoje(misturado, s, "2026-10-09").texto).toBe("2,4 mil tokens");
  });

  it("tokens curtos", () => {
    expect(formatarTokens(820)).toBe("820");
    expect(formatarTokens(12_400)).toBe("12,4 mil");
    expect(formatarTokens(1_250_000)).toBe("1,3 mi");
  });
});

describe("semana de uso", () => {
  it("sete dias até hoje, dia sem uso com zero, barra contra o maior dia", () => {
    const semana = semanaDeUso(
      [uso({ dia: "2026-10-03", tokensEntrada: 4000, tokensSaida: 0 }), uso(), uso({ ferramenta: "codex" })],
      AGORA,
    );
    expect(semana.dias.map((d) => d.dia)).toEqual([
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
    ]);
    expect(semana.dias.map((d) => d.rotulo)).toEqual(["sáb", "dom", "seg", "ter", "qua", "qui", "sex"]);
    expect(semana.dias.map((d) => d.pct)).toEqual([100, 0, 0, 0, 0, 0, 60]);
    expect(semana.dias.at(-1)).toMatchObject({ hoje: true, tokens: 2400 });
    expect(semana.total).toBe(6400);
    expect(semana.estimativa).toBe(false);
  });

  it("estimativa só conta dentro da semana; semana vazia não divide por zero", () => {
    expect(semanaDeUso([uso({ dia: "2026-09-01", fonte: "estimativa" })], AGORA).estimativa).toBe(false);
    expect(semanaDeUso([uso({ fonte: "estimativa" })], AGORA).estimativa).toBe(true);
    expect(semanaDeUso([], AGORA).dias.every((d) => d.pct === 0)).toBe(true);
  });

  it("o período pedido ao serviço é o do gráfico", () => {
    expect(periodoDoGrafico(AGORA)).toEqual({ de: "2026-10-03", ate: "2026-10-09" });
  });
});

describe("lista de sessões", () => {
  const lista: ListaSessoes = {
    projetos: [{ id: "p1", nome: "moductus", caminho: "V:\\moductus", repositorio: null, arquivado: false }],
    sessoes: [sessao({ id: "s1" }), sessao({ id: "s2", ferramenta: "codex" })],
  };

  it("a sessão que mudou vai ao topo sem duplicar; projeto novo entra", () => {
    const projeto = { id: "p2", nome: "site", caminho: "V:\\site", repositorio: null, arquivado: false };
    const junta = juntarSessao(lista, { sessao: sessao({ id: "s2", estado: "terminou" }), projeto });
    expect(junta.sessoes.map((s) => [s.id, s.estado])).toEqual([
      ["s2", "terminou"],
      ["s1", "trabalhando"],
    ]);
    expect(junta.projetos.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("no alto só as ferramentas com sessão, mais o Claude Code quando os hooks estão ligados", () => {
    const ligada = { tipo: "hooks-claude-code" as const, estado: "ligada" as const };
    const conexao = { ...ligada, conta: null, ultimoErro: null, conectadaEm: null };
    const soCodex = { ...lista, sessoes: [sessao({ ferramenta: "codex" })] };
    expect(ferramentasAcompanhadas({ lista: soCodex, uso: [], conexao: null })).toEqual(["codex"]);
    expect(ferramentasAcompanhadas({ lista: soCodex, uso: [], conexao })).toEqual(["claude-code", "codex"]);
  });
});
