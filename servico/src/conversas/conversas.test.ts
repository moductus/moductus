import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Conversa, FalaParcial, Mensagem, ResultadoEnviar } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { RepositorioAgentes } from "../agentes/agentes.ts";
import { RepositorioExecucoes } from "../agentes/execucoes.ts";
import { classificadorPeloRuntime, Roteador } from "../agentes/roteador.ts";
import { MENSAGEM_SEM_MODELO, Runtime } from "../agentes/runtime.ts";
import { abrirBanco } from "../banco/conexao.ts";
import { limparLixeira } from "../banco/lixeira.ts";
import { Catalogo } from "../ferramentas/catalogo.ts";
import { ProvedorFalso, roteiros } from "../provedores/falso.ts";
import { RegistroProvedores } from "../provedores/registro.ts";
import { paraModelo, pedidoDe, RepositorioConversas, ServicoConversas } from "./conversas.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/**
 * Banco migrado de verdade, o runtime de verdade e um provedor falso por agente (a Faina sem
 * modelo), com o classificador do roteamento rodando no modelo da Alba como em produção.
 */
function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-conversas-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  db.exec(`
    INSERT INTO provedores (id, tipo, nome) VALUES
      ('p-alba', 'claude-cli', 'Falso'), ('p-tula', 'claude-cli', 'Falso'), ('p-nuno', 'claude-cli', 'Falso');
    UPDATE agentes SET provedor_id = 'p-' || id WHERE id IN ('alba', 'tula', 'nuno');
  `);
  const falsos = {
    alba: new ProvedorFalso("p-alba"),
    tula: new ProvedorFalso("p-tula"),
    nuno: new ProvedorFalso("p-nuno"),
  };
  const provedores = new RegistroProvedores().registrar(
    "claude-cli",
    (config) => falsos[config.id.slice(2) as keyof typeof falsos],
  );
  const agentes = new RepositorioAgentes(db);
  const execucoes = new RepositorioExecucoes(db);
  let segundos = 0;
  const agora = () => new Date(Date.UTC(2026, 9, 9, 14, 0, segundos++));
  const runtime = new Runtime(
    { agentes, execucoes, provedores, catalogo: new Catalogo([]) },
    { execucao: () => {}, agente: () => {} },
    { agora },
  );
  const eventos = { conversas: [] as Conversa[], mensagens: [] as Mensagem[], parciais: [] as FalaParcial[] };
  const repo = new RepositorioConversas(db);
  const servico = new ServicoConversas(
    { repo, agentes, runtime, roteador: new Roteador(classificadorPeloRuntime(runtime, agentes)) },
    {
      conversa: (c) => eventos.conversas.push(Conversa.parse(c)),
      mensagem: (m) => eventos.mensagens.push(Mensagem.parse(m)),
      parcial: (p) => eventos.parciais.push(FalaParcial.parse(p)),
    },
    { agora },
  );
  return { db, falsos, execucoes, eventos, repo, servico };
}

/** As mensagens da conversa na ordem em que foram ditas. */
function conversaInteira(servico: ServicoConversas, conversaId: string): Mensagem[] {
  return servico.mensagens({ conversaId, limite: 200 }).itens.reverse();
}

describe("abrir, listar e arquivar", () => {
  test("a do time e a de cada agente nascem uma vez; arquivada, abrir começa outra", () => {
    const { servico, eventos } = montar();
    const time = servico.abrir({});
    expect(time).toMatchObject({ tipo: "time", agenteId: null, arquivada: false });
    expect(servico.abrir({})).toEqual(time);
    const tula = servico.abrir({ agenteId: "tula" });
    expect(tula).toMatchObject({ tipo: "agente", agenteId: "tula" });
    expect(() => servico.abrir({ agenteId: "zeca" })).toThrow("agente não encontrado");

    expect(servico.arquivar({ id: tula.id, arquivada: true }).arquivada).toBe(true);
    const outra = servico.abrir({ agenteId: "tula" });
    expect(outra.id).not.toBe(tula.id);
    expect(eventos.conversas.map((c) => [c.id, c.arquivada])).toEqual([
      [time.id, false],
      [tula.id, false],
      [tula.id, true],
      [outra.id, false],
    ]);
    // O time primeiro; depois a que nasceu por último.
    expect(servico.listar().map((c) => c.id)).toEqual([time.id, outra.id, tula.id]);
  });

  test("conversa arquivada não recebe mensagem; a que não existe, nada", async () => {
    const { servico } = montar();
    const tula = servico.abrir({ agenteId: "tula" });
    servico.arquivar({ id: tula.id, arquivada: true });
    await expect(servico.enviar({ conversaId: tula.id, conteudo: "oi" })).rejects.toThrow("arquivada");
    await expect(servico.enviar({ conversaId: "nada", conteudo: "oi" })).rejects.toThrow("não encontrada");
    expect(() => servico.mensagens({ conversaId: "nada" })).toThrow("não encontrada");
  });
});

