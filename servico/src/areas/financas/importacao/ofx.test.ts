import { describe, expect, test } from "vitest";
import { ErroDoOfx, lerOfx, lerValorOfx, MENSAGEM_CORTADO, MENSAGEM_NAO_E_OFX } from "./ofx.ts";

/** Texto em bytes 1252: do U+0000 ao U+00FF, o byte é o próprio código (os acentos do pt-BR). */
function em1252(texto: string): Uint8Array {
  return Uint8Array.from(texto, (c) => {
    const codigo = c.charCodeAt(0);
    if (codigo > 0xff) throw new Error(`Fora do 1252 da fixture: ${c}`);
    return codigo;
  });
}

const emUtf8 = (texto: string): Uint8Array => new TextEncoder().encode(texto);

/** OFX 1.02 em SGML, como os bancos daqui exportam: sem fechar as folhas, 1252, fuso BRT. */
const SGML_CONTA = [
  "OFXHEADER:100",
  "DATA:OFXSGML",
  "VERSION:102",
  "SECURITY:NONE",
  "ENCODING:USASCII",
  "CHARSET:1252",
  "COMPRESSION:NONE",
  "OLDFILEUID:NONE",
  "NEWFILEUID:NONE",
  "",
  "<OFX>",
  "<SIGNONMSGSRSV1>",
  "<SONRS>",
  "<STATUS>",
  "<CODE>0",
  "<SEVERITY>INFO",
  "</STATUS>",
  "<DTSERVER>20251105083000[-3:BRT]",
  "<LANGUAGE>POR",
  "<FI>",
  "<ORG>Banco Fictício",
  "<FID>0341",
  "</FI>",
  "</SONRS>",
  "</SIGNONMSGSRSV1>",
  "<BANKMSGSRSV1>",
  "<STMTTRNRS>",
  "<TRNUID>1",
  "<STATUS>",
  "<CODE>0",
  "<SEVERITY>INFO",
  "</STATUS>",
  "<STMTRS>",
  "<CURDEF>BRL",
  "<BANKACCTFROM>",
  "<BANKID>0341",
  "<BRANCHID>1234",
  "<ACCTID>56789-0",
  "<ACCTTYPE>CHECKING",
  "</BANKACCTFROM>",
  "<BANKTRANLIST>",
  "<DTSTART>20251001000000[-3:BRT]",
  "<DTEND>20251031235959[-3:BRT]",
  "<STMTTRN>",
  "<TRNTYPE>DEBIT",
  "<DTPOSTED>20251031220000[-3:BRT]",
  "<TRNAMT>-45,90",
  "<FITID>20251031001",
  "<CHECKNUM>000123",
  "<MEMO>Padaria São João",
  "</STMTTRN>",
  "<STMTTRN>",
  "<TRNTYPE>CREDIT",
  "<DTPOSTED>20251015",
  "<TRNAMT>1500.00",
  "<FITID>20251015002",
  "<NAME>Salário",
  "<MEMO>Salário",
  "</STMTTRN>",
  "<STMTTRN>",
  "<TRNTYPE>PAYMENT",
  "<DTPOSTED>20251020120000",
  "<TRNAMT>-1.234,56",
  "<FITID>20251020003",
  "<NAME>Aluguel & Condomínio",
  "<MEMO>Ref. outubro",
  "</STMTTRN>",
  "</BANKTRANLIST>",
  "<LEDGERBAL>",
  "<BALAMT>8.219,54",
  "<DTASOF>20251031235959[-3:BRT]",
  "</LEDGERBAL>",
  "</STMTRS>",
  "</STMTTRNRS>",
  "</BANKMSGSRSV1>",
  "</OFX>",
  "",
];

