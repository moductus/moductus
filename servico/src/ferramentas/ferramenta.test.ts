import { describe, expect, test } from "vitest";
import { z } from "zod";
import { DO_USUARIO } from "../banco/tabela.ts";
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
  desfazer: () => {},
  executar: (entrada) => ({ gravado: entrada }),
});

describe("ferramenta()", () => {
  test("ação externo sem o texto do cartão falha na declaração", () => {
    expect(() =>
      ferramenta({
        nome: "github.comentar",
        descricao: "Comenta num PR",
        entrada: z.object({}),
        efeito: "externo",
        executar: () => null,
      }),
    ).toThrow('ferramenta "github.comentar": ação externo precisa do texto do cartão de aprovação');
  });

  test("ação interno sem a função inversa falha na declaração; leitura e externo não aceitam uma", () => {
    const base = { descricao: "x", entrada: z.object({}), executar: () => null };
    expect(() => ferramenta({ ...base, nome: "tarefas.criar", efeito: "interno" })).toThrow(
      'ferramenta "tarefas.criar": ação interno precisa da função que a desfaz',
    );
    expect(() =>
      ferramenta({ ...base, nome: "tarefas.listar", efeito: "leitura", desfazer: () => null }),
    ).toThrow('ferramenta "tarefas.listar": só ação interno se desfaz pelo histórico');
    expect(() =>
      ferramenta({
        ...base,
        nome: "github.comentar",
        efeito: "externo",
        cartao: () => ({ descricao: "Vou comentar.", rotulo: "Comentar" }),
        desfazer: () => null,
      }),
    ).toThrow(/só ação interno se desfaz/);
  });

  test("a inversa recebe o resultado e o contexto, e precisa ser síncrona", () => {
    const recebido: unknown[] = [];
    const criar = ferramenta({
      nome: "tarefas.criar",
      descricao: "Cria uma tarefa",
      entrada: z.object({ titulo: z.string() }),
      efeito: "interno",
      executar: () => ({ id: "t1" }),
      desfazer: (resultado, ctx) => {
        recebido.push(resultado, ctx);
      },
    });
    const ler = ferramenta({
      nome: "tarefas.listar",
      descricao: "Lista",
      entrada: z.object({}),
      efeito: "leitura",
      executar: () => [],
    });
    const assincrona = ferramenta({
      nome: "tarefas.mover",
      descricao: "Move",
      entrada: z.object({}),
      efeito: "interno",
      executar: () => null,
      desfazer: async () => {},
    });
    expect([criar.desfazivel, ler.desfazivel]).toEqual([true, false]);

    const ctx = { chamadaId: "c1", agenteId: "alba", execucaoId: "e1", carimbo: DO_USUARIO };
    criar.desfazer({ id: "t1" }, ctx);
    expect(recebido).toEqual([{ id: "t1" }, ctx]);
    expect(() => ler.desfazer(null, ctx)).toThrow("tarefas.listar não se desfaz");
    // Terminaria fora da transação do histórico.
    expect(() => assincrona.desfazer(null, ctx)).toThrow("a inversa de tarefas.mover precisa ser síncrona");
  });

  test("o texto do cartão sai da entrada validada; fora de externo, null", () => {
    const comentar = ferramenta({
      nome: "github.comentar",
      descricao: "Comenta num PR",
      entrada: z.object({ pr: z.number().int() }),
      efeito: "externo",
      executar: () => null,
      cartao: ({ pr }) => ({ descricao: `Vou comentar no #${pr}.`, rotulo: `Comentar no #${pr}` }),
    });
    expect(comentar.cartao({ pr: 142 })).toEqual({
      descricao: "Vou comentar no #142.",
      rotulo: "Comentar no #142",
    });
    expect(lancar.cartao({ valorCentavos: 1, descricao: "x" })).toBeNull();
  });

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
      desfazer: () => {},
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