describe("conversa com o time", () => {
  test("pergunta com duas áreas é dividida e respondida por dois agentes na mesma conversa", async () => {
    const { servico, falsos, execucoes, eventos } = montar();
    const texto = "Quanto já foi de mercado este mês? E tenho algo amanhã cedo?";
    falsos.alba.roteirizar(
      // O classificador, no modelo da Alba.
      roteiros.resposta(
        '[{"agente":"tula","parte":"Quanto já foi de mercado este mês?"},{"agente":"alba","parte":"E tenho algo amanhã cedo?"}]',
        { tokensEntrada: 40, tokensSaida: 12 },
      ),
      [
        { tipo: "texto", texto: "Amanhã a primeira coisa é a Daily, " },
        { tipo: "texto", texto: "às 9h30." },
        { tipo: "fim", continuacao: "sessao-alba" },
      ],
    );
    falsos.tula.roteirizar([
      { tipo: "texto", texto: "R$ 512 de R$ 600 em mercado, " },
      { tipo: "texto", texto: "85% do previsto." },
      { tipo: "fim", continuacao: "sessao-tula" },
    ]);
    const time = servico.abrir({});

    const resultado = ResultadoEnviar.parse(await servico.enviar({ conversaId: time.id, conteudo: texto }));
    expect(resultado.agentes).toEqual(["tula", "alba"]);
    expect(resultado.mensagem).toMatchObject({ conversaId: time.id, agenteId: null, conteudo: texto });
    await servico.ocioso();

    // O classificador rodou como execução da Alba, sem ferramentas e com o prompt curto.
    const classificacao = falsos.alba.pedidos[0]!;
    expect(classificacao.ferramentas).toEqual([]);
    expect(classificacao.instrucoes).toContain("Você distribui as mensagens");
    expect(classificacao.mensagens).toEqual([{ papel: "usuario", texto }]);

    // Cada um recebeu a mensagem inteira com a parte que é dele.
    const ultima = (falso: ProvedorFalso) => falso.pedidos.at(-1)!.mensagens.at(-1)!.texto;
    expect(ultima(falsos.tula)).toContain('Responda só a esta parte: "Quanto já foi de mercado este mês?"');
    expect(ultima(falsos.tula)).toContain("O resto fica com Alba.");
    expect(ultima(falsos.alba)).toContain('Responda só a esta parte: "E tenho algo amanhã cedo?"');
    expect(ultima(falsos.alba).startsWith(texto)).toBe(true);

    // As duas respostas na mesma conversa, assinadas pelo agente e pela execução.
    const mensagens = conversaInteira(servico, time.id);
    expect(mensagens.map((m) => [m.agenteId, m.conteudo])).toEqual(
      expect.arrayContaining([
        [null, texto],
        ["tula", "R$ 512 de R$ 600 em mercado, 85% do previsto."],
        ["alba", "Amanhã a primeira coisa é a Daily, às 9h30."],
      ]),
    );
    expect(mensagens).toHaveLength(3);
    for (const resposta of mensagens.slice(1)) {
      const execucao = execucoes.execucao(resposta.execucaoId!);
      expect(execucao).toMatchObject({ agenteId: resposta.agenteId, gatilho: "mensagem", estado: "ok" });
    }
    // Três execuções: o classificador e as duas respostas.
    expect(execucoes.pagina({}).itens).toHaveLength(3);

    // Streaming: o texto inteiro até ali, de cada execução; a gravada vem por evento também.
    expect(eventos.parciais.filter((p) => p.agenteId === "tula").map((p) => p.texto)).toEqual([
      "R$ 512 de R$ 600 em mercado, ",
      "R$ 512 de R$ 600 em mercado, 85% do previsto.",
    ]);
    const daTula = mensagens.find((m) => m.agenteId === "tula")!;
    expect(eventos.parciais.find((p) => p.agenteId === "tula")!.execucaoId).toBe(daTula.execucaoId);
    expect(eventos.mensagens.map((m) => m.id).sort()).toEqual(mensagens.map((m) => m.id).sort());
    expect(eventos.mensagens[0]!.id).toBe(resultado.mensagem.id);
  });

  test("regras dividem sem chamar o classificador", async () => {
    const { servico, falsos } = montar();
    falsos.tula.roteirizar(roteiros.resposta("Lancei R$ 45 em mercado."));
    falsos.nuno.roteirizar(roteiros.resposta("O CI do #142 quebrou no lint."));
    const time = servico.abrir({});
    const { agentes } = await servico.enviar({
      conversaId: time.id,
      conteudo: "Paguei R$ 45 no mercado. O CI do github.com/gustavo/moductus/pull/142 quebrou?",
    });
    await servico.ocioso();
    expect(agentes).toEqual(["tula", "nuno"]);
    expect(falsos.alba.pedidos).toHaveLength(0);
    expect(conversaInteira(servico, time.id).map((m) => m.agenteId)).toEqual(
      expect.arrayContaining([null, "tula", "nuno"]),
    );
  });

  test("menção escolhe; os outros agentes chegam assinados no histórico de quem responde", async () => {
    const { servico, falsos } = montar();
    falsos.tula.roteirizar(roteiros.resposta("R$ 512 de R$ 600."), roteiros.resposta("Foi R$ 80 a mais."));
    falsos.nuno.roteirizar(roteiros.resposta("2 sessões ativas."));
    const time = servico.abrir({});
    await servico.enviar({ conversaId: time.id, conteudo: "@tula quanto foi de mercado?" });
    await servico.ocioso();
    await servico.enviar({ conversaId: time.id, conteudo: "@nuno e as sessões?" });
    await servico.ocioso();
    expect(falsos.nuno.pedidos[0]!.mensagens).toEqual([
      { papel: "usuario", texto: "@tula quanto foi de mercado?" },
      { papel: "usuario", texto: "Tula respondeu: R$ 512 de R$ 600." },
      { papel: "usuario", texto: "@nuno e as sessões?" },
    ]);

    // Sem menção e sem regra, o classificador sabe quem falou por último.
    falsos.alba.roteirizar(roteiros.resposta('[{"agente":"tula"}]'));
    await servico.enviar({ conversaId: time.id, conteudo: "e a semana passada?" });
    await servico.ocioso();
    expect(falsos.alba.pedidos[0]!.instrucoes).toContain("A última resposta da conversa foi de nuno.");
    expect(falsos.tula.pedidos[1]!.mensagens.at(-1)).toEqual({
      papel: "usuario",
      texto: "e a semana passada?",
    });
  });

  test("agente sem modelo responde com o motivo, e a Alba sem modelo não classifica", async () => {
    const { db, servico, falsos, execucoes } = montar();
    db.exec("UPDATE agentes SET provedor_id = NULL WHERE id = 'alba'");
    const time = servico.abrir({});
    const { agentes } = await servico.enviar({ conversaId: time.id, conteudo: "@faina limpa isso" });
    await servico.ocioso();
    expect(agentes).toEqual(["faina"]);
    const daFaina = conversaInteira(servico, time.id).at(-1)!;
    expect(daFaina).toMatchObject({ agenteId: "faina", conteudo: MENSAGEM_SEM_MODELO("Faina") });
    expect(execucoes.execucao(daFaina.execucaoId!)?.estado).toBe("erro");

    // Sem modelo para classificar, vai direto ao padrão, sem uma execução a mais.
    await servico.enviar({ conversaId: time.id, conteudo: "e amanhã?" });
    await servico.ocioso();
    expect(falsos.alba.pedidos).toHaveLength(0);
    expect(execucoes.pagina({ agenteId: "alba" }).itens).toHaveLength(1);
    expect(conversaInteira(servico, time.id).at(-1)).toMatchObject({
      agenteId: "alba",
      conteudo: MENSAGEM_SEM_MODELO("Alba"),
    });
  });

  test("agente desligado fica fora do roteamento", async () => {
    const { db, servico, falsos } = montar();
    db.exec("UPDATE agentes SET estado = 'desligado' WHERE id = 'tula'");
    falsos.alba.roteirizar(roteiros.resposta('[{"agente":"tula"}]'), roteiros.resposta("Anotei."));
    const time = servico.abrir({});
    const { agentes } = await servico.enviar({ conversaId: time.id, conteudo: "Paguei R$ 45 no mercado." });
    await servico.ocioso();
    expect(agentes).toEqual(["alba"]);
    expect(falsos.tula.pedidos).toHaveLength(0);
  });
});

