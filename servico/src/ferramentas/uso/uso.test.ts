import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../../banco/conexao.ts";
import { RepositorioSessoes, ServicoSessoes } from "../../sessoes/sessoes.ts";
import { Catalogo } from "../catalogo.ts";
import { AVISO_ESTIMATIVA, AVISO_SEM_CUSTO, DIAS_MAXIMO, ferramentasUso } from "./uso.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

type Valor = {
  de: string;
  ate: string;
  linhas: Record<string, unknown>[];
  total: Record<string, unknown>;
  avisos: string[];
};

function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-ferramentas-uso-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  const repo = new RepositorioSessoes(db);
  const sessoes = new ServicoSessoes(repo, () => {});
  repo.criarProjeto("p1", "moductus", "V:\\moductus", "2026-10-01T00:00:00.000Z");
  const somar = (dia: string, fonte: "ferramenta" | "estimativa", entrada: number) =>
    repo.somarUso({
      dia,
      ferramenta: "claude-code",
      modelo: "claude-sonnet-4-5",
      projetoId: "p1",
      entrada,
      saida: 10,
      cache: 5,
      fonte,
      agora: "2026-10-09T12:00:00.000Z",
    });
  // 15h de 9/10 em UTC ainda é 9/10 em qualquer fuso de UTC−12 a UTC+8 (o dia é o local).
  const escopo = new Catalogo(
    ferramentasUso(sessoes, { agora: () => new Date("2026-10-09T15:00:00.000Z") }),
  ).doAgente(["uso.*"]);
  const chamar = async (entrada: unknown) =>
    escopo.executor({ agenteId: "nuno", execucaoId: null, sinal: new AbortController().signal })({
      id: "c1",
      nome: "uso__por_dia",
      entrada,
    });
  return { db, somar, chamar };
}

describe("ferramenta uso.por_dia", () => {
  test("sem datas, hoje; projeto pelo nome; estimativa marcada; sem preço, sem custo", async () => {
    const { somar, chamar } = montar();
    somar("2026-10-08", "ferramenta", 100);
    somar("2026-10-09", "estimativa", 200);
    const r = await chamar({});
    expect(r.ok).toBe(true);
    const valor = (r as { valor: Valor }).valor;
    expect(valor).toMatchObject({ de: "2026-10-09", ate: "2026-10-09" });
    expect(valor.linhas).toEqual([
      {
        dia: "2026-10-09",
        ferramenta: "claude-code",
        modelo: "claude-sonnet-4-5",
        projeto: "moductus",
        tokensEntrada: 200,
        tokensSaida: 10,
        tokensCache: 5,
        custoEstimadoMicrodolares: null,
        estimativa: true,
      },
    ]);
    expect(valor.total).toEqual({
      tokensEntrada: 200,
      tokensSaida: 10,
      tokensCache: 5,
      custoEstimadoMicrodolares: null,
      estimativa: true,
    });
    expect(valor.avisos).toEqual([AVISO_ESTIMATIVA, AVISO_SEM_CUSTO]);
  });

  test("intervalo soma tudo; custo só aparece quando todas as linhas têm", async () => {
    const { db, somar, chamar } = montar();
    somar("2026-10-08", "ferramenta", 100);
    somar("2026-10-09", "ferramenta", 200);
    db.exec("UPDATE uso_ia SET custo_estimado_microdolares = 1500");
    const valor = ((await chamar({ de: "2026-10-01", ate: "2026-10-09" })) as { valor: Valor }).valor;
    expect(valor.total).toEqual({
      tokensEntrada: 300,
      tokensSaida: 20,
      tokensCache: 10,
      custoEstimadoMicrodolares: 3000,
      estimativa: false,
    });
    expect(valor.avisos).toEqual([]);

    db.exec("UPDATE uso_ia SET custo_estimado_microdolares = NULL WHERE dia = '2026-10-08'");
    const parcial = ((await chamar({ de: "2026-10-01", ate: "2026-10-09" })) as { valor: Valor }).valor;
    expect(parcial.total.custoEstimadoMicrodolares).toBeNull();
    expect(parcial.avisos).toEqual([AVISO_SEM_CUSTO]);

    const vazio = ((await chamar({ de: "2026-09-01", ate: "2026-09-02" })) as { valor: Valor }).valor;
    expect(vazio).toMatchObject({ linhas: [], avisos: [], total: { custoEstimadoMicrodolares: null } });
  });

  test("datas invertidas, intervalo longo e formato errado voltam ao modelo como erro", async () => {
    const { chamar } = montar();
    expect(await chamar({ de: "2026-10-09", ate: "2026-10-01" })).toEqual({
      ok: false,
      erro: "uso.por_dia falhou: o primeiro dia precisa vir antes do último",
    });
    expect(await chamar({ de: "2026-01-01", ate: "2026-10-09" })).toEqual({
      ok: false,
      erro: `uso.por_dia falhou: consulte no máximo ${DIAS_MAXIMO} dias por vez`,
    });
    expect(await chamar({ de: "9/10" })).toMatchObject({ ok: false });
  });
});