/** OFX 2.11 em XML, UTF-8, com entidade escapada. */
const XML_CONTA = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <SIGNONMSGSRSV1>
    <SONRS>
      <STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
      <DTSERVER>20251105083000.000[-3:BRT]</DTSERVER>
      <LANGUAGE>POR</LANGUAGE>
      <FI><ORG>Cooperativa Exemplo</ORG><FID>756</FID></FI>
    </SONRS>
  </SIGNONMSGSRSV1>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <TRNUID>1</TRNUID>
      <STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
      <STMTRS>
        <CURDEF>BRL</CURDEF>
        <BANKACCTFROM>
          <BANKID>756</BANKID>
          <ACCTID>4321</ACCTID>
          <ACCTTYPE>SAVINGS</ACCTTYPE>
        </BANKACCTFROM>
        <BANKTRANLIST>
          <DTSTART>20251101</DTSTART>
          <DTEND>20251104</DTEND>
          <STMTTRN>
            <TRNTYPE>POS</TRNTYPE>
            <DTPOSTED>20251102100000.000[-3:BRT]</DTPOSTED>
            <TRNAMT>-89.10</TRNAMT>
            <FITID>A1</FITID>
            <NAME>Pão &amp; Café Ação</NAME>
          </STMTTRN>
          <STMTTRN>
            <TRNTYPE>XFER</TRNTYPE>
            <DTUSER>20251103</DTUSER>
            <TRNAMT>250</TRNAMT>
            <FITID>A2</FITID>
            <MEMO>Pix recebido &#8211; Maria</MEMO>
          </STMTTRN>
        </BANKTRANLIST>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>
