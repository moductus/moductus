import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test, vi } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { Catalogo } from "../ferramentas/catalogo.ts";
import { ProvedorFalso, roteiros } from "../provedores/falso.ts";
import { RegistroProvedores } from "../provedores/registro.ts";
import { RepositorioAgentes } from "./agentes.ts";
import {
  ESPERA_INICIAL_MS,
  ESPERA_MAXIMA_MS,
  esperaCrescente,
  inicioDoDiaSeguinte,
  MENSAGEM_DESLIGADO,
  PROVA_DO_PRINCIPAL_MS,
  type ConverterCusto,
} from "./estado.ts";
import { RepositorioExecucoes } from "./execucoes.ts";
import { Runtime, type PedidoExecucao, type ResultadoExecucao } from "./runtime.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const INICIO = Date.UTC(2026, 9, 9, 12, 0, 0);
const as = (ms: number) => new Date(ms).toISOString();

/**
 * Relógio falso: `agora` só anda quando o teste manda, e o despertador do runtime fica numa lista
 * que `avancar` dispara na ordem, como o tempo passando.
 */
function relogio() {
  let agora = INICIO;
  let proximo = 0;
  const programados = new Map<number, { quando: number; fazer: () => void }>();
  return {
    agora: () => new Date(agora),
    programar: (fazer: () => void, ms: number) => {
      const id = proximo++;
      programados.set(id, { quando: agora + ms, fazer });
      return () => programados.delete(id);
    },
    avancar(ms: number) {
      const alvo = agora + ms;
      for (;;) {
        const vencidos = [...programados].filter(([, p]) => p.quando <= alvo);
        if (vencidos.length === 0) break;
        const [id, p] = vencidos.sort(([, a], [, b]) => a.quando - b.quando)[0]!;
        programados.delete(id);
        agora = Math.max(agora, p.quando);
        p.fazer();
      }
      agora = alvo;
    },
    get pendentes() {
      return programados.size;
    },
  };
}

/**
 * Banco migrado de verdade; Alba e Nuno com um provedor falso cada e um terceiro, `p-reserva`,
 * cadastrado para servir de reserva. O Nuno usa API (`openai-compativel` com `gpt-4o-mini`), para
 * as execuções terem custo estimado e o teto ter o que somar.
 */
function montar(opcoes: { emCentavos?: ConverterCusto } = {}) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-estado-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  db.exec(`
    INSERT INTO provedores (id, tipo, nome, modelo) VALUES
      ('p-alba', 'claude-cli', 'Falso da Alba', NULL),
      ('p-nuno', 'openai-compativel', 'Falso do Nuno', 'gpt-4o-mini'),
      ('p-reserva', 'claude-cli', 'Reserva', NULL);
    UPDATE agentes SET provedor_id = 'p-' || id WHERE id IN ('alba', 'nuno');
  `);
  const falsos: Record<string, ProvedorFalso> = {
    "p-alba": new ProvedorFalso("p-alba"),
    "p-nuno": new ProvedorFalso("p-nuno"),
    "p-reserva": new ProvedorFalso("p-reserva"),
  };
  const provedores = new RegistroProvedores()
    .registrar("claude-cli", (config) => falsos[config.id]!)
    .registrar("openai-compativel", (config) => falsos[config.id]!);
  const tempo = relogio();
  const agentes = new RepositorioAgentes(db);
  const avisos: string[] = [];
  const runtime = new Runtime(
    { agentes, execucoes: new RepositorioExecucoes(db), provedores, catalogo: new Catalogo([]) },
    { execucao: () => {}, agente: (id) => avisos.push(id) },
    {
      agora: tempo.agora,
      programar: tempo.programar,
      ...(opcoes.emCentavos ? { emCentavos: opcoes.emCentavos } : {}),
    },
  );
  const situacao = (id: string) => runtime.situacao(agentes.agente(id)!);
  const guardado = (id: string) =>
    db
      .prepare("SELECT estado, dorme_ate, motivo_sono, pausado_ate, origem FROM agentes WHERE id = ?")
      .get(id);
  return { db, runtime, falsos, tempo, agentes, avisos, situacao, guardado };
}

const pedir = (agenteId: string, texto: string, mudanca: Partial<PedidoExecucao> = {}): PedidoExecucao => ({
  agenteId,
  gatilho: "mensagem",
  mensagens: [{ papel: "usuario", texto }],
  ...mudanca,
});

