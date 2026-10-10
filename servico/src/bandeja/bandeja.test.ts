import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Agente, SituacaoAgente } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RepositorioAgentes, ServicoAgentes } from "../agentes/agentes.ts";
import { RepositorioExecucoes } from "../agentes/execucoes.ts";
import { Runtime, type ResultadoExecucao } from "../agentes/runtime.ts";
import { abrirBanco } from "../banco/conexao.ts";
import { CanalCasca } from "../casca/canal.ts";
import { Catalogo } from "../ferramentas/catalogo.ts";
import { ProvedorFalso, roteiros } from "../provedores/falso.ts";
import { RegistroProvedores } from "../provedores/registro.ts";
import {
  ateQuando,
  CLIQUE_NA_BANDEJA,
  estadoEmTexto,
  fimDaPausa,
  ligarBandeja,
  lerClique,
  montarMenu,
  type ItemBandeja,
  type MenuBandeja,
} from "./bandeja.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** Quinta, 9 de outubro, 14h no relógio local: a bandeja fala a hora de quem usa. */
const INICIO = new Date(2026, 9, 9, 14, 0).getTime();
const local = (dia: number, hora: number, minuto = 0) => new Date(2026, 9, dia, hora, minuto);

const SITUACAO: SituacaoAgente = {
  estado: "ativo",
  atividade: "ocioso",
  motivoSono: null,
  dormeAte: null,
  pausadoAte: null,
  fila: 0,
};

const rotulos = (itens: readonly ItemBandeja[] | undefined): string[] =>
  (itens ?? []).map((i) => ("separador" in i ? "---" : i.rotulo));

const item = (menu: MenuBandeja, rotulo: string) => {
  const achado = menu.itens.find((i) => !("separador" in i) && i.rotulo.startsWith(rotulo));
  if (!achado || "separador" in achado) throw new Error(`sem item ${rotulo}`);
  return achado;
};

describe("textos do menu", () => {
  test("30 minutos, 1 hora e até amanhã, que é a meia-noite local", () => {
    const agora = local(9, 14, 10);
    expect(fimDaPausa("30min", agora)).toBe(local(9, 14, 40).toISOString());
    expect(fimDaPausa("1h", agora)).toBe(local(9, 15, 10).toISOString());
    expect(fimDaPausa("amanha", agora)).toBe(local(10, 0).toISOString());
  });

  test("até quando: a próxima meia-noite pelo nome, só a hora no mesmo dia, outro dia com a data", () => {
    const agora = local(9, 23, 30);
    expect(ateQuando(local(9, 23, 45).toISOString(), agora)).toBe("até 23:45");
    expect(ateQuando(local(10, 0).toISOString(), agora)).toBe("até meia-noite");
    expect(ateQuando(local(10, 0, 30).toISOString(), agora)).toBe("até 10/10, 00:30");
    expect(ateQuando(local(11, 0).toISOString(), agora)).toBe("até 11/10, 00:00");
    expect(ateQuando(local(12, 9, 5).toISOString(), agora)).toBe("até 12/10, 09:05");
  });

  test("cada estado numa linha, com a fila que espera a volta", () => {
    const agora = local(9, 14);
    expect(estadoEmTexto(SITUACAO, agora)).toBe("ativo");
    expect(estadoEmTexto({ ...SITUACAO, atividade: "trabalhando" }, agora)).toBe("ativo");
    expect(estadoEmTexto({ ...SITUACAO, estado: "pausado" }, agora)).toBe("pausado até retomar");
    expect(
      estadoEmTexto(
        { ...SITUACAO, estado: "pausado", pausadoAte: local(9, 15).toISOString(), fila: 2 },
        agora,
      ),
    ).toBe("pausado até 15:00, 2 na fila");
    expect(
      estadoEmTexto(
        { ...SITUACAO, estado: "dormindo", motivoSono: "limite", dormeAte: local(9, 17).toISOString() },
        agora,
      ),
    ).toBe("dormindo até 17:00");
    expect(estadoEmTexto({ ...SITUACAO, estado: "dormindo", motivoSono: "fora_do_ar" }, agora)).toBe(
      "dormindo",
    );
    expect(estadoEmTexto({ ...SITUACAO, estado: "dormindo", motivoSono: "teto", fila: 1 }, agora)).toBe(
      "parado no teto de hoje, 1 na fila",
    );
    expect(estadoEmTexto({ ...SITUACAO, estado: "dormindo", motivoSono: "sem_modelo" }, agora)).toBe(
      "sem modelo",
    );
    expect(estadoEmTexto({ ...SITUACAO, estado: "desligado" }, agora)).toBe("desligado");
  });

  test("o clique vira ação; id de outra coisa é ignorado", () => {
    expect(lerClique("pausar:*:30min")).toEqual({ acao: "pausar", por: "30min" });
    expect(lerClique("pausar:tula:amanha")).toEqual({ acao: "pausar", agenteId: "tula", por: "amanha" });
    expect(lerClique("retomar:*")).toEqual({ acao: "retomar" });
    expect(lerClique("retomar:nuno")).toEqual({ acao: "retomar", agenteId: "nuno" });
    for (const outro of ["pausar:*:2h", "pausar:*", "agente:alba", "pausar-todos", "retomar:", "", 7, null]) {
      expect(lerClique(outro)).toBeNull();
    }
  });
});

