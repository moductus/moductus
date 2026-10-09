import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  CONFIG_PADRAO,
  type AcaoAprovacao,
  type EstadoNotificacoes,
  type Notificacao,
  type Silencio,
} from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { RepositorioAgentes } from "../agentes/agentes.ts";
import { RepositorioAprovacoes, ServicoAprovacoes } from "../aprovacoes/aprovacoes.ts";
import { abrirBanco } from "../banco/conexao.ts";
import { RepositorioSessoes } from "../sessoes/sessoes.ts";
import { avisarAprovacoes, botoesDoCartao, resumoDaAcao } from "./aprovacoes.ts";
import { avisarContexto } from "./nuno.ts";
import {
  dentroDoHorario,
  entregaPela,
  RepositorioNotificacoes,
  ServicoNotificacoes,
  type AvisoWindows,
  type NovoAviso,
} from "./notificacoes.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** 12:00 no horário local do PC, que é o relógio do horário de silêncio. */
const MEIO_DIA = new Date(2026, 9, 9, 12, 0);

/**
 * Banco migrado de verdade, relógio na mão e uma casca de mentira que só anota: nenhum aviso
 * chega ao Windows. `telaCheia` diz o que a casca responde e conta as perguntas.
 */
function montar(opcoes: { silencio?: Partial<Silencio>; emFoco?: boolean; cascaFalha?: boolean } = {}) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-notificacoes-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  let agora = MEIO_DIA;
  let silencio: Silencio = { ...CONFIG_PADRAO.silencio, ...opcoes.silencio };
  const casca = {
    mostrados: [] as AvisoWindows[],
    retirados: [] as string[],
    telaCheia: false,
    perguntas: 0,
    /** O que acontece enquanto a casca responde (a decisão chegando no meio). */
    durante: {} as { telaCheia?: () => Promise<void>; mostrar?: () => Promise<void> },
  };
  const eventos = {
    estados: [] as EstadoNotificacoes[],
    novas: [] as Notificacao[],
    naoVistas: [] as Notificacao[][],
  };
  const agentes = new RepositorioAgentes(db);
  const servico = new ServicoNotificacoes(
    new RepositorioNotificacoes(db),
    {
      agentes: () => agentes.agentes().map((a) => ({ id: a.id, nome: a.nome })),
      silencio: () => silencio,
      emFoco: () => opcoes.emFoco ?? false,
      windows: {
        mostrar: async (aviso) => {
          if (opcoes.cascaFalha) throw new Error("a casca não respondeu");
          await casca.durante.mostrar?.();
          casca.mostrados.push(aviso);
        },
        retirar: (id) => {
          casca.retirados.push(id);
          return Promise.resolve();
        },
        telaCheia: async () => {
          casca.perguntas++;
          await casca.durante.telaCheia?.();
          return casca.telaCheia;
        },
      },
    },
    {
      estado: (e) => eventos.estados.push(e),
      nova: (n) => eventos.novas.push(n),
      naoVistas: (n) => eventos.naoVistas.push(n),
    },
    { agora: () => agora },
  );
  const linhas = () =>
    db
      .prepare("SELECT do_agente_id, tipo, titulo, referencia, canal, vista_em FROM notificacoes ORDER BY id")
      .all();
  return {
    db,
    servico,
    casca,
    eventos,
    linhas,
    ir: (data: Date) => (agora = data),
    silenciar: (s: Partial<Silencio>) => (silencio = { ...silencio, ...s }),
  };
}

const lembrete = (extra: Partial<NovoAviso> = {}): NovoAviso => ({
  agenteId: "alba",
  tipo: "lembrete",
  titulo: "Ligar pro banco",
  corpo: "Daqui a 10 minutos.",
  ...extra,
});

