import type {
  Agente,
  Aprovacao,
  Execucao,
  ItemGithub,
  Provedor,
  SessaoIa,
  SituacaoAgente,
} from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import { lerSituacao } from "../../componentes/personagem/situacao.ts";
import {
  cartoesDeEstado,
  linhaDoAgente,
  linhaDoNuno,
  listaDeNomes,
  modeloDoTime,
  resumoDoTime,
  sessoesEsperando,
  timeDoServico,
  timeSemModelo,
  ultimaDeCada,
} from "./agentes.ts";

// Quinta, 8 de outubro de 2026, 10h, na hora local.
const AGORA = new Date(2026, 9, 8, 10, 0);
const local = (dia: number, hora: number, minuto = 0) => new Date(2026, 9, dia, hora, minuto).toISOString();

const ATIVO: SituacaoAgente = {
  estado: "ativo",
  atividade: "ocioso",
  motivoSono: null,
  dormeAte: null,
  pausadoAte: null,
  fila: 0,
};

const agente = (
  id: string,
  situacao: Partial<SituacaoAgente> = {},
  provedorId: string | null = "cli",
): Agente => ({
  id,
  nome: id,
  funcao: "",
  instrucoes: "",
  personagem: { silhueta: "ovo", traco: "raios", tom: "ambar" },
  ferramentas: [],
  provedorId,
  provedorReservaId: null,
  gatilhos: [],
  escoposMemoria: [],
  tetoDiarioCentavos: null,
  deFabrica: true,
  situacao: { ...ATIVO, ...situacao },
});

const provedor = (id: string, nome: string, tipo: Provedor["tipo"]): Provedor => ({
  id,
  tipo,
  nome,
  modelo: null,
  baseUrl: null,
  temChave: false,
  testadoEm: null,
});

const PROVEDORES = [provedor("cli", "Claude Code", "claude-cli"), provedor("api", "OpenAI", "openai")];

const pedido = (
  id: string,
  sessaoId: string | null,
  estado: Aprovacao["estado"] = "pendente",
): Aprovacao => ({
  id,
  fonte: "claude-code",
  agenteId: null,
  execucaoId: null,
  sessaoId,
  descricao: "Quer rodar o comando abaixo.",
  acao: { ferramenta: "Bash", entrada: {}, rotulo: null, rotuloRecusar: null, desfazivel: false },
  estado,
  criadoEm: AGORA.toISOString(),
  decididaEm: null,
  regraCriadaId: null,
  admiteSempre: true,
});

const execucao = (agenteId: string, extra: Partial<Execucao> = {}): Execucao => ({
  id: `${agenteId}-${extra.estado ?? "ok"}`,
  agenteId,
  gatilho: "mensagem",
  provedorId: "cli",
  inicio: null,
  fim: null,
  estado: "ok",
  erro: null,
  tokensEntrada: null,
  tokensSaida: null,
  custoEstimadoMicrodolares: null,
  cobranca: "assinatura",
  resumo: null,
  ...extra,
});

