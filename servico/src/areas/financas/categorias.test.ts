import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { METODOS, PropostaRegra, type MudancaFinancas } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { abrirBanco } from "../../banco/conexao.ts";
import { limparLixeira } from "../../banco/lixeira.ts";
import {
  chaveDescricao,
  compararRegras,
  ErroDasCategorias,
  MENSAGEM_REGRA_NAO_ENCONTRADA,
  MENSAGEM_REGRA_REPETIDA,
  MENSAGEM_TEM_SUBCATEGORIAS,
  MENSAGEM_NOME_REPETIDO,
  MENSAGEM_REGEX_CATASTROFICA,
  MENSAGEM_REGEX_INVALIDA,
  MENSAGEM_REGEX_LENTA,
  MENSAGEM_REGEX_LONGA,
  MENSAGEM_REGEX_REFERENCIA,
  MENSAGEM_REGRA_DO_USUARIO,
  MENSAGEM_RESTAURAR_A_MAE,
  MENSAGEM_TIPO_DA_MAE,
  MENSAGEM_TRANSFERENCIA,
  MENSAGEM_UM_NIVEL,
  padraoDaDescricao,
  PRAZO_REGEX_MS,
  RepositorioCategorias,
  ServicoCategorias,
  temRepeticaoAninhada,
  validarRegex,
} from "./categorias.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const DA_TULA = { origem: "agente", agenteId: "tula", execucaoId: null } as const;

/**
 * Prazo de regex folgado para os testes que não são sobre o prazo: com a suíte inteira rodando, os
 * 50 ms de produção estouram por carga e tiram a regex boa do lote.
 */
const PRAZO_FOLGADO_MS = 2000;

