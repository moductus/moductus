import { CamposCaptura, type TipoCaptura, TrechoReconhecido } from "@moductus/contrato";
import { describe, expect, test } from "vitest";
import { TAMANHO_DA_FRASE, entenderFrase } from "./frases.ts";
import { lerRecorrencia } from "./recorrencia.ts";
import { TempoDoDia } from "./tempo.ts";

const SP = "America/Sao_Paulo";
/** Quinta, 8 de outubro de 2026, 10:00 em São Paulo: o dia do quadro `AreaTarefas`. */
const AGORA = "2026-10-08T13:00:00.000Z";
const tempoEm = (iso: string, fuso = SP) =>
  new TempoDoDia(
    () => fuso,
    () => new Date(iso),
  );
const tempo = tempoEm(AGORA);

const LISTAS = [
  { id: "entrada", nome: "Entrada" },
  { id: "trabalho", nome: "Trabalho" },
  { id: "pessoal", nome: "Pessoal" },
  { id: "01VIAGEM", nome: "Viagem de dezembro" },
];

type Esperado = { tipo?: TipoCaptura; titulo: string } & Partial<Omit<CamposCaptura, "titulo">>;

const VAZIOS: Omit<CamposCaptura, "titulo"> = {
  dia: null,
  hora: null,
  duracaoMin: null,
  recorrencia: null,
  lembreteMinutosAntes: null,
  listaId: null,
  valorCentavos: null,
};

