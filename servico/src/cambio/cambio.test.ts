import type { Cambio } from "@moductus/contrato";
import { describe, expect, test } from "vitest";
import {
  CACHE_DA_COTACAO_MS,
  converter,
  ENDERECO_FRANKFURTER,
  MENSAGEM_FONTE_ESTRANHA,
  MENSAGEM_FONTE_FORA,
  MENSAGEM_FONTE_SEM_MOEDA,
  ServicoCambio,
  SO_DOLAR,
} from "./cambio.ts";

const CINCO_E_MEIO: Cambio = {
  cotacoes: { BRL: { milionesimos: 5_500_000, data: "2026-10-16", fonte: "digitada" } },
};

describe("conversão do custo para a moeda do teto", () => {
  test("em dólar não há conversão: microdólares viram centavos, sem cotação", () => {
    expect(converter(1_000_000, "USD", { cotacoes: {} })).toEqual({ centavos: 100, cotacaoDe: null });
    expect(SO_DOLAR(27, "USD")).toEqual({ centavos: 0, cotacaoDe: null });
  });

  test("em real, pela cotação digitada e com a data dela; sem cotação, nada de número", () => {
    // US$ 2,00 a R$ 5,50 são R$ 11,00.
    expect(converter(2_000_000, "BRL", CINCO_E_MEIO)).toEqual({ centavos: 1100, cotacaoDe: "2026-10-16" });
    expect(converter(2_000_000, "EUR", CINCO_E_MEIO)).toBeNull();
    expect(SO_DOLAR(2_000_000, "BRL")).toBeNull();
  });

  test("para baixo e em inteiro grande: o centavo só conta quando inteiro, sem estourar", () => {
    // 1.999 µ$ a 5,5 são 1,099 centavo: conta 1.
    expect(converter(1_999, "BRL", CINCO_E_MEIO)?.centavos).toBe(1);
    // US$ 10 mil a 999.999,999999 por dólar: o produto passa do inteiro seguro e a conta segue exata.
    const caro: Cambio = {
      cotacoes: { GBP: { milionesimos: 999_999_999_999, data: "2026-10-16", fonte: "digitada" } },
    };
    expect(converter(10_000_000_000, "GBP", caro)?.centavos).toBe(999_999_999_999);
  });
});

/** Uma resposta da fonte, como o `fetch` devolve. */
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

/** `fetch` falso: anota os endereços pedidos e responde o que o teste mandar. Nenhuma rede. */
function fonte(responder: (url: string, sinal: AbortSignal) => Promise<Response>) {
  const pedidos: string[] = [];
  const buscar = ((url: string | URL | Request, init?: RequestInit) => {
    pedidos.push(String(url));
    return responder(String(url), init!.signal!);
  }) as typeof fetch;
  return { buscar, pedidos };
}

describe("buscar cotação na fonte (Frankfurter v2, HTTP simulado)", () => {
  test("200: devolve o valor em milionésimos e a data da resposta, não a de hoje", async () => {
    const { buscar, pedidos } = fonte(() =>
      Promise.resolve(resposta({ date: "2026-10-16", base: "USD", quote: "BRL", rate: 5.4321 })),
    );
    const cambio = new ServicoCambio({ buscar, agora: () => new Date("2026-10-18T12:00:00.000Z") });
    expect(await cambio.buscar("BRL")).toEqual({ moeda: "BRL", milionesimos: 5_432_100, data: "2026-10-16" });
    expect(pedidos).toEqual([`${ENDERECO_FRANKFURTER}BRL`]);
    expect(ENDERECO_FRANKFURTER).toBe("https://api.frankfurter.dev/v2/rate/USD/");
  });

  test("24 horas de cache por moeda: a fonte não é consultada de novo antes disso", async () => {
    let agora = Date.parse("2026-10-18T12:00:00.000Z");
    let taxa = 5.4;
    const { buscar, pedidos } = fonte((url) =>
      Promise.resolve(resposta({ date: "2026-10-16", base: "USD", quote: url.slice(-3), rate: taxa })),
    );
    const cambio = new ServicoCambio({ buscar, agora: () => new Date(agora) });
    await cambio.buscar("BRL");
    taxa = 5.6;
    agora += CACHE_DA_COTACAO_MS - 1;
    expect((await cambio.buscar("BRL")).milionesimos).toBe(5_400_000);
    await cambio.buscar("EUR");
    expect(pedidos).toHaveLength(2);
    agora += 1;
    expect((await cambio.buscar("BRL")).milionesimos).toBe(5_600_000);
    expect(pedidos).toHaveLength(3);
  });

  test("404: a fonte não tem a moeda, e a falha não fica guardada", async () => {
    let status = 404;
    const { buscar, pedidos } = fonte(() =>
      Promise.resolve(
        status === 404
          ? resposta({ message: "not found" }, 404)
          : resposta({ date: "2026-10-16", base: "USD", quote: "GBP", rate: 0.79 }),
      ),
    );
    const cambio = new ServicoCambio({ buscar });
    await expect(cambio.buscar("GBP")).rejects.toThrow(MENSAGEM_FONTE_SEM_MOEDA("GBP"));
    status = 200;
    expect((await cambio.buscar("GBP")).milionesimos).toBe(790_000);
    expect(pedidos).toHaveLength(2);
  });

  test("timeout: passado o prazo, a busca desiste e diz que a gravada continua", async () => {
    const { buscar } = fonte(
      (_url, sinal) =>
        new Promise((_resolve, rejeitar) => sinal.addEventListener("abort", () => rejeitar(sinal.reason))),
    );
    const cambio = new ServicoCambio({ buscar, prazoMs: 20 });
    await expect(cambio.buscar("BRL")).rejects.toThrow(MENSAGEM_FONTE_FORA);
  });

  test("500, sem rede e resposta que não é a pedida também não viram número", async () => {
    const respostas = [
      () => Promise.resolve(resposta({}, 503)),
      () => Promise.reject(new TypeError("fetch failed")),
      () => Promise.resolve(resposta({ date: "2026-10-16", base: "USD", quote: "EUR", rate: 0.9 })),
      () => Promise.resolve(resposta({ date: "2026-10-16", base: "USD", quote: "BRL", rate: -1 })),
      () => Promise.resolve(new Response("<html>", { status: 200 })),
    ];
    let vez = 0;
    const { buscar } = fonte(() => respostas[vez++]!());
    const cambio = new ServicoCambio({ buscar });
    await expect(cambio.buscar("BRL")).rejects.toThrow(MENSAGEM_FONTE_FORA);
    await expect(cambio.buscar("BRL")).rejects.toThrow(MENSAGEM_FONTE_FORA);
    await expect(cambio.buscar("BRL")).rejects.toThrow(MENSAGEM_FONTE_ESTRANHA);
    await expect(cambio.buscar("BRL")).rejects.toThrow(MENSAGEM_FONTE_ESTRANHA);
    await expect(cambio.buscar("BRL")).rejects.toThrow(MENSAGEM_FONTE_ESTRANHA);
  });
});
