import { describe, expect, test } from "vitest";
import {
  decodificar,
  detectarCsv,
  ErroDoCsv,
  lerCsv,
  lerData,
  lerValorCsv,
  separarRegistros,
  type MapeamentoCsv,
} from "./csv.ts";

const utf8 = (texto: string) => new TextEncoder().encode(texto);

/** Texto em Windows-1252, só com o que o teste usa (ASCII e acentos do Latin-1). */
const cp1252 = (texto: string) => Uint8Array.from([...texto].map((c) => c.charCodeAt(0)));

/** O extrato do quadro `ExtratoColunas`: ponto e vírgula, data brasileira, vírgula nos centavos. */
const COOPERATIVA = [
  "DT_MOV;HISTORICO;VLR;SALDO",
  "01/09/2026;PIX RECEBIDO SALARIO;4.860,00;5.102,33",
  "02/09/2026;COMPRA CARTAO MERCADO BOM PRECO;-132,18;4.970,15",
  "03/09/2026;DEB AUT INTERNET FIBRA;-99,90;4.870,25",
  "05/09/2026;PIX ENVIADO ALUGUEL;-1.450,00;3.420,25",
  "06/09/2026;COMPRA CARTAO FARMACIA CENTRO;-41,00;3.379,25",
].join("\r\n");

describe("registros pela RFC 4180", () => {
  test("aspas, aspas dobradas e quebra de linha dentro de aspas", () => {
    const texto = 'a;b;c\r\n"x;y";"diz ""oi""";"linha 1\r\nlinha 2"\r\n\r\nfim;;\r\n';
    expect(separarRegistros(texto, ";")).toEqual([
      { linha: 1, campos: ["a", "b", "c"] },
      { linha: 2, campos: ["x;y", 'diz "oi"', "linha 1\r\nlinha 2"] },
      { linha: 5, campos: ["fim", "", ""] },
    ]);
  });

  test("LF, CR sozinho e último registro sem quebra", () => {
    expect(separarRegistros("a,b\nc,d\re,f", ",").map((r) => r.campos)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
  });

  test("aspas que não fecham são erro legível, com a linha", () => {
    expect(() => separarRegistros('a;b\r\n1;"sem fim\r\n2;3', ";")).toThrow(
      new ErroDoCsv("Aspas abertas na linha 2 não fecham até o fim do arquivo."),
    );
  });
});

describe("data e valor", () => {
  test.each([
    ["01/09/2026", "dd/mm/aaaa", "2026-09-01"],
    ["1/9/2026 10:32", "dd/mm/aaaa", "2026-09-01"],
    ["2026-09-01", "aaaa-mm-dd", "2026-09-01"],
    ["2026-09-01T10:00:00-03:00", "aaaa-mm-dd", "2026-09-01"],
    ["01/09/26", "dd/mm/aa", "2026-09-01"],
    ["09/13/2026", "mm/dd/aaaa", "2026-09-13"],
    ["29/02/2028", "dd/mm/aaaa", "2028-02-29"],
  ] as const)("%s em %s é %s", (texto, formato, esperado) => {
    expect(lerData(texto, formato)).toBe(esperado);
  });

  test.each([
    ["31/02/2026", "dd/mm/aaaa"],
    ["13/13/2026", "dd/mm/aaaa"],
    ["2026-09-01", "dd/mm/aaaa"],
    ["ontem", "aaaa-mm-dd"],
  ] as const)("%s em %s é ilegível", (texto, formato) => {
    expect(lerData(texto, formato)).toBeNull();
  });

  test.each([
    ["4.860,00", ",", 486000],
    ["-132,18", ",", -13218],
    ["R$ -1.450,00", ",", -145000],
    ["-R$ 12", ",", -1200],
    ["45,9", ",", 4590],
    ["45,90 D", ",", -4590],
    ["45,90 C", ",", 4590],
    ["(41,00)", ",", -4100],
    ["41,00-", ",", -4100],
    ["12,3400", ",", 1234],
    ["0,00", ",", 0],
    ["1,234.56", ".", 123456],
    ["-99.9", ".", -9990],
    ["1234.50", ".", 123450],
  ] as const)("%s com decimal %s é %i centavos", (texto, decimal, esperado) => {
    expect(lerValorCsv(texto, decimal)).toBe(esperado);
  });

  test.each([
    ["", ","],
    ["abc", ","],
    ["45.90", ","],
    ["12,345", ","],
    ["1.23.4,00", ","],
    ["4.860,00", "."],
  ] as const)("%j com decimal %s é ilegível", (texto, decimal) => {
    expect(lerValorCsv(texto, decimal)).toBeNull();
  });
});

describe("codificação", () => {
  test("UTF-8 com BOM, e Windows-1252 quando os bytes não são UTF-8", () => {
    const comBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("Descrição")]);
    expect(decodificar(comBom)).toEqual({ texto: "Descrição", codificacao: "utf-8" });
    expect(decodificar(cp1252("AÇOUGUE SÃO JOÃO"))).toEqual({
      texto: "AÇOUGUE SÃO JOÃO",
      codificacao: "windows-1252",
    });
  });
});