/** A tabela de frases do ADR-0034, com hoje = quinta, 08/10/2026, 10:00. */
const TABELA: [string, Esperado][] = [
  // As três do critério de pronto.
  ["ligar pro banco amanhã 15h", { titulo: "ligar pro banco", dia: "2026-10-09", hora: "15:00" }],
  [
    "beber água às 15h todo dia",
    { titulo: "beber água", dia: "2026-10-08", hora: "15:00", recorrencia: "FREQ=DAILY" },
  ],
  [
    "reunião com o contador quinta 10h",
    { tipo: "evento", titulo: "reunião com o contador", dia: "2026-10-15", hora: "10:00" },
  ],

  // Sem data: tarefa sem data.
  ["comprar pão", { titulo: "comprar pão" }],
  ["pagar a conta de luz", { titulo: "pagar a conta de luz" }],
  ["pedir segunda via do boleto", { titulo: "pedir segunda via do boleto" }],
  ["comprar 1/2 kg de carne", { titulo: "comprar 1/2 kg de carne" }],
  ["terminar as 3 tarefas do sprint", { titulo: "terminar as 3 tarefas do sprint" }],
  ["marcar consulta no dermatologista", { titulo: "marcar consulta no dermatologista" }],
  ["ir ao mercado às 25h", { titulo: "ir ao mercado às 25h" }],
  ["#casa limpar a calha", { titulo: "#casa limpar a calha" }],

  // Dias.
  ["enviar relatório sexta", { titulo: "enviar relatório", dia: "2026-10-09" }],
  ["enviar relatório na sexta-feira", { titulo: "enviar relatório", dia: "2026-10-09" }],
  ["revisar contrato até segunda", { titulo: "revisar contrato", dia: "2026-10-12" }],
  ["entregar o relatório na próxima terça", { titulo: "entregar o relatório", dia: "2026-10-13" }],
  ["ligar pra vó domingo", { titulo: "ligar pra vó", dia: "2026-10-11" }],
  ["ligar pro João depois de amanhã", { titulo: "ligar pro João", dia: "2026-10-10" }],
  ["pagar a segunda parcela na sexta", { titulo: "pagar a segunda parcela", dia: "2026-10-09" }],
  ["renovar passaporte 12/11", { titulo: "renovar passaporte", dia: "2026-11-12" }],
  ["entregar trabalho 03/10", { titulo: "entregar trabalho", dia: "2027-10-03" }],
  ["prova 15/12/2026", { titulo: "prova", dia: "2026-12-15" }],
  ["pagar IPTU dia 5", { titulo: "pagar IPTU", dia: "2026-11-05" }],
  ["pagar fatura do cartão até o dia 15", { titulo: "pagar fatura do cartão", dia: "2026-10-15" }],
  ["aniversário da Ana 25 de dezembro", { titulo: "aniversário da Ana", dia: "2026-12-25" }],
  // Evento sem dia e lembrete sem hora não se lançam: viram tarefa (volta 1, item 1).
  ["consulta 30/02", { titulo: "consulta 30/02" }],

  // Horas.
  ["ver o jogo hoje às 21h", { titulo: "ver o jogo", dia: "2026-10-08", hora: "21:00" }],
  ["ligar pro banco amanhã às 15 horas", { titulo: "ligar pro banco", dia: "2026-10-09", hora: "15:00" }],
  ["Ligar pro BANCO Amanhã 15H", { titulo: "Ligar pro BANCO", dia: "2026-10-09", hora: "15:00" }],
  ["ligar pro banco amanha 15h", { titulo: "ligar pro banco", dia: "2026-10-09", hora: "15:00" }],
  ["dentista amanhã às 3 da tarde", { titulo: "dentista", dia: "2026-10-09", hora: "15:00" }],
  ["ligar pra operadora às 4 da tarde", { titulo: "ligar pra operadora", dia: "2026-10-08", hora: "16:00" }],
  ["aula de violão terça 19h30", { titulo: "aula de violão", dia: "2026-10-13", hora: "19:30" }],
  [
    "levar o carro na revisão 15/10 às 8h",
    { titulo: "levar o carro na revisão", dia: "2026-10-15", hora: "08:00" },
  ],
  ["festa da firma 18 de dezembro às 19h", { titulo: "festa da firma", dia: "2026-12-18", hora: "19:00" }],
  ["reunião às 9h", { tipo: "evento", titulo: "reunião", dia: "2026-10-09", hora: "09:00" }],
  ["fazer backup hoje à noite", { titulo: "fazer backup", dia: "2026-10-08", hora: "19:00" }],
  ["hoje à noite às 8 jantar", { titulo: "jantar", dia: "2026-10-08", hora: "20:00" }],
  ["quinta, 10h, com o contador", { titulo: "com o contador", dia: "2026-10-15", hora: "10:00" }],
  ["levar o lixo pra fora à noite", { titulo: "levar o lixo pra fora", dia: "2026-10-08", hora: "19:00" }],
  [
    "almoço com o pessoal do trabalho meio-dia",
    { tipo: "evento", titulo: "almoço com o pessoal do trabalho", dia: "2026-10-08", hora: "12:00" },
  ],

  // Daqui a pouco.
  ["tirar o bolo do forno em 20 min", { titulo: "tirar o bolo do forno", dia: "2026-10-08", hora: "10:20" }],
  ["ligar pro síndico em 1h30", { titulo: "ligar pro síndico", dia: "2026-10-08", hora: "11:30" }],
  ["responder o e-mail em 2 dias", { titulo: "responder o e-mail", dia: "2026-10-10" }],

  // Duração.
  ["estudar inglês por 1 hora amanhã", { titulo: "estudar inglês", dia: "2026-10-09", duracaoMin: 60 }],
  [
    "reunião de planejamento das 14h às 16h",
    { tipo: "evento", titulo: "reunião de planejamento", dia: "2026-10-08", hora: "14:00", duracaoMin: 120 },
  ],
  ["das 23h à 1h plantão", { titulo: "plantão", dia: "2026-10-08", hora: "23:00", duracaoMin: 120 }],
  [
    "assistir aula de 14h a 15h30",
    { titulo: "assistir aula", dia: "2026-10-08", hora: "14:00", duracaoMin: 90 },
  ],
  [
    "call com o cliente amanhã 11h por 30 min",
    { tipo: "evento", titulo: "call com o cliente", dia: "2026-10-09", hora: "11:00", duracaoMin: 30 },
  ],

  // Repetição.
  [
    "academia toda segunda e quarta às 7h",
    { titulo: "academia", dia: "2026-10-12", hora: "07:00", recorrencia: "FREQ=WEEKLY;BYDAY=MO,WE" },
  ],
  [
    "regar as plantas toda semana",
    { titulo: "regar as plantas", dia: "2026-10-08", recorrencia: "FREQ=WEEKLY" },
  ],
  [
    "pagar aluguel todo dia 10",
    { titulo: "pagar aluguel", dia: "2026-10-10", recorrencia: "FREQ=MONTHLY;BYMONTHDAY=10" },
  ],
  [
    "separar comprovantes todo mês",
    { titulo: "separar comprovantes", dia: "2026-10-08", recorrencia: "FREQ=MONTHLY" },
  ],
  [
    "renovar seguro do carro todo ano",
    { titulo: "renovar seguro do carro", dia: "2026-10-08", recorrencia: "FREQ=YEARLY" },
  ],
  [
    "tomar vitamina todos os dias às 8h",
    { titulo: "tomar vitamina", dia: "2026-10-09", hora: "08:00", recorrencia: "FREQ=DAILY" },
  ],
  [
    "daily às 9h30 dias úteis",
    { titulo: "daily", dia: "2026-10-09", hora: "09:30", recorrencia: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  ],
  [
    "treino de segunda a sexta às 6h",
    { titulo: "treino", dia: "2026-10-09", hora: "06:00", recorrencia: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  ],
  ["faxina aos sábados", { titulo: "faxina", dia: "2026-10-10", recorrencia: "FREQ=WEEKLY;BYDAY=SA" }],
  [
    "academia nos fins de semana",
    { titulo: "academia", dia: "2026-10-10", recorrencia: "FREQ=WEEKLY;BYDAY=SA,SU" },
  ],
  [
    "trocar a água do filtro a cada 2 semanas",
    { titulo: "trocar a água do filtro", dia: "2026-10-08", recorrencia: "FREQ=WEEKLY;INTERVAL=2" },
  ],
  [
    "reunião de condomínio toda primeira segunda do mês às 19h",
    {
      tipo: "evento",
      titulo: "reunião de condomínio",
      dia: "2026-11-02",
      hora: "19:00",
      recorrencia: "FREQ=MONTHLY;BYDAY=1MO",
    },
  ],
  [
    "fechar o caixa toda última sexta",
    { titulo: "fechar o caixa", dia: "2026-10-30", recorrencia: "FREQ=MONTHLY;BYDAY=-1FR" },
  ],
  [
    "dia sim dia não tomar sol",
    { titulo: "tomar sol", dia: "2026-10-08", recorrencia: "FREQ=DAILY;INTERVAL=2" },
  ],
  [
    "meditar por 10 minutos todo dia de manhã",
    { titulo: "meditar", dia: "2026-10-09", hora: "09:00", duracaoMin: 10, recorrencia: "FREQ=DAILY" },
  ],

  // Lembrete.
  [
    "me lembra de tomar remédio às 22h",
    { tipo: "lembrete", titulo: "tomar remédio", dia: "2026-10-08", hora: "22:00" },
  ],
  [
    "lembrete: ligar pra mãe amanhã de manhã",
    { tipo: "lembrete", titulo: "ligar pra mãe", dia: "2026-10-09", hora: "09:00" },
  ],
  ["lembrar de comprar ração amanhã", { titulo: "comprar ração", dia: "2026-10-09" }],
  [
    "me avisa daqui a 2 horas de desligar o forno",
    { tipo: "lembrete", titulo: "desligar o forno", dia: "2026-10-08", hora: "12:00" },
  ],
  [
    "pagar boleto sexta 9h me lembra 1 dia antes",
    { titulo: "pagar boleto", dia: "2026-10-09", hora: "09:00", lembreteMinutosAntes: 1440 },
  ],
  [
    "reunião de equipe toda segunda às 10h com lembrete 15 min antes",
    {
      tipo: "evento",
      titulo: "reunião de equipe",
      dia: "2026-10-12",
      hora: "10:00",
      recorrencia: "FREQ=WEEKLY;BYDAY=MO",
      lembreteMinutosAntes: 15,
    },
  ],

  // Evento.
  [
    "consulta no dentista dia 20 às 14h30",
    { tipo: "evento", titulo: "consulta no dentista", dia: "2026-10-20", hora: "14:30" },
  ],
  [
    "entrevista de emprego segunda às 9h",
    { tipo: "evento", titulo: "entrevista de emprego", dia: "2026-10-12", hora: "09:00" },
  ],
  [
    "jantar com a Ana sábado às 20h",
    { tipo: "evento", titulo: "jantar com a Ana", dia: "2026-10-10", hora: "20:00" },
  ],

  // Lista.
  ["estudar para a prova #pessoal", { titulo: "estudar para a prova", listaId: "pessoal" }],
  ["comprar protetor na lista viagem de dezembro", { titulo: "comprar protetor", listaId: "01VIAGEM" }],

  // Gasto (fase 4): o valor em reais marca.
  ["45 de mercado no débito", { tipo: "gasto", titulo: "mercado no débito", valorCentavos: 4500 }],
  ["R$ 32,90 farmácia", { tipo: "gasto", titulo: "farmácia", valorCentavos: 3290 }],
  ["almoço 28 reais", { tipo: "gasto", titulo: "almoço", valorCentavos: 2800 }],
  ["uber R$1.285,50", { tipo: "gasto", titulo: "uber", valorCentavos: 128550 }],
  [
    "gastei 120 no posto ontem",
    { tipo: "gasto", titulo: "gastei no posto", dia: "2026-10-07", valorCentavos: 12000 },
  ],
  [
    "netflix R$ 55,90 todo mês",
    { tipo: "gasto", titulo: "netflix", dia: "2026-10-08", recorrencia: "FREQ=MONTHLY", valorCentavos: 5590 },
  ],
  [
    "paguei 30 de padaria na segunda",
    { tipo: "gasto", titulo: "paguei de padaria", dia: "2026-10-05", valorCentavos: 3000 },
  ],
  // Pagar ou comprar com data é tarefa: o valor fica no título.
  ["pagar R$ 150 da internet amanhã", { titulo: "pagar R$ 150 da internet", dia: "2026-10-09" }],
  ["comprar presente R$ 100 até sábado", { titulo: "comprar presente R$ 100", dia: "2026-10-10" }],

  // Nota e memória (fase 5): o resto é o conteúdo, sem campo.
  [
    "guarda isso: a senha do wifi é jabuticaba amanhã",
    { tipo: "memoria", titulo: "a senha do wifi é jabuticaba amanhã" },
  ],
  ["nota: ideias para o aniversário", { tipo: "nota", titulo: "ideias para o aniversário" }],
  ["anota que o código do portão é 4471", { tipo: "nota", titulo: "o código do portão é 4471" }],
  ["pedir nota fiscal amanhã", { titulo: "pedir nota fiscal", dia: "2026-10-09" }],

  // Volta 1 da revisão.
  // 1. Evento sem dia e lembrete sem hora viram tarefa.
  ["reunião com o gerente", { titulo: "reunião com o gerente" }],
  ["me lembra de pagar o condomínio", { titulo: "pagar o condomínio" }],
  ["me lembra de pagar o condomínio sexta", { titulo: "pagar o condomínio", dia: "2026-10-09" }],
  // 2. "as" sem crase é artigo; com hora marcada, vale.
  ["entregar as 3 para o cliente", { titulo: "entregar as 3 para o cliente" }],
  ["revisar as 3 com o chefe", { titulo: "revisar as 3 com o chefe" }],
  ["ligar as 15h", { titulo: "ligar", dia: "2026-10-08", hora: "15:00" }],
  // 3. Dia dito com repetição cai na primeira ocorrência a partir dele.
  [
    "academia toda segunda a partir de amanhã",
    { titulo: "academia", dia: "2026-10-12", recorrencia: "FREQ=WEEKLY;BYDAY=MO" },
  ],
  [
    "aula de natação toda terça a partir de 20/10",
    { titulo: "aula de natação", dia: "2026-10-20", recorrencia: "FREQ=WEEKLY;BYDAY=TU" },
  ],
  // 4. "às N" sem período: a próxima entre N e N+12 a partir de agora (10:00).
  [
    "reunião às 3 sobre orçamento",
    { tipo: "evento", titulo: "reunião sobre orçamento", dia: "2026-10-08", hora: "15:00" },
  ],
  ["ligar pro João às 9", { titulo: "ligar pro João", dia: "2026-10-08", hora: "21:00" }],
  ["tomar remédio às 11", { titulo: "tomar remédio", dia: "2026-10-08", hora: "11:00" }],
  // 5. Número com período abrindo a frase é hora, não gasto.
  ["8 da noite jantar", { titulo: "jantar", dia: "2026-10-08", hora: "20:00" }],
  ["10 da manhã academia", { titulo: "academia", dia: "2026-10-09", hora: "10:00" }],
  ["3 de manhã correr", { titulo: "correr", dia: "2026-10-09", hora: "03:00" }],
  // 6. "hoje à meia-noite" é a virada para amanhã.
  ["fechar o caixa hoje à meia-noite", { titulo: "fechar o caixa", dia: "2026-10-09", hora: "00:00" }],
  // 7. Data que não existe leva a hora junto para o título.
  ["reunião 31/02 às 15h", { titulo: "reunião 31/02 às 15h" }],
  ["pagar o boleto 30 de fevereiro 9h", { titulo: "pagar o boleto 30 de fevereiro 9h" }],
  // 8. A preposição da hora sai com ela.
  [
    "reunião ao meio-dia com o diretor",
    { tipo: "evento", titulo: "reunião com o diretor", dia: "2026-10-08", hora: "12:00" },
  ],
  [
    "reunião para as 15h com o cliente",
    { tipo: "evento", titulo: "reunião com o cliente", dia: "2026-10-08", hora: "15:00" },
  ],
  ["ligar pras 16h", { titulo: "ligar", dia: "2026-10-08", hora: "16:00" }],
  // 9. "próxima" e "que vem" são futuro: com valor, é tarefa.
  ["almoço 50 reais na próxima terça", { titulo: "almoço 50 reais", dia: "2026-10-13" }],
  ["uber R$ 40 sexta que vem", { titulo: "uber R$ 40", dia: "2026-10-09" }],
];

describe("a tabela de frases", () => {
  test("tem pelo menos 60 frases", () => {
    expect(TABELA.length).toBeGreaterThanOrEqual(60);
  });

  test.each(TABELA)("%s", (frase, esperado) => {
    const { tipo = "tarefa", ...campos } = esperado;
    const r = entenderFrase(frase, tempo, { listas: LISTAS });
    expect({ tipo: r.tipo, campos: r.campos }).toEqual({ tipo, campos: { ...VAZIOS, ...campos } });
    // A saída cabe no contrato da prévia, e a repetição é uma que o Moductus expande.
    expect(CamposCaptura.parse(r.campos)).toEqual(r.campos);
    for (const t of r.trechos) {
      expect(TrechoReconhecido.parse(t)).toEqual(t);
      expect(frase.slice(t.inicio, t.fim).trim()).toBe(frase.slice(t.inicio, t.fim));
    }
    if (r.campos.recorrencia !== null) expect(lerRecorrencia(r.campos.recorrencia).entendida).toBe(true);
  });
});

describe("trechos e tipo", () => {
  test("cada campo diz de que pedaço da frase saiu", () => {
    const frase = "ligar pro banco amanhã 15h";
    const r = entenderFrase(frase, tempo);
    expect(r.trechos).toEqual([
      { campo: "dia", inicio: 16, fim: 22 },
      { campo: "hora", inicio: 23, fim: 26 },
    ]);
    expect(r.trechos.map((t) => frase.slice(t.inicio, t.fim))).toEqual(["amanhã", "15h"]);
    expect(r.trechoDoTipo).toBeNull();
    expect(r.reconheceu).toBe(true);
  });

  test("o trecho inclui a preposição e o que deu dois campos aparece nos dois", () => {
    const frase = "reunião das 14h às 16h na quinta";
    const r = entenderFrase(frase, tempo);
    expect(r.trechos.map((t) => [t.campo, frase.slice(t.inicio, t.fim)])).toEqual([
      ["hora", "das 14h às 16h"],
      ["duracaoMin", "das 14h às 16h"],
      ["dia", "na quinta"],
    ]);
    expect(r.trechoDoTipo).toEqual({ inicio: 0, fim: 7 });
  });

  test("a marca do lembrete sai do título e é o trecho do tipo", () => {
    const frase = "me lembra de tomar remédio às 22h";
    const r = entenderFrase(frase, tempo);
    expect(frase.slice(r.trechoDoTipo!.inicio, r.trechoDoTipo!.fim)).toBe("me lembra de");
  });

  test("frase sem nada além do título não reconhece nada: é a vez do modelo", () => {
    const r = entenderFrase("comprar pão", tempo);
    expect(r).toEqual({
      tipo: "tarefa",
      campos: { ...VAZIOS, titulo: "comprar pão" },
      trechos: [],
      trechoDoTipo: null,
      reconheceu: false,
    });
  });

  test('evento sem dia vira tarefa, mas diz de onde veio o tipo para o "Na verdade é"', () => {
    const frase = "reunião com o gerente";
    const r = entenderFrase(frase, tempo);
    expect(r.tipo).toBe("tarefa");
    expect(r.trechoDoTipo).toEqual({ inicio: 0, fim: 7 });
    expect(r.reconheceu).toBe(true);
    const lembrete = entenderFrase("me lembra de pagar o condomínio sexta", tempo);
    expect(lembrete.tipo).toBe("tarefa");
    expect(lembrete.trechoDoTipo).toEqual({ inicio: 0, fim: 12 });
  });

  test("às 3 sem dia depois das 15h é amanhã às 3", () => {
    const r = entenderFrase("ligar às 3", tempoEm("2026-10-08T20:00:00.000Z"));
    expect(r.campos).toMatchObject({ dia: "2026-10-09", hora: "03:00" });
  });

  test("um segundo dia fica no título em vez de trocar o primeiro", () => {
    const r = entenderFrase("ligar amanhã ou sexta", tempo);
    expect(r.campos.dia).toBe("2026-10-09");
    expect(r.campos.titulo).toBe("ligar ou sexta");
  });

  test("a frase que é só data e hora fica inteira no título", () => {
    const r = entenderFrase("amanhã 15h", tempo);
    expect(r.campos).toEqual({ ...VAZIOS, titulo: "amanhã 15h", dia: "2026-10-09", hora: "15:00" });
  });

  test("lista desconhecida não é chute: sem listas, o #pessoal fica no título", () => {
    const r = entenderFrase("estudar #pessoal", tempo);
    expect(r.campos.listaId).toBeNull();
    expect(r.campos.titulo).toBe("estudar #pessoal");
  });
});

describe("o relógio e o fuso", () => {
  test("hora sem dia que já passou vai para amanhã; a que não passou fica hoje", () => {
    expect(entenderFrase("ligar às 9h", tempo).campos.dia).toBe("2026-10-09");
    expect(entenderFrase("ligar às 11h", tempo).campos.dia).toBe("2026-10-08");
    // A hora de agora já conta como passada.
    expect(entenderFrase("ligar às 10h", tempo).campos.dia).toBe("2026-10-09");
  });

  test("hoje e amanhã são os do fuso de config, não os do UTC", () => {
    // 23:30 de quinta em São Paulo é sexta de manhã em Tóquio.
    const instante = "2026-10-09T02:30:00.000Z";
    expect(entenderFrase("ligar amanhã", tempoEm(instante)).campos.dia).toBe("2026-10-09");
    expect(entenderFrase("ligar amanhã", tempoEm(instante, "Asia/Tokyo")).campos.dia).toBe("2026-10-10");
  });

  test("em 20 min perto da meia-noite cai no dia seguinte", () => {
    const r = entenderFrase("tirar a roupa da máquina em 20 min", tempoEm("2026-10-09T02:50:00.000Z"));
    expect(r.campos).toMatchObject({ dia: "2026-10-09", hora: "00:10" });
  });

  test("o fuso muda no config e vale na próxima frase", () => {
    let fuso = SP;
    const relogio = new TempoDoDia(
      () => fuso,
      () => new Date("2026-10-08T23:30:00.000Z"),
    );
    expect(entenderFrase("ligar hoje", relogio).campos.dia).toBe("2026-10-08");
    fuso = "Asia/Tokyo";
    expect(entenderFrase("ligar hoje", relogio).campos.dia).toBe("2026-10-09");
  });

  test("data no fim do calendário não estoura: o trecho volta para o título", () => {
    const r = entenderFrase("ligar depois de amanhã", tempoEm("9999-12-31T12:00:00.000Z", "UTC"));
    expect(r.campos.dia).toBeNull();
    expect(r.campos.titulo).toBe("ligar depois de amanhã");
  });
});

describe("entrada grande ou estranha", () => {
  test("frase enorme não trava: só os primeiros caracteres contam e o título cabe no contrato", () => {
    const enorme = "ligar pro banco amanhã 15h " + "amanhã às 15h todo dia #x R$ 1,00 ".repeat(50_000);
    const inicio = performance.now();
    const r = entenderFrase(enorme, tempo);
    expect(performance.now() - inicio).toBeLessThan(1000);
    expect(r.campos).toMatchObject({ dia: "2026-10-09", hora: "15:00" });
    expect(r.campos.titulo.length).toBeLessThanOrEqual(500);
    expect(CamposCaptura.parse(r.campos)).toEqual(r.campos);
    for (const t of r.trechos) expect(t.fim).toBeLessThanOrEqual(TAMANHO_DA_FRASE);
  });

  test("uma palavra só de um milhão de letras, números e barras", () => {
    for (const enorme of ["a".repeat(1_000_000), "1/".repeat(500_000), "9".repeat(1_000_000)]) {
      const r = entenderFrase(enorme, tempo);
      expect(r.tipo).toBe("tarefa");
      expect(r.campos.titulo.length).toBeLessThanOrEqual(500);
    }
  });

  test("o corte não parte um emoji ao meio", () => {
    const r = entenderFrase("a".repeat(499) + "😀 amanhã", tempo);
    expect(r.campos.titulo).toBe("a".repeat(499));
    const longa = entenderFrase("😀".repeat(600), tempo);
    expect(longa.campos.titulo).toBe("😀".repeat(250));
  });

  test("caractere de controle separa como espaço e não vai para o título", () => {
    const r = entenderFrase("ligar\u0000pro banco\tamanhã\n15h", tempo);
    expect(r.campos).toMatchObject({ titulo: "ligar pro banco", dia: "2026-10-09", hora: "15:00" });
  });

  test("frase sem nada que se leia é erro", () => {
    expect(() => entenderFrase("   \u0000 ", tempo)).toThrow(RangeError);
  });

  test("acento decomposto (NFD) é lido como o composto", () => {
    const r = entenderFrase("ligar amanhã às 15h", tempo);
    expect(r.campos).toMatchObject({ titulo: "ligar", dia: "2026-10-09", hora: "15:00" });
  });
});
