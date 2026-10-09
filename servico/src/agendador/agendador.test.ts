import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Gatilho } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AgenteGuardado } from "../agentes/agentes.ts";
import { RepositorioAgentes } from "../agentes/agentes.ts";
import { RepositorioExecucoes } from "../agentes/execucoes.ts";
import { Runtime, type PedidoExecucao, type ResultadoExecucao } from "../agentes/runtime.ts";
import { abrirBanco } from "../banco/conexao.ts";
import { Catalogo } from "../ferramentas/catalogo.ts";
import { ProvedorFalso, roteiros } from "../provedores/falso.ts";
import { RegistroProvedores } from "../provedores/registro.ts";
import { Agendador, ultimaOcorrencia, type Disparo } from "./agendador.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** Relógio falso no fuso local, como o do PC: `ir(dia, h, m)` põe o relógio lá, sem conferir nada. */
function relogio() {
  let agora = new Date(2026, 9, 9, 8, 0, 0);
  return {
    agora: () => new Date(agora),
    ir: (dia: number, h: number, m: number, s = 0) => {
      agora = new Date(2026, 9, dia, h, m, s);
    },
  };
}

function agente(id: string, gatilhos: Gatilho[], estado: AgenteGuardado["estado"] = "ativo"): AgenteGuardado {
  return {
    id,
    nome: id,
    funcao: "",
    instrucoes: "",
    personagem: { silhueta: "a", traco: "b", tom: "c" },
    ferramentas: [],
    provedorId: null,
    provedorReservaId: null,
    gatilhos,
    escoposMemoria: [],
    tetoDiarioCentavos: null,
    estado,
    dormeAte: null,
    deFabrica: false,
  };
}

/**
 * Agendador com agentes em memória e um runtime falso que anota os pedidos. Cada pedido fica
 * rodando até o teste soltar (`soltar()`), para dar para ver o que acontece com o que está pendente.
 */
