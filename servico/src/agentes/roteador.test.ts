import { describe, expect, test, vi } from "vitest";
import {
  apelidoDe,
  dividirEmTrechos,
  lerClassificacao,
  mencoes,
  porRegra,
  promptDoClassificador,
  Roteador,
  type AgenteRoteavel,
  type Classificador,
} from "./roteador.ts";

const TIME: AgenteRoteavel[] = [
  { id: "alba", nome: "Alba", funcao: "Cuida do seu dia", instrucoes: "Você é a Alba e cuida do dia a dia." },
  { id: "tula", nome: "Tula", funcao: "Cuida do seu dinheiro", instrucoes: "Você é a Tula. Nunca paga." },
  { id: "faina", nome: "Faina", funcao: "Faz o serviço pesado", instrucoes: "" },
  { id: "nuno", nome: "Nuno", funcao: "Fica de olho nas suas IAs e no seu código", instrucoes: "" },
];

/** Classificador que responde sempre o mesmo e guarda o que recebeu. */
function classificadorFixo(resposta: Awaited<ReturnType<Classificador>>) {
  return vi.fn<Classificador>(async () => resposta);
}

describe("menção", () => {
  test("o apelido é @ e o nome sem acento nem espaço", () => {
    expect(apelidoDe({ nome: "Faina" })).toBe("@faina");
    expect(apelidoDe({ nome: "Zé Ninguém" })).toBe("@zeninguem");
  });

  test("pelo apelido ou pelo id, sem repetir, na ordem do texto; e-mail não é menção", () => {
    const renomeada = [...TIME.slice(0, 3), { ...TIME[3]!, nome: "Nunão" }];
    expect(mencoes("@NUNAO e @tula, depois @nuno de novo", renomeada)).toEqual(["nuno", "tula"]);
    expect(mencoes("manda para gustavo@alba.com", TIME)).toEqual([]);
    expect(mencoes("@ninguem me ajuda", TIME)).toEqual([]);
  });
});

describe("regras", () => {
  test("valor em reais vai para a Tula", () => {
    for (const texto of ["45 reais de mercado", "paguei R$ 45", "R$1.200,00 no aluguel", "custou 1 real"]) {
      expect(porRegra(texto, TIME), texto).toEqual(["tula"]);
    }
    expect(porRegra("isso é realmente 2 vezes", TIME)).toEqual([]);
  });

  test("link de PR vai para o Nuno", () => {
    expect(porRegra("olha https://github.com/gustavo/moductus/pull/142", TIME)).toEqual(["nuno"]);
    expect(porRegra("o repositório github.com/gustavo/moductus", TIME)).toEqual([]);
  });

  test("arquivo ou pasta vai para a Faina", () => {
    for (const texto of [
      "abre C:\\Users\\gusta\\notas",
      "o que tem em ~/fotos",
      "lê o extrato.ofx",
      "limpa os Downloads",
      "joga na Área de Trabalho",
      "joga na area de trabalho",
      "LIMPA A ÁREA DE TRABALHO",
      "acha o arquivo do contrato",
    ]) {
      expect(porRegra(texto, TIME), texto).toEqual(["faina"]);
    }
    expect(porRegra("tenho algo amanhã cedo?", TIME)).toEqual([]);
  });

  test("um trecho com duas áreas vai aos dois; agente desligado não entra", () => {
    expect(porRegra("o setup.exe custou R$ 40", TIME)).toEqual(["tula", "faina"]);
    expect(porRegra("o setup.exe custou R$ 40", TIME.slice(0, 2))).toEqual(["tula"]);
  });

  test("trechos são frases e linhas; ponto de número e de link não corta", () => {
    expect(dividirEmTrechos("Paguei R$ 1.200,50. E o github.com/a/b/pull/3?\nOk")).toEqual([
      "Paguei R$ 1.200,50.",
      "E o github.com/a/b/pull/3?",
      "Ok",
    ]);
  });
});

