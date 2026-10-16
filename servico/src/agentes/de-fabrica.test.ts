import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { AGENTES_DE_FABRICA, ConfigAgente } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { RepositorioAgentes } from "./agentes.ts";
import { DE_FABRICA, definicaoDeFabrica, sqlDeFabrica } from "./de-fabrica.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

function bancoNovo() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-de-fabrica-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  return { db, repo: new RepositorioAgentes(db) };
}

/** O que a definição cobre, lido de um agente guardado. */
const daDefinicao = (a: ConfigAgente) => ({
  nome: a.nome,
  funcao: a.funcao,
  instrucoes: a.instrucoes,
  personagem: a.personagem,
  ferramentas: a.ferramentas,
  gatilhos: a.gatilhos,
  escoposMemoria: a.escoposMemoria,
});

describe("agentes de fábrica", () => {
  test("são os quatro do contrato, cada um válido como configuração", () => {
    expect(Object.keys(DE_FABRICA)).toEqual([...AGENTES_DE_FABRICA]);
    for (const id of AGENTES_DE_FABRICA) {
      const config = {
        ...DE_FABRICA[id],
        provedorId: null,
        provedorReservaId: null,
        tetoDiarioCentavos: null,
      };
      expect(ConfigAgente.safeParse(config).success, id).toBe(true);
    }
  });

  // Quem muda um de fábrica aqui sem uma migração que leve o banco junto quebra este teste.
  test("um banco novo, com todas as migrações, tem o time exatamente como está aqui", () => {
    const { repo } = bancoNovo();
    for (const id of AGENTES_DE_FABRICA) {
      const guardado = repo.agente(id);
      expect(guardado?.deFabrica, id).toBe(true);
      expect(daDefinicao(guardado!), id).toEqual(DE_FABRICA[id]);
    }
  });

  test("a definição só existe para os quatro", () => {
    expect(definicaoDeFabrica("tula")).toBe(DE_FABRICA.tula);
    expect(definicaoDeFabrica("zeca")).toBeNull();
    // Nada do protótipo do objeto passa por agente de fábrica.
    expect(definicaoDeFabrica("toString")).toBeNull();
  });

  test("o SQL de uma migração leva só os campos pedidos ao de fábrica, com a aspa dobrada", () => {
    const { db, repo } = bancoNovo();
    db.exec(`UPDATE agentes SET nome = 'Tulinha', instrucoes = 'D''Ávila', ferramentas = '[]',
               provedor_id = 'p1' WHERE id = 'tula'`);
    const sql = sqlDeFabrica("tula", ["instrucoes", "ferramentas"]);
    db.exec(sql);
    expect(repo.agente("tula")).toMatchObject({
      nome: "Tulinha",
      instrucoes: DE_FABRICA.tula.instrucoes,
      ferramentas: DE_FABRICA.tula.ferramentas,
      provedorId: "p1",
    });

    expect(sqlDeFabrica("alba", ["nome"])).toBe(
      "UPDATE agentes SET nome = 'Alba' WHERE id = 'alba' AND de_fabrica = 1;",
    );
    expect(() => sqlDeFabrica("alba", [])).toThrow("diga quais campos");
  });
});