/** O que o pedido devolveu até agora, sem esperar: `null` enquanto ele espera a vez. */
function acompanhar(promessa: Promise<ResultadoExecucao>) {
  const estado: { resultado: ResultadoExecucao | null; erro: unknown } = { resultado: null, erro: null };
  promessa.then(
    (r) => (estado.resultado = r),
    (e: unknown) => (estado.erro = e),
  );
  return estado;
}

/** Deixa as promessas pendentes andarem (a fila e a porta são assíncronas). */
const assentar = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("dormir pelo provedor e acordar", () => {
  test("limite põe o agente para dormir até a volta; a fila espera e roda ao acordar, em ordem", async () => {
    const { runtime, falsos, tempo, situacao, guardado } = montar();
    const volta = as(INICIO + 3 * 3_600_000);
    falsos["p-alba"]!.roteirizar(
      roteiros.falha("limite", volta),
      roteiros.resposta("um"),
      roteiros.resposta("dois"),
    );

    const r = await runtime.executar(pedir("alba", "oi"));
    expect(r.sono).toEqual({ motivo: "limite", ate: volta });
    expect(guardado("alba")).toEqual({
      estado: "dormindo",
      dorme_ate: volta,
      motivo_sono: "limite",
      pausado_ate: null,
      origem: "agente",
    });

    const primeiro = acompanhar(runtime.executar(pedir("alba", "primeiro")));
    const segundo = acompanhar(runtime.executar(pedir("alba", "segundo")));
    await assentar();
    // Nenhuma chamada nova ao modelo enquanto dorme; os dois contam na fila.
    expect(falsos["p-alba"]!.pedidos).toHaveLength(1);
    expect(situacao("alba")).toMatchObject({ estado: "dormindo", dormeAte: volta, fila: 2 });

    tempo.avancar(3 * 3_600_000 - 1);
    await assentar();
    expect(primeiro.resultado).toBeNull();

    tempo.avancar(1);
    await vi.waitFor(() => expect(segundo.resultado).not.toBeNull());
    expect(primeiro.resultado?.texto).toBe("um");
    expect(segundo.resultado?.texto).toBe("dois");
    expect(falsos["p-alba"]!.pedidos.map((p) => p.mensagens.at(-1)?.texto)).toEqual([
      "oi",
      "primeiro",
      "segundo",
    ]);
    expect(guardado("alba")).toMatchObject({ estado: "ativo", dorme_ate: null, motivo_sono: null });
    expect(situacao("alba")).toMatchObject({ estado: "ativo", atividade: "ocioso", fila: 0 });
  });

  test("limite sem hora de volta: tenta de novo com espera crescente, e dar certo zera a espera", async () => {
    const { runtime, falsos, tempo, guardado } = montar();
    falsos["p-alba"]!.roteirizar(
      roteiros.falha("limite"),
      roteiros.falha("fora_do_ar"),
      roteiros.resposta("voltei"),
      roteiros.falha("limite"),
    );

    await runtime.executar(pedir("alba", "1"));
    expect(guardado("alba")).toMatchObject({
      dorme_ate: as(INICIO + ESPERA_INICIAL_MS),
      motivo_sono: "limite",
    });

    const segundo = acompanhar(runtime.executar(pedir("alba", "2")));
    tempo.avancar(ESPERA_INICIAL_MS);
    await vi.waitFor(() => expect(segundo.resultado).not.toBeNull());
    const depoisDoSegundo = INICIO + ESPERA_INICIAL_MS;
    expect(guardado("alba")).toMatchObject({
      dorme_ate: as(depoisDoSegundo + 2 * ESPERA_INICIAL_MS),
      motivo_sono: "fora_do_ar",
    });

    const terceiro = acompanhar(runtime.executar(pedir("alba", "3")));
    tempo.avancar(2 * ESPERA_INICIAL_MS);
    await vi.waitFor(() => expect(terceiro.resultado?.texto).toBe("voltei"));

    await runtime.executar(pedir("alba", "4"));
    expect(guardado("alba")).toMatchObject({
      dorme_ate: as(INICIO + 3 * ESPERA_INICIAL_MS + ESPERA_INICIAL_MS),
    });
  });

  test("a espera crescente dobra até o máximo", () => {
    expect([1, 2, 3, 4].map(esperaCrescente)).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(esperaCrescente(20)).toBe(ESPERA_MAXIMA_MS);
  });

  test("credencial recusada dorme sem hora: só acorda quando alguém acorda", async () => {
    const { runtime, falsos, tempo, guardado } = montar();
    falsos["p-alba"]!.roteirizar(
      roteiros.falha("credencial", "2026-10-09T13:00:00.000Z"),
      roteiros.resposta("ok"),
    );
    await runtime.executar(pedir("alba", "oi"));
    expect(guardado("alba")).toMatchObject({
      estado: "dormindo",
      dorme_ate: null,
      motivo_sono: "credencial",
    });

    const depois = acompanhar(runtime.executar(pedir("alba", "e agora?")));
    tempo.avancar(24 * 3_600_000);
    await assentar();
    expect(depois.resultado).toBeNull();

    runtime.estados.acordar("alba");
    await vi.waitFor(() => expect(depois.resultado?.texto).toBe("ok"));
  });

  test("na subida, quem passou da hora acorda e quem não passou ganha despertador", () => {
    const { db, runtime, tempo, guardado } = montar();
    db.exec(`
      UPDATE agentes SET estado = 'dormindo', motivo_sono = 'limite', dorme_ate = '${as(INICIO - 1)}' WHERE id = 'alba';
      UPDATE agentes SET estado = 'dormindo', motivo_sono = 'limite', dorme_ate = '${as(INICIO + 60_000)}' WHERE id = 'nuno';
      UPDATE agentes SET estado = 'pausado', pausado_ate = '${as(INICIO + 120_000)}' WHERE id = 'faina';
    `);
    runtime.estados.vigiar();
    expect(guardado("alba")).toMatchObject({ estado: "ativo", dorme_ate: null, motivo_sono: null });
    expect(tempo.pendentes).toBe(2);

    tempo.avancar(60_000);
    expect(guardado("nuno")).toMatchObject({ estado: "ativo" });
    tempo.avancar(60_000);
    expect(guardado("faina")).toMatchObject({ estado: "ativo", pausado_ate: null });
    expect(tempo.pendentes).toBe(0);
  });
});