describe("menu do time", () => {
  const agente = (id: string, nome: string, situacao: Partial<SituacaoAgente> = {}): Agente =>
    ({ id, nome, situacao: { ...SITUACAO, ...situacao } }) as Agente;

  test("todos ativos: pausar todos e cada agente com as três pausas; desligado sem ação", () => {
    const menu = montarMenu(
      [agente("alba", "Alba"), agente("tula", "Tula"), agente("nuno", "Nuno", { estado: "desligado" })],
      local(9, 14),
    );
    expect(menu.dica).toBe("Moductus");
    expect(rotulos(menu.itens)).toEqual([
      "Pausar todos os agentes",
      "---",
      "Alba: ativo",
      "Tula: ativo",
      "Nuno: desligado",
    ]);
    expect(rotulos(item(menu, "Pausar todos").itens)).toEqual(["Por 30 minutos", "Por 1 hora", "Até amanhã"]);
    expect(rotulos(item(menu, "Alba").itens)).toEqual([
      "Pausar por 30 minutos",
      "Pausar por 1 hora",
      "Pausar até amanhã",
    ]);
    expect(item(menu, "Nuno")).toMatchObject({ habilitado: false });
    expect(item(menu, "Nuno").itens).toBeUndefined();
  });

  test("com alguém pausado: retomar todos, e o pausado retoma ou muda a pausa", () => {
    const menu = montarMenu(
      [
        agente("alba", "Alba"),
        agente("tula", "Tula", { estado: "pausado", pausadoAte: local(9, 15).toISOString(), fila: 1 }),
      ],
      local(9, 14),
    );
    expect(menu.dica).toBe("Moductus: Tula em pausa");
    expect(rotulos(menu.itens)).toEqual([
      "Pausar todos os agentes",
      "Retomar todos os agentes",
      "---",
      "Alba: ativo",
      "Tula: pausado até 15:00, 1 na fila",
    ]);
    expect(rotulos(item(menu, "Tula").itens)).toEqual([
      "Retomar agora",
      "---",
      "Pausar por 30 minutos",
      "Pausar por 1 hora",
      "Pausar até amanhã",
    ]);
  });

  test("time inteiro pausado e ninguém ligado", () => {
    const pausado = { estado: "pausado" as const };
    expect(
      montarMenu([agente("alba", "Alba", pausado), agente("tula", "Tula", pausado)], local(9, 14)).dica,
    ).toBe("Moductus: agentes pausados");
    const desligados = montarMenu([agente("alba", "Alba", { estado: "desligado" })], local(9, 14));
    expect(item(desligados, "Pausar todos")).toMatchObject({ habilitado: false });
  });
});