describe("conversa com um agente", () => {
  test("só ele responde, e a próxima resposta continua a sessão que a anterior deixou", async () => {
    const { servico, falsos } = montar();
    falsos.nuno.roteirizar(
      [
        { tipo: "texto", texto: "2 sessões ativas." },
        { tipo: "fim", continuacao: "sessao-1" },
      ],
      [
        { tipo: "pausa", ms: 5 },
        { tipo: "texto", texto: "O #142 passou." },
        { tipo: "fim", continuacao: "sessao-2" },
      ],
      roteiros.resposta("Nenhum PR esperando."),
    );
    const nuno = servico.abrir({ agenteId: "nuno" });
    // Três seguidas: cada uma espera a anterior para montar o pedido.
    const enviados = await Promise.all([
      servico.enviar({ conversaId: nuno.id, conteudo: "como estão as sessões? R$ 10" }),
      servico.enviar({ conversaId: nuno.id, conteudo: "e o CI?" }),
      servico.enviar({ conversaId: nuno.id, conteudo: "algum PR?" }),
    ]);
    await servico.ocioso();
    expect(enviados.map((r) => r.agentes)).toEqual([["nuno"], ["nuno"], ["nuno"]]);
    expect(falsos.alba.pedidos).toHaveLength(0);
    expect(falsos.tula.pedidos).toHaveLength(0);
    expect(falsos.nuno.pedidos.map((p) => p.continuarDe)).toEqual([null, "sessao-1", "sessao-2"]);
    // Cada uma responde a mensagem que a disparou, com o histórico até ela.
    expect(falsos.nuno.pedidos.map((p) => p.mensagens.at(-1)!.texto)).toEqual([
      "como estão as sessões? R$ 10",
      "e o CI?",
      "algum PR?",
    ]);
    expect(falsos.nuno.pedidos[2]!.mensagens.map((m) => m.texto)).not.toContain("O #142 passou.");
  });

  test("falha do provedor fica na conversa e não perde a sessão a continuar", async () => {
    const { servico, falsos } = montar();
    falsos.tula.roteirizar(
      [
        { tipo: "texto", texto: "R$ 512." },
        { tipo: "fim", continuacao: "sessao-tula" },
      ],
      roteiros.falha("limite", "2026-10-09T18:00:00.000Z"),
      roteiros.resposta("R$ 600."),
    );
    const tula = servico.abrir({ agenteId: "tula" });
    for (const conteudo of ["quanto foi?", "e o previsto?", "e o previsto?"]) {
      await servico.enviar({ conversaId: tula.id, conteudo });
      await servico.ocioso();
    }
    expect(falsos.tula.pedidos.map((p) => p.continuarDe)).toEqual([null, "sessao-tula", "sessao-tula"]);
    expect(conversaInteira(servico, tula.id).map((m) => m.conteudo)).toEqual([
      "quanto foi?",
      "R$ 512.",
      "e o previsto?",
      "falha roteirizada: limite",
      "e o previsto?",
      "R$ 600.",
    ]);
  });
});