describe("provedor reserva", () => {
  test("principal no limite: o mesmo pedido vai à reserva, e os próximos também até a volta dele", async () => {
    const { db, runtime, falsos, tempo, guardado } = montar();
    db.exec("UPDATE agentes SET provedor_reserva_id = 'p-reserva' WHERE id = 'alba'");
    const volta = as(INICIO + 3_600_000);
    falsos["p-alba"]!.roteirizar(roteiros.falha("limite", volta), roteiros.resposta("principal de volta"));
    falsos["p-reserva"]!.roteirizar(
      roteiros.resposta("pela reserva"),
      roteiros.resposta("ainda pela reserva"),
    );

    const r = await runtime.executar(pedir("alba", "oi"));
    expect(r.texto).toBe("pela reserva");
    expect(r.execucao).toMatchObject({ estado: "ok", provedorId: "p-reserva" });
    expect(guardado("alba")).toMatchObject({ estado: "ativo" });
    // As duas tentativas ficam no histórico: a do principal com o erro, a da reserva com a resposta.
    expect(
      db.prepare("SELECT provedor_id, estado FROM execucoes WHERE do_agente_id = 'alba' ORDER BY id").all(),
    ).toEqual([
      { provedor_id: "p-alba", estado: "erro" },
      { provedor_id: "p-reserva", estado: "ok" },
    ]);

    expect((await runtime.executar(pedir("alba", "de novo"))).texto).toBe("ainda pela reserva");
    expect(falsos["p-alba"]!.pedidos).toHaveLength(1);

    tempo.avancar(3_600_000);
    expect((await runtime.executar(pedir("alba", "e agora?"))).texto).toBe("principal de volta");
  });

  test("principal e reserva fora: dorme até a primeira volta, e acordando tenta o principal primeiro", async () => {
    const { db, runtime, falsos, tempo, guardado } = montar();
    db.exec("UPDATE agentes SET provedor_reserva_id = 'p-reserva' WHERE id = 'alba'");
    falsos["p-alba"]!.roteirizar(roteiros.falha("ausente"), roteiros.resposta("principal"));
    falsos["p-reserva"]!.roteirizar(roteiros.falha("limite", as(INICIO + 2 * 3_600_000)));

    const r = await runtime.executar(pedir("alba", "oi"));
    expect(r.execucao).toMatchObject({ estado: "erro", provedorId: "p-reserva" });
    // O principal sem hora é provado de novo antes da volta da reserva.
    expect(guardado("alba")).toMatchObject({
      estado: "dormindo",
      motivo_sono: "limite",
      dorme_ate: as(INICIO + PROVA_DO_PRINCIPAL_MS),
    });

    const depois = acompanhar(runtime.executar(pedir("alba", "e agora?")));
    tempo.avancar(PROVA_DO_PRINCIPAL_MS);
    await vi.waitFor(() => expect(depois.resultado?.texto).toBe("principal"));
    expect(falsos["p-reserva"]!.pedidos).toHaveLength(1);
  });

  test("principal que já respondeu algo antes de falhar não é repetido na reserva", async () => {
    const { db, runtime, falsos, guardado } = montar();
    db.exec("UPDATE agentes SET provedor_reserva_id = 'p-reserva' WHERE id = 'alba'");
    falsos["p-alba"]!.roteirizar([
      { tipo: "texto", texto: "Começando" },
      { tipo: "erro", falha: { motivo: "limite", mensagem: "acabou", voltaEm: as(INICIO + 60_000) } },
    ]);
    const r = await runtime.executar(pedir("alba", "oi"));
    expect(r.execucao).toMatchObject({ estado: "erro", provedorId: "p-alba" });
    expect(falsos["p-reserva"]!.pedidos).toHaveLength(0);
    expect(guardado("alba")).toMatchObject({ estado: "dormindo", dorme_ate: as(INICIO + 60_000) });
  });
});