/** Banco migrado de verdade (categorias semeadas) e um relógio que só anda quando o teste manda. */
function montar(prazoRegexMs = PRAZO_FOLGADO_MS) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-categorias-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta, { duravel: false });
  bancos.push(db);
  const relogio = { agora: new Date("2026-11-20T12:00:00.000Z") };
  const andar = (ms = 1000) => {
    relogio.agora = new Date(relogio.agora.getTime() + ms);
  };
  const eventos: MudancaFinancas[] = [];
  const servico = new ServicoCategorias(
    new RepositorioCategorias(db),
    { mudou: (m) => eventos.push(m) },
    { agora: () => relogio.agora, prazoRegexMs },
  );
  db.prepare("INSERT INTO contas (id, nome, tipo) VALUES ('nubank', 'Nubank', 'corrente')").run();
  db.prepare("INSERT INTO contas (id, nome, tipo) VALUES ('itau', 'Itaú', 'corrente')").run();
  let n = 0;
  /** Um lançamento direto no banco (a área de lançamentos é outra tarefa). */
  const lancar = (l: {
    conta?: string;
    data: string;
    descricao: string;
    categoria: string | null;
    valor?: number;
    original?: string;
  }) => {
    const id = `l${String(++n).padStart(3, "0")}`;
    const impressao = createHash("sha256").update(id).digest("hex");
    db.prepare(
      `INSERT INTO lancamentos (id, conta_id, data, descricao, descricao_original, valor_centavos, categoria_id, impressao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      l.conta ?? "nubank",
      l.data,
      l.descricao,
      l.original ?? null,
      l.valor ?? -1000,
      l.categoria,
      impressao,
    );
    return id;
  };
  return { db, servico, eventos, andar, lancar };
}

/** A resposta passa pelo schema de saída do contrato, como no canal. */
const confere = <M extends keyof typeof METODOS>(metodo: M, saida: unknown) => {
  const r = METODOS[metodo].saida.safeParse(saida);
  expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
};

const erroDaArea = (fazer: () => unknown, mensagem: string) => {
  expect(fazer).toThrow(ErroDasCategorias);
  expect(fazer).toThrow(mensagem);
};

describe("ordem das regras (ADR-0045)", () => {
  test("a regra do usuário vence a do agente, mesmo com padrão mais curto", () => {
    const { servico } = montar();
    servico.criarRegra(
      { padrao: "IFOOD RESTAURANTE", tipoPadrao: "contem", categoriaId: "mercado" },
      DA_TULA,
    );
    const doUsuario = servico.criarRegra({
      padrao: "IFOOD",
      tipoPadrao: "contem",
      categoriaId: "restaurantes",
    });
    const [c] = servico.categorizar([{ contaId: "nubank", descricao: "PAG*IFOOD RESTAURANTE 4412" }]);
    expect(c).toEqual({ categoriaId: "restaurantes", fonte: "regra", regraId: doUsuario.id });
    expect(servico.regras().map((r) => r.criadaPor)).toEqual(["usuario", "agente"]);
  });

  test("entre regras do mesmo autor, o padrão mais longo vence, qualquer que seja o tipo", () => {
    const { servico } = montar();
    servico.criarRegra({ padrao: "UBER", tipoPadrao: "comeca_com", categoriaId: "transporte" });
    const eats = servico.criarRegra({
      padrao: "UBER.*EATS",
      tipoPadrao: "regex",
      categoriaId: "restaurantes",
    });
    const [comida, corrida] = servico.categorizar([
      { contaId: "nubank", descricao: "UBER *EATS PENDING" },
      { contaId: "nubank", descricao: "UBER *TRIP HELP.UBER.COM" },
    ]);
    expect(comida).toMatchObject({ categoriaId: "restaurantes", regraId: eats.id });
    expect(corrida).toMatchObject({ categoriaId: "transporte", fonte: "regra" });
  });

  test("regra compara sem acento e sem caixa; comeca_com só pelo começo", () => {
    const { servico } = montar();
    servico.criarRegra({ padrao: "açougue", tipoPadrao: "contem", categoriaId: "mercado" });
    servico.criarRegra({ padrao: "Farmácia", tipoPadrao: "comeca_com", categoriaId: "saude" });
    const r = servico.categorizar([
      { contaId: "nubank", descricao: "ACOUGUE DO ZE" },
      { contaId: "nubank", descricao: "FARMACIA SAO JOAO" },
      { contaId: "nubank", descricao: "DROGARIA FARMACIA" },
    ]);
    expect(r.map((c) => c.categoriaId)).toEqual(["mercado", "saude", null]);
  });

  test("a regra vence o lançamento igual anterior, que vence o nada", () => {
    const { servico, lancar } = montar();
    lancar({ data: "2026-10-02", descricao: "PADARIA PAO QUENTE 001", categoria: "mercado" });
    lancar({ data: "2026-11-02", descricao: "PADARIA PAO QUENTE 002", categoria: "restaurantes" });
    lancar({ data: "2026-11-03", descricao: "POSTO SHELL", categoria: "outros_gastos" });
    servico.criarRegra({ padrao: "SHELL", tipoPadrao: "contem", categoriaId: "transporte" });
    const r = servico.categorizar([
      { contaId: "nubank", descricao: "Padaria Pão Quente 777" },
      { contaId: "nubank", descricao: "POSTO SHELL" },
      { contaId: "nubank", descricao: "LOJA NOVA" },
      { contaId: "itau", descricao: "PADARIA PAO QUENTE 003" },
    ]);
    expect(r).toEqual([
      // O mais recente da mesma conta empresta, com a descrição normalizada sem os números.
      { categoriaId: "restaurantes", fonte: "anterior", regraId: null },
      expect.objectContaining({ categoriaId: "transporte", fonte: "regra" }),
      { categoriaId: null, fonte: null, regraId: null },
      // Outra conta não empresta.
      { categoriaId: null, fonte: null, regraId: null },
    ]);
  });

  test("o empréstimo ignora lançamento na lixeira e categoria arquivada", () => {
    const { db, servico, lancar } = montar();
    const apagado = lancar({ data: "2026-11-05", descricao: "BANCA DO JOAO", categoria: "lazer" });
    lancar({ data: "2026-11-01", descricao: "BANCA DO JOAO", categoria: "compras" });
    db.prepare("UPDATE lancamentos SET apagado_em = '2026-11-06T00:00:00.000Z' WHERE id = ?").run(apagado);
    expect(servico.categorizar([{ contaId: "nubank", descricao: "BANCA DO JOAO" }])[0]?.categoriaId).toBe(
      "compras",
    );
    servico.definirCategoria({ id: "compras", arquivada: true });
    expect(
      servico.categorizar([{ contaId: "nubank", descricao: "BANCA DO JOAO" }])[0]?.categoriaId,
    ).toBeNull();
  });

  test("vezes_aplicada só conta o que foi lançado", () => {
    const { servico } = montar();
    const regra = servico.criarRegra({ padrao: "NETFLIX", tipoPadrao: "contem", categoriaId: "assinaturas" });
    const r = servico.categorizar([
      { contaId: "nubank", descricao: "NETFLIX.COM" },
      { contaId: "nubank", descricao: "NETFLIX.COM" },
    ]);
    expect(servico.regras()[0]?.vezesAplicada).toBe(0);
    servico.registrarAplicacoes(r.map((c) => c.regraId));
    servico.registrarAplicacoes([null]);
    const depois = servico.regras()[0];
    expect(depois?.vezesAplicada).toBe(2);
    expect(depois?.atualizadoEm).toBe(regra.atualizadoEm);
  });
});

describe("regex com limite de tamanho e de tempo", () => {
  test("regex catastrófica é recusada antes de gravar", () => {
    const { servico, db } = montar();
    for (const padrao of ["(A+)+$", "(.*)*X", "^(\\w{2,})+!", "((AB)*C)+"]) {
      erroDaArea(
        () => servico.criarRegra({ padrao, tipoPadrao: "regex", categoriaId: "mercado" }),
        MENSAGEM_REGEX_CATASTROFICA,
      );
    }
    expect(db.prepare("SELECT count(*) AS n FROM regras_categoria").get()).toEqual({ n: 0 });
  });

  test("a que escapa da leitura rasa cai na prova com prazo", () => {
    // Alternativas que se sobrepõem sob repetição: sem quantificador aninhado, mas exponencial.
    expect(temRepeticaoAninhada("^(A|A)*$")).toBe(false);
    erroDaArea(() => validarRegex("^(A|A)*$"), MENSAGEM_REGEX_LENTA);
  });

  test("tamanho, sintaxe e referência a grupo", () => {
    erroDaArea(() => validarRegex(`A${"B".repeat(100)}`), MENSAGEM_REGEX_LONGA);
    erroDaArea(() => validarRegex("(ABC"), MENSAGEM_REGEX_INVALIDA);
    erroDaArea(() => validarRegex("(A)\\1"), MENSAGEM_REGEX_REFERENCIA);
  });

  test("regex comum passa e compara contra a descrição normalizada", () => {
    const { servico } = montar();
    expect(temRepeticaoAninhada("^PAG\\*(IFOOD|RAPPI)")).toBe(false);
    expect(temRepeticaoAninhada("[(+)]+ABC")).toBe(false);
    servico.criarRegra({ padrao: "^PAG\\*(IFOOD|RAPPI)", tipoPadrao: "regex", categoriaId: "restaurantes" });
    const r = servico.categorizar([
      { contaId: "nubank", descricao: "pag*rappi são paulo" },
      { contaId: "nubank", descricao: "PAGAMENTO IFOOD" },
    ]);
    expect(r.map((c) => c.categoriaId)).toEqual(["restaurantes", null]);
  });

  test("regex gravada por outro caminho que trava conta como 'não bate', sem travar a categorização", () => {
    const { servico, db } = montar(PRAZO_REGEX_MS);
    servico.criarRegra({ padrao: "AAAA", tipoPadrao: "contem", categoriaId: "lazer" });
    db.prepare(
      `INSERT INTO regras_categoria (id, padrao, tipo_padrao, categoria_id) VALUES ('ruim', '^(A+)+$', 'regex', 'mercado')`,
    ).run();
    const erro = console.error;
    console.error = () => {};
    try {
      const inicio = performance.now();
      const [c] = servico.categorizar([{ contaId: "nubank", descricao: `${"A".repeat(40)}!` }]);
      expect(c?.categoriaId).toBe("lazer");
      expect(performance.now() - inicio).toBeLessThan(1000);
    } finally {
      console.error = erro;
    }
  });
});

describe("proposta de regra ao corrigir um importado", () => {
  const importado = {
    descricao: "MERCADO BOM PRECO 1234",
    descricaoOriginal: "MERCADO BOM PRECO 1234",
    importacaoId: "imp1",
    categoriaAntes: null,
    categoriaDepois: "mercado",
  };

  test("corrigir 'MERCADO BOM PRECO 1234' propõe 'contém MERCADO BOM PRECO', e a proposta aceita vira regra do usuário", () => {
    const { servico } = montar();
    const proposta = servico.proporRegra(importado);
    expect(proposta).toEqual({ padrao: "MERCADO BOM PRECO", tipoPadrao: "contem", categoriaId: "mercado" });
    expect(PropostaRegra.safeParse(proposta).success).toBe(true);
    const regra = servico.criarRegra(proposta!);
    expect(regra).toMatchObject({ criadaPor: "usuario", padrao: "MERCADO BOM PRECO" });
    expect(servico.categorizar([{ contaId: "itau", descricao: "MERCADO BOM PRECO 9876" }])[0]).toMatchObject({
      categoriaId: "mercado",
      fonte: "regra",
    });
  });

  test("não propõe para lançamento à mão, sem categoria, mesma categoria ou quando a regra que vence já dá", () => {
    const { servico } = montar();
    expect(servico.proporRegra({ ...importado, importacaoId: null })).toBeNull();
    expect(servico.proporRegra({ ...importado, categoriaDepois: null })).toBeNull();
    expect(servico.proporRegra({ ...importado, categoriaAntes: "mercado" })).toBeNull();
    expect(servico.proporRegra({ ...importado, descricaoOriginal: "1234 5678" })).toBeNull();
    servico.criarRegra({ padrao: "BOM PRECO", tipoPadrao: "contem", categoriaId: "mercado" });
    expect(servico.proporRegra(importado)).toBeNull();
    expect(servico.proporRegra({ ...importado, categoriaDepois: "casa" })).toMatchObject({
      categoriaId: "casa",
    });
  });

  test("o padrão é o começo da descrição normalizada até o primeiro número", () => {
    expect(padraoDaDescricao("Mercado Bom Preço 1234")).toBe("MERCADO BOM PRECO");
    expect(padraoDaDescricao("IFOOD*12345")).toBe("IFOOD");
    expect(padraoDaDescricao("UBER *TRIP 1234 SAO PAULO")).toBe("UBER *TRIP");
    expect(padraoDaDescricao("  netflix.com  ")).toBe("NETFLIX.COM");
    expect(chaveDescricao("Padaria  Pão Quente 777")).toBe("PADARIA PAO QUENTE");
  });

  test("a regra que o usuário aceita troca a da Tula com o mesmo padrão; a Tula não troca a do usuário", () => {
    const { servico } = montar();
    const daTula = servico.criarRegra(
      { padrao: "Bom Preco", tipoPadrao: "contem", categoriaId: "compras" },
      DA_TULA,
    );
    const aceita = servico.criarRegra({ padrao: "BOM PREÇO", tipoPadrao: "contem", categoriaId: "mercado" });
    expect(aceita.id).toBe(daTula.id);
    expect(aceita).toMatchObject({ criadaPor: "usuario", categoriaId: "mercado" });
    erroDaArea(
      () => servico.criarRegra({ padrao: "bom preco", tipoPadrao: "contem", categoriaId: "lazer" }, DA_TULA),
      MENSAGEM_REGRA_DO_USUARIO,
    );
    expect(servico.regras()).toHaveLength(1);
  });
});

describe("categorias de um nível", () => {
  test("cria subcategoria do mesmo tipo e lista a mãe seguida das filhas", () => {
    const { servico, eventos } = montar();
    const feira = servico.criarCategoria({ nome: "Feira", tipo: "gasto", categoriaPaiId: "mercado" });
    confere("financas.criarCategoria", feira);
    const lista = servico.categorias();
    confere("financas.categorias", lista);
    const ids = lista.map((c) => c.id);
    expect(ids.indexOf(feira.id)).toBe(ids.indexOf("mercado") + 1);
    expect(lista.at(-1)?.id).toBe("transferencia");
    expect(eventos.at(-1)).toEqual({ partes: ["categorias"], lancamentos: [], apagados: [] });
  });

  test("recusa neta, mãe de outro tipo, nome repetido entre irmãs e mexer na Transferência", () => {
    const { servico } = montar();
    const feira = servico.criarCategoria({ nome: "Feira", tipo: "gasto", categoriaPaiId: "mercado" });
    erroDaArea(
      () => servico.criarCategoria({ nome: "Hortifruti", tipo: "gasto", categoriaPaiId: feira.id }),
      MENSAGEM_UM_NIVEL,
    );
    erroDaArea(
      () => servico.definirCategoria({ id: "mercado", categoriaPaiId: "casa" }),
      MENSAGEM_TEM_SUBCATEGORIAS,
    );
    erroDaArea(() => servico.definirCategoria({ id: "casa", categoriaPaiId: feira.id }), MENSAGEM_UM_NIVEL);
    erroDaArea(
      () => servico.criarCategoria({ nome: "Bônus", tipo: "receita", categoriaPaiId: "mercado" }),
      MENSAGEM_TIPO_DA_MAE,
    );
    erroDaArea(() => servico.criarCategoria({ nome: "mercado", tipo: "gasto" }), MENSAGEM_NOME_REPETIDO);
    erroDaArea(
      () => servico.definirCategoria({ id: "transferencia", arquivada: true }),
      MENSAGEM_TRANSFERENCIA,
    );
    erroDaArea(() => servico.apagarCategoria({ id: "transferencia" }), MENSAGEM_TRANSFERENCIA);
  });

  test("categoria em uso pede confirmação; confirmada, vai à lixeira com subcategorias e regras e os lançamentos ficam sem categoria", () => {
    const { db, servico, lancar } = montar();
    const feira = servico.criarCategoria({ nome: "Feira", tipo: "gasto", categoriaPaiId: "mercado" });
    const regra = servico.criarRegra({ padrao: "HORTIFRUTI", tipoPadrao: "contem", categoriaId: feira.id });
    const regraMae = servico.criarRegra({ padrao: "ATACADAO", tipoPadrao: "contem", categoriaId: "mercado" });
    const l1 = lancar({ data: "2026-11-01", descricao: "ATACADAO", categoria: "mercado" });
    const l2 = lancar({ data: "2026-11-02", descricao: "HORTIFRUTI", categoria: feira.id });

    const pedido = servico.apagarCategoria({ id: "mercado" });
    expect(pedido).toEqual({ apagada: false, lancamentos: 2 });
    confere("financas.apagarCategoria", pedido);
    expect(servico.categorias().some((c) => c.id === "mercado")).toBe(true);

    const apagada = servico.apagarCategoria({ id: "mercado", confirmado: true });
    confere("financas.apagarCategoria", apagada);
    expect(apagada).toEqual({ apagada: true, ids: ["mercado", feira.id, ...[regra.id, regraMae.id].sort()] });
    expect(servico.categorias().some((c) => c.id === "mercado" || c.id === feira.id)).toBe(false);
    expect(servico.regras()).toEqual([]);
    const semCategoria = db
      .prepare("SELECT id FROM lancamentos WHERE categoria_id IS NULL ORDER BY id")
      .all() as { id: string }[];
    expect(semCategoria.map((l) => l.id)).toEqual([l1, l2]);
    expect(servico.categorizar([{ contaId: "nubank", descricao: "ATACADAO" }])[0]?.categoriaId).toBeNull();
  });

  test("restaurar traz a categoria com as subcategorias e regras que foram junto, e não as apagadas antes", () => {
    const { servico, andar } = montar();
    const feira = servico.criarCategoria({ nome: "Feira", tipo: "gasto", categoriaPaiId: "mercado" });
    const antes = servico.criarCategoria({ nome: "Empório", tipo: "gasto", categoriaPaiId: "mercado" });
    const regra = servico.criarRegra({ padrao: "HORTIFRUTI", tipoPadrao: "contem", categoriaId: feira.id });
    servico.apagarCategoria({ id: antes.id });
    andar();
    servico.apagarCategoria({ id: "mercado" });
    erroDaArea(() => servico.restaurarCategoria(feira.id), MENSAGEM_RESTAURAR_A_MAE);
    andar();
    const voltaram = servico.restaurarCategoria("mercado");
    expect(voltaram.map((c) => c.id).sort()).toEqual([feira.id, "mercado"].sort());
    expect(servico.regras().map((r) => r.id)).toEqual([regra.id]);
    expect(servico.categorias().some((c) => c.id === antes.id)).toBe(false);
  });

  test("a lixeira esvazia a categoria apagada com as regras depois de 30 dias", () => {
    const { db, servico } = montar();
    servico.criarRegra({ padrao: "IFOOD", tipoPadrao: "contem", categoriaId: "restaurantes" });
    servico.apagarCategoria({ id: "restaurantes" });
    limparLixeira(db, new Date("2026-12-21T12:00:00.000Z"));
    expect(db.prepare("SELECT count(*) AS n FROM categorias WHERE id = 'restaurantes'").get()).toEqual({
      n: 0,
    });
    expect(db.prepare("SELECT count(*) AS n FROM regras_categoria").get()).toEqual({ n: 0 });
  });
});

describe("volta 1 da revisão", () => {
  test("lançamento só na lixeira não pede confirmação e também fica sem categoria", () => {
    const { db, servico, lancar } = montar();
    const l = lancar({ data: "2026-11-01", descricao: "CINEMA", categoria: "lazer" });
    db.prepare("UPDATE lancamentos SET apagado_em = '2026-11-02T00:00:00.000Z' WHERE id = ?").run(l);
    const r = servico.apagarCategoria({ id: "lazer" });
    expect(r).toEqual({ apagada: true, ids: ["lazer"] });
    expect(db.prepare("SELECT categoria_id FROM lancamentos WHERE id = ?").get(l)).toEqual({
      categoria_id: null,
    });
  });

  test("regex lenta com dígitos e classe vazia é recusada", () => {
    expect(temRepeticaoAninhada("[]|(\\d+)+$")).toBe(true);
    expect(temRepeticaoAninhada("[^](A)")).toBe(false);
    for (const padrao of ["^(\\d|\\d)*$", "(\\w|\\d)*Z", "[]|(\\d+)+$"]) {
      expect(() => validarRegex(padrao)).toThrow(ErroDasCategorias);
    }
    erroDaArea(() => validarRegex("[]|(\\d+)+$"), MENSAGEM_REGEX_CATASTROFICA);
    erroDaArea(() => validarRegex("^(\\d|\\d)*$"), MENSAGEM_REGEX_LENTA);
  });

  test("a regex lenta ao lado de uma boa: a boa vale na segunda tentativa e a lenta sai do lote", () => {
    const { servico, db } = montar(PRAZO_REGEX_MS);
    db.prepare(
      `INSERT INTO regras_categoria (id, padrao, tipo_padrao, categoria_id, criado_em)
       VALUES ('lenta', '^(\\d|\\d)*$', 'regex', 'mercado', '2026-01-01T00:00:00.000Z'),
              ('boa', '^1+', 'regex', 'lazer', '2026-01-02T00:00:00.000Z')`,
    ).run();
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const inicio = performance.now();
      const r = servico.categorizar([
        { contaId: "nubank", descricao: `${"1".repeat(40)}!` },
        { contaId: "nubank", descricao: `${"1".repeat(41)}!` },
        { contaId: "nubank", descricao: "1111" },
      ]);
      expect(r.map((c) => c.regraId)).toEqual(["boa", "boa", "boa"]);
      expect(performance.now() - inicio).toBeLessThan(2000);
      expect(erros.mock.calls.filter(([m]) => String(m).includes("saiu do lote"))).toHaveLength(1);
    } finally {
      erros.mockRestore();
    }
  });

  test("a regex perde os acentos como a descrição comparada", () => {
    const { servico } = montar();
    servico.criarRegra({ padrao: "^AÇOUGUE", tipoPadrao: "regex", categoriaId: "mercado" });
    expect(servico.categorizar([{ contaId: "nubank", descricao: "Açougue do Zé" }])[0]?.categoriaId).toBe(
      "mercado",
    );
  });

  test("o tamanho da ordem é o do padrão normalizado", () => {
    const base = {
      tipoPadrao: "contem",
      categoriaId: "mercado",
      vezesAplicada: 0,
      criadaPor: "usuario",
      origem: "usuario",
      agenteId: null,
      execucaoId: null,
      criadoEm: "2026-11-20T12:00:00.000Z",
      atualizadoEm: "2026-11-20T12:00:00.000Z",
    } as const;
    const espacado = { ...base, id: "a", padrao: "A     B" };
    const curto = { ...base, id: "b", padrao: "ABCD" };
    expect([espacado, curto].sort(compararRegras).map((r) => r.id)).toEqual(["b", "a"]);
  });

  test("o igual anterior só empresta com 2 palavras ou 6 letras na chave", () => {
    const { servico, lancar } = montar();
    lancar({ data: "2026-11-01", descricao: "PIX 123", categoria: "lazer" });
    lancar({ data: "2026-11-01", descricao: "NETFLIX 1", categoria: "assinaturas" });
    const r = servico.categorizar([
      { contaId: "nubank", descricao: "PIX 999" },
      { contaId: "nubank", descricao: "NETFLIX 2" },
    ]);
    expect(r.map((c) => c.categoriaId)).toEqual([null, "assinaturas"]);
  });

  test("a proposta corta o padrão em até 200 caracteres numa fronteira de palavra", () => {
    const { servico } = montar();
    const descricao = `${"PALAVRA ".repeat(40)}FIM`;
    const proposta = servico.proporRegra({
      descricao,
      descricaoOriginal: null,
      importacaoId: "imp1",
      categoriaAntes: null,
      categoriaDepois: "mercado",
    });
    expect(proposta?.padrao.length).toBeLessThanOrEqual(200);
    expect(proposta?.padrao.endsWith("PALAVRA")).toBe(true);
    expect(PropostaRegra.safeParse(proposta).success).toBe(true);
  });

  test("restaurar recusa nome que colide com irmã viva e deixa na lixeira a regra repetida", () => {
    const { servico } = montar();
    const feira = servico.criarCategoria({ nome: "Feira", tipo: "gasto", categoriaPaiId: "mercado" });
    const regra = servico.criarRegra({ padrao: "HORTIFRUTI", tipoPadrao: "contem", categoriaId: feira.id });
    const outra = servico.criarRegra({ padrao: "SACOLAO", tipoPadrao: "contem", categoriaId: feira.id });
    servico.apagarCategoria({ id: feira.id });
    const nova = servico.criarCategoria({ nome: "feira", tipo: "gasto", categoriaPaiId: "mercado" });
    erroDaArea(() => servico.restaurarCategoria(feira.id), MENSAGEM_NOME_REPETIDO);
    servico.definirCategoria({ id: nova.id, nome: "Feira livre" });
    servico.criarRegra({ padrao: "hortifruti", tipoPadrao: "contem", categoriaId: "casa" });
    servico.restaurarCategoria(feira.id);
    const vivas = servico.regras().map((r) => r.id);
    expect(vivas).toContain(outra.id);
    expect(vivas).not.toContain(regra.id);
  });

  test("duas idas à lixeira no mesmo instante têm marcas diferentes e voltam separadas", () => {
    const { servico } = montar();
    servico.apagarCategoria({ id: "lazer" });
    servico.apagarCategoria({ id: "pets" });
    servico.restaurarCategoria("lazer");
    const ids = servico.categorias().map((c) => c.id);
    expect(ids).toContain("lazer");
    expect(ids).not.toContain("pets");
  });

  test("categoria com subcategoria na lixeira não vira subcategoria, com mensagem clara", () => {
    const { servico } = montar();
    const feira = servico.criarCategoria({ nome: "Feira", tipo: "gasto", categoriaPaiId: "mercado" });
    servico.apagarCategoria({ id: feira.id });
    erroDaArea(
      () => servico.definirCategoria({ id: "mercado", categoriaPaiId: "casa" }),
      MENSAGEM_TEM_SUBCATEGORIAS,
    );
  });

  test("definirRegra muda padrão e categoria, mantém quem ensinou e recusa padrão repetido; apagarRegra manda à lixeira", () => {
    const { servico, eventos } = montar();
    const daTula = servico.criarRegra(
      { padrao: "IFOOD", tipoPadrao: "contem", categoriaId: "mercado" },
      DA_TULA,
    );
    const outra = servico.criarRegra({ padrao: "RAPPI", tipoPadrao: "contem", categoriaId: "restaurantes" });
    const editada = servico.definirRegra({ id: daTula.id, padrao: "PAG*IFOOD", categoriaId: "restaurantes" });
    confere("financas.definirRegra", editada);
    expect(editada).toMatchObject({ padrao: "PAG*IFOOD", categoriaId: "restaurantes", criadaPor: "agente" });
    erroDaArea(() => servico.definirRegra({ id: daTula.id, padrao: "rappi" }), MENSAGEM_REGRA_REPETIDA);
    const apagados = servico.apagarRegra({ id: outra.id });
    confere("financas.apagarRegra", apagados);
    expect(apagados).toEqual({ ids: [outra.id] });
    expect(servico.regras().map((r) => r.id)).toEqual([daTula.id]);
    erroDaArea(() => servico.apagarRegra({ id: outra.id }), MENSAGEM_REGRA_NAO_ENCONTRADA);
    expect(eventos.at(-1)).toEqual({ partes: ["regras"], lancamentos: [], apagados: [] });
  });

  test("regra de categoria arquivada é pulada no categorizar", () => {
    const { servico } = montar();
    servico.criarRegra({ padrao: "STEAM", tipoPadrao: "contem", categoriaId: "lazer" });
    servico.criarRegra({ padrao: "STEAM GAMES", tipoPadrao: "contem", categoriaId: "compras" });
    servico.definirCategoria({ id: "compras", arquivada: true });
    expect(servico.categorizar([{ contaId: "nubank", descricao: "STEAM GAMES 123" }])[0]).toMatchObject({
      categoriaId: "lazer",
      fonte: "regra",
    });
  });
});
