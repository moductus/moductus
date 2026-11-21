import { describe, expect, test } from "vitest";
import {
  LeituraExtrato,
  LinhaPrevia,
  MapeamentoCsv,
  PedidoConfirmarImportacao,
  PedidoPreviaImportacao,
  PerfilImportacao,
  PreviaImportacao,
  ProgressoImportacao,
} from "./importacao.ts";

const linha = {
  indice: 0,
  data: "2026-09-02",
  descricao: "Mercado Bom Preço",
  descricaoOriginal: "MERCADO BOM PRECO 1234",
  valorCentavos: -8790,
  idExterno: "N0001",
  situacao: "nova",
  incluir: true,
  categoriaId: "mercado",
  categoriaPor: "regra",
  casouCom: null,
  parcela: null,
};

const mapeamento = {
  pularLinhas: 0,
  cabecalho: ["Data", "Histórico", "Valor"],
  data: 0,
  descricao: [1],
  valor: { modo: "sinal", coluna: 2, negativo: "saida" },
  identificador: null,
};

describe("ler o extrato", () => {
  test("OFX traz os extratos com os últimos dígitos da conta; o mesmo arquivo diz quando já entrou", () => {
    const ofx = {
      leitor: "ofx",
      leituraId: "01KA0000000000000000000R01",
      arquivoNome: "nubank-setembro.ofx",
      formato: "ofx",
      jaImportado: { importacaoId: "01KA0000000000000000000I01", em: "2026-11-12T10:00:00.000Z" },
      versao: "102",
      extratos: [
        {
          indice: 0,
          tipo: "conta",
          banco: "0260",
          contaFinal: "4321",
          moeda: "BRL",
          periodo: { inicio: "2026-09-01", fim: "2026-09-30" },
          transacoes: 84,
          contaId: null,
        },
      ],
    };
    expect(LeituraExtrato.parse(ofx)).toEqual(ofx);
    expect(LeituraExtrato.safeParse({ ...ofx, formato: "csv" }).success).toBe(false);
    expect(LeituraExtrato.safeParse({ ...ofx, extratos: [] }).success).toBe(false);
  });

  test("CSV traz a detecção da amostra e o perfil reconhecido pelo cabeçalho", () => {
    const csv = {
      leitor: "csv",
      leituraId: "01KA0000000000000000000R02",
      arquivoNome: "extrato-cooperativa-set.csv",
      formato: "csv",
      jaImportado: null,
      perfilId: null,
      deteccao: {
        codificacao: "windows-1252",
        separador: ";",
        formatoDecimal: ",",
        formatoData: "dd/mm/aaaa",
        mapeamento,
        pularLinhas: 0,
        cabecalho: ["Data", "Histórico", "Valor"],
        colunas: 3,
        amostra: [["02/09/2026", "MERCADO", "-87,90"]],
        totalLinhas: 96,
        frase: "Detectei ponto e vírgula, datas no formato brasileiro e vírgula nos centavos.",
      },
    };
    expect(LeituraExtrato.parse(csv)).toEqual(csv);
  });

  test("o mapeamento do CSV é o do leitor: débito e crédito ou uma coluna com sinal", () => {
    expect(MapeamentoCsv.parse({ ...mapeamento, pularLinhas: undefined, identificador: undefined })).toEqual(
      mapeamento,
    );
    expect(
      MapeamentoCsv.safeParse({ ...mapeamento, valor: { modo: "debito_credito", debito: 2, credito: 3 } })
        .success,
    ).toBe(true);
    expect(MapeamentoCsv.safeParse({ ...mapeamento, descricao: [] }).success).toBe(false);
    expect(MapeamentoCsv.safeParse({ ...mapeamento, data: -1 }).success).toBe(false);
  });
});

