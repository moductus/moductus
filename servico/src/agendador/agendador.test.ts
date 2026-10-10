import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { EstadoAgente, Gatilho } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RepositorioAgentes } from "../agentes/agentes.ts";
import { RepositorioExecucoes } from "../agentes/execucoes.ts";
import { Runtime, type PedidoExecucao, type ResultadoExecucao } from "../agentes/runtime.ts";
import { abrirBanco } from "../banco/conexao.ts";
import { Catalogo } from "../ferramentas/catalogo.ts";
import { ProvedorFalso, roteiros } from "../provedores/falso.ts";
import { RegistroProvedores } from "../provedores/registro.ts";
import {
  Agendador,
  ocorrenciaDeHoje,
  PRAZO_RETOMADA_MS,
  RepositorioDisparos,
  type DependenciasAgendador,
  type Disparo,
} from "./agendador.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const em = (dia: number, h: number, m: number, s = 0) => new Date(2026, 9, dia, h, m, s);

function bancoMigrado(): DatabaseSync {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-agendador-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  return db;
}

/**
 * Banco migrado de verdade, relógio falso no fuso local (como o do PC) e um runtime falso que
 * anota os pedidos e segura cada um até o teste soltar. `andar` faz o relógio do serviço correr
 * em passos de 30 s conferindo a cada passo; `suspender` pula o relógio sem conferir nada;
 * `reiniciar` troca o agendador por um novo sobre o mesmo banco, como o serviço que sobe de novo.
 */
