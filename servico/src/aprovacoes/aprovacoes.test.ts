import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Aprovacao, RegraPermissao, type AcaoAprovacao } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { RepositorioSessoes } from "../sessoes/sessoes.ts";
import { MENSAGEM_NEGADO, RepositorioAprovacoes, ServicoAprovacoes, type NovoPedido } from "./aprovacoes.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const AGORA = "2026-10-09T12:00:00.000Z";

/** Banco migrado de verdade na pasta dada (ou numa nova), relógio na mão e os avisos anotados. */
function montar(pasta = mkdtempSync(join(tmpdir(), "moductus-aprovacoes-"))) {
  if (!pastas.includes(pasta)) pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  let agora = new Date(AGORA);
  const avisos: Aprovacao[] = [];
  const regrasAvisadas: RegraPermissao[][] = [];
  const servico = new ServicoAprovacoes(
    new RepositorioAprovacoes(db),
    { aprovacao: (a) => avisos.push(a), regras: (r) => regrasAvisadas.push(r) },
    { agora: () => agora },
  );
  const andar = (ms: number) => (agora = new Date(agora.getTime() + ms));
  return { pasta, db, servico, avisos, regrasAvisadas, andar };
}

/** Um projeto e uma sessão do Claude Code nele, como os hooks gravariam. */
function sessaoEm(db: DatabaseSync, projeto: string, sessao: string, caminho = `V:\\${projeto}`) {
  const repo = new RepositorioSessoes(db);
  if (!repo.projeto(projeto)) repo.criarProjeto(projeto, projeto, caminho, AGORA);
  repo.criarSessao({
    id: sessao,
    projetoId: projeto,
    ferramenta: "claude-code",
    idExterno: `externo-${sessao}`,
    modelo: null,
    estado: "esperando",
    agora: AGORA,
    encerrada: false,
    transcript: null,
  });
}

const bash = (command: string): AcaoAprovacao => ({
  ferramenta: "Bash",
  entrada: { command },
  rotulo: null,
  rotuloRecusar: null,
  desfazivel: false,
});

const doTerminal = (sessaoId: string, command = "pnpm test"): NovoPedido => ({
  fonte: "claude-code",
  sessaoId,
  descricao: `O Claude Code quer rodar ${command}.`,
  acao: bash(command),
});

const ler = (file_path: string): AcaoAprovacao => ({
  ferramenta: "Read",
  entrada: { file_path },
  rotulo: null,
  rotuloRecusar: null,
  desfazivel: false,
});

const doTerminalCom = (
  sessaoId: string,
  acao: Pick<AcaoAprovacao, "ferramenta" | "entrada">,
): NovoPedido => ({
  fonte: "claude-code",
  sessaoId,
  descricao: `O Claude Code quer usar ${acao.ferramenta}.`,
  acao: { rotulo: null, rotuloRecusar: null, desfazivel: false, ...acao },
});

const doNuno = (numero: number, agenteId = "nuno"): NovoPedido => ({
  fonte: "moductus",
  agenteId,
  descricao: `Comento no PR #${numero} que o CI voltou a passar?`,
  acao: {
    ferramenta: "github.comentar",
    entrada: { repositorio: "gustavo/moductus", numero, texto: "CI verde de novo." },
    rotulo: "Comentar no PR",
    rotuloRecusar: "Depois",
    desfazivel: false,
  },
});

function cartao(servico: ServicoAprovacoes, pedido: NovoPedido): Aprovacao {
  const r = servico.pedir(pedido);
  if (r.tipo !== "cartao") throw new Error(`esperava cartão, veio ${r.tipo}`);
  return r.aprovacao;
}

