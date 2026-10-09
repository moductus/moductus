import { describe, expect, test } from "vitest";
import { z } from "zod";
import { capacidade, ferramenta, nomeParaModelo, oferecida } from "./ferramenta.ts";

const lancar = ferramenta({
  nome: "financas.lancar",
  descricao: "Registra um gasto ou receita",
  entrada: z.object({
    valorCentavos: z.number().int(),
    descricao: z.string().min(1),
    categoria: z.string().optional(),
    parcelas: z.number().int().positive().default(1),
    itens: z.array(z.object({ nome: z.string(), valorCentavos: z.number() })).optional(),
  }),
  efeito: "interno",
  executar: (entrada) => ({ gravado: entrada }),
});

describe("ferramenta()", () => {
  test("gera o JSON Schema da entrada como as APIs pedem", () => {
    expect(lancar.esquema).toEqual({
      type: "object",
      properties: {
        valorCentavos: expect.objectContaining({ type: "integer" }),
        descricao: { type: "string", minLength: 1 },
        categoria: { type: "string" },
        parcelas: expect.objectContaining({ type: "integer", default: 1 }),
        itens: expect.objectContaining({ type: "array" }),
      },
      // O que tem padrão é opcional para o modelo.
      required: ["valorCentavos", "descricao"],
    });
    expect(lancar.esquema).not.toHaveProperty("$schema");
  });

  test("o modelo vê o nome sem ponto, e a lista /capacidades vê o do catálogo", () => {
    expect(lancar.nomeModelo).toBe("financas__lancar");
    expect(nomeParaModelo("arquivos.ler_texto")).toBe("arquivos__ler_texto");
    expect(oferecida(lancar)).toEqual({
      nome: "financas__lancar",
      descricao: "Registra um gasto ou receita",
      esquema: lancar.esquema,
    });
    expect(capacidade(lancar)).toEqual({
      nome: "financas.lancar",
      descricao: "Registra um gasto ou receita",
      efeito: "interno",
    });
  });

  test("nome fora de dominio.acao, sem descrição ou com entrada sem JSON Schema falha ao declarar", () => {
    const base = { descricao: "x", entrada: z.object({}), efeito: "leitura" as const, executar: () => null };
    for (const nome of [
      "financas",
      "Financas.lancar",
      "financas.*",
      "financas.lancar.mais",
      "fin__ancas.lancar",
    ]) {
      expect(() => ferramenta({ ...base, nome }), nome).toThrow(/dominio\.acao/);
    }
    expect(() => ferramenta({ ...base, nome: "a.b", descricao: "  " })).toThrow(/descrição/);
    expect(() => ferramenta({ ...base, nome: `a.${"b".repeat(70)}` })).toThrow(/longo demais/);
    expect(() =>
      ferramenta({ ...base, nome: "agenda.marcar", entrada: z.object({ quando: z.date() }) }),
    ).toThrow(/agenda\.marcar.*JSON Schema/);
  });

  test("entrada válida volta como o Zod entende, com os padrões preenchidos", () => {
    expect(lancar.validar({ valorCentavos: 1250, descricao: "Almoço", sobra: true })).toEqual({
      ok: true,
      valor: { valorCentavos: 1250, descricao: "Almoço", parcelas: 1 },
    });
  });

  test("entrada inválida vira uma frase legível com cada campo", () => {
    const r = lancar.validar({
      valorCentavos: "12,50",
      parcelas: 0,
      itens: [{ nome: "pão", valorCentavos: "3" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toMatch(/^Entrada inválida para financas\.lancar\. /);
    expect(r.erro).toContain("valorCentavos: esperava um número, recebeu um texto");
    expect(r.erro).toContain("descricao: campo obrigatório");
    expect(r.erro).toContain("parcelas: precisa ser maior que 0");
    expect(r.erro).toContain("itens[0].valorCentavos: esperava um número");
    expect(r.erro).not.toContain("undefined");
  });

  test("limites saem em português do Brasil, com o tamanho certo", () => {
    const limites = ferramenta({
      nome: "notas.criar",
      descricao: "Cria uma nota",
      entrada: z.object({
        titulo: z.string().min(2).max(3),
        etiquetas: z.array(z.string()).min(1),
        prioridade: z.number().int().min(1).lt(5),
      }),
      efeito: "interno",
      executar: () => null,
    });
    const curto = limites.validar({ titulo: "a", etiquetas: [], prioridade: 0 });
    const longo = limites.validar({ titulo: "abcd", etiquetas: ["x"], prioridade: 5 });
    expect(curto).toEqual({
      ok: false,
      erro: "Entrada inválida para notas.criar. titulo: precisa ter pelo menos 2 caracteres; etiquetas: precisa ter pelo menos 1 item; prioridade: precisa ser pelo menos 1.",
    });
    expect(longo).toEqual({
      ok: false,
      erro: "Entrada inválida para notas.criar. titulo: pode ter no máximo 3 caracteres; prioridade: precisa ser menor que 5.",
    });
    expect(JSON.stringify([curto, longo])).not.toContain("Demasiado");
  });

  test("entrada que nem é objeto também explica", () => {
    const r = lancar.validar("gastei 12 reais");
    expect(r).toEqual({
      ok: false,
      erro: "Entrada inválida para financas.lancar. entrada: esperava um objeto, recebeu um texto.",
    });
  });
});
