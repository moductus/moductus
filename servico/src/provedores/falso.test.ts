import { afterEach, describe, expect, test, vi } from "vitest";
import { ProvedorFalso, roteiros } from "./falso.ts";
import type { ChamadaDeFerramenta, EventoAgente, PedidoDoAgente, ResultadoDeFerramenta } from "./provedor.ts";

const pedido = (mudanca: Partial<PedidoDoAgente> = {}): PedidoDoAgente => ({
  agenteId: "nuno",
  execucaoId: "exec-1",
  instrucoes: "Você é o Nuno.",
  mensagens: [{ papel: "usuario", texto: "O que precisa de mim?" }],
  ferramentas: [],
  executarFerramenta: () => Promise.reject(new Error("nenhuma ferramenta esperada")),
  continuarDe: null,
  ...mudanca,
});

async function coletar(eventos: AsyncIterable<EventoAgente>): Promise<EventoAgente[]> {
  const lista: EventoAgente[] = [];
  for await (const evento of eventos) lista.push(evento);
  return lista;
}

const executar = (falso: ProvedorFalso, p = pedido(), sinal = new AbortController().signal) =>
  coletar(falso.executar(p, sinal));

afterEach(() => {
  vi.useRealTimers();
});

describe("provedor falso", () => {
  test("segue o roteiro na ordem e guarda o pedido recebido", async () => {
    const falso = new ProvedorFalso(
      "p1",
      roteiros.resposta("Dois PRs esperam você.", { tokensEntrada: 7, tokensSaida: 3 }),
    );
    const p = pedido();
    expect(await executar(falso, p)).toEqual([
      { tipo: "texto", texto: "Dois PRs esperam você." },
      { tipo: "uso", tokensEntrada: 7, tokensSaida: 3 },
      { tipo: "fim", continuacao: null },
    ]);
    expect(falso.pedidos).toEqual([p]);
  });

  test("cada execução consome o próximo roteiro e, sem roteiro, falha alto", async () => {
    const falso = new ProvedorFalso("p1", [{ tipo: "texto", texto: "um" }]).roteirizar([
      { tipo: "texto", texto: "dois" },
      { tipo: "fim", continuacao: "sessao-2" },
    ]);
    expect(falso.pendentes).toBe(2);
    expect(await executar(falso)).toEqual([
      { tipo: "texto", texto: "um" },
      { tipo: "fim", continuacao: null },
    ]);
    expect(await executar(falso)).toEqual([
      { tipo: "texto", texto: "dois" },
      { tipo: "fim", continuacao: "sessao-2" },
    ]);
    expect(falso.pendentes).toBe(0);
    await expect(executar(falso, pedido({ execucaoId: "exec-9" }))).rejects.toThrow(
      "provedor falso p1 sem roteiro para a execução exec-9",
    );
  });

  test("roteiro pode ser montado a partir do pedido", async () => {
    const falso = new ProvedorFalso("p1", (p) =>
      roteiros.resposta(`eco: ${p.mensagens.at(-1)?.texto ?? ""}`),
    );
    const eventos = await executar(falso, pedido({ continuarDe: "sessao-1" }));
    expect(eventos[0]).toEqual({ tipo: "texto", texto: "eco: O que precisa de mim?" });
    expect(falso.pedidos[0]?.continuarDe).toBe("sessao-1");
  });

  test("chamada de ferramenta passa pelo executor do pedido e relata o resultado", async () => {
    const recebidas: ChamadaDeFerramenta[] = [];
    const executarFerramenta = (chamada: ChamadaDeFerramenta): Promise<ResultadoDeFerramenta> => {
      recebidas.push(chamada);
      return Promise.resolve(
        chamada.nome === "github.prs"
          ? { ok: true, valor: [{ numero: 42 }] }
          : { ok: false, erro: "entrada inválida" },
      );
    };
    const falso = new ProvedorFalso("p1", [
      { tipo: "ferramenta", nome: "github.prs", entrada: { estado: "aberto" } },
      { tipo: "ferramenta", nome: "github.comentar", entrada: {}, id: "toolu_1" },
      { tipo: "texto", texto: "O #42 espera você." },
    ]);
    const eventos = await executar(falso, pedido({ executarFerramenta }));
    expect(recebidas).toEqual([
      { id: "chamada-1", nome: "github.prs", entrada: { estado: "aberto" } },
      { id: "toolu_1", nome: "github.comentar", entrada: {} },
    ]);
    expect(eventos).toEqual([
      { tipo: "ferramenta", chamada: recebidas[0] },
      { tipo: "resultado", chamadaId: "chamada-1", resultado: { ok: true, valor: [{ numero: 42 }] } },
      { tipo: "ferramenta", chamada: recebidas[1] },
      { tipo: "resultado", chamadaId: "toolu_1", resultado: { ok: false, erro: "entrada inválida" } },
      { tipo: "texto", texto: "O #42 espera você." },
      { tipo: "fim", continuacao: null },
    ]);
  });

  test("erro tipado encerra a sequência: nada depois dele sai", async () => {
    const falso = new ProvedorFalso("p1", [
      { tipo: "texto", texto: "começando" },
      ...roteiros.falha("limite", "2026-10-09T18:00:00.000Z"),
      { tipo: "texto", texto: "nunca" },
    ]);
    expect(await executar(falso)).toEqual([
      { tipo: "texto", texto: "começando" },
      {
        tipo: "erro",
        falha: {
          motivo: "limite",
          mensagem: "falha roteirizada: limite",
          voltaEm: "2026-10-09T18:00:00.000Z",
        },
      },
    ]);
  });

  test("exceção do roteiro escapa do iterador, como um adaptador quebrado", async () => {
    const falso = new ProvedorFalso("p1", [{ tipo: "excecao", erro: new Error("stream-json ilegível") }]);
    await expect(executar(falso)).rejects.toThrow("stream-json ilegível");
  });

  test("pausa usa o relógio do teste e o cancelamento interrompe no meio", async () => {
    vi.useFakeTimers();
    const falso = new ProvedorFalso("p1", [
      { tipo: "texto", texto: "antes" },
      { tipo: "pausa", ms: 5000 },
      { tipo: "texto", texto: "depois" },
    ]);
    const controle = new AbortController();
    const recebidos: EventoAgente[] = [];
    const rodando = (async () => {
      for await (const evento of falso.executar(pedido(), controle.signal)) recebidos.push(evento);
    })();
    await vi.advanceTimersByTimeAsync(4999);
    expect(recebidos).toEqual([{ tipo: "texto", texto: "antes" }]);
    controle.abort();
    await expect(rodando).rejects.toMatchObject({ name: "AbortError" });
    expect(recebidos).toEqual([{ tipo: "texto", texto: "antes" }]);
  });

  test("pausa termina quando o relógio anda o bastante", async () => {
    vi.useFakeTimers();
    const falso = new ProvedorFalso("p1", [{ tipo: "pausa", ms: 1000 }, ...roteiros.resposta("ok")]);
    const rodando = executar(falso);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await rodando).map((e) => e.tipo)).toEqual(["texto", "uso", "fim"]);
  });

  test("sinal já cancelado não consome roteiro", async () => {
    const falso = new ProvedorFalso("p1", roteiros.resposta("ok"));
    await expect(executar(falso, pedido(), AbortSignal.abort())).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(falso.pendentes).toBe(1);
    expect(falso.pedidos).toEqual([]);
  });
});