describe("cartões de aprovação", () => {
  test("pedido sem regra vira cartão pendente no formato do contrato, gravado e avisado", async () => {
    const { db, servico, avisos } = montar();
    sessaoEm(db, "moductus", "s1");
    const a = cartao(servico, doTerminal("s1"));
    expect(Aprovacao.parse(a)).toEqual(a);
    expect(a).toMatchObject({
      fonte: "claude-code",
      agenteId: null,
      execucaoId: null,
      sessaoId: "s1",
      estado: "pendente",
      criadoEm: AGORA,
      decididaEm: null,
      regraCriadaId: null,
    });
    expect(avisos).toEqual([a]);
    expect(await servico.pendentes()).toEqual([a]);
    const linha = db.prepare("SELECT origem, agente_id FROM aprovacoes WHERE id = ?").get(a.id);
    expect(linha).toEqual({ origem: "conexao", agente_id: null });
  });

  test("pedido de agente leva o carimbo do agente", () => {
    const { db, servico } = montar();
    const a = cartao(servico, doNuno(12));
    expect(a).toMatchObject({ fonte: "moductus", agenteId: "nuno", sessaoId: null });
    const linha = db.prepare("SELECT origem, agente_id, do_agente_id FROM aprovacoes WHERE id = ?").get(a.id);
    expect(linha).toEqual({ origem: "agente", agente_id: "nuno", do_agente_id: "nuno" });
  });

  test("fechar o app com cartão pendente e reabrir mantém o cartão, e quem volta a esperar recebe a decisão", async () => {
    const antes = montar();
    sessaoEm(antes.db, "moductus", "s1");
    const a = cartao(antes.servico, doTerminal("s1"));
    const b = cartao(antes.servico, doNuno(12));
    const c = cartao(antes.servico, doNuno(13));
    antes.db.close();

    // Na subida, o do terminal expira (ninguém mais segura a resposta do hook); os do Moductus ficam.
    const depois = montar(antes.pasta);
    expect(await depois.servico.pendentes()).toEqual([a, b, c]);
    expect(depois.servico.expirarDoTerminal().map((x) => [x.id, x.estado])).toEqual([[a.id, "expirada"]]);
    expect(await depois.servico.pendentes()).toEqual([b, c]);

    const espera = depois.servico.esperar(b.id);
    const decidida = await depois.servico.decidir({ id: b.id, decisao: "permitir" });
    expect(decidida).toMatchObject({ estado: "aprovada", decididaEm: AGORA });
    expect(await espera).toEqual({ aprovacao: decidida, mensagem: null });
    expect(await depois.servico.pendentes()).toEqual([c]);
  });

  test("decidir libera quem espera; negar devolve a mensagem escrita ou a padrão", async () => {
    const { db, servico, avisos } = montar();
    sessaoEm(db, "moductus", "s1");
    const a = cartao(servico, doTerminal("s1", "pnpm build"));
    const b = cartao(servico, doTerminal("s1", "pnpm lint"));
    const c = cartao(servico, doTerminal("s1", "pnpm dev"));
    const esperas = [
      servico.esperar(a.id),
      servico.esperar(a.id),
      servico.esperar(b.id),
      servico.esperar(c.id),
    ];

    await servico.decidir({ id: a.id, decisao: "permitir" });
    await servico.decidir({ id: b.id, decisao: "negar" });
    await servico.decidir({ id: c.id, decisao: "negar", mensagem: "Agora não, rode só os testes" });

    const [a1, a2, nb, nc] = await Promise.all(esperas);
    expect(a1).toEqual(a2);
    expect(a1).toMatchObject({ aprovacao: { estado: "aprovada" }, mensagem: null });
    expect(nb).toMatchObject({ aprovacao: { estado: "negada" }, mensagem: MENSAGEM_NEGADO });
    expect(nc).toMatchObject({ aprovacao: { estado: "negada" }, mensagem: "Agora não, rode só os testes" });
    expect(avisos.map((x) => x.estado)).toEqual([
      "pendente",
      "pendente",
      "pendente",
      "aprovada",
      "negada",
      "negada",
    ]);
    expect(await servico.pendentes()).toEqual([]);
    const linha = db.prepare("SELECT origem FROM aprovacoes WHERE id = ?").get(a.id);
    expect(linha).toEqual({ origem: "usuario" });
  });

  test("cartão já decidido volta como está e não muda de decisão", async () => {
    const { db, servico, avisos } = montar();
    sessaoEm(db, "moductus", "s1");
    const a = cartao(servico, doTerminal("s1"));
    const aprovada = await servico.decidir({ id: a.id, decisao: "permitir" });
    expect(await servico.decidir({ id: a.id, decisao: "negar", sempre: "projeto" })).toEqual(aprovada);
    expect(avisos).toHaveLength(2);
    expect(servico.regras()).toEqual([]);
    expect(await servico.esperar(a.id)).toEqual({ aprovacao: aprovada, mensagem: null });
    await expect(servico.decidir({ id: "nao-existe", decisao: "permitir" })).rejects.toThrow(
      "aprovação não encontrada",
    );
  });

  test("desistir de esperar não mexe no cartão", async () => {
    const { db, servico } = montar();
    sessaoEm(db, "moductus", "s1");
    const a = cartao(servico, doTerminal("s1"));
    const controle = new AbortController();
    const espera = servico.esperar(a.id, controle.signal);
    controle.abort(new Error("o hook desistiu"));
    await expect(espera).rejects.toThrow("o hook desistiu");
    expect(await servico.pendentes()).toEqual([a]);
    await expect(servico.esperar(a.id, controle.signal)).rejects.toThrow("o hook desistiu");
  });

  test("pedido fora da forma é recusado sem gravar", async () => {
    const { servico } = montar();
    expect(() => servico.pedir({ ...doNuno(1), agenteId: null })).toThrow("precisa do agente");
    expect(() => servico.pedir({ ...doTerminal("s1"), agenteId: "nuno" })).toThrow("não tem agente");
    expect(() => servico.pedir({ ...doNuno(1), acao: { ...doNuno(1).acao, rotulo: null } })).toThrow();
    expect(() => servico.pedir({ ...doTerminal("s1"), descricao: "" })).toThrow();
    expect(await servico.pendentes()).toEqual([]);
  });
});

