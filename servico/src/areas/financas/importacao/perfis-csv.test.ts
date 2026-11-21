import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { migrar } from "../../../banco/migracoes.ts";
import { MIGRACOES } from "../../../migracoes/index.ts";
import { detectarCsv, ErroDoCsv, lerCsv, type MapeamentoCsv } from "./csv.ts";
import { PerfisCsv, type NovoPerfilCsv } from "./perfis-csv.ts";

const utf8 = (texto: string) => new TextEncoder().encode(texto);

function montar() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrar(db, MIGRACOES);
  let n = 0;
  const relogio = { agora: new Date("2026-11-21T12:00:00.000Z") };
  const perfis = new PerfisCsv(
    db,
    () => `perfil${++n}`,
    () => relogio.agora,
  );
  return { db, perfis, relogio };
}

const EXTRATO = [
  "DT_MOV;HISTORICO;VLR;SALDO",
  "01/09/2026;PIX RECEBIDO SALARIO;4.860,00;5.102,33",
  "02/09/2026;COMPRA CARTAO MERCADO BOM PRECO;-132,18;4.970,15",
].join("\r\n");

/** O que o mapeamento guiado manda salvar depois que o usuário confirma a detecção. */
function confirmado(): NovoPerfilCsv {
  const d = detectarCsv(utf8(EXTRATO));
  return {
    banco: "Cooperativa",
    tipoConta: "conta",
    mapeamento: d.mapeamento as MapeamentoCsv,
    separador: d.separador,
    formatoDecimal: d.formatoDecimal,
    formatoData: d.formatoData,
    codificacao: d.codificacao,
  };
}