describe("rotear", () => {
  test("menção manda a mensagem inteira a cada mencionado, sem classificar", async () => {
    const classificar = classificadorFixo([{ agenteId: "nuno", parte: null }]);
    const destinos = await new Roteador(classificar).rotear("@faina e @tula, R$ 40 no Downloads", TIME);
    expect(destinos).toEqual([
      { agenteId: "faina", parte: null },
      { agenteId: "tula", parte: null },
    ]);
    expect(classificar).not.toHaveBeenCalled();
  });

  test("regras que cobrem tudo dividem por trecho, sem classificar", async () => {
    const classificar = classificadorFixo([]);
    const destinos = await new Roteador(classificar).rotear(
      "Paguei R$ 45 no mercado. O CI do github.com/a/b/pull/142 quebrou?",
      TIME,
    );
    expect(destinos).toEqual([
      { agenteId: "tula", parte: "Paguei R$ 45 no mercado." },
      { agenteId: "nuno", parte: "O CI do github.com/a/b/pull/142 quebrou?" },
    ]);
    expect(classificar).not.toHaveBeenCalled();
  });

  test("sobrou trecho sem regra: o classificador vê a mensagem inteira e a regra prevalece", async () => {
    const texto = "Paguei R$ 45 no mercado. Me lembra de ligar pro banco amanhã às 15h.";
    const classificar = classificadorFixo([
      { agenteId: "tula", parte: "a parte errada" },
      { agenteId: "alba", parte: "Me lembra de ligar pro banco amanhã às 15h." },
    ]);
    const destinos = await new Roteador(classificar).rotear(texto, TIME, "tula");
    expect(classificar).toHaveBeenCalledWith({ texto, agentes: TIME, ultimoAResponder: "tula" });
    expect(destinos).toEqual([
      { agenteId: "tula", parte: "Paguei R$ 45 no mercado." },
      { agenteId: "alba", parte: "Me lembra de ligar pro banco amanhã às 15h." },
    ]);
  });

  test("dividida por regra entre dois, o trecho que o classificador não dá a ninguém vai à Alba", async () => {
    const texto = "Paguei R$ 45 no mercado. O CI do github.com/a/b/pull/142 quebrou? E amanhã cedo?";
    const esperado = [
      { agenteId: "tula", parte: "Paguei R$ 45 no mercado." },
      { agenteId: "nuno", parte: "O CI do github.com/a/b/pull/142 quebrou?" },
      { agenteId: "alba", parte: "E amanhã cedo?" },
    ];
    expect(await new Roteador(classificadorFixo([])).rotear(texto, TIME)).toEqual(esperado);
    expect(await new Roteador().rotear(texto, TIME)).toEqual(esperado);
    // O classificador que dá a sobra a quem a regra já escolheu põe o trecho na parte dele.
    const peloNuno = new Roteador(classificadorFixo([{ agenteId: "nuno", parte: null }]));
    expect(await peloNuno.rotear(texto, TIME)).toEqual([
      esperado[0],
      { agenteId: "nuno", parte: "O CI do github.com/a/b/pull/142 quebrou? E amanhã cedo?" },
    ]);
  });

  test("trecho solto que o classificador dá a quem a regra já escolheu não chama mais ninguém", async () => {
    const texto = "Paguei R$ 45 no mercado. Foi no débito.";
    const pelaTula = new Roteador(classificadorFixo([{ agenteId: "tula", parte: null }]));
    expect(await pelaTula.rotear(texto, TIME)).toEqual([{ agenteId: "tula", parte: null }]);
    // Sem classificador, ou sem resposta dele, a regra basta: a Alba só é padrão de quem não tem destino.
    expect(await new Roteador().rotear(texto, TIME)).toEqual([{ agenteId: "tula", parte: null }]);
    expect(await new Roteador(classificadorFixo([])).rotear(texto, TIME)).toEqual([
      { agenteId: "tula", parte: null },
    ]);
  });

  test("sem regra, o classificador divide a pergunta com duas áreas", async () => {
    const texto = "Quanto já foi de mercado este mês? E tenho algo amanhã cedo?";
    const classificar = classificadorFixo([
      { agenteId: "Tula", parte: "Quanto já foi de mercado este mês?" },
      { agenteId: "alba", parte: "E tenho algo amanhã cedo?" },
    ]);
    const destinos = await new Roteador(classificar).rotear(texto, TIME);
    expect(classificar).toHaveBeenCalledWith({ texto, agentes: TIME, ultimoAResponder: null });
    expect(destinos).toEqual([
      { agenteId: "tula", parte: "Quanto já foi de mercado este mês?" },
      { agenteId: "alba", parte: "E tenho algo amanhã cedo?" },
    ]);
  });

  test("um destino só leva a mensagem inteira", async () => {
    const classificar = classificadorFixo([{ agenteId: "tula", parte: "mercado" }]);
    expect(await new Roteador(classificar).rotear("Quanto foi de mercado?", TIME)).toEqual([
      { agenteId: "tula", parte: null },
    ]);
  });

  test("sem classificador, com ele falhando ou citando quem não existe, vai à Alba", async () => {
    const quebrado: Classificador = async () => {
      throw new Error("modelo fora");
    };
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const roteador of [
      new Roteador(),
      new Roteador(quebrado),
      new Roteador(classificadorFixo([{ agenteId: "zeca", parte: null }])),
      new Roteador(classificadorFixo([])),
    ]) {
      expect(await roteador.rotear("e amanhã?", TIME)).toEqual([{ agenteId: "alba", parte: null }]);
    }
    expect(erro).toHaveBeenCalledOnce();
    erro.mockRestore();
  });

  test("sem a Alba, o padrão é o primeiro do time; sem ninguém, não há quem responda", async () => {
    expect(await new Roteador().rotear("e amanhã?", TIME.slice(1))).toEqual([
      { agenteId: "tula", parte: null },
    ]);
    await expect(new Roteador().rotear("oi", [])).rejects.toThrow("nenhum agente");
  });
});

describe("classificador", () => {
  test("o prompt é curto, diz quem é cada um e quem falou por último", () => {
    const prompt = promptDoClassificador(TIME, "tula");
    expect(prompt).toContain("- tula: Tula, cuida do seu dinheiro. Você é a Tula.");
    expect(prompt).not.toContain("Nunca paga");
    expect(prompt).toContain("A última resposta da conversa foi de tula.");
    expect(prompt.length).toBeLessThan(1_000);
  });

  test("lê a lista com texto em volta; o que não for a lista é não sei", () => {
    expect(lerClassificacao('Claro: [{"agente":"tula","parte":"mercado"},{"agente":"alba"}] pronto')).toEqual(
      [
        { agenteId: "tula", parte: "mercado" },
        { agenteId: "alba", parte: null },
      ],
    );
    expect(lerClassificacao("tula")).toEqual([]);
    expect(lerClassificacao("[tula, alba]")).toEqual([]);
    expect(lerClassificacao('[{"quem":"tula"}]')).toEqual([]);
  });
});