describe("regras de permissão", () => {
  test("sempre neste projeto: a regra decide o próximo pedido igual sem cartão, também em outra sessão do projeto", async () => {
    const { db, servico, avisos, regrasAvisadas } = montar();
    sessaoEm(db, "moductus", "s1");
    sessaoEm(db, "moductus", "s2");
    sessaoEm(db, "outro", "s3");
    const a = cartao(servico, doTerminal("s1"));

    const decidida = await servico.decidir({ id: a.id, decisao: "permitir", sempre: "projeto" });
    const [regra] = servico.regras();
    expect(RegraPermissao.parse(regra)).toEqual({
      id: decidida.regraCriadaId,
      escopo: "projeto",
      projetoId: "moductus",
      agenteId: null,
      ferramenta: "Bash",
      padrao: "pnpm test",
      decisao: "permitir",
      criadoEm: AGORA,
      expiraEm: null,
    });
    expect(regrasAvisadas).toEqual([[regra]]);

    const avisosAntes = avisos.length;
    expect(servico.pedir(doTerminal("s1"))).toEqual({ tipo: "regra", decisao: "permitir", regra });
    expect(servico.pedir(doTerminal("s2", "  pnpm test "))).toEqual({
      tipo: "regra",
      decisao: "permitir",
      regra,
    });
    expect(avisos).toHaveLength(avisosAntes);
    expect(await servico.pendentes()).toEqual([]);

    // Outro comando ou outro projeto: cartão.
    expect(servico.pedir(doTerminal("s1", "pnpm test && rm -rf .")).tipo).toBe("cartao");
    expect(servico.pedir(doTerminal("s3")).tipo).toBe("cartao");
  });

  test("sempre para este agente: a regra cobre o mesmo pedido daquele agente, não outro PR nem outro agente", async () => {
    const { servico } = montar();
    const a = cartao(servico, doNuno(12));
    const decidida = await servico.decidir({ id: a.id, decisao: "permitir", sempre: "agente" });
    expect(servico.regras()).toEqual([
      expect.objectContaining({
        id: decidida.regraCriadaId,
        escopo: "agente",
        agenteId: "nuno",
        projetoId: null,
        ferramenta: "github.comentar",
        padrao: '{"numero":12,"repositorio":"gustavo/moductus","texto":"CI verde de novo."}',
      }),
    ]);
    expect(servico.pedir(doNuno(12))).toMatchObject({ tipo: "regra", decisao: "permitir" });
    expect(servico.pedir(doNuno(13)).tipo).toBe("cartao");
    expect(servico.pedir(doNuno(12, "alba")).tipo).toBe("cartao");
  });

  test("arquivo: a regra do projeto cobre o mesmo caminho dentro da pasta do projeto, e nada fora dela", async () => {
    const { db, servico } = montar();
    sessaoEm(db, "moductus", "s1", "V:\\moductus");
    const editar = (file_path: string) => doTerminalCom("s1", { ...ler(file_path), ferramenta: "Edit" });
    const a = cartao(servico, editar("V:\\moductus\\src\\a.ts"));
    await servico.decidir({ id: a.id, decisao: "permitir", sempre: "projeto" });
    expect(servico.regras()).toEqual([expect.objectContaining({ padrao: "V:\\moductus\\src\\a.ts" })]);

    // O mesmo arquivo escrito de outro jeito passa; outro arquivo ou `..` para fora pede cartão.
    expect(servico.pedir(editar("v:/moductus/src/a.ts")).tipo).toBe("regra");
    expect(servico.pedir(editar("V:\\moductus\\src\\x\\..\\a.ts")).tipo).toBe("regra");
    expect(servico.pedir(editar("V:\\moductus\\src\\b.ts")).tipo).toBe("cartao");
    expect(servico.pedir(editar("V:\\moductus\\..\\outro\\src\\a.ts")).tipo).toBe("cartao");
    expect(servico.pedir(editar("src\\a.ts")).tipo).toBe("cartao");

    // Fora do projeto não vira regra do projeto, nem uma regra gravada assim cobre o pedido.
    const fora = cartao(servico, editar("V:\\moductus2\\a.ts"));
    await expect(servico.decidir({ id: fora.id, decisao: "permitir", sempre: "projeto" })).rejects.toThrow(
      "fora do projeto",
    );
    new RepositorioAprovacoes(db).inserirRegra({
      id: "01K79Z6N7Q4W3J5XG2B8C1D0ER",
      escopo: "projeto",
      projetoId: "moductus",
      agenteId: null,
      ferramenta: "Edit",
      padrao: "V:\\moductus2\\a.ts",
      decisao: "permitir",
      criadoEm: AGORA,
      expiraEm: null,
    });
    expect(servico.pedir(editar("V:\\moductus2\\a.ts")).tipo).toBe("cartao");
  });

  test("busca na web: a regra cobre o mesmo domínio", async () => {
    const { db, servico } = montar();
    sessaoEm(db, "moductus", "s1");
    const buscar = (url: string) =>
      doTerminalCom("s1", { ferramenta: "WebFetch", entrada: { url, prompt: "resuma" } });
    const a = cartao(servico, buscar("https://docs.anthropic.com/hooks"));
    await servico.decidir({ id: a.id, decisao: "permitir", sempre: "projeto" });
    expect(servico.regras()).toEqual([expect.objectContaining({ padrao: "docs.anthropic.com" })]);
    expect(servico.pedir(buscar("https://DOCS.anthropic.com/outra")).tipo).toBe("regra");
    expect(servico.pedir(buscar("https://exemplo.com/docs.anthropic.com")).tipo).toBe("cartao");
    expect(servico.pedir(buscar("não é endereço")).tipo).toBe("cartao");
  });

  test("ferramenta de MCP: a regra cobre a mesma entrada, em qualquer ordem de chaves", async () => {
    const { db, servico } = montar();
    sessaoEm(db, "moductus", "s1");
    const issue = (entrada: object) =>
      doTerminalCom("s1", { ferramenta: "mcp__github__create_issue", entrada });
    const a = cartao(servico, issue({ title: "Falha no CI", body: "Logs", labels: ["ci", "bug"] }));
    await servico.decidir({ id: a.id, decisao: "permitir", sempre: "projeto" });
    expect(servico.pedir(issue({ labels: ["ci", "bug"], body: "Logs", title: "Falha no CI" })).tipo).toBe(
      "regra",
    );
    expect(servico.pedir(issue({ title: "Outra", body: "Logs", labels: ["ci", "bug"] })).tipo).toBe("cartao");
    expect(servico.pedir(issue({ title: "Falha no CI", body: "Logs", labels: ["bug", "ci"] })).tipo).toBe(
      "cartao",
    );
  });

  test("negar com sempre cria regra que nega; com as duas cobrindo, negar ganha", async () => {
    const { db, servico } = montar();
    sessaoEm(db, "moductus", "s1");
    const a = cartao(servico, doTerminal("s1", "git push"));
    await servico.decidir({ id: a.id, decisao: "negar", sempre: "projeto" });
    expect(servico.pedir(doTerminal("s1", "git push"))).toMatchObject({ tipo: "regra", decisao: "negar" });

    // Uma regra que permite o mesmo comando não passa por cima da que nega.
    new RepositorioAprovacoes(db).inserirRegra({
      id: "01K79Z6N7Q4W3J5XG2B8C1D0EP",
      escopo: "projeto",
      projetoId: "moductus",
      agenteId: null,
      ferramenta: "Bash",
      padrao: "git push",
      decisao: "permitir",
      criadoEm: AGORA,
      expiraEm: null,
    });
    expect(servico.pedir(doTerminal("s1", "git push"))).toMatchObject({ tipo: "regra", decisao: "negar" });
    expect(servico.pedir(doTerminal("s1", "git status")).tipo).toBe("cartao");
  });

  test("regra removida ou vencida não decide mais", async () => {
    const { db, servico, regrasAvisadas, andar } = montar();
    sessaoEm(db, "moductus", "s1");
    const a = cartao(servico, doTerminal("s1"));
    const { regraCriadaId } = await servico.decidir({ id: a.id, decisao: "permitir", sempre: "projeto" });
    expect(servico.removerRegra({ id: regraCriadaId ?? "" })).toEqual([]);
    expect(regrasAvisadas.at(-1)).toEqual([]);
    expect(servico.pedir(doTerminal("s1")).tipo).toBe("cartao");
    expect(() => servico.removerRegra({ id: regraCriadaId ?? "" })).toThrow("regra não encontrada");
    expect(db.prepare("SELECT apagado_em FROM regras_permissao").get()).toEqual({ apagado_em: AGORA });

    new RepositorioAprovacoes(db).inserirRegra({
      id: "01K79Z6N7Q4W3J5XG2B8C1D0EQ",
      escopo: "projeto",
      projetoId: "moductus",
      agenteId: null,
      ferramenta: "Bash",
      padrao: "pnpm lint",
      decisao: "permitir",
      criadoEm: AGORA,
      expiraEm: "2026-10-09T13:00:00.000Z",
    });
    expect(servico.pedir(doTerminal("s1", "pnpm lint")).tipo).toBe("regra");
    andar(60 * 60_000);
    expect(servico.pedir(doTerminal("s1", "pnpm lint")).tipo).toBe("cartao");
    expect(servico.regras()).toEqual([]);
  });

  test("sempre sem projeto, sem agente ou sem comando é recusado e o cartão continua pendente", async () => {
    const { db, servico } = montar();
    sessaoEm(db, "moductus", "s1");
    const semSessao = cartao(servico, { ...doTerminal("s1"), sessaoId: null });
    const doTerm = cartao(servico, doTerminal("s1"));
    const semComando = cartao(servico, { ...doTerminal("s1"), acao: { ...bash(""), entrada: {} } });
    const doAgente = cartao(servico, doNuno(12));

    await expect(
      servico.decidir({ id: semSessao.id, decisao: "permitir", sempre: "projeto" }),
    ).rejects.toThrow("não tem projeto");
    await expect(servico.decidir({ id: doTerm.id, decisao: "permitir", sempre: "agente" })).rejects.toThrow(
      "não vem de um agente",
    );
    await expect(
      servico.decidir({ id: semComando.id, decisao: "permitir", sempre: "projeto" }),
    ).rejects.toThrow("não tem comando");
    await expect(
      servico.decidir({ id: doAgente.id, decisao: "permitir", sempre: "projeto" }),
    ).rejects.toThrow("não tem projeto");
    expect((await servico.pendentes()).map((x) => x.id)).toEqual([
      semSessao.id,
      doTerm.id,
      semComando.id,
      doAgente.id,
    ]);
    expect(servico.regras()).toEqual([]);
  });
});