describe("detecção por amostra", () => {
  test("o extrato do quadro: ponto e vírgula, data brasileira, vírgula nos centavos e a coluna de saldo de fora", () => {
    const d = detectarCsv(utf8(COOPERATIVA));
    expect(d).toMatchObject({
      codificacao: "utf-8",
      separador: ";",
      formatoDecimal: ",",
      formatoData: "dd/mm/aaaa",
      pularLinhas: 0,
      cabecalho: ["DT_MOV", "HISTORICO", "VLR", "SALDO"],
      colunas: 4,
      totalLinhas: 5,
      frase:
        "Detectei ponto e vírgula, datas no formato brasileiro e vírgula nos centavos. Confira só a coluna de valor: negativo é saída?",
      mapeamento: {
        pularLinhas: 0,
        cabecalho: ["DT_MOV", "HISTORICO", "VLR", "SALDO"],
        data: 0,
        descricao: [1],
        valor: { modo: "sinal", coluna: 2, negativo: "saida" },
        identificador: null,
      },
    });
    expect(d.amostra[0]).toEqual(["01/09/2026", "PIX RECEBIDO SALARIO", "4.860,00", "5.102,33"]);
  });

  test("vírgula, data ISO, ponto nos centavos, aspas e identificador pelo título", () => {
    const texto = [
      "Data,Valor,Identificador,Descrição",
      '2026-10-01,-45.90,6a1f-01,"Compra no débito - Padaria, Pão & Cia"',
      "2026-10-02,1200.00,6a1f-02,Transferência recebida",
      '2026-10-03,-8.5,6a1f-03,"Uber ""Pool"""',
    ].join("\n");
    const d = detectarCsv(utf8(texto));
    expect(d).toMatchObject({
      separador: ",",
      formatoDecimal: ".",
      formatoData: "aaaa-mm-dd",
      frase:
        "Detectei vírgula, datas no formato ano-mês-dia e ponto nos centavos. Confira só a coluna de valor: negativo é saída?",
      mapeamento: { data: 0, descricao: [3], valor: { modo: "sinal", coluna: 1 }, identificador: 2 },
    });
    const lido = lerCsv(utf8(texto), d.mapeamento as MapeamentoCsv);
    expect(lido.linhas).toEqual([
      {
        linha: 2,
        data: "2026-10-01",
        descricao: "Compra no débito - Padaria, Pão & Cia",
        valorCentavos: -4590,
        idExterno: "6a1f-01",
      },
      {
        linha: 3,
        data: "2026-10-02",
        descricao: "Transferência recebida",
        valorCentavos: 120000,
        idExterno: "6a1f-02",
      },
      { linha: 4, data: "2026-10-03", descricao: 'Uber "Pool"', valorCentavos: -850, idExterno: "6a1f-03" },
    ]);
  });

  test("colunas de débito e crédito, linhas do banco antes do cabeçalho e Windows-1252", () => {
    const texto = [
      "Extrato de conta corrente",
      "Agência: 0001;Conta: 12345-6",
      "Data;Lançamento;Débito;Crédito;Saldo",
      "01/09/2026;AÇOUGUE SÃO JOÃO;87,40;;1.000,00",
      "02/09/2026;SALÁRIO;;3.500,00;4.412,60",
    ].join("\r\n");
    const d = detectarCsv(cp1252(texto));
    expect(d).toMatchObject({
      codificacao: "windows-1252",
      separador: ";",
      pularLinhas: 2,
      cabecalho: ["Data", "Lançamento", "Débito", "Crédito", "Saldo"],
      frase:
        "Detectei ponto e vírgula, datas no formato brasileiro e vírgula nos centavos. Confira as colunas de débito e crédito.",
      mapeamento: {
        pularLinhas: 2,
        data: 0,
        descricao: [1],
        valor: { modo: "debito_credito", debito: 2, credito: 3 },
      },
    });
    const lido = lerCsv(cp1252(texto), d.mapeamento as MapeamentoCsv);
    expect(lido.linhas.map((l) => [l.linha, l.descricao, l.valorCentavos])).toEqual([
      [4, "AÇOUGUE SÃO JOÃO", -8740],
      [5, "SALÁRIO", 350000],
    ]);
    expect(lido.periodo).toEqual({ inicio: "2026-09-01", fim: "2026-09-02" });
  });

  test("tabulação e arquivo sem cabeçalho: sugere pelo conteúdo e não há título para reconhecer", () => {
    const texto = "05/10/2026\tMERCADO\t-50,00\n06/10/2026\tFARMACIA\t-20,00\n";
    const d = detectarCsv(utf8(texto));
    expect(d).toMatchObject({
      separador: "\t",
      cabecalho: null,
      totalLinhas: 2,
      mapeamento: { cabecalho: null, data: 0, descricao: [1], valor: { modo: "sinal", coluna: 2 } },
    });
    const lido = lerCsv(utf8(texto), d.mapeamento as MapeamentoCsv);
    expect(lido.linhas.map((l) => l.valorCentavos)).toEqual([-5000, -2000]);
  });

  test("dia e mês trocáveis ficam no brasileiro; dia acima de 12 no meio decide pelo americano", () => {
    const br = detectarCsv(utf8("Data;Descrição;Valor\n01/02/2026;A;-1,00\n03/04/2026;B;-2,00"));
    expect(br.formatoData).toBe("dd/mm/aaaa");
    const us = detectarCsv(utf8("Date,Description,Amount\n01/02/2026,A,-1.00\n01/13/2026,B,-2.00"));
    expect(us.formatoData).toBe("mm/dd/aaaa");
    expect(us.frase).toContain("datas no formato americano");
  });

  test("arquivo vazio ou sem colunas é erro legível", () => {
    expect(() => detectarCsv(utf8("  \r\n"))).toThrow(new ErroDoCsv("O arquivo está vazio."));
    expect(() => detectarCsv(utf8("uma linha só\noutra"))).toThrow(
      new ErroDoCsv("Não achei colunas neste arquivo: ele é mesmo um CSV?"),
    );
  });
});