describe("o time no painel", () => {
  it("só os quatro de fábrica; sem modelo quando ninguém veio ou todos dormem sem modelo", () => {
    expect(Object.keys(timeDoServico([agente("alba"), agente("outro")]))).toEqual(["alba"]);
    expect(timeSemModelo({})).toBe(true);
    expect(
      timeSemModelo(timeDoServico([agente("alba", { estado: "dormindo", motivoSono: "sem_modelo" })])),
    ).toBe(true);
    expect(
      timeSemModelo(
        timeDoServico([
          agente("alba", { estado: "dormindo", motivoSono: "sem_modelo" }),
          agente("tula", { estado: "dormindo", motivoSono: "limite" }),
        ]),
      ),
    ).toBe(false);
  });

  it("resumo: quem trabalha e quem espera, contando cada sessão do terminal uma vez", () => {
    const time = timeDoServico([
      agente("tula", { atividade: "trabalhando" }),
      agente("faina", { atividade: "esperando" }),
      agente("alba", { estado: "pausado", atividade: "trabalhando" }),
    ]);
    const pedidos = [pedido("a", "s1"), pedido("b", "s1"), pedido("c", null), pedido("d", "s2", "aprovada")];
    expect(sessoesEsperando(pedidos)).toBe(2);
    expect(resumoDoTime(time, pedidos)).toBe("1 trabalhando · 3 esperando você");
    expect(resumoDoTime({}, [])).toBe("ninguém esperando você");
  });

  it("a última execução de cada um, da lista que vem da mais nova", () => {
    const nova = execucao("alba", { id: "n", resumo: "nova" });
    const velha = execucao("alba", { id: "v", resumo: "velha" });
    expect(ultimaDeCada([nova, velha, execucao("tula")]).alba).toBe(nova);
  });

  it("a linha de cada um diz o que faz, o que espera ou quando volta", () => {
    const linha = (situacao: Partial<SituacaoAgente>, ex?: Execucao, p?: Aprovacao) => {
      const a = agente("alba", situacao);
      return linhaDoAgente("alba", a, lerSituacao(a.situacao, AGORA), ex, p, AGORA);
    };
    expect(linha({})).toBe("Cuida do seu dia");
    expect(linha({}, execucao("alba", { resumo: "Briefing da manhã enviado" }))).toBe(
      "Briefing da manhã enviado",
    );
    expect(
      linha(
        { atividade: "trabalhando", fila: 2 },
        execucao("alba", { estado: "rodando", inicio: local(8, 9, 5) }),
      ),
    ).toBe("Trabalhando desde 9:05 · 2 pedidos na fila");
    expect(linha({ atividade: "trabalhando" })).toBe("Trabalhando agora");
    expect(
      linha({ atividade: "esperando" }, undefined, { ...pedido("a", null), descricao: "Prévia pronta" }),
    ).toBe("Prévia pronta");
    expect(linha({ atividade: "erro" }, execucao("alba", { estado: "erro", erro: "O modelo recusou" }))).toBe(
      "O modelo recusou",
    );
    expect(linha({ estado: "pausado", pausadoAte: local(8, 14) })).toBe("Em pausa até 14h");
    expect(linha({ estado: "dormindo", motivoSono: "limite", dormeAte: local(12, 9) })).toBe("Volta seg 9h");
    expect(linhaDoAgente("alba", undefined, lerSituacao(undefined), undefined, undefined, AGORA)).toBe(
      "Conectar um modelo",
    );
  });

  it("a linha do Nuno junta sessões esperando, contexto cheio e o GitHub, em até duas partes", () => {
    const sessao = {
      id: "s1",
      projetoId: "p1",
      encerradaEm: null,
      contexto: { usadoTokens: 170, janelaTokens: 200 },
    } as SessaoIa;
    const item = (tipo: ItemGithub["tipo"]) => ({ tipo, estado: "aberto", precisaDeMim: true }) as ItemGithub;
    const nome = () => "api-pedidos";
    expect(linhaDoNuno([], nome, 0, [])).toBeNull();
    expect(linhaDoNuno([sessao], nome, 0, [item("pr"), item("pr")])).toBe(
      "api-pedidos usou 85% do contexto · 2 PRs esperam você",
    );
    expect(linhaDoNuno([], nome, 2, [item("pr"), item("issue")])).toBe(
      "2 sessões esperando você · 2 itens do GitHub esperam você",
    );
  });
});