describe("expirar quando a situação muda", () => {
  test("situação que caiu expira o cartão ao listar e libera quem espera; a que falha não derruba", async () => {
    const { servico, avisos } = montar();
    const a = cartao(servico, doNuno(12));
    const b = cartao(servico, doNuno(13));
    const fechados = new Set<number>();
    servico.registrarSituacao((x) => !fechados.has((x.acao.entrada as { numero: number }).numero));
    servico.registrarSituacao(() => {
      throw new Error("gh fora do ar");
    });
    const espera = servico.esperar(a.id);

    expect(await servico.pendentes()).toEqual([a, b]);
    fechados.add(12);
    expect(await servico.pendentes()).toEqual([b]);
    expect(await espera).toMatchObject({ aprovacao: { id: a.id, estado: "expirada", decididaEm: AGORA } });
    expect(avisos.at(-1)).toMatchObject({ id: a.id, estado: "expirada" });
  });

  test("decidir um cartão cuja situação mudou expira em vez de decidir", async () => {
    const { servico } = montar();
    const a = cartao(servico, doNuno(12));
    const tirar = servico.registrarSituacao(() => false);
    expect(await servico.decidir({ id: a.id, decisao: "permitir", sempre: "agente" })).toMatchObject({
      estado: "expirada",
      regraCriadaId: null,
    });
    expect(servico.regras()).toEqual([]);
    tirar();
    expect(await servico.conferir()).toEqual([]);
  });

  test("a sessão do terminal terminou: os cartões dela expiram, os das outras não", async () => {
    const { db, servico } = montar();
    sessaoEm(db, "moductus", "s1");
    sessaoEm(db, "moductus", "s2");
    const a = cartao(servico, doTerminal("s1"));
    const b = cartao(servico, doTerminal("s2"));
    expect(servico.expirarDaSessao("s1").map((x) => [x.id, x.estado])).toEqual([[a.id, "expirada"]]);
    expect(await servico.pendentes()).toEqual([b]);
    expect(servico.expirar(a.id)).toBeNull();
  });

  test("admiteSempre segue o critério da regra: padrão, projeto da sessão e arquivo dentro dele", async () => {
    const { db, servico } = montar();
    sessaoEm(db, "moductus", "s1", "V:\\moductus");
    const editar = (file_path: string) => doTerminalCom("s1", { ...ler(file_path), ferramenta: "Edit" });
    const casos = {
      comando: cartao(servico, doTerminal("s1")),
      semComando: cartao(servico, { ...doTerminal("s1"), acao: { ...bash(""), entrada: {} } }),
      semSessao: cartao(servico, { ...doTerminal("s1"), sessaoId: null }),
      arquivoDentro: cartao(servico, editar("V:\\moductus\\src\\a.ts")),
      arquivoFora: cartao(servico, editar("C:\\Windows\\win.ini")),
      doAgente: cartao(servico, doNuno(12)),
    };
    const esperado = {
      comando: true,
      semComando: false,
      semSessao: false,
      arquivoDentro: true,
      arquivoFora: false,
      doAgente: true,
    };
    const doPedido = Object.fromEntries(Object.entries(casos).map(([k, a]) => [k, a.admiteSempre]));
    expect(doPedido).toEqual(esperado);
    // Relido do banco (depois de reabrir, pela lista), o cálculo é o mesmo.
    const lidos = new Map((await servico.pendentes()).map((a) => [a.id, a.admiteSempre]));
    expect(Object.fromEntries(Object.entries(casos).map(([k, a]) => [k, lidos.get(a.id)]))).toEqual(esperado);
  });
});
