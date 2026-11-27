import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CATEGORIA_TRANSFERENCIA, METODOS, type MudancaFinancas } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { abrirBanco } from "../../banco/conexao.ts";
import { MENSAGEM_ERRO_INTERNO } from "./canal.ts";
import { atendentesDosLancamentos } from "./canal-lancamentos.ts";
import { RepositorioCategorias, ServicoCategorias } from "./categorias.ts";
import { impressaoDoLancamento, RepositorioContas, ServicoContas } from "./contas.ts";
import {
  ErroDosLancamentos,
  MENSAGEM_CATEGORIA_ARQUIVADA,
  MENSAGEM_CATEGORIA_DE_TRANSFERENCIA,
  MENSAGEM_CONTA_ARQUIVADA,
  MENSAGEM_MOEDAS_DIFERENTES,
  MENSAGEM_NAO_ESTA_NA_LIXEIRA,
  MENSAGEM_PARCELA_MUDA_DE_CONTA,
  MENSAGEM_PARCELAS_SEM_VALOR,
  MENSAGEM_TRANSFERENCIA_SEM_CATEGORIA,
  mesmoDiaMesesDepois,
  RepositorioLancamentos,
  ServicoLancamentos,
} from "./lancamentos.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * Banco migrado de verdade, com as contas (F4-08) e as categorias (F4-10) reais ao lado, e um
 * relógio que anda 1 ms a cada leitura (UTC no CI, fuso fixo aqui).
 */
function montar(agora = "2026-11-10T15:00:00.000Z") {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-lancamentos-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta, { duravel: false });
  bancos.push(db);
  let ms = new Date(agora).getTime();
  const relogio = () => new Date(ms++);
  const eventos: MudancaFinancas[] = [];
  const avisos = { mudou: (m: MudancaFinancas) => eventos.push(m) };
  const fuso = () => "America/Sao_Paulo";
  const contas = new ServicoContas(new RepositorioContas(db), { lerFuso: fuso }, avisos, { agora: relogio });
  const categorias = new ServicoCategorias(new RepositorioCategorias(db), avisos, { agora: relogio });
  const servico = new ServicoLancamentos(
    new RepositorioLancamentos(db),
    { contas, categorias, lerFuso: fuso },
    avisos,
    { agora: relogio },
  );
  const corrente = contas.criarConta({ nome: "Nubank", tipo: "corrente" });
  const cartao = contas.criarConta({
    nome: "Cartão Nubank",
    tipo: "cartao",
    diaFechamento: 15,
    diaVencimento: 25,
    contaPagamentoId: corrente.id,
  });
  eventos.length = 0;
  return { db, servico, contas, categorias, eventos, corrente, cartao };
}

/** A resposta passa pelo schema de saída do contrato, como no canal. */
const confere = <M extends keyof typeof METODOS>(metodo: M, saida: unknown) => {
  const r = METODOS[metodo].saida.safeParse(saida);
  expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
};

const apagadoEm = (db: DatabaseSync, id: string) =>
  (db.prepare("SELECT apagado_em FROM lancamentos WHERE id = ?").get(id) as { apagado_em: string | null })
    .apagado_em;