describe("cartões de estado (Estados.dc.html)", () => {
  it("nomes em lista", () => {
    expect(listaDeNomes(["alba"])).toBe("Alba");
    expect(listaDeNomes(["alba", "tula", "nuno"])).toBe("Alba, Tula e Nuno");
  });

  it("time inteiro pausado vira um cartão; a ordem é pausa, limite, erro e teto", () => {
    const time = timeDoServico(
      ["alba", "tula", "faina", "nuno"].map((id) =>
        agente(id, { estado: "pausado", pausadoAte: local(8, 14) }),
      ),
    );
    const [pausa] = cartoesDeEstado(time, PROVEDORES, AGORA);
    expect(pausa).toMatchObject({
      tipo: "pausa",
      agentes: ["alba", "tula", "faina", "nuno"],
      titulo: "Time pausado até 14h",
      texto: "Ninguém usa modelo nem mexe em nada até lá.",
      primaria: { texto: "Retomar agora", acao: { tipo: "retomar" } },
    });
    expect(pausa!.primaria.acao).not.toHaveProperty("agenteIds");

    // Dois de quatro: o cartão é dos dois e retoma os dois, sem dizer de onde veio a pausa.
    const [dois] = cartoesDeEstado(
      timeDoServico([
        agente("alba", { estado: "pausado" }),
        agente("tula"),
        agente("faina", { estado: "pausado" }),
        agente("nuno"),
      ]),
      PROVEDORES,
      AGORA,
    );
    expect(dois).toMatchObject({
      titulo: "Alba e Faina em pausa até você retomar",
      texto: "Nada roda com modelo até lá; o resto do time segue normal.",
      primaria: { acao: { tipo: "retomar", agenteIds: ["alba", "faina"] } },
    });

    const misto = timeDoServico([
      agente("alba", { estado: "dormindo", motivoSono: "teto" }),
      agente("tula", { estado: "dormindo", motivoSono: "fora_do_ar", dormeAte: local(8, 10, 5) }),
      agente("faina", { estado: "dormindo", motivoSono: "limite", dormeAte: local(12, 9) }),
      agente("nuno", { estado: "pausado" }),
    ]);
    expect(cartoesDeEstado(misto, PROVEDORES, AGORA).map((c) => [c.tipo, c.quem])).toEqual([
      ["pausa", "Nuno"],
      ["limite", "Faina"],
      ["falha", "Tula"],
      ["teto", "Alba"],
    ]);
  });

  it("o mesmo limite no mesmo modelo é um cartão no plural, com a hora de volta por extenso", () => {
    const time = timeDoServico(
      ["alba", "nuno"].map((id) =>
        agente(id, { estado: "dormindo", motivoSono: "limite", dormeAte: local(12, 9) }),
      ),
    );
    const [limite] = cartoesDeEstado(time, PROVEDORES, AGORA);
    expect(limite).toMatchObject({
      quem: "Alba e Nuno",
      titulo: "O limite do Claude Code acabou",
      texto: "Voltamos segunda às 9h, quando ele renova. O que não precisa de modelo continua.",
      estado: { texto: "dormindo", tom: "neutro" },
    });
  });

  it("erro de provedor diz o que houve sem inventar contagem; chave recusada manda a Modelos", () => {
    const fora = cartoesDeEstado(
      timeDoServico([
        agente("tula", { estado: "dormindo", motivoSono: "fora_do_ar", dormeAte: local(8, 10, 5) }),
      ]),
      PROVEDORES,
      AGORA,
    )[0]!;
    expect(fora.texto).toBe("O Claude Code não respondeu. Nada foi alterado; tento de novo às 10:05.");
    expect(fora.estado).toEqual({ texto: "erro", tom: "perigo" });
    const chave = cartoesDeEstado(
      timeDoServico([agente("tula", { estado: "dormindo", motivoSono: "credencial" }, "api")]),
      PROVEDORES,
      AGORA,
    )[0]!;
    expect(chave.texto).toBe("O OpenAI recusou a chave. Nada foi alterado; confira a chave em Modelos.");
  });

  it("credencial recusada num CLI é falta de login: diz como entrar, não fala de chave", () => {
    const [login] = cartoesDeEstado(
      timeDoServico([
        agente("alba", { estado: "dormindo", motivoSono: "credencial", dormeAte: local(8, 10, 5) }, "cli"),
      ]),
      PROVEDORES,
      AGORA,
    );
    expect(login).toMatchObject({
      tipo: "falha",
      titulo: "Não consegui falar com o modelo",
      texto: "O Claude Code está sem login. Entre no terminal com `claude` e tento de novo às 10:05.",
    });
    const alba = agente("alba", { estado: "dormindo", motivoSono: "credencial", dormeAte: local(8, 10, 5) });
    const modelo = { tipo: "claude-cli", nome: "Claude Code" } as const;
    expect(
      linhaDoAgente(
        "alba",
        alba,
        lerSituacao(alba.situacao, AGORA, modelo),
        undefined,
        undefined,
        AGORA,
        modelo,
      ),
    ).toBe("Claude Code sem login, tenta de novo às 10:05");
  });

  it("a hora da nova tentativa passou e o agente segue em erro: o cartão não promete o passado", () => {
    const depois = new Date(2026, 9, 8, 10, 7);
    const [fora] = cartoesDeEstado(
      timeDoServico([
        agente("tula", { estado: "dormindo", motivoSono: "fora_do_ar", dormeAte: local(8, 10, 5) }),
      ]),
      PROVEDORES,
      depois,
    );
    expect(fora!.texto).toBe("O Claude Code não respondeu. Nada foi alterado; estou tentando de novo.");
  });

  it("teto sem valor (a moeda não foi decidida) e desligado não vira cartão", () => {
    const [teto, ...resto] = cartoesDeEstado(
      timeDoServico([
        agente("nuno", { estado: "dormindo", motivoSono: "teto" }),
        agente("alba", { estado: "desligado" }),
      ]),
      PROVEDORES,
      AGORA,
    );
    expect(resto).toEqual([]);
    expect(teto).toMatchObject({
      titulo: "Cheguei ao teto de hoje",
      texto: "Paro até meia-noite, a menos que você mude o teto em Modelos.",
      primaria: { texto: "Mudar o teto", acao: { tipo: "modelos" } },
      secundaria: { texto: "Parar até amanhã", acao: { tipo: "dispensar" } },
    });
  });
});

describe("modelo do time no rodapé", () => {
  it("um modelo, vários ou nenhum", () => {
    expect(modeloDoTime(timeDoServico([agente("alba"), agente("tula")]), PROVEDORES)).toEqual({
      texto: "Modelo dos agentes: Claude Code, sua assinatura",
      acao: "Trocar",
    });
    expect(modeloDoTime(timeDoServico([agente("alba"), agente("tula", {}, "api")]), PROVEDORES).texto).toBe(
      "Modelos dos agentes: Claude Code e OpenAI",
    );
    expect(modeloDoTime(timeDoServico([agente("alba", {}, null)]), PROVEDORES)).toEqual({
      texto: "Nenhum modelo conectado ao time",
      acao: "Conectar",
    });
  });
});