describe("entrega pela preferência", () => {
  test("tudo avisa qualquer tipo; só o que precisa, aprovação, lembrete e erro; nada, nenhum", () => {
    const tipos = ["aprovacao", "lembrete", "erro", "aviso", "rotina"] as const;
    const avisa = (nivel: "tudo" | "so_o_que_precisa" | "nada") =>
      tipos.filter((t) => entregaPela({ nivel, canal: "ambos" }, t).avisa);
    expect(avisa("tudo")).toEqual(tipos);
    expect(avisa("so_o_que_precisa")).toEqual(["aprovacao", "lembrete", "erro"]);
    expect(avisa("nada")).toEqual([]);
  });

  test("o canal escolhe ponto, Windows ou os dois", () => {
    expect(entregaPela({ nivel: "tudo", canal: "dock" }, "aviso")).toEqual({
      avisa: true,
      ponto: true,
      windows: false,
    });
    expect(entregaPela({ nivel: "tudo", canal: "windows" }, "aviso")).toEqual({
      avisa: true,
      ponto: false,
      windows: true,
    });
    expect(entregaPela({ nivel: "tudo", canal: "ambos" }, "aviso")).toEqual({
      avisa: true,
      ponto: true,
      windows: true,
    });
  });

  test("horário de silêncio atravessa a meia-noite e início igual ao fim não silencia", () => {
    const as = (h: number, m: number) => new Date(2026, 9, 9, h, m);
    expect(dentroDoHorario(as(23, 0), "22:00", "07:30")).toBe(true);
    expect(dentroDoHorario(as(7, 29), "22:00", "07:30")).toBe(true);
    expect(dentroDoHorario(as(7, 30), "22:00", "07:30")).toBe(false);
    expect(dentroDoHorario(as(21, 59), "22:00", "07:30")).toBe(false);
    expect(dentroDoHorario(as(13, 0), "12:00", "14:00")).toBe(true);
    expect(dentroDoHorario(as(14, 0), "12:00", "14:00")).toBe(false);
    expect(dentroDoHorario(as(9, 0), "09:00", "09:00")).toBe(false);
  });
});