describe("prévia e lançar", () => {
  test("a prévia vai para uma conta que existe ou uma nova, e o CSV é lido por perfil ou por colunas", () => {
    const base = { leituraId: "01KA0000000000000000000R02" };
    expect(PedidoPreviaImportacao.safeParse({ ...base, contaId: "c1" }).success).toBe(true);
    expect(PedidoPreviaImportacao.safeParse(base).success).toBe(false);
    expect(
      PedidoPreviaImportacao.safeParse({
        ...base,
        contaId: "c1",
        novaConta: { nome: "Coop", tipo: "corrente" },
      }).success,
    ).toBe(false);
    const csv = {
      mapeamento,
      separador: ";",
      formatoDecimal: ",",
      formatoData: "dd/mm/aaaa",
      codificacao: "utf-8",
    };
    expect(PedidoPreviaImportacao.safeParse({ ...base, contaId: "c1", perfilId: "p1", csv }).success).toBe(
      false,
    );
    expect(
      PedidoPreviaImportacao.safeParse({
        ...base,
        contaId: "c1",
        csv,
        salvarPerfil: { banco: "Cooperativa", tipoConta: "conta" },
      }).success,
    ).toBe(true);
    expect(
      PedidoPreviaImportacao.safeParse({
        ...base,
        contaId: "c1",
        salvarPerfil: { banco: "Cooperativa", tipoConta: "conta" },
      }).success,
    ).toBe(false);
  });

  test("a linha que casou diz com qual lançamento; categoria diz de onde veio", () => {
    expect(LinhaPrevia.parse(linha)).toEqual(linha);
    expect(LinhaPrevia.safeParse({ ...linha, situacao: "repetida", incluir: false }).success).toBe(false);
    expect(
      LinhaPrevia.safeParse({ ...linha, situacao: "possivel_repetida", incluir: false, casouCom: "l1" })
        .success,
    ).toBe(true);
    expect(LinhaPrevia.safeParse({ ...linha, categoriaPor: null }).success).toBe(false);
    expect(LinhaPrevia.safeParse({ ...linha, categoriaId: null, categoriaPor: null }).success).toBe(true);
  });

  test("sem modelo, a prévia sai com a sugestão marcada como sem modelo e as linhas sem categoria", () => {
    const previa = {
      importacaoId: "01KA0000000000000000000I02",
      contaId: "c1",
      arquivoNome: "nubank-setembro.ofx",
      formato: "ofx",
      periodo: { inicio: "2026-09-01", fim: "2026-09-30" },
      linhas: [{ ...linha, categoriaId: null, categoriaPor: null }],
      recusadas: [{ linha: 12, motivo: "data ilegível" }],
      novas: 1,
      repetidas: 0,
      possiveisRepetidas: 0,
      semCategoria: 1,
      entradasCentavos: 0,
      saidasCentavos: 8790,
      sobraCentavos: -8790,
      sugestao: "sem_modelo",
      frase: null,
      propostasRegra: [],
    };
    expect(PreviaImportacao.parse(previa)).toEqual(previa);
    expect(PreviaImportacao.safeParse({ ...previa, sugestao: "travou" }).success).toBe(false);
  });

  test("lançar leva só o que a tela mudou e as regras aceitas", () => {
    const pedido = {
      importacaoId: "01KA0000000000000000000I02",
      linhas: [
        { indice: 3, incluir: true },
        { indice: 7, categoriaId: null },
      ],
      regras: [{ padrao: "MERCADO BOM PRECO", tipoPadrao: "contem", categoriaId: "mercado" }],
    };
    expect(PedidoConfirmarImportacao.parse(pedido)).toEqual(pedido);
    expect(PedidoConfirmarImportacao.safeParse({ ...pedido, linhas: [{ indice: -1 }] }).success).toBe(false);
  });

  test("o progresso diz a etapa e quanto foi, sem total quando ainda não se sabe", () => {
    expect(ProgressoImportacao.safeParse({ id: "r1", etapa: "tula", feitos: 2, total: null }).success).toBe(
      true,
    );
    expect(ProgressoImportacao.safeParse({ id: "r1", etapa: "esperando", feitos: 0, total: 1 }).success).toBe(
      false,
    );
  });
});

describe("perfis", () => {
  test("o perfil do OFX não tem mapeamento; o do CSV tem as colunas", () => {
    const perfil = {
      id: "01KA0000000000000000000P01",
      banco: "Cooperativa",
      tipoConta: "conta",
      formato: "csv",
      mapeamento,
      separador: ";",
      formatoData: "dd/mm/aaaa",
      formatoDecimal: ",",
      codificacao: null,
      deFabrica: false,
      origem: "usuario",
      agenteId: null,
      execucaoId: null,
      criadoEm: "2026-11-21T12:00:00.000Z",
      atualizadoEm: "2026-11-21T12:00:00.000Z",
    };
    expect(PerfilImportacao.parse(perfil)).toEqual(perfil);
    expect(
      PerfilImportacao.safeParse({
        ...perfil,
        formato: "ofx",
        mapeamento: null,
        separador: null,
        formatoData: null,
      }).success,
    ).toBe(true);
    expect(PerfilImportacao.safeParse({ ...perfil, separador: "|" }).success).toBe(false);
  });
});