describe("perfil do usuário", () => {
  test("salvo, reconhece o mesmo cabeçalho na próxima vez e lê o arquivo sem perguntar", () => {
    const { db, perfis } = montar();
    expect(perfis.reconhecer(detectarCsv(utf8(EXTRATO)).cabecalho, "conta")).toBeNull();

    const salvo = perfis.salvar(confirmado());
    expect(
      db
        .prepare(
          "SELECT banco, tipo_conta, formato, separador, formato_data, formato_decimal, codificacao, de_fabrica, origem FROM perfis_importacao",
        )
        .all(),
    ).toEqual([
      {
        banco: "Cooperativa",
        tipo_conta: "conta",
        formato: "csv",
        separador: ";",
        formato_data: "dd/mm/aaaa",
        formato_decimal: ",",
        codificacao: "utf-8",
        de_fabrica: 0,
        origem: "usuario",
      },
    ]);

    // Outro arquivo do mesmo banco, de outro mês.
    const proximo = "DT_MOV;HISTORICO;VLR;SALDO\r\n01/10/2026;PIX ENVIADO ALUGUEL;-1.450,00;3.420,25\r\n";
    const achado = perfis.reconhecer(detectarCsv(utf8(proximo)).cabecalho, "conta");
    expect(achado).toEqual(salvo);
    const lido = lerCsv(utf8(proximo), achado!.mapeamento, achado!);
    expect(lido.linhas.map((l) => [l.data, l.valorCentavos])).toEqual([["2026-10-01", -145000]]);
  });

  test("cabeçalho exato: outra ordem, outro título ou arquivo sem títulos não reconhecem", () => {
    const { perfis } = montar();
    perfis.salvar(confirmado());
    expect(perfis.reconhecer(["DT_MOV", "HISTORICO", "SALDO", "VLR"], "conta")).toBeNull();
    expect(perfis.reconhecer(["DT_MOV", "HISTORICO", "VALOR", "SALDO"], "conta")).toBeNull();
    expect(perfis.reconhecer(["dt_mov", "historico", "vlr", "saldo"], "conta")).toBeNull();
    expect(perfis.reconhecer(null, "conta")).toBeNull();
    expect(perfis.reconhecer(["DT_MOV", "HISTORICO", "VLR", "SALDO"], "cartao")).toBeNull();
    expect(perfis.reconhecer([" DT_MOV", "HISTORICO ", "VLR", "SALDO"], "conta")?.banco).toBe("Cooperativa");
  });

  test("salvar de novo o mesmo cabeçalho atualiza o perfil em vez de duplicar", () => {
    const { db, perfis, relogio } = montar();
    const primeiro = perfis.salvar(confirmado());
    relogio.agora = new Date("2026-11-22T12:00:00.000Z");
    const segundo = perfis.salvar({ ...confirmado(), banco: "Cooperativa Sul" });
    expect(segundo.id).toBe(primeiro.id);
    expect(db.prepare("SELECT id, banco, tipo_conta, atualizado_em FROM perfis_importacao").all()).toEqual([
      {
        id: primeiro.id,
        banco: "Cooperativa Sul",
        tipo_conta: "conta",
        atualizado_em: "2026-11-22T12:00:00.000Z",
      },
    ]);
  });

  test("conta e cartão com o mesmo cabeçalho convivem: cada tipo reconhece e atualiza o seu", () => {
    const { db, perfis } = montar();
    const cabecalho = ["DT_MOV", "HISTORICO", "VLR", "SALDO"];
    const base = confirmado();
    const conta = perfis.salvar(base);
    const cartao = perfis.salvar({
      ...base,
      tipoConta: "cartao",
      mapeamento: { ...base.mapeamento, valor: { modo: "sinal", coluna: 2, negativo: "entrada" } },
    });
    expect(cartao.id).not.toBe(conta.id);
    expect(perfis.reconhecer(cabecalho, "conta")?.id).toBe(conta.id);
    expect(perfis.reconhecer(cabecalho, "cartao")?.mapeamento.valor).toEqual({
      modo: "sinal",
      coluna: 2,
      negativo: "entrada",
    });

    // Salvar de novo o de cartão atualiza só ele.
    perfis.salvar({ ...base, banco: "Cooperativa Cartão", tipoConta: "cartao" });
    expect(
      db.prepare("SELECT id, banco, tipo_conta FROM perfis_importacao ORDER BY tipo_conta").all(),
    ).toEqual([
      { id: cartao.id, banco: "Cooperativa Cartão", tipo_conta: "cartao" },
      { id: conta.id, banco: "Cooperativa", tipo_conta: "conta" },
    ]);
  });

  test("o do usuário vence o de fábrica com o mesmo cabeçalho, que fica como estava", () => {
    const { db, perfis } = montar();
    const mapeamento = JSON.stringify({ ...confirmado().mapeamento, descricao: [1, 3] });
    db.prepare(
      "INSERT INTO perfis_importacao (id, banco, tipo_conta, formato, mapeamento, de_fabrica) VALUES ('fabrica', 'cooperativa', 'conta', 'csv', ?, 1)",
    ).run(mapeamento);
    expect(perfis.reconhecer(["DT_MOV", "HISTORICO", "VLR", "SALDO"], "conta")?.id).toBe("fabrica");

    const meu = perfis.salvar(confirmado());
    expect(meu.id).not.toBe("fabrica");
    expect(perfis.reconhecer(["DT_MOV", "HISTORICO", "VLR", "SALDO"], "conta")?.id).toBe(meu.id);
    expect(db.prepare("SELECT mapeamento FROM perfis_importacao WHERE id = 'fabrica'").get()).toEqual({
      mapeamento,
    });
  });

  test("perfil na lixeira, de OFX ou com mapeamento que não é de CSV fica de fora", () => {
    const { db, perfis } = montar();
    const salvo = perfis.salvar(confirmado());
    db.prepare(
      "INSERT INTO perfis_importacao (id, banco, tipo_conta, formato, mapeamento) VALUES ('velho', 'x', 'conta', 'csv', '{\"coluna\":1}')",
    ).run();
    db.prepare(
      "INSERT INTO perfis_importacao (id, banco, tipo_conta, formato, mapeamento) VALUES ('ofx', 'x', 'conta', 'ofx', ?)",
    ).run(JSON.stringify(confirmado().mapeamento));
    db.prepare("UPDATE perfis_importacao SET apagado_em = '2026-11-21T13:00:00.000Z' WHERE id = ?").run(
      salvo.id,
    );
    expect(perfis.reconhecer(["DT_MOV", "HISTORICO", "VLR", "SALDO"], "conta")).toBeNull();
  });

  test("perfil sem nome de banco é recusado", () => {
    const { perfis } = montar();
    expect(() => perfis.salvar({ ...confirmado(), banco: "  " })).toThrow(ErroDoCsv);
  });
});