describe("avisar", () => {
  test("padrão: lembrete sai no Windows e no ponto, com o nome do agente", async () => {
    const { servico, casca, eventos } = montar();
    const n = await servico.avisar(lembrete({ referencia: "lembrete:1" }));
    expect(n).toMatchObject({ agenteId: "alba", tipo: "lembrete", canal: "ambos", vistaEm: null });
    expect(casca.mostrados).toEqual([
      { id: n.id, agente: "Alba", titulo: "Ligar pro banco", corpo: "Daqui a 10 minutos.", botoes: [] },
    ]);
    expect(eventos.novas.map((x) => x.id)).toEqual([n.id]);
    expect(servico.naoVistas().map((x) => x.id)).toEqual([n.id]);
  });

  test('nível "nada" não avisa e registra: sem Windows, sem ponto, no histórico já visto', async () => {
    const { servico, casca, eventos, linhas } = montar();
    servico.definir({ agenteId: "alba", nivel: "nada", canal: "ambos" });
    const n = await servico.avisar(lembrete());
    expect(casca.mostrados).toEqual([]);
    expect(eventos.novas).toEqual([]);
    expect(eventos.naoVistas).toEqual([]);
    expect(servico.naoVistas()).toEqual([]);
    expect(n.vistaEm).toBe(MEIO_DIA.toISOString());
    expect(linhas()).toEqual([
      expect.objectContaining({ do_agente_id: "alba", tipo: "lembrete", titulo: "Ligar pro banco" }),
    ]);
    expect(servico.listar({}).itens.map((x) => x.id)).toEqual([n.id]);
  });

  test('"só o que precisa de mim" registra o aviso comum sem avisar e avisa o erro', async () => {
    const { servico, casca } = montar();
    const comum = await servico.avisar({ agenteId: "nuno", tipo: "aviso", titulo: "Contexto em 82%" });
    const erro = await servico.avisar({ agenteId: "nuno", tipo: "erro", titulo: "CI quebrou em moductus" });
    expect(comum.vistaEm).not.toBeNull();
    expect(casca.mostrados.map((m) => m.id)).toEqual([erro.id]);
    expect(servico.naoVistas().map((x) => x.id)).toEqual([erro.id]);
  });

  test("a do agente vence a geral, que vence o padrão; restaurar volta à geral", async () => {
    const { servico, eventos } = montar();
    servico.definir({ agenteId: null, nivel: "tudo", canal: "dock" });
    servico.definir({ agenteId: "nuno", tipo: "aviso", nivel: "nada", canal: "windows" });
    expect(servico.preferenciaDe("alba", "rotina")).toEqual({ nivel: "tudo", canal: "dock" });
    expect(servico.preferenciaDe("nuno", "aviso")).toMatchObject({ nivel: "nada", canal: "windows" });
    expect(servico.preferenciaDe("nuno", "erro")).toMatchObject({ nivel: "tudo", canal: "dock" });

    const estado = servico.obter();
    expect(estado.preferencias).toHaveLength(4 * 5);
    expect(estado.preferencias.find((p) => p.agenteId === "nuno" && p.tipo === "aviso")).toEqual({
      agenteId: "nuno",
      tipo: "aviso",
      nivel: "nada",
      canal: "windows",
      definida: true,
    });
    expect(estado.preferencias.find((p) => p.agenteId === "tula" && p.tipo === "aviso")?.definida).toBe(
      false,
    );

    servico.restaurar({ agenteId: "nuno" });
    expect(servico.preferenciaDe("nuno", "aviso")).toMatchObject({ nivel: "tudo", canal: "dock" });
    servico.restaurar({ agenteId: null });
    expect(servico.preferenciaDe("nuno", "aviso")).toEqual({ nivel: "so_o_que_precisa", canal: "ambos" });
    expect(eventos.estados).toHaveLength(4);
  });

  test("mudar de novo a mesma preferência substitui, sem duplicar", () => {
    const { servico, db } = montar();
    servico.definir({ agenteId: "alba", nivel: "tudo", canal: "dock" });
    servico.definir({ agenteId: "alba", nivel: "nada", canal: "ambos" });
    expect(db.prepare("SELECT count(*) AS n FROM notificacoes_preferencias").get()).toEqual({ n: 5 });
    expect(servico.preferenciaDe("alba", "lembrete")).toMatchObject({ nivel: "nada", canal: "ambos" });
  });

  test("só o ponto: sem Windows; só o Windows: sem ponto", async () => {
    const { servico, casca } = montar();
    servico.definir({ agenteId: "alba", nivel: "tudo", canal: "dock" });
    servico.definir({ agenteId: "tula", nivel: "tudo", canal: "windows" });
    const daAlba = await servico.avisar(lembrete());
    const daTula = await servico.avisar({ agenteId: "tula", tipo: "aviso", titulo: "Fatura vence amanhã" });
    expect(casca.mostrados.map((m) => m.id)).toEqual([daTula.id]);
    expect(servico.naoVistas().map((x) => x.id)).toEqual([daAlba.id]);
  });

  test("enquanto o aviso da mesma referência não foi visto, não repete", async () => {
    const { servico, casca } = montar();
    const primeiro = await servico.avisar(lembrete({ referencia: "lembrete:1" }));
    const repetido = await servico.avisar(lembrete({ referencia: "lembrete:1" }));
    expect(repetido.id).toBe(primeiro.id);
    expect(casca.mostrados).toHaveLength(1);
    servico.marcarVistas({ ids: [primeiro.id] });
    const depois = await servico.avisar(lembrete({ referencia: "lembrete:1" }));
    expect(depois.id).not.toBe(primeiro.id);
  });

  test("casca fora do ar não derruba o aviso: ele fica no histórico e no ponto", async () => {
    const { servico } = montar({ cascaFalha: true });
    const n = await servico.avisar(lembrete());
    expect(servico.naoVistas().map((x) => x.id)).toEqual([n.id]);
  });
});

describe("silêncio", () => {
  test("no horário de silêncio o Windows cala; o ponto continua", async () => {
    const { servico, casca, ir } = montar({
      silencio: { horario: { ligado: true, inicio: "22:00", fim: "07:30" } },
    });
    ir(new Date(2026, 9, 9, 23, 15));
    const n = await servico.avisar(lembrete());
    expect(casca.mostrados).toEqual([]);
    expect(servico.naoVistas().map((x) => x.id)).toEqual([n.id]);
    ir(new Date(2026, 9, 10, 8, 0));
    await servico.avisar(lembrete({ titulo: "Reunião às 9h" }));
    expect(casca.mostrados.map((m) => m.titulo)).toEqual(["Reunião às 9h"]);
  });

  test("em tela cheia o Windows cala; desligado, a casca nem é perguntada", async () => {
    const { servico, casca, silenciar } = montar();
    casca.telaCheia = true;
    await servico.avisar(lembrete());
    expect(casca.mostrados).toEqual([]);
    expect(casca.perguntas).toBe(1);

    silenciar({ telaCheia: false });
    await servico.avisar(lembrete({ titulo: "Em tela cheia, mas sem silêncio" }));
    expect(casca.mostrados).toHaveLength(1);
    expect(casca.perguntas).toBe(1);
  });

  test("durante o foco passam aprovação e lembrete; o erro espera no ponto", async () => {
    const { servico, casca } = montar({ emFoco: true });
    await servico.avisar(lembrete());
    const erro = await servico.avisar({ agenteId: "nuno", tipo: "erro", titulo: "CI quebrou" });
    expect(casca.mostrados.map((m) => m.titulo)).toEqual(["Ligar pro banco"]);
    expect(servico.naoVistas().map((x) => x.id)).toContain(erro.id);
  });
});