describe("teto diário", () => {
  // gpt-4o-mini: 100 tokens de entrada e 20 de saída custam 27 µ$ pela tabela (provedores/precos.ts).
  const UM_CENTAVO_POR_MICRODOLAR: ConverterCusto = (microdolares) => microdolares;

  test("atingido, o agente dorme até o dia seguinte e a fila roda na virada", async () => {
    const { db, runtime, falsos, tempo, situacao, guardado } = montar({
      emCentavos: UM_CENTAVO_POR_MICRODOLAR,
    });
    db.exec("UPDATE agentes SET teto_diario_centavos = 50 WHERE id = 'nuno'");
    falsos["p-nuno"]!.roteirizar(
      roteiros.resposta("um"),
      roteiros.resposta("dois"),
      roteiros.resposta("amanhã"),
    );

    expect((await runtime.executar(pedir("nuno", "1"))).execucao.custoEstimadoMicrodolares).toBe(27);
    expect(guardado("nuno")).toMatchObject({ estado: "ativo" });
    // A segunda passa do teto: roda (não dá para parar no meio) e o agente dorme depois dela.
    await runtime.executar(pedir("nuno", "2"));
    const amanha = inicioDoDiaSeguinte(new Date(INICIO)).toISOString();
    expect(guardado("nuno")).toMatchObject({ estado: "dormindo", motivo_sono: "teto", dorme_ate: amanha });
    expect(situacao("nuno")).toMatchObject({ estado: "dormindo", motivoSono: "teto" });

    const terceiro = acompanhar(runtime.executar(pedir("nuno", "3")));
    await assentar();
    expect(falsos["p-nuno"]!.pedidos).toHaveLength(2);

    tempo.avancar(Date.parse(amanha) - INICIO);
    await vi.waitFor(() => expect(terceiro.resultado?.texto).toBe("amanhã"));
  });

  test("teto baixado no meio do dia vale na próxima vez, antes de chamar o modelo", async () => {
    const { db, runtime, falsos, guardado } = montar({ emCentavos: UM_CENTAVO_POR_MICRODOLAR });
    falsos["p-nuno"]!.roteirizar(roteiros.resposta("um"), roteiros.resposta("não chega"));
    await runtime.executar(pedir("nuno", "1"));
    db.exec("UPDATE agentes SET teto_diario_centavos = 10 WHERE id = 'nuno'");

    const segundo = acompanhar(runtime.executar(pedir("nuno", "2")));
    await assentar();
    expect(segundo.resultado).toBeNull();
    expect(falsos["p-nuno"]!.pedidos).toHaveLength(1);
    expect(guardado("nuno")).toMatchObject({ estado: "dormindo", motivo_sono: "teto" });
  });

  test("sem câmbio para a moeda do teto, o teto não vale", async () => {
    const { db, runtime, falsos, guardado } = montar();
    db.exec("UPDATE agentes SET teto_diario_centavos = 1 WHERE id = 'nuno'");
    falsos["p-nuno"]!.roteirizar(roteiros.resposta("um"), roteiros.resposta("dois"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    await runtime.executar(pedir("nuno", "1"));
    await runtime.executar(pedir("nuno", "2"));
    expect(guardado("nuno")).toMatchObject({ estado: "ativo" });
    expect(erro).toHaveBeenCalledTimes(1);
    erro.mockRestore();
  });

  test("assinatura não gasta: o teto não para quem roda pelo CLI", async () => {
    const { db, runtime, falsos, guardado } = montar({ emCentavos: UM_CENTAVO_POR_MICRODOLAR });
    db.exec("UPDATE agentes SET teto_diario_centavos = 0 WHERE id = 'alba'");
    falsos["p-alba"]!.roteirizar(roteiros.resposta("um"), roteiros.resposta("dois"));
    await runtime.executar(pedir("alba", "1"));
    expect((await runtime.executar(pedir("alba", "2"))).texto).toBe("dois");
    expect(guardado("alba")).toMatchObject({ estado: "ativo" });
  });
});

describe("pausar, retomar e desligar", () => {
  test("pausado não chama o modelo; retomar entrega a fila", async () => {
    const { runtime, falsos, situacao, guardado } = montar();
    falsos["p-alba"]!.roteirizar(roteiros.resposta("depois da reunião"));
    expect(runtime.estados.pausar("alba", null)).toEqual(["alba"]);
    expect(guardado("alba")).toMatchObject({ estado: "pausado", pausado_ate: null, origem: "usuario" });

    const pedido = acompanhar(runtime.executar(pedir("alba", "oi")));
    await assentar();
    expect(falsos["p-alba"]!.pedidos).toHaveLength(0);
    expect(situacao("alba")).toMatchObject({ estado: "pausado", fila: 1 });

    expect(runtime.estados.retomar(undefined)).toEqual(["alba"]);
    await vi.waitFor(() => expect(pedido.resultado?.texto).toBe("depois da reunião"));
  });

  test("pausa com hora retoma sozinha; o agente que dormia fica pausado por cima", async () => {
    const { runtime, falsos, tempo, guardado } = montar();
    falsos["p-alba"]!.roteirizar(
      roteiros.falha("limite", as(INICIO + 3_600_000)),
      roteiros.resposta("voltei"),
    );
    await runtime.executar(pedir("alba", "1"));
    expect(runtime.estados.pausar(undefined, as(INICIO + 30 * 60_000))).toEqual([
      "alba",
      "tula",
      "faina",
      "nuno",
    ]);
    expect(guardado("alba")).toMatchObject({ estado: "pausado", dorme_ate: null, motivo_sono: null });

    const pedido = acompanhar(runtime.executar(pedir("alba", "2")));
    tempo.avancar(30 * 60_000);
    await vi.waitFor(() => expect(pedido.resultado?.texto).toBe("voltei"));
    expect(guardado("nuno")).toMatchObject({ estado: "ativo", pausado_ate: null });
  });

  test("desligar recusa quem esperava a vez; desligado não roda", async () => {
    const { runtime, situacao } = montar();
    runtime.estados.pausar("alba", null);
    const pedido = acompanhar(runtime.executar(pedir("alba", "oi")));
    await assentar();

    runtime.estados.ligar("alba", false);
    await vi.waitFor(() => expect(pedido.erro).toEqual(new Error(MENSAGEM_DESLIGADO("Alba"))));
    await expect(runtime.executar(pedir("alba", "e agora?"))).rejects.toThrow(MENSAGEM_DESLIGADO("Alba"));
    expect(situacao("alba")).toMatchObject({ estado: "desligado", fila: 0 });
  });

  test("cancelar quem espera na porta tira o pedido da fila sem rodar", async () => {
    const { runtime, falsos, situacao } = montar();
    runtime.estados.pausar("alba", null);
    const cancelar = new AbortController();
    const pedido = acompanhar(runtime.executar(pedir("alba", "oi", { sinal: cancelar.signal })));
    await assentar();
    expect(situacao("alba").fila).toBe(1);

    cancelar.abort(new Error("desisti"));
    await vi.waitFor(() => expect(pedido.erro).toEqual(new Error("desisti")));
    expect(situacao("alba").fila).toBe(0);
    runtime.estados.retomar("alba");
    await assentar();
    expect(falsos["p-alba"]!.pedidos).toHaveLength(0);
  });
});