function montar(agentes: AgenteGuardado[]) {
  const tempo = relogio();
  const pedidos: PedidoExecucao[] = [];
  const soltas: Array<() => void> = [];
  const runtime = {
    executar: (pedido: PedidoExecucao) => {
      pedidos.push(pedido);
      return new Promise<ResultadoExecucao>((resolve) => soltas.push(() => resolve({} as ResultadoExecucao)));
    },
  };
  const agendador = new Agendador({ agentes: { agentes: () => agentes }, runtime }, { agora: tempo.agora });
  const soltar = async () => {
    for (const s of soltas.splice(0)) s();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { agendador, pedidos, tempo, soltar, agentes };
}

const resumo = (disparos: Disparo[]) => disparos.map((d) => `${d.agenteId} ${d.gatilho.tipo}`);

describe("ultimaOcorrencia", () => {
  test("é hoje se a hora já passou e ontem se ainda não chegou", () => {
    expect(ultimaOcorrencia("08:30", new Date(2026, 9, 9, 8, 30))).toEqual(new Date(2026, 9, 9, 8, 30));
    expect(ultimaOcorrencia("08:30", new Date(2026, 9, 9, 9, 0))).toEqual(new Date(2026, 9, 9, 8, 30));
    expect(ultimaOcorrencia("08:30", new Date(2026, 9, 9, 8, 29))).toEqual(new Date(2026, 9, 8, 8, 30));
  });
});

describe("horário", () => {
  test("dispara quando o relógio passa da hora, uma vez por dia", async () => {
    const { agendador, pedidos, tempo, soltar } = montar([
      agente("alba", [{ tipo: "horario", hora: "08:30" }]),
    ]);
    expect(agendador.verificar()).toEqual([]);
    tempo.ir(9, 8, 29, 50);
    expect(agendador.verificar()).toEqual([]);

    tempo.ir(9, 8, 30, 20);
    const [disparo] = agendador.verificar();
    expect(disparo).toMatchObject({ agenteId: "alba", atrasado: false });
    expect(disparo!.previsto).toBe(new Date(2026, 9, 9, 8, 30).toISOString());
    expect(pedidos[0]).toMatchObject({ agenteId: "alba", gatilho: "horario" });
    expect(pedidos[0]!.mensagens).toEqual([
      { papel: "usuario", texto: "Gatilho: horário 08:30. Disparado em 09/10 08:30." },
    ]);
    await soltar();

    tempo.ir(9, 8, 31);
    expect(agendador.verificar()).toEqual([]);
    tempo.ir(9, 23, 59);
    expect(agendador.verificar()).toEqual([]);
    tempo.ir(10, 8, 30, 10);
    expect(resumo(agendador.verificar())).toEqual(["alba horario"]);
  });

  test("gatilho que aparece depois da hora não dispara o que já passou", () => {
    const agentes = [agente("alba", [])];
    const { agendador, tempo } = montar(agentes);
    agendador.verificar();
    tempo.ir(9, 9, 0);
    agentes[0]!.gatilhos = [{ tipo: "horario", hora: "08:30" }];
    expect(agendador.verificar()).toEqual([]);
    tempo.ir(9, 9, 1);
    expect(agendador.verificar()).toEqual([]);
  });

  test("relógio do PC que volta para trás não dispara nada", () => {
    const { agendador, tempo } = montar([agente("alba", [{ tipo: "horario", hora: "08:30" }])]);
    tempo.ir(9, 8, 40);
    agendador.verificar();
    tempo.ir(9, 8, 10);
    expect(agendador.verificar()).toEqual([]);
  });
});

describe("intervalo", () => {
  test("dispara a cada N minutos contados do último disparo", async () => {
    const { agendador, pedidos, tempo, soltar } = montar([
      agente("nuno", [{ tipo: "intervalo", minutos: 15 }]),
    ]);
    agendador.verificar();
    tempo.ir(9, 8, 14, 59);
    expect(agendador.verificar()).toEqual([]);
    tempo.ir(9, 8, 15);
    expect(resumo(agendador.verificar())).toEqual(["nuno intervalo"]);
    expect(pedidos[0]!.mensagens[0]!.texto).toBe("Gatilho: a cada 15 min. Disparado em 09/10 08:15.");
    await soltar();
    tempo.ir(9, 8, 29);
    expect(agendador.verificar()).toEqual([]);
    tempo.ir(9, 8, 30);
    expect(resumo(agendador.verificar())).toEqual(["nuno intervalo"]);
  });

  test("não dispara por cima do que ainda está na fila ou rodando; dispara quando terminar", async () => {
    const { agendador, pedidos, tempo, soltar } = montar([
      agente("nuno", [{ tipo: "intervalo", minutos: 15 }]),
    ]);
    agendador.verificar();
    tempo.ir(9, 8, 15);
    expect(agendador.verificar()).toHaveLength(1);
    tempo.ir(9, 8, 31);
    expect(agendador.verificar()).toEqual([]);
    tempo.ir(9, 8, 50);
    expect(agendador.verificar()).toEqual([]);

    await soltar();
    tempo.ir(9, 8, 50, 30);
    const disparos = agendador.verificar();
    expect(disparos).toHaveLength(1);
    expect(disparos[0]!.atrasado).toBe(true);
    expect(pedidos).toHaveLength(2);
  });
});

describe("suspender e voltar", () => {
  test("o que venceu enquanto o PC dormia dispara uma vez só, marcado como atrasado", async () => {
    const { agendador, pedidos, tempo, soltar } = montar([
      agente("alba", [{ tipo: "horario", hora: "08:30" }]),
      agente("nuno", [
        { tipo: "intervalo", minutos: 15 },
        { tipo: "evento", nome: "sessao.pediu_aprovacao" },
      ]),
    ]);
    agendador.verificar();

    // Dormiu às 08:05 e voltou no dia seguinte às 10:12: passaram dois 08:30 e uns 100 intervalos.
    tempo.ir(10, 10, 12);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const disparos = agendador.retomar();
    expect(resumo(disparos)).toEqual(["alba horario", "nuno intervalo"]);
    expect(disparos.every((d) => d.atrasado)).toBe(true);
    expect(disparos[0]!.previsto).toBe(new Date(2026, 9, 10, 8, 30).toISOString());
    expect(pedidos.map((p) => p.mensagens[0]!.texto)).toEqual([
      "Gatilho: horário 08:30. Venceu em 10/10 08:30 e só disparou agora, 10/10 10:12, porque o PC estava suspenso ou o Moductus parado.",
      "Gatilho: a cada 15 min. Venceu em 09/10 08:15 e só disparou agora, 10/10 10:12, porque o PC estava suspenso ou o Moductus parado.",
    ]);

    // O Windows avisa a retomada duas vezes e o relógio do serviço confere logo depois: nada de novo.
    expect(agendador.retomar()).toEqual([]);
    expect(agendador.verificar()).toEqual([]);
    await soltar();
    expect(agendador.verificar()).toEqual([]);
    expect(pedidos).toHaveLength(2);

    // Daí em diante, o intervalo conta da retomada.
    tempo.ir(10, 10, 27);
    expect(resumo(agendador.verificar())).toEqual(["nuno intervalo"]);
  });

  test("com o runtime de verdade, a execução fica registrada uma vez com o gatilho de horário", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "moductus-agendador-"));
    pastas.push(pasta);
    const db = abrirBanco(pasta);
    bancos.push(db);
    db.exec(`
      INSERT INTO provedores (id, tipo, nome) VALUES ('p-alba', 'claude-cli', 'Falso da Alba');
      UPDATE agentes SET provedor_id = 'p-alba', gatilhos = '[{"tipo":"horario","hora":"08:30"}]' WHERE id = 'alba';
    `);
    const falso = new ProvedorFalso("p-alba", roteiros.resposta("Briefing pronto."));
    const tempo = relogio();
    const agentes = new RepositorioAgentes(db);
    const execucoes = new RepositorioExecucoes(db);
    const runtime = new Runtime(
      {
        agentes,
        execucoes,
        provedores: new RegistroProvedores().registrar("claude-cli", () => falso),
        catalogo: new Catalogo([]),
      },
      { execucao: () => {}, agente: () => {} },
      { agora: tempo.agora },
    );
    const agendador = new Agendador({ agentes, runtime }, { agora: tempo.agora });
    agendador.verificar();

    tempo.ir(10, 10, 12);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const disparos = [...agendador.retomar(), ...agendador.retomar(), ...agendador.verificar()];
    expect(disparos).toHaveLength(1);
    const resultado = await disparos[0]!.resultado;

    expect(resultado?.texto).toBe("Briefing pronto.");
    const linhas = db.prepare("SELECT do_agente_id, gatilho, estado FROM execucoes").all();
    expect(linhas).toEqual([{ do_agente_id: "alba", gatilho: "horario", estado: "ok" }]);
    expect(falso.pedidos[0]!.mensagens.at(-1)!.texto).toContain("Venceu em 10/10 08:30");
  });
});