`;

/** Fatura de cartão com uma compra só: o `ofx-js` devolve objeto, não lista. */
const SGML_CARTAO = [
  "OFXHEADER:100",
  "DATA:OFXSGML",
  "VERSION:102",
  "ENCODING:USASCII",
  "CHARSET:1252",
  "",
  "<OFX>",
  "<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20251105<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>",
  "<CREDITCARDMSGSRSV1>",
  "<CCSTMTTRNRS>",
  "<TRNUID>1",
  "<STATUS><CODE>0<SEVERITY>INFO</STATUS>",
  "<CCSTMTRS>",
  "<CURDEF>BRL",
  "<CCACCTFROM>",
  "<ACCTID>5555XXXXXXXX1234",
  "</CCACCTFROM>",
  "<BANKTRANLIST>",
  "<DTSTART>20251001",
  "<DTEND>20251031",
  "<STMTTRN>",
  "<TRNTYPE>DEBIT",
  "<DTPOSTED>20251012000000[-3:BRT]",
  "<TRNAMT>-312,40",
  "<FITID>CC1",
  "<MEMO>Farmácia Saúde 01/03",
  "</STMTTRN>",
  "</BANKTRANLIST>",
  "</CCSTMTRS>",
  "</CCSTMTTRNRS>",
  "</CREDITCARDMSGSRSV1>",
  "</OFX>",
  "",
];

describe("lerOfx", () => {
  test("SGML 1.02 em 1252: acentos, data literal com [-3:BRT], vírgula nos centavos e conta", () => {
    const arquivo = lerOfx(em1252(SGML_CONTA.join("\r\n")));
    expect(arquivo).toMatchObject({
      versao: "102",
      codificacao: "windows-1252",
      organizacao: "Banco Fictício",
      fid: "0341",
    });
    expect(arquivo.extratos).toHaveLength(1);
    const [extrato] = arquivo.extratos;
    expect(extrato).toMatchObject({
      tipo: "conta",
      banco: "0341",
      agencia: "1234",
      conta: "56789-0",
      tipoConta: "CHECKING",
      moeda: "BRL",
      periodo: { inicio: "2025-10-01", fim: "2025-10-31" },
      saldo: { valor: 821954, data: "2025-10-31" },
    });
    expect(extrato?.transacoes).toEqual([
      {
        fitid: "20251031001",
        // 22h de 31/10 em BRT é 1º/11 em UTC: fica a data do arquivo.
        data: "2025-10-31",
        valor: -4590,
        tipo: "DEBIT",
        nome: null,
        memo: "Padaria São João",
        descricao: "Padaria São João",
        documento: "000123",
      },
      {
        fitid: "20251015002",
        data: "2025-10-15",
        valor: 150000,
        tipo: "CREDIT",
        nome: "Salário",
        memo: "Salário",
        descricao: "Salário",
        documento: null,
      },
      {
        fitid: "20251020003",
        data: "2025-10-20",
        valor: -123456,
        tipo: "PAYMENT",
        nome: "Aluguel & Condomínio",
        memo: "Ref. outubro",
        descricao: "Aluguel & Condomínio · Ref. outubro",
        documento: null,
      },
    ]);
  });

  test("CR sem LF lê igual ao CRLF", () => {
    const comCrlf = lerOfx(em1252(SGML_CONTA.join("\r\n")));
    const soCr = lerOfx(em1252(SGML_CONTA.join("\r")));
    expect(soCr).toEqual(comCrlf);
    expect(soCr.versao).toBe("102");
  });

  test("XML 2.x em UTF-8 com &amp;, entidade numérica e DTUSER de reserva", () => {
    const arquivo = lerOfx(emUtf8(XML_CONTA));
    expect(arquivo).toMatchObject({
      versao: "211",
      codificacao: "utf-8",
      organizacao: "Cooperativa Exemplo",
      fid: "756",
    });
    const [extrato] = arquivo.extratos;
    expect(extrato).toMatchObject({
      tipo: "conta",
      banco: "756",
      agencia: null,
      conta: "4321",
      tipoConta: "SAVINGS",
      periodo: { inicio: "2025-11-01", fim: "2025-11-04" },
      saldo: null,
    });
    expect(extrato?.transacoes.map((t) => [t.data, t.valor, t.descricao])).toEqual([
      ["2025-11-02", -8910, "Pão & Café Ação"],
      ["2025-11-03", 25000, "Pix recebido – Maria"],
    ]);
  });

  test("BOM do UTF-8 sai antes de ler", () => {
    const comBom = new Uint8Array([0xef, 0xbb, 0xbf, ...emUtf8(XML_CONTA)]);
    expect(lerOfx(comBom)).toEqual(lerOfx(emUtf8(XML_CONTA)));
  });

  test("arquivo que diz UTF-8 e manda 1252 é lido como 1252", () => {
    const arquivo = lerOfx(em1252(XML_CONTA));
    expect(arquivo.codificacao).toBe("windows-1252");
    expect(arquivo.extratos[0]?.transacoes[0]?.descricao).toBe("Pão & Café Ação");
  });

  test("UTF-8 misturado com byte 1252 solto: o válido fica UTF-8, o solto vai pelo 1252", () => {
    const [antes = "", depois = ""] = XML_CONTA.split("Pão &amp; Café Ação");
    // "São" em UTF-8 válido seguido de 0xC9 ("É" no 1252) sozinho, que não forma sequência UTF-8.
    const misto = new Uint8Array([...emUtf8(`${antes}São `), 0xc9, ...emUtf8(` Ação${depois}`)]);
    const arquivo = lerOfx(misto);
    expect(arquivo.codificacao).toBe("windows-1252");
    expect(arquivo.extratos[0]?.transacoes[0]?.descricao).toBe("São É Ação");
  });

  test("rótulo de codificação vira o nome canônico", () => {
    const iso = SGML_CONTA.map((linha) => (linha === "CHARSET:1252" ? "CHARSET:8859-1" : linha));
    expect(lerOfx(em1252(iso.join("\r\n"))).codificacao).toBe("windows-1252");
    const utf8 = XML_CONTA.replace('encoding="UTF-8"', 'encoding="utf8"');
    expect(lerOfx(emUtf8(utf8)).codificacao).toBe("utf-8");
    const latin = XML_CONTA.replace('encoding="UTF-8"', 'encoding="ISO-8859-1"');
    const arquivo = lerOfx(em1252(latin));
    expect(arquivo.codificacao).toBe("windows-1252");
    expect(arquivo.extratos[0]?.transacoes[0]?.descricao).toBe("Pão & Café Ação");
  });

  test("codificação desconhecida é erro legível", () => {
    const estranha = XML_CONTA.replace('encoding="UTF-8"', 'encoding="x-inventada"');
    expect(() => lerOfx(emUtf8(estranha))).toThrow(
      new ErroDoOfx("O arquivo OFX usa uma codificação que não dá para ler: x-inventada."),
    );
  });

  test("cartão com uma transação só vira lista de uma, sem banco nem agência", () => {
    const arquivo = lerOfx(em1252(SGML_CARTAO.join("\r\n")));
    expect(arquivo.organizacao).toBeNull();
    expect(arquivo.extratos).toEqual([
      {
        tipo: "cartao",
        banco: null,
        agencia: null,
        conta: "5555XXXXXXXX1234",
        tipoConta: null,
        moeda: "BRL",
        periodo: { inicio: "2025-10-01", fim: "2025-10-31" },
        saldo: null,
        transacoes: [
          {
            fitid: "CC1",
            data: "2025-10-12",
            valor: -31240,
            tipo: "DEBIT",
            nome: null,
            memo: "Farmácia Saúde 01/03",
            descricao: "Farmácia Saúde 01/03",
            documento: null,
          },
        ],
      },
    ]);
  });

  test.each([
    ["SGML cortado no meio de uma transação", em1252(SGML_CONTA.join("\r\n").slice(0, 1200))],
    [
      "SGML cortado depois de fechar uma transação",
      em1252(SGML_CONTA.slice(0, SGML_CONTA.indexOf("</STMTTRN>") + 1).join("\r\n")),
    ],
    ["XML cortado", emUtf8(XML_CONTA.slice(0, XML_CONTA.indexOf("</BANKTRANLIST>")))],
  ])("%s vira erro legível, sem extrato pela metade", (_, bytes) => {
    expect(() => lerOfx(bytes)).toThrow(new ErroDoOfx(MENSAGEM_CORTADO));
  });

  test("arquivo que não é OFX diz isso", () => {
    expect(() => lerOfx(emUtf8("Data;Descrição;Valor\n01/10/2025;Mercado;-10,00\n"))).toThrow(
      new ErroDoOfx(MENSAGEM_NAO_E_OFX),
    );
    expect(() => lerOfx(new Uint8Array())).toThrow(new ErroDoOfx(MENSAGEM_NAO_E_OFX));
  });

  test("valor que não dá para ler recusa o arquivo inteiro, dizendo qual", () => {
    const comDefeito = SGML_CONTA.map((linha) => (linha === "<TRNAMT>1500.00" ? "<TRNAMT>12.345" : linha));
    expect(() => lerOfx(em1252(comDefeito.join("\r\n")))).toThrow(
      new ErroDoOfx('O valor "12.345" da transação de 15/10/2025 não deu para ler.'),
    );
  });

  test("transação sem data recusa o arquivo", () => {
    const semData = SGML_CONTA.filter((linha) => linha !== "<DTPOSTED>20251015");
    expect(() => lerOfx(em1252(semData.join("\r\n")))).toThrow(
      new ErroDoOfx("Uma transação do extrato está sem data (20251015002)."),
    );
  });

  test("data que não existe no calendário é recusada", () => {
    const dataRuim = SGML_CONTA.map((linha) =>
      linha === "<DTPOSTED>20251015" ? "<DTPOSTED>20250231" : linha,
    );
    expect(() => lerOfx(em1252(dataRuim.join("\r\n")))).toThrow(
      new ErroDoOfx('A data "20250231" de uma transação do extrato não deu para ler (20251015002).'),
    );
  });

  test("DTPOSTED que não é data recusa mesmo com DTUSER válido", () => {
    const comReserva = SGML_CONTA.flatMap((linha) =>
      linha === "<DTPOSTED>20251015" ? ["<DTPOSTED>2025-10-15", "<DTUSER>20251015"] : [linha],
    );
    expect(() => lerOfx(em1252(comReserva.join("\r\n")))).toThrow(
      new ErroDoOfx('A data "2025-10-15" de uma transação do extrato não deu para ler (20251015002).'),
    );
  });
});

describe("lerValorOfx", () => {
  test.each<[string, number | null]>([
    ["-45,90", -4590],
    ["-45.90", -4590],
    ["45.9", 4590],
    ["+10,00", 1000],
    ["100", 10000],
    ["-0.01", -1],
    ["-.5", -50],
    ["45.9000", 4590],
    ["-45.90000", -4590],
    ["  -12,30  ", -1230],
    ["1.234,56", 123456],
    ["-1.234,56", -123456],
    ["1234567.89", 123456789],
    // Um separador só com exatamente três casas: milhar ou decimal, na dúvida não entra.
    ["1.234", null],
    ["1.500", null],
    ["10.000", null],
    ["45.900", null],
    ["-1,500", null],
    // Quatro casas ou mais: só zero sobrando no fim.
    ["45.1230", null],
    ["1,234.56", null],
    ["45,", null],
    ["", null],
    ["abc", null],
    ["99999999999999999", null],
  ])("%s → %s", (bruto, centavos) => {
    expect(lerValorOfx(bruto)).toBe(centavos);
  });
});