function montar(inicio = em(9, 8, 0)) {
  const db = bancoMigrado();
  let agora = inicio;
  const relogio = () => new Date(agora);
  const programados: Array<{ ate: number; fazer: () => void }> = [];
  const pedidos: PedidoExecucao[] = [];
  const soltas: Array<() => void> = [];
  const deps: DependenciasAgendador = {
    agentes: new RepositorioAgentes(db),
    disparos: new RepositorioDisparos(db),
    runtime: {
      executar: (pedido) => {
        pedidos.push(pedido);
        return new Promise<ResultadoExecucao>((resolve) =>
          soltas.push(() => resolve({} as ResultadoExecucao)),
        );
      },
    },
  };
  const novo = () =>
    new Agendador(deps, {
      agora: relogio,
      programar: (fazer, ms) => programados.push({ ate: agora.getTime() + ms, fazer }),
    });
  const t = {
    db,
    pedidos,
    agendador: novo(),
    textos: () => pedidos.map((p) => p.mensagens[0]!.texto),
    definir(agenteId: string, gatilhos: Gatilho[], estado: EstadoAgente = "ativo") {
      db.prepare("UPDATE agentes SET gatilhos = ?, estado = ? WHERE id = ?").run(
        JSON.stringify(gatilhos),
        estado,
        agenteId,
      );
    },
    suspender(ate: Date) {
      agora = ate;
    },
    /** Corre o relógio até `ate`, conferindo a cada `passoMs` e rodando o que estava programado. */
    andar(ate: Date, passoMs = 30_000): Disparo[] {
      const disparos: Disparo[] = [];
      while (agora.getTime() < ate.getTime()) {
        agora = new Date(Math.min(agora.getTime() + passoMs, ate.getTime()));
        for (const p of programados.splice(0)) {
          if (p.ate <= agora.getTime()) p.fazer();
          else programados.push(p);
        }
        disparos.push(...t.agendador.verificar());
      }
      return disparos;
    },
    reiniciar() {
      t.agendador = novo();
    },
    async soltar() {
      for (const s of soltas.splice(0)) s();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
  return t;
}

const resumo = (disparos: Disparo[]) => disparos.map((d) => `${d.agenteId} ${d.gatilho.tipo}`);

describe("ocorrenciaDeHoje", () => {
  test("é o HH:MM do dia de agora, mesmo que ainda não tenha chegado", () => {
    expect(ocorrenciaDeHoje("08:30", em(9, 9, 0))).toEqual(em(9, 8, 30));
    expect(ocorrenciaDeHoje("08:30", em(9, 7, 0))).toEqual(em(9, 8, 30));
  });
});

describe("horário", () => {
  test("dispara quando o relógio passa da hora, uma vez por dia", async () => {
    const t = montar();
    t.definir("alba", [{ tipo: "horario", hora: "08:30" }]);
    t.agendador.verificar();
    expect(t.andar(em(9, 8, 29, 30))).toEqual([]);

    const [disparo, ...resto] = t.andar(em(9, 8, 30, 30));
    expect(resto).toEqual([]);
    expect(disparo).toMatchObject({ agenteId: "alba", atrasado: false, esperou: false });
    expect(disparo!.previsto).toBe(em(9, 8, 30).toISOString());
    expect(t.pedidos[0]).toMatchObject({ agenteId: "alba", gatilho: "horario" });
    expect(t.textos()).toEqual(["Gatilho: horário 08:30. Disparado em 09/10 08:30."]);
    await t.soltar();

    expect(t.andar(em(10, 8, 29, 30))).toEqual([]);
    expect(resumo(t.andar(em(10, 8, 30, 30)))).toEqual(["alba horario"]);
  });

  test("relógio do PC que volta para trás não dispara de novo a ocorrência que já disparou", async () => {
    const t = montar();
    t.definir("alba", [{ tipo: "horario", hora: "08:30" }]);
    t.agendador.verificar();
    expect(t.andar(em(9, 8, 31))).toHaveLength(1);
    await t.soltar();
    t.suspender(em(9, 8, 10));
    expect(t.andar(em(9, 8, 40))).toEqual([]);
  });
});

describe("reiniciar o serviço", () => {
  test("a referência vem do banco: dispara o que venceu com ele parado uma vez, e o de ontem não", async () => {
    const t = montar(em(8, 9, 0));
    t.definir("alba", [{ tipo: "horario", hora: "08:30" }]);
    t.agendador.verificar();

    // Parou no dia 8 às 09:00 e subiu de novo no dia 9 às 09:00: o 08:30 de hoje passou parado.
    t.suspender(em(9, 9, 0));
    t.reiniciar();
    const [disparo, ...resto] = t.agendador.verificar();
    expect(resto).toEqual([]);
    expect(disparo).toMatchObject({ agenteId: "alba", atrasado: true, previsto: em(9, 8, 30).toISOString() });
    expect(t.textos()).toEqual([
      "Gatilho: horário 08:30. Venceu em 09/10 08:30 e só disparou agora, 09/10 09:00, porque o PC estava suspenso ou o Moductus parado.",
    ]);

    // Caiu no meio da execução (a referência foi gravada antes) e subiu de novo: não repete.
    t.suspender(em(9, 9, 5));
    t.reiniciar();
    expect(t.agendador.verificar()).toEqual([]);

    // Desligado do dia 9 às 09:05 ao dia 11 às 07:00: o 08:30 do dia 10 não dispara mais.
    t.suspender(em(11, 7, 0));
    t.reiniciar();
    expect(t.agendador.verificar()).toEqual([]);
    expect(t.andar(em(11, 8, 29, 30))).toEqual([]);
    const [deHoje] = t.andar(em(11, 8, 30, 30));
    expect(deHoje).toMatchObject({ atrasado: false, previsto: em(11, 8, 30).toISOString() });
    expect(t.pedidos).toHaveLength(2);
  });

  test("gatilho que o agendador nunca viu começa a contar de agora", () => {
    const t = montar(em(9, 9, 0));
    t.definir("alba", [{ tipo: "horario", hora: "08:30" }]);
    t.definir("nuno", [{ tipo: "intervalo", minutos: 15 }]);
    expect(t.agendador.verificar()).toEqual([]);
    expect(t.andar(em(9, 9, 14, 30))).toEqual([]);
    expect(resumo(t.andar(em(9, 9, 15)))).toEqual(["nuno intervalo"]);
  });

  test("a referência é gravada antes de o runtime ser chamado", () => {
    const db = bancoMigrado();
    db.prepare("UPDATE agentes SET gatilhos = ? WHERE id = 'nuno'").run(
      JSON.stringify([{ tipo: "intervalo", minutos: 15 }]),
    );
    let agora = em(9, 8, 0);
    const disparos = new RepositorioDisparos(db);
    const vistoPeloRuntime: Array<string | null> = [];
    const agendador = new Agendador(
      {
        agentes: new RepositorioAgentes(db),
        disparos,
        runtime: {
          executar: () => {
            vistoPeloRuntime.push([...disparos.todas().values()][0]!.disparadoEm);
            return new Promise<never>(() => {});
          },
        },
      },
      { agora: () => agora },
    );
    for (let minuto = 0; minuto <= 15; minuto++) {
      agora = em(9, 8, minuto);
      agendador.verificar();
    }
    expect(vistoPeloRuntime).toEqual([em(9, 8, 15).toISOString()]);
  });
});

describe("intervalo", () => {
  test("conta do previsto quando sai na hora, sem deriva", async () => {
    const t = montar();
    t.definir("nuno", [{ tipo: "intervalo", minutos: 15 }]);
    t.agendador.verificar();
    // Conferindo a cada 40 s, o 08:15 sai às 08:15:20; o próximo vence às 08:30:00, não às 08:30:20.
    const [primeiro] = t.andar(em(9, 8, 15, 20), 40_000);
    expect(primeiro!.previsto).toBe(em(9, 8, 15).toISOString());
    expect(t.textos()).toEqual(["Gatilho: a cada 15 min. Disparado em 09/10 08:15."]);
    await t.soltar();
    expect(t.andar(em(9, 8, 29, 20), 40_000)).toEqual([]);
    const [segundo] = t.andar(em(9, 8, 30), 40_000);
    expect(segundo!.previsto).toBe(em(9, 8, 30).toISOString());
  });

  test("não dispara por cima do que está em curso; quando termina, dispara dizendo que esperou", async () => {
    const t = montar();
    t.definir("nuno", [{ tipo: "intervalo", minutos: 15 }]);
    t.agendador.verificar();
    expect(t.andar(em(9, 8, 15))).toHaveLength(1);
    expect(t.andar(em(9, 8, 50))).toEqual([]);

    await t.soltar();
    const [disparo] = t.andar(em(9, 8, 50, 30));
    expect(disparo).toMatchObject({ atrasado: false, esperou: true, previsto: em(9, 8, 30).toISOString() });
    expect(t.textos()[1]).toBe(
      "Gatilho: a cada 15 min. Venceu em 09/10 08:30 e disparou agora, 09/10 08:50, quando o trabalho anterior deste gatilho terminou.",
    );
    // Quem esperou conta de quando disparou, não do previsto: não sai outro logo em seguida.
    await t.soltar();
    expect(t.andar(em(9, 9, 5))).toEqual([]);
    expect(t.andar(em(9, 9, 5, 30))).toHaveLength(1);
  });
});

describe("suspender e voltar", () => {
  test("espera o prazo da retomada e dispara o que venceu uma vez só, marcado como atrasado", async () => {
    const t = montar();
    t.definir("alba", [{ tipo: "horario", hora: "08:30" }]);
    t.definir("nuno", [
      { tipo: "intervalo", minutos: 15 },
      { tipo: "evento", nome: "sessao.pediu_aprovacao" },
    ]);
    t.agendador.verificar();
    t.andar(em(9, 8, 5));

    // Dormiu às 08:05 e voltou no dia seguinte às 10:12: passaram dois 08:30 e uns 100 intervalos.
    t.suspender(em(10, 10, 12));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retomada = t.agendador.retomar();
    // O relógio do serviço confere logo que o PC acorda, e o Windows avisa duas vezes: nada antes do prazo.
    expect(t.agendador.verificar()).toEqual([]);
    expect(t.agendador.retomar()).toBe(retomada);
    expect(t.pedidos).toEqual([]);

    t.andar(new Date(em(10, 10, 12).getTime() + PRAZO_RETOMADA_MS), PRAZO_RETOMADA_MS);
    const disparos = await retomada;
    expect(resumo(disparos)).toEqual(["alba horario", "nuno intervalo"]);
    expect(disparos.every((d) => d.atrasado && !d.esperou)).toBe(true);
    expect(disparos[0]!.previsto).toBe(em(10, 8, 30).toISOString());
    expect(t.textos()).toEqual([
      "Gatilho: horário 08:30. Venceu em 10/10 08:30 e só disparou agora, 10/10 10:12, porque o PC estava suspenso ou o Moductus parado.",
      "Gatilho: a cada 15 min. Venceu em 09/10 08:15 e só disparou agora, 10/10 10:12, porque o PC estava suspenso ou o Moductus parado.",
    ]);

    await t.soltar();
    expect(t.andar(em(10, 10, 27))).toEqual([]);
    // Atrasado conta de quando disparou (10:12:20).
    expect(resumo(t.andar(em(10, 10, 27, 30)))).toEqual(["nuno intervalo"]);
    expect(t.pedidos).toHaveLength(3);
  });

  test("sem o aviso da casca, a conferência percebe que ficou parada e também espera o prazo", () => {
    const t = montar();
    t.definir("alba", [{ tipo: "horario", hora: "08:30" }]);
    t.agendador.verificar();
    t.andar(em(9, 8, 5));
    t.suspender(em(10, 10, 12));
    expect(t.agendador.verificar()).toEqual([]);
    expect(t.andar(em(10, 10, 12, 10), 10_000)).toEqual([]);
    const [disparo] = t.andar(em(10, 10, 12, 20), 10_000);
    expect(disparo).toMatchObject({ agenteId: "alba", atrasado: true });
  });

  test("com o runtime de verdade, a execução fica registrada uma vez com o gatilho de horário", async () => {
    const db = bancoMigrado();
    db.exec(`
      INSERT INTO provedores (id, tipo, nome) VALUES ('p-alba', 'claude-cli', 'Falso da Alba');
      UPDATE agentes SET provedor_id = 'p-alba', gatilhos = '[{"tipo":"horario","hora":"08:30"}]' WHERE id = 'alba';
    `);
    const falso = new ProvedorFalso("p-alba", roteiros.resposta("Briefing pronto."));
    let agora = em(9, 8, 0);
    const programados: Array<() => void> = [];
    const agentes = new RepositorioAgentes(db);
    const runtime = new Runtime(
      {
        agentes,
        execucoes: new RepositorioExecucoes(db),
        provedores: new RegistroProvedores().registrar("claude-cli", () => falso),
        catalogo: new Catalogo([]),
      },
      { execucao: () => {}, agente: () => {} },
      { agora: () => agora },
    );
    const agendador = new Agendador(
      { agentes, disparos: new RepositorioDisparos(db), runtime },
      { agora: () => agora, programar: (fazer) => programados.push(fazer) },
    );
    agendador.verificar();

    agora = em(10, 10, 12);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retomada = agendador.retomar();
    agendador.retomar();
    agora = em(10, 10, 12, 20);
    for (const fazer of programados.splice(0)) fazer();
    const disparos = [...(await retomada), ...agendador.verificar()];
    expect(disparos).toHaveLength(1);
    expect((await disparos[0]!.resultado)?.texto).toBe("Briefing pronto.");
    expect(db.prepare("SELECT do_agente_id, gatilho, estado FROM execucoes").all()).toEqual([
      { do_agente_id: "alba", gatilho: "horario", estado: "ok" },
    ]);
    expect(falso.pedidos[0]!.mensagens.at(-1)!.texto).toContain("Venceu em 10/10 08:30");
  });
});

describe("evento interno", () => {
  test("dispara cada agente que tem o evento; os que chegam enquanto o anterior roda se juntam", async () => {
    const t = montar();
    t.definir("alba", [{ tipo: "evento", nome: "arquivo.chegou" }]);
    t.definir("nuno", [{ tipo: "evento", nome: "sessao.pediu_aprovacao" }]);
    t.definir("faina", [{ tipo: "evento", nome: "sessao.pediu_aprovacao" }], "desligado");

    const primeiro = t.agendador.emitir("sessao.pediu_aprovacao", "moductus: Bash pede para rodar pnpm test");
    expect(resumo(primeiro)).toEqual(["nuno evento"]);
    expect(primeiro[0]).toMatchObject({ atrasado: false, esperou: false, juntado: false });
    expect(t.pedidos[0]).toMatchObject({ agenteId: "nuno", gatilho: "evento" });
    expect(t.textos()).toEqual([
      "Gatilho: evento sessao.pediu_aprovacao. Disparado em 09/10 08:00.\n\nmoductus: Bash pede para rodar pnpm test",
    ]);

    // Três eventos enquanto o primeiro roda: esperam juntos e viram um disparo só.
    t.suspender(em(9, 8, 1));
    const segundo = t.agendador.emitir("sessao.pediu_aprovacao", "site: Edit pede para mudar index.html");
    t.suspender(em(9, 8, 2));
    const terceiro = t.agendador.emitir("sessao.pediu_aprovacao");
    const quarto = t.agendador.emitir("sessao.pediu_aprovacao", "api: Bash pede para rodar dotnet test");
    expect(segundo[0]).toMatchObject({ esperou: true, juntado: false });
    expect(terceiro[0]).toMatchObject({ esperou: true, juntado: true, previsto: em(9, 8, 1).toISOString() });
    expect(quarto[0]!.resultado).toBe(segundo[0]!.resultado);
    expect(t.agendador.emitir("orcamento.estourou")).toEqual([]);
    expect(t.pedidos).toHaveLength(1);

    t.suspender(em(9, 8, 3));
    await t.soltar();
    expect(t.pedidos).toHaveLength(2);
    expect(t.textos()[1]).toBe(
      "Gatilho: evento sessao.pediu_aprovacao, 3 vezes desde 09/10 08:01. Disparado em 09/10 08:03.\n\n" +
        "site: Edit pede para mudar index.html\n\napi: Bash pede para rodar dotnet test",
    );
    await t.soltar();
    await expect(segundo[0]!.resultado).resolves.toEqual({});

    // Nada em curso: o próximo evento roda na hora.
    expect(t.agendador.emitir("sessao.pediu_aprovacao")[0]).toMatchObject({ esperou: false });
    expect(t.pedidos).toHaveLength(3);
  });
});

describe("estado do agente", () => {
  test("desligado não dispara; ao ligar, começa a contar de novo", () => {
    const t = montar();
    const linhas = () => t.db.prepare("SELECT do_agente_id FROM agendador_disparos").all();
    t.definir("nuno", [{ tipo: "intervalo", minutos: 15 }]);
    t.agendador.verificar();
    expect(linhas()).toEqual([{ do_agente_id: "nuno" }]);
    t.definir("nuno", [{ tipo: "intervalo", minutos: 15 }], "desligado");
    expect(t.andar(em(9, 8, 40))).toEqual([]);
    // Desligado (ou na lixeira) não está na lista: a referência dele é apagada.
    expect(linhas()).toEqual([]);

    t.definir("nuno", [{ tipo: "intervalo", minutos: 15 }]);
    expect(t.andar(em(9, 8, 55))).toEqual([]);
    expect(resumo(t.andar(em(9, 8, 55, 30)))).toEqual(["nuno intervalo"]);
  });

  test("pausado e dormindo pedem ao runtime, que decide a vez", () => {
    const t = montar();
    t.definir("alba", [{ tipo: "intervalo", minutos: 5 }], "pausado");
    t.definir("tula", [{ tipo: "intervalo", minutos: 5 }], "dormindo");
    t.agendador.verificar();
    expect(resumo(t.andar(em(9, 8, 5)))).toEqual(["alba intervalo", "tula intervalo"]);
  });

  test("pedido recusado pelo runtime fica no log e libera o gatilho", async () => {
    const db = bancoMigrado();
    db.prepare("UPDATE agentes SET gatilhos = ? WHERE id = 'nuno'").run(
      JSON.stringify([{ tipo: "intervalo", minutos: 15 }]),
    );
    let agora = em(9, 8, 0);
    let recusar = true;
    const runtime = {
      executar: () =>
        recusar ? Promise.reject(new Error("agente não encontrado")) : new Promise<never>(() => {}),
    };
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    const agendador = new Agendador(
      { agentes: new RepositorioAgentes(db), disparos: new RepositorioDisparos(db), runtime },
      { agora: () => agora },
    );
    /** Confere minuto a minuto até `ate`, juntando os disparos. */
    const conferirAte = (ate: number) => {
      const disparos: Disparo[] = [];
      for (; agora.getMinutes() < ate; agora = em(9, 8, agora.getMinutes() + 1)) {
        disparos.push(...agendador.verificar());
      }
      return [...disparos, ...agendador.verificar()];
    };
    const [disparo, ...resto] = conferirAte(15);
    expect(resto).toEqual([]);
    await expect(disparo!.resultado).resolves.toBeNull();
    expect(erros).toHaveBeenCalledWith(expect.stringContaining("a cada 15 min de nuno não rodou"));

    recusar = false;
    expect(conferirAte(30)).toHaveLength(1);
  });
});

test("erro numa conferência do relógio vai para o log e o relógio segue", () => {
  const db = bancoMigrado();
  vi.useFakeTimers();
  const erros = vi.spyOn(console, "error").mockImplementation(() => {});
  const agendador = new Agendador({
    agentes: {
      agentes: () => {
        throw new Error("banco ocupado");
      },
    },
    disparos: new RepositorioDisparos(db),
    runtime: { executar: () => new Promise<never>(() => {}) },
  });
  const parar = agendador.vigiar(1_000);
  vi.advanceTimersByTime(2_500);
  parar();
  expect(erros).toHaveBeenCalledTimes(2);
  expect(erros).toHaveBeenCalledWith("agendador: conferência falhou: Error: banco ocupado");
});