describe("visto", () => {
  test("marcar as de um agente tira o ponto só dele e avisa o dock", async () => {
    const { servico, eventos } = montar();
    await servico.avisar(lembrete());
    const doNuno = await servico.avisar({ agenteId: "nuno", tipo: "erro", titulo: "CI quebrou" });
    const restantes = servico.marcarVistas({ agenteId: "alba" });
    expect(restantes.map((x) => x.id)).toEqual([doNuno.id]);
    expect(eventos.naoVistas.at(-1)?.map((x) => x.id)).toEqual([doNuno.id]);
  });

  test("clique no corpo do aviso só marca como visto", async () => {
    const { servico } = montar();
    const n = await servico.avisar(lembrete({ referencia: "aprovacao:x" }));
    let chamadas = 0;
    servico.registrarAcao("aprovacao", () => Promise.resolve(chamadas++ >= 0));
    await servico.aoClicar(n.id, null);
    expect(servico.naoVistas()).toEqual([]);
    expect(chamadas).toBe(0);
  });
});

/** Um projeto e uma sessão do Claude Code nele, como os hooks gravariam. */
function sessaoEm(db: DatabaseSync, projeto: string, sessao: string) {
  const repo = new RepositorioSessoes(db);
  const agora = MEIO_DIA.toISOString();
  repo.criarProjeto(projeto, projeto, `V:\\${projeto}`, agora);
  repo.criarSessao({
    id: sessao,
    projetoId: projeto,
    ferramenta: "claude-code",
    idExterno: `externo-${sessao}`,
    modelo: null,
    estado: "esperando",
    agora,
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

/** Aprovações de verdade ligadas às notificações, como no main.ts. */
function comAprovacoes(montado: ReturnType<typeof montar>) {
  const nomes = new RepositorioAgentes(montado.db);
  let mudou: (a: Parameters<ReturnType<typeof avisarAprovacoes>>[0]) => Promise<void> = () =>
    Promise.resolve();
  const pendentes: Promise<void>[] = [];
  const aprovacoes = new ServicoAprovacoes(
    new RepositorioAprovacoes(montado.db),
    { aprovacao: (a) => pendentes.push(mudou(a)), regras: () => undefined },
    { agora: () => MEIO_DIA },
  );
  const sessoes = new RepositorioSessoes(montado.db);
  mudou = avisarAprovacoes(
    montado.servico,
    { obter: (id) => aprovacoes.obter(id), decidir: (pedido) => aprovacoes.decidir(pedido) },
    {
      nomeDoAgente: (id) => nomes.agente(id)?.nome ?? null,
      projetoDaSessao: (id) => {
        const projetoId = sessoes.sessao(id)?.projetoId;
        return projetoId ? (sessoes.projeto(projetoId)?.nome ?? null) : null;
      },
    },
  );
  const assentar = async () => {
    while (pendentes.length > 0) await Promise.all(pendentes.splice(0));
  };
  return { aprovacoes, assentar };
}

describe("aprovação pendente", () => {
  test("gera um aviso com os botões do cartão; clicar em permitir decide e retira o aviso", async () => {
    const montado = montar();
    const { servico, casca, db } = montado;
    const { aprovacoes, assentar } = comAprovacoes(montado);
    sessaoEm(db, "moductus", "s1");

    const pedido = aprovacoes.pedir({
      fonte: "claude-code",
      sessaoId: "s1",
      descricao: "O Claude Code quer rodar pnpm test em moductus.",
      acao: bash("pnpm test"),
    });
    await assentar();
    if (pedido.tipo !== "cartao") throw new Error("esperava cartão");
    const aprovacao = pedido.aprovacao;

    expect(casca.mostrados).toHaveLength(1);
    const aviso = casca.mostrados[0]!;
    expect(aviso).toMatchObject({
      agente: "Nuno",
      titulo: "Claude Code pede permissão",
      // Na tela de bloqueio e na Central de Notificações, só o resumo: o comando fica no cartão.
      corpo: "Claude Code quer rodar um comando em moductus.",
    });
    expect(JSON.stringify(aviso)).not.toContain("pnpm test");
    // Os mesmos do cartão do terminal: Negar, Sempre neste projeto e Permitir.
    expect(aviso.botoes).toEqual(botoesDoCartao(aprovacao));
    expect(aviso.botoes.map((b) => b.rotulo)).toEqual(["Negar", "Sempre neste projeto", "Permitir"]);
    expect(servico.naoVistas()).toEqual([
      expect.objectContaining({
        id: aviso.id,
        agenteId: "nuno",
        tipo: "aprovacao",
        referencia: `aprovacao:${aprovacao.id}`,
      }),
    ]);

    await servico.aoClicar(aviso.id, "permitir");
    await assentar();
    expect((await aprovacoes.pendentes()).map((a) => a.id)).toEqual([]);
    expect(db.prepare("SELECT estado FROM aprovacoes WHERE id = ?").get(aprovacao.id)).toEqual({
      estado: "aprovada",
    });
    expect(casca.retirados).toEqual([aviso.id]);
    expect(servico.naoVistas()).toEqual([]);
  });

  test('"Sempre neste projeto" no aviso cria a regra; negar no cartão retira o aviso', async () => {
    const montado = montar();
    const { servico, casca, db } = montado;
    const { aprovacoes, assentar } = comAprovacoes(montado);
    sessaoEm(db, "moductus", "s1");

    const primeiro = aprovacoes.pedir({
      fonte: "claude-code",
      sessaoId: "s1",
      descricao: "pnpm lint",
      acao: bash("pnpm lint"),
    });
    await assentar();
    await servico.aoClicar(casca.mostrados[0]!.id, "sempre");
    await assentar();
    expect(aprovacoes.regras()).toHaveLength(1);
    // O próximo pedido igual a regra decide, sem cartão nem aviso.
    expect(
      aprovacoes.pedir({
        fonte: "claude-code",
        sessaoId: "s1",
        descricao: "pnpm lint",
        acao: bash("pnpm lint"),
      }).tipo,
    ).toBe("regra");
    expect(primeiro.tipo).toBe("cartao");

    const outro = aprovacoes.pedir({
      fonte: "claude-code",
      sessaoId: "s1",
      descricao: "rm -rf dist",
      acao: bash("rm -rf dist"),
    });
    await assentar();
    if (outro.tipo !== "cartao") throw new Error("esperava cartão");
    await aprovacoes.decidir({ id: outro.aprovacao.id, decisao: "negar" });
    await assentar();
    expect(casca.mostrados).toHaveLength(2);
    expect(casca.retirados).toEqual([casca.mostrados[0]!.id, casca.mostrados[1]!.id]);
    expect(servico.naoVistas()).toEqual([]);
  });

  test("pedido de agente usa os rótulos do cartão e sai em nome do agente", async () => {
    const montado = montar();
    const { casca } = montado;
    const { aprovacoes, assentar } = comAprovacoes(montado);
    aprovacoes.pedir({
      fonte: "moductus",
      agenteId: "faina",
      descricao: "142 arquivos em 6 pastas. A lista está no painel.",
      acao: {
        ferramenta: "arquivos.organizar",
        entrada: { pasta: "Downloads" },
        rotulo: "Organizar 142 arquivos",
        rotuloRecusar: "Depois",
        desfazivel: true,
      },
    });
    await assentar();
    expect(casca.mostrados[0]).toMatchObject({
      agente: "Faina",
      titulo: "Faina pede sua aprovação",
      botoes: [
        { id: "negar", rotulo: "Depois" },
        { id: "permitir", rotulo: "Organizar 142 arquivos" },
      ],
    });
  });

  test('com "nada" para aprovações do Nuno, o pedido fica só registrado e o cartão segue no dock', async () => {
    const montado = montar();
    const { servico, casca, db } = montado;
    const { aprovacoes, assentar } = comAprovacoes(montado);
    sessaoEm(db, "moductus", "s1");
    servico.definir({ agenteId: "nuno", tipo: "aprovacao", nivel: "nada", canal: "ambos" });
    aprovacoes.pedir({
      fonte: "claude-code",
      sessaoId: "s1",
      descricao: "pnpm test",
      acao: bash("pnpm test"),
    });
    await assentar();
    expect(casca.mostrados).toEqual([]);
    expect(servico.naoVistas()).toEqual([]);
    expect(servico.listar({}).itens).toEqual([
      expect.objectContaining({ tipo: "aprovacao", agenteId: "nuno" }),
    ]);
    expect(await aprovacoes.pendentes()).toHaveLength(1);
  });

  /** Um pedido do Claude Code na sessão s1 de moductus, já com o aviso mostrado. */
  async function pedidoComAviso(montado: ReturnType<typeof montar>, command = "pnpm test") {
    const { aprovacoes, assentar } = comAprovacoes(montado);
    if (!montado.db.prepare("SELECT 1 FROM sessoes_ia WHERE id = 's1'").get()) {
      sessaoEm(montado.db, "moductus", "s1");
    }
    const pedido = aprovacoes.pedir({
      fonte: "claude-code",
      sessaoId: "s1",
      descricao: command,
      acao: bash(command),
    });
    await assentar();
    if (pedido.tipo !== "cartao") throw new Error("esperava cartão");
    return { aprovacoes, assentar, aprovacao: pedido.aprovacao, aviso: montado.casca.mostrados.at(-1)! };
  }

  const estadoDe = (db: DatabaseSync, id: string) =>
    (db.prepare("SELECT estado FROM aprovacoes WHERE id = ?").get(id) as { estado: string }).estado;

  test("clique em aviso de cartão já decidido ou expirado não muda nada nem cria regra", async () => {
    const montado = montar();
    const decidido = await pedidoComAviso(montado);
    await decidido.aprovacoes.decidir({ id: decidido.aprovacao.id, decisao: "negar" });
    await decidido.assentar();
    await montado.servico.aoClicar(decidido.aviso.id, "sempre");
    await montado.servico.aoClicar(decidido.aviso.id, "permitir");
    expect(estadoDe(montado.db, decidido.aprovacao.id)).toBe("negada");

    const expirado = await pedidoComAviso(montado, "pnpm build");
    expirado.aprovacoes.expirarDaSessao("s1");
    await expirado.assentar();
    await montado.servico.aoClicar(expirado.aviso.id, "permitir");
    expect(estadoDe(montado.db, expirado.aprovacao.id)).toBe("expirada");
    expect(decidido.aprovacoes.regras()).toEqual([]);
    expect(montado.servico.naoVistas()).toEqual([]);
  });

  test("botão que o aviso não oferece não decide e o aviso continua esperando", async () => {
    const montado = montar();
    const { aprovacao, aviso, aprovacoes } = await pedidoComAviso(montado);
    await montado.servico.aoClicar(aviso.id, "apagar-tudo");
    expect(estadoDe(montado.db, aprovacao.id)).toBe("pendente");
    expect(montado.servico.naoVistas().map((n) => n.id)).toEqual([aviso.id]);
    expect(aprovacoes.regras()).toEqual([]);
  });

  test('"sempre" num cartão que não admite regra é recusado: nada decidido, nada criado', async () => {
    const montado = montar();
    const { aprovacoes, assentar } = comAprovacoes(montado);
    // Sem sessão (e sem projeto), o cartão do terminal não oferece "Sempre neste projeto".
    const pedido = aprovacoes.pedir({
      fonte: "claude-code",
      descricao: "pnpm test",
      acao: bash("pnpm test"),
    });
    await assentar();
    if (pedido.tipo !== "cartao") throw new Error("esperava cartão");
    const aviso = montado.casca.mostrados[0]!;
    expect(aviso.botoes.map((b) => b.id)).toEqual(["negar", "permitir"]);
    expect(aviso.corpo).toBe("Claude Code quer rodar um comando.");
    await montado.servico.aoClicar(aviso.id, "sempre");
    expect(estadoDe(montado.db, pedido.aprovacao.id)).toBe("pendente");
    expect(aprovacoes.regras()).toEqual([]);
    expect(montado.servico.naoVistas()).toHaveLength(1);
  });

  test("cartão decidido enquanto a casca respondia a tela cheia: o aviso nem sai", async () => {
    const montado = montar();
    const { aprovacoes, assentar } = comAprovacoes(montado);
    sessaoEm(montado.db, "moductus", "s1");
    montado.casca.durante.telaCheia = async () => {
      const [pendente] = await aprovacoes.pendentes();
      await aprovacoes.decidir({ id: pendente!.id, decisao: "permitir" });
    };
    aprovacoes.pedir({ fonte: "claude-code", sessaoId: "s1", descricao: "x", acao: bash("pnpm test") });
    await assentar();
    expect(montado.casca.mostrados).toEqual([]);
    expect(montado.servico.naoVistas()).toEqual([]);
  });

  test("cartão decidido enquanto o aviso saía: o aviso é retirado depois de mostrado", async () => {
    const montado = montar();
    const { aprovacoes, assentar } = comAprovacoes(montado);
    sessaoEm(montado.db, "moductus", "s1");
    montado.casca.durante.mostrar = async () => {
      const [pendente] = await aprovacoes.pendentes();
      await aprovacoes.decidir({ id: pendente!.id, decisao: "negar" });
    };
    aprovacoes.pedir({ fonte: "claude-code", sessaoId: "s1", descricao: "x", acao: bash("pnpm test") });
    await assentar();
    const id = montado.casca.mostrados[0]!.id;
    expect(montado.casca.retirados.at(-1)).toBe(id);
  });
});

describe("resumo do pedido do terminal", () => {
  test("diz o tipo de ação, nunca o conteúdo", () => {
    expect(resumoDaAcao("Bash")).toBe("rodar um comando");
    expect(resumoDaAcao("PowerShell")).toBe("rodar um comando");
    expect(resumoDaAcao("Edit")).toBe("mudar um arquivo");
    expect(resumoDaAcao("Write")).toBe("mudar um arquivo");
    expect(resumoDaAcao("Read")).toBe("ler arquivos");
    expect(resumoDaAcao("WebFetch")).toBe("acessar a internet");
    expect(resumoDaAcao("mcp__github__create_issue")).toBe("usar uma ferramenta MCP");
    expect(resumoDaAcao("Task")).toBe("usar uma ferramenta");
  });
});

describe("aviso de contexto do Nuno", () => {
  const contexto = (sessaoId: string) => ({
    sessaoId,
    titulo: "Contexto em 80%",
    corpo: "A sessão do Claude Code em moductus chegou a 80% do contexto.",
    usadoTokens: 160_000,
    janelaTokens: 200_000,
  });
  const assentar = () => new Promise((r) => setTimeout(r, 0));

  test("passa pela preferência do Nuno e fica no banco com a sessão como referência", async () => {
    const montado = montar();
    montado.servico.definir({ agenteId: "nuno", tipo: "aviso", nivel: "tudo", canal: "dock" });
    const avisar = avisarContexto(montado.servico);
    avisar(contexto("s1"));
    await assentar();
    expect(montado.linhas()).toEqual([
      {
        do_agente_id: "nuno",
        tipo: "aviso",
        titulo: "Contexto em 80%",
        referencia: "sessao:s1",
        canal: "dock",
        vista_em: null,
      },
    ]);
    expect(montado.casca.mostrados).toEqual([]);
    // Enquanto o aviso da sessão não foi visto, o de depois da compactação não repete.
    avisar(contexto("s1"));
    await assentar();
    expect(montado.linhas()).toHaveLength(1);
    montado.servico.marcarVistas({ agenteId: "nuno" });
    avisar(contexto("s1"));
    await assentar();
    expect(montado.linhas()).toHaveLength(2);
  });

  test('no padrão ("só o que precisa de mim") o aviso comum fica só registrado', async () => {
    const montado = montar();
    avisarContexto(montado.servico)(contexto("s2"));
    await assentar();
    expect(montado.linhas()).toEqual([
      expect.objectContaining({ referencia: "sessao:s2", vista_em: expect.any(String) }),
    ]);
    expect(montado.servico.naoVistas()).toEqual([]);
    expect(montado.casca.mostrados).toEqual([]);
  });
});