describe("compra parcelada", () => {
  test("R$ 100,00 em 3 vezes no cartão dá 33,34 + 33,33 + 33,33 em três faturas seguidas", () => {
    const { servico, contas, cartao } = montar();
    const parcelas = servico.lancar({
      contaId: cartao.id,
      data: "2026-11-10",
      descricao: "Fone de ouvido",
      valorCentavos: -10_000,
      categoriaId: "compras",
      parcelas: 3,
    });
    confere("financas.lancar", parcelas);
    expect(parcelas.map((p) => p.valorCentavos)).toEqual([-3334, -3333, -3333]);
    expect(parcelas.map((p) => [p.parcelaNumero, p.parcelaTotal])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(new Set(parcelas.map((p) => p.compraId)).size).toBe(1);
    expect(parcelas[0]?.compraId).not.toBeNull();
    expect(parcelas.map((p) => p.data)).toEqual(["2026-11-10", "2026-12-10", "2027-01-10"]);

    const faturas = contas.faturas({ contaId: cartao.id });
    expect(faturas.map((f) => [f.mesReferencia, f.totalCentavos])).toEqual([
      ["2027-01", -3333],
      ["2026-12", -3333],
      ["2026-11", -3334],
    ]);
    expect(new Set(parcelas.map((p) => p.faturaId)).size).toBe(3);
    expect(parcelas.map((p) => p.faturaId)).toEqual(
      ["2026-11", "2026-12", "2027-01"].map((m) => faturas.find((f) => f.mesReferencia === m)?.id),
    );
  });

  test("a compra do dia do fechamento começa na fatura seguinte", () => {
    const { servico, contas, cartao } = montar();
    servico.lancar({
      contaId: cartao.id,
      data: "2026-11-15",
      descricao: "TV",
      valorCentavos: -20_000,
      parcelas: 2,
    });
    expect(
      contas
        .faturas({ contaId: cartao.id })
        .map((f) => f.mesReferencia)
        .sort(),
    ).toEqual(["2026-12", "2027-01"]);
  });

  test("fechamento dia 31 e compra dia 30: fevereiro não fica sem parcela, e cada data cai na própria fatura", () => {
    const { servico, contas } = montar();
    const pagadora = contas.criarConta({ nome: "Itaú", tipo: "corrente" });
    const cartao = contas.criarConta({
      nome: "Cartão Itaú",
      tipo: "cartao",
      diaFechamento: 31,
      diaVencimento: 8,
      contaPagamentoId: pagadora.id,
    });
    const parcelas = servico.lancar({
      contaId: cartao.id,
      data: "2026-01-30",
      descricao: "Geladeira",
      valorCentavos: -30_001,
      parcelas: 3,
    });
    const faturas = contas.faturas({ contaId: cartao.id });
    const mesDa = (faturaId: string | null) => faturas.find((f) => f.id === faturaId)?.mesReferencia;
    expect(parcelas.map((p) => mesDa(p.faturaId))).toEqual(["2026-01", "2026-02", "2026-03"]);
    // 30/02 não existe e 28/02 já é o fechamento: a parcela fica na véspera, dentro da fatura dela.
    expect(parcelas.map((p) => p.data)).toEqual(["2026-01-30", "2026-02-27", "2026-03-30"]);
    expect(parcelas.map((p) => p.valorCentavos)).toEqual([-10_001, -10_000, -10_000]);
    for (const p of parcelas) expect(contas.faturaDaCompra(cartao.id, p.data).id).toBe(p.faturaId);
  });

  test("fora do cartão, uma parcela por mês, sem fatura; o mês curto usa o último dia", () => {
    const { servico, corrente } = montar();
    const parcelas = servico.lancar({
      contaId: corrente.id,
      data: "2026-12-31",
      descricao: "Curso",
      valorCentavos: -900,
      parcelas: 3,
    });
    expect(parcelas.map((p) => [p.data, p.faturaId, p.valorCentavos])).toEqual([
      ["2026-12-31", null, -300],
      ["2027-01-31", null, -300],
      ["2027-02-28", null, -300],
    ]);
    expect(mesmoDiaMesesDepois("2027-12-31", 2)).toBe("2028-02-29");
  });

  test("valor que não chega a um centavo por parcela é recusado sem gravar nada", () => {
    const { db, servico, cartao } = montar();
    expect(() =>
      servico.lancar({
        contaId: cartao.id,
        data: "2026-11-10",
        descricao: "X",
        valorCentavos: -2,
        parcelas: 3,
      }),
    ).toThrow(MENSAGEM_PARCELAS_SEM_VALOR);
    expect(db.prepare("SELECT count(*) AS n FROM lancamentos").get()).toEqual({ n: 0 });
  });

  test("a descrição e a categoria novas de uma parcela valem para as outras; a conta só muda com a compra", () => {
    const { servico, cartao, corrente } = montar();
    const [p1, p2, p3] = servico.lancar({
      contaId: cartao.id,
      data: "2026-11-10",
      descricao: "Loja",
      valorCentavos: -9_000,
      parcelas: 3,
      categoriaId: null,
    });
    if (!p1 || !p2 || !p3) throw new Error("sem parcelas");
    const editado = servico.definirLancamento({
      id: p2.id,
      descricao: "Loja de móveis",
      categoriaId: "casa",
    });
    confere("financas.definirLancamento", editado);
    expect(editado.lancamentos.map((l) => [l.id, l.descricao, l.categoriaId])).toEqual([
      [p2.id, "Loja de móveis", "casa"],
      [p1.id, "Loja de móveis", "casa"],
      [p3.id, "Loja de móveis", "casa"],
    ]);
    expect(editado.propostaRegra).toBeNull();
    // O valor é só desta parcela.
    const valor = servico.definirLancamento({ id: p3.id, valorCentavos: -2_999 });
    expect(valor.lancamentos.map((l) => l.id)).toEqual([p3.id]);
    expect(() => servico.definirLancamento({ id: p1.id, contaId: corrente.id })).toThrow(
      MENSAGEM_PARCELA_MUDA_DE_CONTA,
    );
    const detalhe = servico.obterLancamento({ id: p1.id });
    confere("financas.obterLancamento", detalhe);
    expect(detalhe.parcelas.map((p) => p.id)).toEqual([p2.id, p3.id]);
  });
});

describe("transferência", () => {
  test("dois lados com o mesmo id, na categoria de transferência; o saldo sai de uma e entra na outra", () => {
    const { servico, contas, corrente, eventos } = montar();
    const poupanca = contas.criarConta({ nome: "Poupança", tipo: "poupanca" });
    eventos.length = 0;
    const lados = servico.transferir({
      deContaId: corrente.id,
      paraContaId: poupanca.id,
      data: "2026-11-10",
      valorCentavos: 50_000,
    });
    confere("financas.transferir", lados);
    const [saida, entrada] = lados;
    expect(saida).toMatchObject({ contaId: corrente.id, valorCentavos: -50_000 });
    expect(entrada).toMatchObject({ contaId: poupanca.id, valorCentavos: 50_000 });
    expect(saida?.transferenciaId).toBe(entrada?.transferenciaId);
    expect(lados.every((l) => l.categoriaId === CATEGORIA_TRANSFERENCIA && l.faturaId === null)).toBe(true);
    expect(saida?.descricao).toBe("Transferência de Nubank para Poupança");
    expect(contas.obterConta({ id: corrente.id }).saldoCentavos).toBe(-50_000);
    expect(contas.obterConta({ id: poupanca.id }).saldoCentavos).toBe(50_000);
    expect(eventos).toEqual([{ partes: ["lancamentos", "contas"], lancamentos: lados, apagados: [] }]);
    expect(servico.obterLancamento({ id: saida?.id ?? "" }).outroLado?.id).toBe(entrada?.id);
  });

  test("apagar um lado apaga os dois com a mesma marca, e restaurar um traz os dois", () => {
    const { db, servico, contas, corrente, eventos } = montar();
    const poupanca = contas.criarConta({ nome: "Poupança", tipo: "poupanca" });
    const [saida, entrada] = servico.transferir({
      deContaId: corrente.id,
      paraContaId: poupanca.id,
      data: "2026-11-10",
      valorCentavos: 1_000,
    });
    if (!saida || !entrada) throw new Error("sem lados");
    eventos.length = 0;
    const apagados = servico.apagarLancamento({ id: entrada.id });
    confere("financas.apagarLancamento", apagados);
    expect(new Set(apagados.ids)).toEqual(new Set([saida.id, entrada.id]));
    expect(apagadoEm(db, saida.id)).not.toBeNull();
    expect(apagadoEm(db, saida.id)).toBe(apagadoEm(db, entrada.id));
    expect(contas.obterConta({ id: corrente.id }).saldoCentavos).toBe(0);
    expect(eventos.at(-1)).toMatchObject({ partes: ["lancamentos", "contas"], apagados: apagados.ids });

    const restaurados = servico.restaurarLancamento({ id: saida.id });
    confere("financas.restaurarLancamento", restaurados);
    expect(new Set(restaurados.map((l) => l.id))).toEqual(new Set([saida.id, entrada.id]));
    expect(contas.obterConta({ id: poupanca.id }).saldoCentavos).toBe(1_000);
    expect(() => servico.restaurarLancamento({ id: saida.id })).toThrow(MENSAGEM_NAO_ESTA_NA_LIXEIRA);
  });

  test("editar a data ou o valor de um lado muda o outro; a categoria não sai da de transferência", () => {
    const { servico, contas, corrente } = montar();
    const poupanca = contas.criarConta({ nome: "Poupança", tipo: "poupanca" });
    const [saida, entrada] = servico.transferir({
      deContaId: corrente.id,
      paraContaId: poupanca.id,
      data: "2026-11-10",
      valorCentavos: 1_000,
      descricao: "Guardar",
    });
    if (!saida || !entrada) throw new Error("sem lados");
    const editado = servico.definirLancamento({ id: saida.id, valorCentavos: -2_500, data: "2026-11-11" });
    expect(editado.lancamentos.map((l) => [l.id, l.data, l.valorCentavos])).toEqual([
      [saida.id, "2026-11-11", -2_500],
      [entrada.id, "2026-11-11", 2_500],
    ]);
    // Descrição e notas são de cada lado.
    expect(servico.definirLancamento({ id: entrada.id, notas: "reserva" }).lancamentos).toHaveLength(1);
    expect(() => servico.definirLancamento({ id: saida.id, categoriaId: "mercado" })).toThrow(
      MENSAGEM_TRANSFERENCIA_SEM_CATEGORIA,
    );
  });

  test("contas de moedas diferentes não transferem; conta arquivada não recebe lançamento", () => {
    const { servico, contas, corrente } = montar();
    const dolar = contas.criarConta({ nome: "Wise", tipo: "corrente", moeda: "USD" });
    expect(() =>
      servico.transferir({
        deContaId: corrente.id,
        paraContaId: dolar.id,
        data: "2026-11-10",
        valorCentavos: 100,
      }),
    ).toThrow(MENSAGEM_MOEDAS_DIFERENTES);
    contas.definirConta({ id: dolar.id, ativa: false });
    expect(() =>
      servico.lancar({ contaId: dolar.id, data: "2026-11-10", descricao: "X", valorCentavos: -1 }),
    ).toThrow(MENSAGEM_CONTA_ARQUIVADA);
  });
});

describe("lançar e editar", () => {
  test("sem categoria no pedido, a regra categoriza e conta uma aplicação; `null` fica sem categoria", () => {
    const { servico, categorias, corrente } = montar();
    const regra = categorias.criarRegra({
      padrao: "IFOOD",
      tipoPadrao: "contem",
      categoriaId: "restaurantes",
    });
    const [comRegra] = servico.lancar({
      contaId: corrente.id,
      data: "2026-11-10",
      descricao: "iFood *Pizzaria",
      valorCentavos: -4_500,
    });
    expect(comRegra?.categoriaId).toBe("restaurantes");
    expect(categorias.regras().find((r) => r.id === regra.id)?.vezesAplicada).toBe(1);
    const [sem] = servico.lancar({
      contaId: corrente.id,
      data: "2026-11-10",
      descricao: "iFood *Pizzaria",
      valorCentavos: -4_500,
      categoriaId: null,
    });
    expect(sem?.categoriaId).toBeNull();
    expect(categorias.regras().find((r) => r.id === regra.id)?.vezesAplicada).toBe(1);
  });

  test("a categoria de transferência e a arquivada não servem para um lançamento comum", () => {
    const { servico, categorias, corrente } = montar();
    const base = { contaId: corrente.id, data: "2026-11-10", descricao: "X", valorCentavos: -100 };
    expect(() => servico.lancar({ ...base, categoriaId: CATEGORIA_TRANSFERENCIA })).toThrow(
      MENSAGEM_CATEGORIA_DE_TRANSFERENCIA,
    );
    categorias.definirCategoria({ id: "pets", arquivada: true });
    expect(() => servico.lancar({ ...base, categoriaId: "pets" })).toThrow(MENSAGEM_CATEGORIA_ARQUIVADA);
  });

  test("no cartão, a data nova leva o lançamento à fatura em que cai; sair do cartão tira a fatura", () => {
    const { servico, contas, cartao, corrente, eventos } = montar();
    const [compra] = servico.lancar({
      contaId: cartao.id,
      data: "2026-11-10",
      descricao: "Mercado",
      valorCentavos: -8_000,
    });
    if (!compra) throw new Error("sem compra");
    expect(eventos.at(-1)?.partes).toEqual(["lancamentos", "contas", "faturas"]);
    const [movido] = servico.definirLancamento({ id: compra.id, data: "2026-11-20" }).lancamentos;
    const dezembro = contas.faturas({ contaId: cartao.id }).find((f) => f.mesReferencia === "2026-12");
    expect(movido?.faturaId).toBe(dezembro?.id);
    expect(dezembro?.totalCentavos).toBe(-8_000);
    const [naConta] = servico.definirLancamento({ id: compra.id, contaId: corrente.id }).lancamentos;
    expect(naConta?.faturaId).toBeNull();
    expect(contas.faturas({ contaId: cartao.id }).every((f) => f.totalCentavos === 0)).toBe(true);
  });

  test("a impressão segue o lançado à mão; o importado guarda a de como veio do banco", () => {
    const { db, servico, corrente } = montar();
    const [manual] = servico.lancar({
      contaId: corrente.id,
      data: "2026-11-10",
      descricao: "X",
      valorCentavos: -100,
    });
    if (!manual) throw new Error("sem lançamento");
    servico.definirLancamento({ id: manual.id, valorCentavos: -150 });
    const impressao = (id: string) =>
      (db.prepare("SELECT impressao FROM lancamentos WHERE id = ?").get(id) as { impressao: string })
        .impressao;
    expect(impressao(manual.id)).toBe(impressaoDoLancamento(corrente.id, "2026-11-10", -150));

    const importado = importar(db, corrente.id, "MERCADO BOM PRECO 1234", -4_500);
    servico.definirLancamento({ id: importado, valorCentavos: -4_600 });
    expect(impressao(importado)).toBe(impressaoDoLancamento(corrente.id, "2026-11-05", -4_500));
  });

  test("trocar a categoria de um importado volta com a regra proposta", () => {
    const { db, servico, corrente } = montar();
    const importado = importar(db, corrente.id, "MERCADO BOM PRECO 1234", -4_500);
    const editado = servico.definirLancamento({ id: importado, categoriaId: "mercado" });
    expect(editado.propostaRegra).toEqual({
      padrao: "MERCADO BOM PRECO",
      tipoPadrao: "contem",
      categoriaId: "mercado",
    });
    expect(editado.lancamentos[0]).toMatchObject({ origem: "usuario", importacaoId: "imp1" });
  });

  test("apagar o pagamento da fatura a deixa sem pagamento; restaurar volta a paga", () => {
    const { servico, contas, cartao } = montar("2026-11-20T15:00:00.000Z");
    servico.lancar({ contaId: cartao.id, data: "2026-11-10", descricao: "Compra", valorCentavos: -5_000 });
    const fatura = contas.faturas({ contaId: cartao.id })[0];
    if (!fatura) throw new Error("sem fatura");
    const paga = contas.pagarFatura({ id: fatura.id });
    expect(paga.estado).toBe("paga");
    servico.apagarLancamento({ id: paga.pagamentoLancamentoId ?? "" });
    expect(contas.faturas({ contaId: cartao.id })[0]?.estado).toBe("fechada");
    servico.restaurarLancamento({ id: paga.pagamentoLancamentoId ?? "" });
    expect(contas.faturas({ contaId: cartao.id })[0]?.estado).toBe("paga");
  });

  test("restaurar não devolve categoria apagada", () => {
    const { db, servico, corrente } = montar();
    const [l] = servico.lancar({
      contaId: corrente.id,
      data: "2026-11-10",
      descricao: "Ração",
      valorCentavos: -100,
      categoriaId: "pets",
    });
    if (!l) throw new Error("sem lançamento");
    servico.apagarLancamento({ id: l.id });
    // Como se a categoria tivesse ido à lixeira por fora da área (a área de categorias já limpa).
    db.prepare("UPDATE categorias SET apagado_em = ? WHERE id = 'pets'").run("2026-11-10T16:00:00.000Z");
    const [restaurado] = servico.restaurarLancamento({ id: l.id });
    expect(restaurado?.categoriaId).toBeNull();
  });
});

describe("busca", () => {
  function comLancamentos() {
    const m = montar();
    const { servico, corrente, cartao, categorias } = m;
    const feira = categorias.criarCategoria({ nome: "Feira", tipo: "gasto", categoriaPaiId: "mercado" });
    const lancar = (
      contaId: string,
      data: string,
      descricao: string,
      valor: number,
      categoriaId: string | null,
    ) => servico.lancar({ contaId, data, descricao, valorCentavos: valor, categoriaId })[0]?.id ?? "";
    const ids = {
      acougue: lancar(corrente.id, "2026-10-03", "Açougue do Zé", -6_000, "mercado"),
      feira: lancar(corrente.id, "2026-10-04", "Feira de domingo", -3_000, feira.id),
      salario: lancar(corrente.id, "2026-10-05", "Salário", 500_000, "salario"),
      livro: lancar(cartao.id, "2026-10-05", "Livraria", -8_000, null),
      novembro: lancar(corrente.id, "2026-11-01", "ACOUGUE BOI GORDO", -2_000, "mercado"),
    };
    return { ...m, feira, ids };
  }

  test('"acougue" acha "Açougue" e "ACOUGUE", sem acento nem caixa', () => {
    const { servico, ids } = comLancamentos();
    const pagina = servico.lancamentos({ texto: "acougue" });
    confere("financas.lancamentos", pagina);
    expect(pagina.itens.map((l) => l.id)).toEqual([ids.novembro, ids.acougue]);
    expect(servico.lancamentos({ texto: "  açou  " }).itens).toHaveLength(2);
    expect(servico.lancamentos({ texto: "boi gordo" }).itens.map((l) => l.id)).toEqual([ids.novembro]);
  });

  test("a descrição original do banco também entra na busca", () => {
    const { db, servico, corrente } = comLancamentos();
    const importado = importar(db, corrente.id, "PAG*JOSEDASILVA", -1_000, "Pão");
    expect(servico.lancamentos({ texto: "josedasilva" }).itens.map((l) => l.id)).toEqual([importado]);
  });

  test("período pelo mês ou pelo intervalo, conta, categoria com as filhas e sem categoria", () => {
    const { servico, cartao, ids } = comLancamentos();
    const idsDe = (pedido: Parameters<typeof servico.lancamentos>[0]) =>
      servico.lancamentos(pedido).itens.map((l) => l.id);
    expect(idsDe({ mes: "2026-10" })).toEqual([ids.livro, ids.salario, ids.feira, ids.acougue]);
    expect(idsDe({ inicio: "2026-10-04", fim: "2026-10-05" })).toEqual([ids.livro, ids.salario, ids.feira]);
    expect(idsDe({ contaId: cartao.id })).toEqual([ids.livro]);
    expect(idsDe({ categoriaId: "mercado", mes: "2026-10" })).toEqual([ids.feira, ids.acougue]);
    expect(idsDe({ semCategoria: true })).toEqual([ids.livro]);
  });

  test("em páginas, do mais novo para o mais antigo, sem repetir nem pular", () => {
    const { servico, ids } = comLancamentos();
    const primeira = servico.lancamentos({ limite: 2 });
    expect(primeira.itens.map((l) => l.id)).toEqual([ids.novembro, ids.livro]);
    expect(primeira.proximo).toBe(ids.livro);
    const segunda = servico.lancamentos({ limite: 2, antesDe: primeira.proximo ?? "" });
    expect(segunda.itens.map((l) => l.id)).toEqual([ids.salario, ids.feira]);
    const terceira = servico.lancamentos({ limite: 2, antesDe: segunda.proximo ?? "" });
    expect(terceira).toEqual({ itens: [expect.objectContaining({ id: ids.acougue })], proximo: null });
  });

  test("o que está na lixeira não aparece", () => {
    const { servico, ids } = comLancamentos();
    servico.apagarLancamento({ id: ids.acougue });
    expect(servico.lancamentos({ texto: "acougue" }).itens.map((l) => l.id)).toEqual([ids.novembro]);
  });
});

describe("resumo do mês", () => {
  test("entradas, saídas e sobra sem transferências; outra moeda à parte; a mãe soma as filhas", () => {
    const { servico, contas, categorias, corrente, cartao } = montar("2026-10-20T15:00:00.000Z");
    const poupanca = contas.criarConta({ nome: "Poupança", tipo: "poupanca" });
    const dolar = contas.criarConta({ nome: "Wise", tipo: "corrente", moeda: "USD" });
    const feira = categorias.criarCategoria({ nome: "Feira", tipo: "gasto", categoriaPaiId: "mercado" });
    const lancar = (contaId: string, data: string, valor: number, categoriaId: string | null) =>
      servico.lancar({ contaId, data, descricao: "X", valorCentavos: valor, categoriaId });
    lancar(corrente.id, "2026-10-05", 500_000, "salario");
    lancar(corrente.id, "2026-10-06", -6_000, "mercado");
    lancar(corrente.id, "2026-10-07", -3_000, feira.id);
    lancar(cartao.id, "2026-10-08", -12_000, null);
    lancar(corrente.id, "2026-09-30", -99_999, "mercado");
    lancar(dolar.id, "2026-10-09", -1_500, "viagens");
    servico.transferir({
      deContaId: corrente.id,
      paraContaId: poupanca.id,
      data: "2026-10-10",
      valorCentavos: 70_000,
    });
    const fatura = contas.faturas({ contaId: cartao.id })[0];
    contas.pagarFatura({ id: fatura?.id ?? "", data: "2026-10-20" });

    const resumo = servico.resumo({});
    confere("financas.resumo", resumo);
    expect(resumo.mes).toBe("2026-10");
    expect(resumo.totais).toEqual({
      moeda: "BRL",
      entradasCentavos: 500_000,
      saidasCentavos: 21_000,
      sobraCentavos: 479_000,
    });
    expect(resumo.outrasMoedas).toEqual([
      { moeda: "USD", entradasCentavos: 0, saidasCentavos: 1_500, sobraCentavos: -1_500 },
    ]);
    expect(resumo.porCategoria).toEqual([
      { categoriaId: null, gastoCentavos: 12_000, lancamentos: 1 },
      { categoriaId: "mercado", gastoCentavos: 9_000, lancamentos: 2 },
      { categoriaId: feira.id, gastoCentavos: 3_000, lancamentos: 1 },
    ]);
    // As linhas de primeiro nível somam as saídas do mês.
    const primeiroNivel = resumo.porCategoria.filter((l) => l.categoriaId !== feira.id);
    expect(primeiroNivel.reduce((s, l) => s + l.gastoCentavos, 0)).toBe(resumo.totais.saidasCentavos);
  });

  test("mês sem lançamento volta zerado, sem inventar número", () => {
    const { servico } = montar();
    expect(servico.resumo({ mes: "2025-01" })).toEqual({
      mes: "2025-01",
      totais: { moeda: "BRL", entradasCentavos: 0, saidasCentavos: 0, sobraCentavos: 0 },
      outrasMoedas: [],
      porCategoria: [],
    });
  });
});

describe("canal", () => {
  test("erro da regra passa como veio; erro de dentro vira o texto genérico", () => {
    const { servico } = montar();
    const atendentes = atendentesDosLancamentos(servico);
    expect(() => atendentes["financas.obterLancamento"]({ id: "nao-existe" })).toThrow(ErroDosLancamentos);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(servico, "resumo").mockImplementation(() => {
      throw new Error("SQLITE_BUSY");
    });
    expect(() => atendentes["financas.resumo"]({})).toThrow(MENSAGEM_ERRO_INTERNO);
  });
});

/** Um lançamento que a importação trouxe, gravado direto no banco (a importação é a F4-19). */
function importar(db: DatabaseSync, contaId: string, original: string, valor: number, descricao = original) {
  db.prepare(
    `INSERT OR IGNORE INTO importacoes (id, conta_id, arquivo_nome, arquivo_hash, formato, estado)
     VALUES ('imp1', ?, 'extrato.ofx', ?, 'ofx', 'concluida')`,
  ).run(contaId, "a".repeat(64));
  const id = `imp-${original.length}-${valor}`;
  db.prepare(
    `INSERT INTO lancamentos (id, conta_id, data, descricao, descricao_original, valor_centavos, importacao_id,
       impressao, origem)
     VALUES (?, ?, '2026-11-05', ?, ?, ?, 'imp1', ?, 'importacao')`,
  ).run(id, contaId, descricao, original, valor, impressaoDoLancamento(contaId, "2026-11-05", valor));
  return id;
}