describe("leitura com o perfil", () => {
  const mapeamento: MapeamentoCsv = {
    pularLinhas: 0,
    cabecalho: ["DT_MOV", "HISTORICO", "VLR", "SALDO"],
    data: 0,
    descricao: [1],
    valor: { modo: "sinal", coluna: 2, negativo: "saida" },
    identificador: null,
  };

  test("o perfil vence a amostra e o cartão inverte o sinal", () => {
    const cartao = "data;estabelecimento;valor\n2026-10-01;IFOOD;45.90\n2026-10-02;ESTORNO IFOOD;-45.90\n";
    const lido = lerCsv(
      utf8(cartao),
      {
        pularLinhas: 0,
        cabecalho: ["data", "estabelecimento", "valor"],
        data: 0,
        descricao: [1],
        valor: { modo: "sinal", coluna: 2, negativo: "entrada" },
        identificador: null,
      },
      { separador: ";", formatoDecimal: ".", formatoData: "aaaa-mm-dd", codificacao: "utf-8" },
    );
    expect(lido.linhas.map((l) => [l.descricao, l.valorCentavos])).toEqual([
      ["IFOOD", -4590],
      ["ESTORNO IFOOD", 4590],
    ]);
    expect(lido).toMatchObject({ separador: ";", formatoDecimal: ".", formatoData: "aaaa-mm-dd" });
  });

  test("linha com data ou valor ilegível vai para as recusadas e o resto entra", () => {
    const texto = [
      "DT_MOV;HISTORICO;VLR;SALDO",
      "01/09/2026;PIX RECEBIDO;10,00;1,00",
      "SALDO ANTERIOR;;;5.000,00",
      "02/09/2026;TARIFA;dez reais;0,00",
      "03/09/2026;;-1,00;0,00",
      "04/09/2026;COMPRA;-2,00;0,00",
    ].join("\n");
    const lido = lerCsv(utf8(texto), mapeamento);
    expect(lido.linhas.map((l) => l.linha)).toEqual([2, 6]);
    expect(lido.recusadas).toEqual([
      { linha: 3, motivo: 'data ilegível: "SALDO ANTERIOR"' },
      { linha: 4, motivo: 'valor ilegível: "dez reais"' },
      { linha: 5, motivo: "sem descrição" },
    ]);
  });

  test("descrição de duas colunas e quebra de linha dentro de aspas", () => {
    const texto = 'Data;Histórico;Complemento;Valor\n01/09/2026;"PIX\nENVIADO";"Maria  Silva";-50,00\n';
    const lido = lerCsv(utf8(texto), {
      pularLinhas: 0,
      cabecalho: ["Data", "Histórico", "Complemento", "Valor"],
      data: 0,
      descricao: [1, 2],
      valor: { modo: "sinal", coluna: 3, negativo: "saida" },
      identificador: null,
    });
    expect(lido.linhas).toEqual([
      {
        linha: 2,
        data: "2026-09-01",
        descricao: "PIX ENVIADO Maria Silva",
        valorCentavos: -5000,
        idExterno: null,
      },
    ]);
  });

  test("coluna além das do arquivo e arquivo só com cabeçalho são erro, sem lançar nada", () => {
    expect(() =>
      lerCsv(utf8(COOPERATIVA), { ...mapeamento, valor: { modo: "sinal", coluna: 7, negativo: "saida" } }),
    ).toThrow(new ErroDoCsv("O mapeamento usa a coluna 8, e o arquivo tem 4: confira o separador."));
    expect(() =>
      lerCsv(utf8("DT_MOV;HISTORICO;VLR;SALDO\r\n"), mapeamento, { formatoData: "dd/mm/aaaa" }),
    ).toThrow(new ErroDoCsv("O arquivo só tem o cabeçalho, sem lançamentos."));
  });

  test("preâmbulo menor ou maior que o do perfil: o cabeçalho é achado e nenhum lançamento some", () => {
    const comPreambulo = { ...mapeamento, pularLinhas: 2 };
    const corpo = [
      "DT_MOV;HISTORICO;VLR;SALDO",
      "01/09/2026;PIX RECEBIDO;10,00;1,00",
      "02/09/2026;COMPRA;-2,00;0,00",
    ];
    const menor = ["Extrato da conta", ...corpo].join("\n");
    const maior = ["Extrato da conta", "Agência 0001", "Conta 123-4", "Período: setembro", ...corpo].join(
      "\n",
    );
    for (const texto of [menor, maior, corpo.join("\n")]) {
      const lido = lerCsv(utf8(texto), comPreambulo);
      expect(lido.linhas.map((l) => [l.descricao, l.valorCentavos])).toEqual([
        ["PIX RECEBIDO", 1000],
        ["COMPRA", -200],
      ]);
      expect(lido.recusadas).toEqual([]);
    }
  });

  test("arquivo sem a linha de títulos do perfil é erro legível", () => {
    const texto = "Data;Descrição;Valor;Saldo\n01/09/2026;PIX;10,00;1,00\n";
    expect(() => lerCsv(utf8(texto), mapeamento)).toThrow(
      new ErroDoCsv("Não achei neste arquivo a linha de títulos do perfil: ele é mesmo deste banco?"),
    );
  });

  test("mais de 50 linhas trocáveis: o dia acima de 12 no fim decide o formato, no leitor e na detecção", () => {
    const linhas = Array.from(
      { length: 60 },
      (_, i) => `0${(i % 9) + 1}/0${(i % 9) + 1}/2026;LINHA ${i};-1,00;0,00`,
    );
    linhas.push("09/13/2026;ULTIMA;-1,00;0,00");
    const texto = ["DT_MOV;HISTORICO;VLR;SALDO", ...linhas].join("\n");
    expect(detectarCsv(utf8(texto)).formatoData).toBe("mm/dd/aaaa");
    const lido = lerCsv(utf8(texto), mapeamento, { separador: ";", formatoDecimal: "," });
    expect(lido.formatoData).toBe("mm/dd/aaaa");
    expect(lido.linhas).toHaveLength(61);
    expect(lido.linhas.at(-1)?.data).toBe("2026-09-13");
  });

  test("com a coluna conhecida, vale o formato que lê mais células, mesmo com muita linha ilegível", () => {
    const texto = [
      "DT_MOV;HISTORICO;VLR;SALDO",
      "01/09/2026;PIX;10,00;1,00",
      "SALDO;;;0,00",
      "TOTAL;;;0,00",
      "RESUMO;;;0,00",
    ].join("\n");
    const lido = lerCsv(utf8(texto), mapeamento, { separador: ";", formatoDecimal: "," });
    expect(lido.formatoData).toBe("dd/mm/aaaa");
    expect(lido.linhas.map((l) => l.descricao)).toEqual(["PIX"]);
    expect(lido.recusadas.map((r) => r.linha)).toEqual([3, 4, 5]);
  });

  test("o extrato do quadro sai em centavos, com o período", () => {
    const lido = lerCsv(utf8(COOPERATIVA), mapeamento);
    expect(lido.linhas.map((l) => l.valorCentavos)).toEqual([486000, -13218, -9990, -145000, -4100]);
    expect(lido.periodo).toEqual({ inicio: "2026-09-01", fim: "2026-09-06" });
    expect(lido.recusadas).toEqual([]);
  });
});
