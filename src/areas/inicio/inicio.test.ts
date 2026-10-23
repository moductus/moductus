import type { ConfigInicio } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  colunasDosEscondidos,
  esconder,
  INICIO_PADRAO,
  mostrar,
  mover,
  ordemCompleta,
  posicao,
  soltar,
  textoDaMudanca,
  trechosDoInicio,
  visiveis,
} from "./inicio.ts";

/** O Início do InicioEditar.dc.html: Finanças escondida, os outros cinco na ordem do padrão. */
const SEM_FINANCAS: ConfigInicio = { ordem: [...INICIO_PADRAO.ordem], escondidos: ["financas"] };

describe("blocos do Início", () => {
  it("o padrão fica como no Sistema.dc.html: briefing em faixa, Tarefas, Foco e Finanças, Dev e Sessões", () => {
    expect(trechosDoInicio(visiveis(INICIO_PADRAO))).toEqual([
      { tipo: "faixa", id: "briefing" },
      { tipo: "colunas", colunas: [["tarefas"], ["foco", "financas"], ["dev", "sessoes"]] },
    ]);
  });

  it("menos blocos ocupam menos colunas; o briefing no meio parte as colunas em duas", () => {
    expect(trechosDoInicio(["tarefas", "foco"])).toEqual([
      { tipo: "colunas", colunas: [["tarefas"], ["foco"]] },
    ]);
    expect(trechosDoInicio(["tarefas", "briefing", "foco", "dev", "sessoes", "financas"])).toEqual([
      { tipo: "colunas", colunas: [["tarefas"]] },
      { tipo: "faixa", id: "briefing" },
      { tipo: "colunas", colunas: [["foco"], ["dev"], ["sessoes", "financas"]] },
    ]);
    expect(trechosDoInicio([])).toEqual([]);
  });

  it("ordem guardada de outra versão: repetido sai, bloco que falta vai para o fim", () => {
    const antiga = { ordem: ["dev", "foco"], escondidos: [] } as ConfigInicio;
    expect(ordemCompleta(antiga)).toEqual(["dev", "foco", "briefing", "tarefas", "financas", "sessoes"]);
  });

  it("mover troca com o vizinho que aparece, pulando o escondido; na ponta, nada muda", () => {
    const desceu = mover(SEM_FINANCAS, "foco", 1)!;
    expect(visiveis(desceu)).toEqual(["briefing", "tarefas", "dev", "foco", "sessoes"]);
    expect(desceu.escondidos).toEqual(["financas"]);
    expect(posicao(desceu, "foco")).toEqual({ numero: 4, total: 5 });
    expect(mover(SEM_FINANCAS, "briefing", -1)).toBeNull();
    expect(mover(SEM_FINANCAS, "sessoes", 1)).toBeNull();
    expect(mover(SEM_FINANCAS, "financas", 1)).toBeNull();
  });

  it("soltar põe o arrastado no lugar do alvo: antes se veio de baixo, depois se veio de cima", () => {
    expect(visiveis(soltar(INICIO_PADRAO, "sessoes", "tarefas")!)).toEqual([
      "briefing",
      "sessoes",
      "tarefas",
      "foco",
      "financas",
      "dev",
    ]);
    expect(visiveis(soltar(INICIO_PADRAO, "briefing", "foco")!)).toEqual([
      "tarefas",
      "foco",
      "briefing",
      "financas",
      "dev",
      "sessoes",
    ]);
    expect(soltar(INICIO_PADRAO, "dev", "dev")).toBeNull();
  });

  it("esconder guarda o lugar; mostrar devolve o bloco a ele", () => {
    const escondido = esconder(INICIO_PADRAO, "foco");
    expect(visiveis(escondido)).toEqual(["briefing", "tarefas", "financas", "dev", "sessoes"]);
    expect(posicao(escondido, "foco")).toBeNull();
    const devolvido = mostrar(escondido, "foco");
    expect(devolvido).toEqual(INICIO_PADRAO);
  });

  it("os Escondidos ficam com as colunas que sobram na última linha", () => {
    // Briefing na linha dele, depois Tarefas, Foco e Dev, e Sessões sozinha: sobram duas.
    expect(colunasDosEscondidos(visiveis(SEM_FINANCAS))).toBe(2);
    expect(colunasDosEscondidos(["briefing", "tarefas", "foco", "dev"])).toBe(3);
    expect(colunasDosEscondidos(["tarefas", "foco"])).toBe(1);
    expect(colunasDosEscondidos([])).toBe(3);
  });

  it("a linha de status diz onde o bloco ficou", () => {
    const subiu = mover(SEM_FINANCAS, "foco", 1)!;
    expect(textoDaMudanca(mover(subiu, "foco", -1)!, "foco", "moveu")).toBe(
      "Foco agora é o 3º de 5 blocos. Cada mudança vale na hora.",
    );
    expect(textoDaMudanca(INICIO_PADRAO, "dev", "escondeu")).toBe(
      "Dev foi para Escondidos. Cada mudança vale na hora.",
    );
    expect(textoDaMudanca(INICIO_PADRAO, "financas", "mostrou")).toBe(
      "Finanças voltou como o 4º de 6 blocos. Cada mudança vale na hora.",
    );
  });
});