describe("mensagens", () => {
  test("página da mais nova para a mais antiga, com cursor", async () => {
    const { servico, repo } = montar();
    const tula = servico.abrir({ agenteId: "tula" });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = `01K79Z6N7Q4W3J5XG2B8C1D0E${i}`;
      repo.gravarMensagem({
        id,
        conversaId: tula.id,
        agenteId: null,
        conteudo: `m${i}`,
        execucaoId: null,
        agora: "2026-10-09T14:00:00.000Z",
      });
      ids.push(id);
    }
    const primeira = servico.mensagens({ conversaId: tula.id, limite: 2 });
    expect(primeira.itens.map((m) => m.conteudo)).toEqual(["m4", "m3"]);
    const segunda = servico.mensagens({ conversaId: tula.id, limite: 2, antesDe: primeira.proximo! });
    expect(segunda.itens.map((m) => m.conteudo)).toEqual(["m2", "m1"]);
    const ultima = servico.mensagens({ conversaId: tula.id, limite: 2, antesDe: segunda.proximo! });
    expect(ultima).toEqual({ itens: [expect.objectContaining({ conteudo: "m0" })], proximo: null });
  });

  test("apagar a conversa leva as mensagens junto para a lixeira, e a limpeza tira as duas", async () => {
    const { db, servico, falsos, repo } = montar();
    falsos.tula.roteirizar(roteiros.resposta("R$ 512."));
    const tula = servico.abrir({ agenteId: "tula" });
    await servico.enviar({ conversaId: tula.id, conteudo: "quanto foi?" });
    await servico.ocioso();
    repo.apagar(tula.id, "2026-10-09T15:00:00.000Z");
    expect(servico.listar()).toEqual([]);
    expect(() => servico.mensagens({ conversaId: tula.id })).toThrow("não encontrada");
    const vivas = db
      .prepare("SELECT COUNT(*) AS n FROM mensagens WHERE apagado_em IS NULL")
      .get() as unknown as { n: number };
    expect(vivas.n).toBe(0);
    limparLixeira(db, new Date("2026-11-09T15:00:01.000Z"));
    const restam = db
      .prepare("SELECT (SELECT COUNT(*) FROM mensagens) + (SELECT COUNT(*) FROM conversas) AS n")
      .get() as unknown as {
      n: number;
    };
    expect(restam.n).toBe(0);
  });
});

