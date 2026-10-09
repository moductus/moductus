import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { PaginaExecucoes } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { Catalogo } from "../ferramentas/catalogo.ts";
import { emJson, MARCA_CIRCULAR, RepositorioExecucoes, ServicoExecucoes } from "./execucoes.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-execucoes-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  const repo = new RepositorioExecucoes(db);
  return { db, repo, servico: new ServicoExecucoes(repo, new Catalogo()) };
}

describe("histórico de execuções", () => {
  test("pagina da mais nova para a mais antiga, por agente ou do time", () => {
    const { repo, servico } = montar();
    const ids = ["01A", "01B", "01C", "01D"];
    ids.forEach((id, i) =>
      repo.iniciar({
        id,
        agenteId: i % 2 === 0 ? "alba" : "nuno",
        gatilho: "mensagem",
        provedorId: null,
        inicio: `2026-10-09T12:00:0${i}.000Z`,
      }),
    );

    const primeira = servico.listar({ limite: 3 });
    expect(PaginaExecucoes.safeParse(primeira).success).toBe(true);
    expect(primeira.itens.map((e) => e.id)).toEqual(["01D", "01C", "01B"]);
    expect(primeira.proximo).toBe("01B");
    const segunda = servico.listar({ limite: 3, antesDe: primeira.proximo! });
    expect(segunda).toEqual({ itens: [expect.objectContaining({ id: "01A" })], proximo: null });

    expect(servico.listar({ agenteId: "alba" }).itens.map((e) => e.id)).toEqual(["01C", "01A"]);
  });

  test("a execução e as chamadas carimbam o agente; bigint do resultado vira texto", () => {
    const { db, repo, servico } = montar();
    repo.iniciar({
      id: "E1",
      agenteId: "nuno",
      gatilho: "intervalo",
      provedorId: "p1",
      inicio: "2026-10-09T12:00:00.000Z",
    });
    repo.registrarChamada({
      id: "C1",
      execucaoId: "E1",
      agenteId: "nuno",
      ferramenta: "github.listar",
      efeito: "leitura",
      entrada: undefined,
      resultado: { ok: true, valor: 1n },
      aprovacaoId: null,
      agora: "2026-10-09T12:00:01.000Z",
    });
    repo.terminar("E1", {
      fim: "2026-10-09T12:00:02.000Z",
      estado: "ok",
      erro: null,
      tokensEntrada: 10,
      tokensSaida: 2,
      custoEstimadoMicrodolares: null,
      resumo: "ok",
    });

    const origem = (tabela: string) =>
      db.prepare(`SELECT origem, agente_id, execucao_id FROM ${tabela}`).get() as Record<string, string>;
    expect(origem("execucoes")).toEqual({ origem: "agente", agente_id: "nuno", execucao_id: "E1" });
    expect(origem("chamadas_ferramenta")).toEqual({ origem: "agente", agente_id: "nuno", execucao_id: "E1" });
    expect(servico.obter({ id: "E1" })).toMatchObject({
      estado: "ok",
      fim: "2026-10-09T12:00:02.000Z",
      chamadas: [{ id: "C1", entrada: null, resultado: { ok: true, valor: "1" }, desfazerAte: null }],
    });
    expect(() => servico.obter({ id: "nada" })).toThrow("execução não encontrada");
  });

  test("registro em JSON: circular marcada, objeto repetido inteiro, o que não serializa vira texto", () => {
    const circular: Record<string, unknown> = { nome: "a" };
    circular.eu = circular;
    expect(JSON.parse(emJson({ valor: circular }))).toEqual({ valor: { nome: "a", eu: MARCA_CIRCULAR } });
    const repetido = { x: 1 };
    expect(JSON.parse(emJson([repetido, repetido]))).toEqual([{ x: 1 }, { x: 1 }]);
    expect(emJson(undefined)).toBe("null");
    const quebrado = {
      toJSON: () => {
        throw new Error("não");
      },
      toString: () => "quebrado",
    };
    expect(JSON.parse(emJson(quebrado))).toBe("quebrado");
  });
});