describe("evento interno", () => {
  test("dispara cada agente que tem o evento, com o detalhe, uma vez por evento", async () => {
    const { agendador, pedidos } = montar([
      agente("alba", [{ tipo: "evento", nome: "arquivo.chegou" }]),
      agente("nuno", [{ tipo: "evento", nome: "sessao.pediu_aprovacao" }]),
      agente("faina", [{ tipo: "evento", nome: "sessao.pediu_aprovacao" }], "desligado"),
    ]);
    expect(agendador.verificar()).toEqual([]);

    const primeiro = agendador.emitir("sessao.pediu_aprovacao", "moductus: Bash pede para rodar pnpm test");
    expect(resumo(primeiro)).toEqual(["nuno evento"]);
    expect(primeiro[0]!.atrasado).toBe(false);
    expect(pedidos[0]).toMatchObject({ agenteId: "nuno", gatilho: "evento" });
    expect(pedidos[0]!.mensagens[0]!.texto).toBe(
      "Gatilho: evento sessao.pediu_aprovacao. Disparado em 09/10 08:00.\n\nmoductus: Bash pede para rodar pnpm test",
    );
    // O segundo evento traz outro detalhe: vai para a fila do agente em vez de se juntar ao primeiro.
    expect(resumo(agendador.emitir("sessao.pediu_aprovacao"))).toEqual(["nuno evento"]);
    expect(agendador.emitir("orcamento.estourou")).toEqual([]);
    expect(pedidos).toHaveLength(2);
  });
});

describe("estado do agente", () => {
  test("desligado não dispara; ao ligar, começa a contar de novo", async () => {
    const agentes = [agente("nuno", [{ tipo: "intervalo", minutos: 15 }], "desligado")];
    const { agendador, tempo } = montar(agentes);
    agendador.verificar();
    tempo.ir(9, 8, 40);
    expect(agendador.verificar()).toEqual([]);

    agentes[0]!.estado = "ativo";
    tempo.ir(9, 8, 41);
    expect(agendador.verificar()).toEqual([]);
    tempo.ir(9, 8, 56);
    expect(resumo(agendador.verificar())).toEqual(["nuno intervalo"]);
  });

  test("pausado e dormindo pedem ao runtime, que decide a vez", () => {
    const { agendador, tempo } = montar([
      agente("alba", [{ tipo: "intervalo", minutos: 5 }], "pausado"),
      agente("tula", [{ tipo: "intervalo", minutos: 5 }], "dormindo"),
    ]);
    agendador.verificar();
    tempo.ir(9, 8, 5);
    expect(resumo(agendador.verificar())).toEqual(["alba intervalo", "tula intervalo"]);
  });

  test("pedido recusado pelo runtime fica no log e libera o gatilho", async () => {
    const tempo = relogio();
    let recusar = true;
    const runtime = {
      executar: () =>
        recusar ? Promise.reject(new Error("agente não encontrado")) : new Promise<never>(() => {}),
    };
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    const agendador = new Agendador(
      { agentes: { agentes: () => [agente("nuno", [{ tipo: "intervalo", minutos: 15 }])] }, runtime },
      { agora: tempo.agora },
    );
    agendador.verificar();
    tempo.ir(9, 8, 15);
    const [disparo] = agendador.verificar();
    await expect(disparo!.resultado).resolves.toBeNull();
    expect(erros).toHaveBeenCalledWith(expect.stringContaining("a cada 15 min de nuno não rodou"));

    recusar = false;
    tempo.ir(9, 8, 30);
    expect(agendador.verificar()).toHaveLength(1);
  });
});
