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

  // Uma migração muda o de fábrica de ontem para o de hoje; quem personalizou fica como deixou.
  test("o SQL de uma migração só troca o campo que ainda está como veio de fábrica", () => {
    const { db, repo } = bancoNovo();
    const ANTIGAS = "Era a D'Ávila.";
    // A Tula no de fábrica antigo nas ferramentas (com espaço no JSON) e personalizada nas
    // instruções; a Alba no de fábrica antigo nas instruções, com aspa.
    db.exec(`UPDATE agentes SET nome = 'Tulinha', instrucoes = 'Do meu jeito.',
               ferramentas = '[ "financas.*" ]', provedor_id = 'p1' WHERE id = 'tula'`);
    db.exec(`UPDATE agentes SET instrucoes = 'Era a D''Ávila.' WHERE id = 'alba'`);

    db.exec(sqlDeFabrica("tula", { instrucoes: ANTIGAS, ferramentas: ["financas.*"] }));
    db.exec(sqlDeFabrica("alba", { instrucoes: ANTIGAS }));

    expect(repo.agente("tula")).toMatchObject({
      nome: "Tulinha",
      instrucoes: "Do meu jeito.",
      ferramentas: DE_FABRICA.tula.ferramentas,
      provedorId: "p1",
    });
    expect(repo.agente("alba")?.instrucoes).toBe(DE_FABRICA.alba.instrucoes);
  });

  test("o SQL tem um UPDATE por campo, com a condição do valor antigo", () => {
    expect(sqlDeFabrica("alba", { nome: "Albinha" })).toBe(
      "UPDATE agentes SET nome = 'Alba' WHERE id = 'alba' AND de_fabrica = 1 AND nome = 'Albinha';",
    );
    expect(sqlDeFabrica("nuno", { funcao: "Olha o código", gatilhos: [{ tipo: "horario", hora: "08:00" }] }))
      .toBe(`UPDATE agentes SET funcao = 'Fica de olho nas suas IAs e no seu código' WHERE id = 'nuno' AND de_fabrica = 1 AND funcao = 'Olha o código';
UPDATE agentes SET gatilhos = '[]' WHERE id = 'nuno' AND de_fabrica = 1 AND json(gatilhos) = json('[{"tipo":"horario","hora":"08:00"}]');`);
    expect(() => sqlDeFabrica("alba", {})).toThrow("diga quais campos");
    expect(() => sqlDeFabrica("alba", { nome: "Alba" })).toThrow("nome já é esse");
  });
});