/**
 * Relógio falso: `agora` só anda quando o teste manda, e o despertador do runtime fica numa lista
 * que `avancar` dispara na ordem, como o tempo passando.
 */
function relogio() {
  let agora = INICIO;
  const programados = new Set<{ quando: number; fazer: () => void }>();
  return {
    agora: () => new Date(agora),
    programar: (fazer: () => void, ms: number) => {
      const p = { quando: agora + ms, fazer };
      programados.add(p);
      return () => programados.delete(p);
    },
    avancar(ms: number) {
      const alvo = agora + ms;
      for (;;) {
        const proximo = [...programados]
          .filter((p) => p.quando <= alvo)
          .sort((a, b) => a.quando - b.quando)[0];
        if (!proximo) break;
        programados.delete(proximo);
        agora = Math.max(agora, proximo.quando);
        proximo.fazer();
      }
      agora = alvo;
    },
  };
}

/**
 * O serviço como o main.ts liga: banco migrado, Alba e Nuno com um provedor falso cada, runtime
 * com o relógio falso e a bandeja falando com uma casca de mentira pelo canal de verdade.
 */
function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-bandeja-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  db.exec(`
    INSERT INTO provedores (id, tipo, nome, modelo) VALUES
      ('p-alba', 'claude-cli', 'Falso da Alba', NULL),
      ('p-nuno', 'claude-cli', 'Falso do Nuno', NULL);
    UPDATE agentes SET provedor_id = 'p-' || id WHERE id IN ('alba', 'nuno');
  `);
  const falsos: Record<string, ProvedorFalso> = {
    "p-alba": new ProvedorFalso("p-alba"),
    "p-nuno": new ProvedorFalso("p-nuno"),
  };
  const provedores = new RegistroProvedores().registrar("claude-cli", (config) => falsos[config.id]!);
  const tempo = relogio();
  const repo = new RepositorioAgentes(db);
  const catalogo = new Catalogo([]);
  let bandeja: { atualizar(): void } | null = null;
  const runtime = new Runtime(
    { agentes: repo, execucoes: new RepositorioExecucoes(db), provedores, catalogo },
    { execucao: () => {}, agente: () => bandeja?.atualizar() },
    { agora: tempo.agora, programar: tempo.programar },
  );
  const agentes = new ServicoAgentes(repo, catalogo, (a) => runtime.situacao(a), runtime.estados);
  const linhas: string[] = [];
  const canal = new CanalCasca({ write: (linha) => linhas.push(linha) });
  const ligada = ligarBandeja({ agentes, canal, agora: tempo.agora });
  bandeja = ligada;
  ligada.atualizar();
  /** O último menu que a casca recebeu. */
  const menu = () => {
    const ultimo = JSON.parse(linhas.at(-1)!) as MenuBandeja & { tipo: string };
    expect(ultimo.tipo).toBe("bandeja");
    return ultimo;
  };
  const clicar = (id: string) => canal.receber(JSON.stringify({ tipo: CLIQUE_NA_BANDEJA, item: id }));
  return { db, runtime, falsos, tempo, linhas, menu, clicar, bandeja: ligada };
}

/** O que o pedido devolveu até agora, sem esperar: `null` enquanto ele espera a vez. */
function acompanhar(promessa: Promise<ResultadoExecucao>) {
  const estado: { resultado: ResultadoExecucao | null } = { resultado: null };
  void promessa.then((r) => (estado.resultado = r));
  return estado;
}

/** Deixa as promessas pendentes andarem (a fila e a porta são assíncronas). */
const assentar = () => new Promise<void>((resolve) => setImmediate(resolve));

const pedir = (agenteId: string, texto: string) => ({
  agenteId,
  gatilho: "intervalo" as const,
  mensagens: [{ papel: "usuario" as const, texto }],
});

