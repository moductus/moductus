// @vitest-environment happy-dom
import { act, Suspense, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sobDemanda } from "./sobDemanda.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | null = null;
let recipiente: HTMLElement;

function Saudacao({ nome }: { nome: string }) {
  return <p>Olá, {nome}</p>;
}

let fallbacks = 0;
function Carregando() {
  fallbacks++;
  return <p>carregando</p>;
}

/** Um import que só termina quando o teste manda: resolve ou falha à mão. */
function importManual() {
  const pedidos: { resolver: () => void; falhar: () => void }[] = [];
  const importar = vi.fn(
    () =>
      new Promise<typeof Saudacao>((resolver, falhar) =>
        pedidos.push({ resolver: () => resolver(Saudacao), falhar: () => falhar(new Error("chunk")) }),
      ),
  );
  return { importar, pedidos };
}

// O `use` só retoma a tela suspensa num act aguardado.
async function desenhar(Tela: (p: { nome: string }) => ReactNode, nome: string) {
  await act(async () =>
    raiz!.render(
      <Suspense fallback={<Carregando />}>
        <Tela nome={nome} />
      </Suspense>,
    ),
  );
}

function montar() {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
}

afterEach(() => {
  fallbacks = 0;
  act(() => raiz?.unmount());
  raiz = null;
  recipiente?.remove();
});

describe("sobDemanda", () => {
  // Fica em primeiro: o React em dev avisa uma vez só por módulo e não avisa na primeira suspensão.
  it("ao retomar depois de suspender, chama use() de novo e o React não avisa de uso condicional", async () => {
    // Fora do act, como no app: o import chega num quadro seguinte e a tela é desenhada de novo.
    const ambiente = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    ambiente.IS_REACT_ACT_ENVIRONMENT = false;
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const nome of ["Alba", "Tula"]) {
        const Tela = sobDemanda(
          () => new Promise<typeof Saudacao>((resolver) => setTimeout(() => resolver(Saudacao), 5)),
        );
        montar();
        raiz!.render(
          <Suspense fallback={<Carregando />}>
            <Tela nome={nome} />
          </Suspense>,
        );
        await vi.waitFor(() => expect(recipiente.textContent).toBe(`Olá, ${nome}`));
        raiz!.unmount();
        recipiente.remove();
      }
      const avisos = erros.mock.calls.filter((chamada) => String(chamada[0]).includes("use()"));
      expect(avisos).toEqual([]);
    } finally {
      raiz = null;
      erros.mockRestore();
      ambiente.IS_REACT_ACT_ENVIRONMENT = true;
    }
  });

  it("só importa quando aparece, suspende enquanto baixa e depois desenha com as props", async () => {
    const { importar, pedidos } = importManual();
    const Tela = sobDemanda(importar);
    expect(importar).not.toHaveBeenCalled();
    montar();
    await desenhar(Tela, "Alba");
    expect(recipiente.textContent).toBe("carregando");
    await act(async () => pedidos[0]!.resolver());
    expect(recipiente.textContent).toBe("Olá, Alba");
    expect(importar).toHaveBeenCalledTimes(1);
  });

  it("depois de carregada, desenha no mesmo quadro, sem passar pelo Suspense, e não importa de novo", async () => {
    const { importar, pedidos } = importManual();
    const Tela = sobDemanda(importar);
    const carregando = Tela.carregar();
    expect(Tela.carregar()).toBe(carregando);
    pedidos[0]!.resolver();
    await carregando;
    montar();
    await desenhar(Tela, "Tula");
    expect(recipiente.textContent).toBe("Olá, Tula");
    await desenhar(Tela, "Nuno");
    expect(recipiente.textContent).toBe("Olá, Nuno");
    expect(fallbacks).toBe(0);
    expect(importar).toHaveBeenCalledTimes(1);
  });

  it("um import que falhou é pedido de novo na próxima vez", async () => {
    const { importar, pedidos } = importManual();
    const Tela = sobDemanda(importar);
    const primeiro = Tela.carregar();
    pedidos[0]!.falhar();
    await expect(primeiro).rejects.toThrow("chunk");
    const segundo = Tela.carregar();
    expect(importar).toHaveBeenCalledTimes(2);
    pedidos[1]!.resolver();
    await segundo;
    montar();
    await desenhar(Tela, "Faina");
    expect(recipiente.textContent).toBe("Olá, Faina");
  });
});