describe("o que vai ao modelo", () => {
  const nomes = new Map([
    ["alba", "Alba"],
    ["tula", "Tula"],
    ["nuno", "Nuno"],
  ]);
  const fala = (agenteId: string | null, conteudo: string): Mensagem => ({
    id: "01K79Z6N7Q4W3J5XG2B8C1D0EA",
    conversaId: "c",
    agenteId,
    conteudo,
    execucaoId: agenteId ? "01K79Z6N7Q4W3J5XG2B8C1D0EB" : null,
    criadoEm: "2026-10-09T14:00:00.000Z",
  });

  test("a fala do próprio agente é dele; a dos outros vem assinada", () => {
    expect(paraModelo(fala("tula", "R$ 512."), "tula", nomes)).toEqual({ papel: "agente", texto: "R$ 512." });
    expect(paraModelo(fala(null, "oi"), "tula", nomes)).toEqual({ papel: "usuario", texto: "oi" });
    expect(paraModelo(fala("alba", "Livre."), "tula", nomes)).toEqual({
      papel: "usuario",
      texto: "Alba respondeu: Livre.",
    });
  });

  test("sozinho responde a mensagem como veio; com mais gente, sabe quem fica com o resto", () => {
    const m = fala(null, "@tula @nuno @alba resumo?");
    expect(
      pedidoDe(m, { agenteId: "tula", parte: null }, [{ agenteId: "tula", parte: null }], nomes).texto,
    ).toBe(m.conteudo);
    const todos = ["tula", "nuno", "alba"].map((agenteId) => ({ agenteId, parte: null }));
    expect(pedidoDe(m, todos[0]!, todos, nomes).texto).toBe(
      `${m.conteudo}\n\n(Nuno e Alba também vão responder esta mensagem. Responda só o que é da sua área.)`,
    );
  });
});