describe("pausar pela bandeja", () => {
  test("pausar o time por 30 min: ninguém chama o modelo, a fila cresce e tudo roda na volta, em ordem", async () => {
    const { falsos, runtime, tempo, menu, clicar } = montar();
    falsos["p-alba"]!.roteirizar(roteiros.resposta("um"), roteiros.resposta("dois"));
    expect(rotulos(menu().itens)).toContain("Alba: ativo");

    clicar("pausar:*:30min");
    expect(menu().dica).toBe("Moductus: agentes pausados");
    expect(rotulos(menu().itens)).toEqual([
      "Pausar todos os agentes",
      "Retomar todos os agentes",
      "---",
      "Alba: pausado até 14:30",
      "Tula: pausado até 14:30",
      "Faina: pausado até 14:30",
      "Nuno: pausado até 14:30",
    ]);

    // O vigia e o agendador continuam anotando: os pedidos entram na fila sem chamar o modelo.
    const um = acompanhar(runtime.executar(pedir("alba", "um")));
    const dois = acompanhar(runtime.executar(pedir("alba", "dois")));
    await assentar();
    expect(falsos["p-alba"]!.pedidos).toHaveLength(0);
    expect(item(menu(), "Alba").rotulo).toBe("Alba: pausado até 14:30, 2 na fila");

    tempo.avancar(29 * 60_000);
    await assentar();
    expect(falsos["p-alba"]!.pedidos).toHaveLength(0);

    tempo.avancar(60_000);
    await vi.waitFor(() => expect(dois.resultado?.texto).toBe("dois"));
    expect(um.resultado?.texto).toBe("um");
    expect(falsos["p-alba"]!.pedidos.map((p) => p.mensagens.at(-1)?.texto)).toEqual(["um", "dois"]);
    expect(menu().dica).toBe("Moductus");
    expect(item(menu(), "Alba").rotulo).toBe("Alba: ativo");
  });

  test("pausar um agente até amanhã e retomar agora pela bandeja entrega o que esperava", async () => {
    const { db, falsos, runtime, menu, clicar } = montar();
    falsos["p-nuno"]!.roteirizar(roteiros.resposta("PR #142 precisa de você"));
    falsos["p-alba"]!.roteirizar(roteiros.resposta("a Alba segue"));

    clicar("pausar:nuno:amanha");
    expect(db.prepare("SELECT estado, pausado_ate, origem FROM agentes WHERE id = 'nuno'").get()).toEqual({
      estado: "pausado",
      pausado_ate: local(10, 0).toISOString(),
      origem: "usuario",
    });
    expect(item(menu(), "Nuno").rotulo).toBe("Nuno: pausado até meia-noite");
    expect(menu().dica).toBe("Moductus: Nuno em pausa");

    const doNuno = acompanhar(runtime.executar(pedir("nuno", "resumir PRs")));
    // Os outros seguem trabalhando.
    expect((await runtime.executar(pedir("alba", "oi"))).texto).toBe("a Alba segue");
    await assentar();
    expect(falsos["p-nuno"]!.pedidos).toHaveLength(0);

    clicar("retomar:nuno");
    await vi.waitFor(() => expect(doNuno.resultado?.texto).toBe("PR #142 precisa de você"));
    expect(item(menu(), "Nuno").rotulo).toBe("Nuno: ativo");
  });

  test("o menu só vai à casca quando muda; clique que falha não derruba nada e refaz o menu", () => {
    const { db, linhas, clicar, menu, bandeja } = montar();
    const antes = linhas.length;
    bandeja.atualizar();
    bandeja.atualizar();
    expect(linhas).toHaveLength(antes);
    clicar("agente:alba");
    clicar("pausar:*:2h");
    expect(linhas).toHaveLength(antes);

    db.exec("UPDATE agentes SET estado = 'desligado' WHERE id = 'tula'");
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    clicar("pausar:tula:1h");
    expect(erros).toHaveBeenCalledWith(expect.stringContaining("bandeja: pausar falhou"));
    erros.mockRestore();
    expect(item(menu(), "Tula")).toMatchObject({ rotulo: "Tula: desligado", habilitado: false });
  });
});
