import { invoke } from "@tauri-apps/api/core";
// Pelo módulo inteiro: `emit` só é lido quando o tour anda, e as janelas sem tour seguem sem ele.
import * as eventos from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { registrar } from "../../nativo/eventos.ts";

/**
 * Tour curto do tutorial (TutorialTour.dc.html; PRODUCT.md §5 "Primeiro uso"): quatro paradas, cada
 * uma na janela de verdade. O dock e o painel (1 e 2), o Sistema (3) e a captura rápida (4). Quem
 * anda é quem tem a bolha ou o teclado: avisa todas as janelas pela parada nova e pede à casca a
 * janela dela. Cada janela desenha a própria parte (o anel, o véu, a bolha) pela parada que recebe.
 * Nada aqui grava no serviço: o tour não tem efeito, e volta quando pedido.
 */
export const PARADAS = [1, 2, 3, 4] as const;
export type Parada = (typeof PARADAS)[number];
export const TOTAL_PARADAS = PARADAS.length;

/** Entre as janelas: a parada de agora, ou `null` com o tour fechado. */
export const EVENTO_PARADA = "tour:parada";
/** A Ajuda da bandeja pede o tour (src-tauri/src/bandeja.rs). */
export const EVENTO_VER_TOUR = "tutorial:tour";
/** A Ajuda da bandeja pede os Primeiros passos de volta, com o Sistema já no Início. */
export const EVENTO_REVER_TUTORIAL = "tutorial:rever";

/** O painel abre nesta "área" só para mostrar a bolha da parada 1 ao lado do dock. */
export const AREA_TOUR = "tour";
/** O painel da parada 2. */
export const AREA_PAINEL_TOUR = "hoje";
/** A frase que a captura mostra já entendida na parada 4: um exemplo, que nunca é lançado. */
export const FRASE_TOUR = "ligar pro banco amanhã 15h";

export function eParada(valor: unknown): valor is Parada {
  return PARADAS.includes(valor as Parada);
}

const comPainel = (p: Parada | null) => p === 1 || p === 2;

/**
 * Vai de uma parada a outra (`null` fecha o tour). Primeiro avisa as janelas, para cada uma já
 * desenhar a parte dela quando aparecer; depois fecha a janela da parada que sai e abre a da nova.
 * "Terminar o tour" leva ao Início, onde ficam os Primeiros passos.
 */
export async function irPara(
  nova: Parada | null,
  de: Parada | null,
  { terminou = false }: { terminou?: boolean } = {},
): Promise<void> {
  // Já está nela: abrir o painel de novo o fecharia (a mesma área alterna).
  if (nova !== null && nova === de) return;
  try {
    await eventos.emit(EVENTO_PARADA, nova);
    if (de === 4 && nova !== 4) await invoke("captura_fechar");
    if (comPainel(de) && !comPainel(nova)) await invoke("painel_fechar");
    if (nova === 1 || nova === 2) {
      await invoke("painel_abrir", { area: nova === 1 ? AREA_TOUR : AREA_PAINEL_TOUR });
      // O painel não ativa sozinho; na parada dele, o teclado do tour (Esc e setas) fica nele.
      await invoke("painel_foco", { quer: true });
    } else if (nova === 3 || (nova === null && terminou)) {
      await invoke("sistema_abrir", { area: "inicio" });
    } else if (nova === 4) {
      // Na parada 3 o Sistema tem o foco, e a captura some ao perdê-lo: aqui ela está fechada.
      await invoke("captura_alternar");
    }
  } catch (erro) {
    registrar(`tour ${String(de)} -> ${String(nova)} falhou: ${String(erro)}`);
  }
}

/** Começa o tour do começo. */
export function iniciarTour(): Promise<void> {
  return irPara(1, null);
}

export interface Tour {
  /** A parada de agora; `null` sem tour. */
  parada: Parada | null;
  /** Anda a partir da parada de agora. */
  ir: (nova: Parada | null, opcoes?: { terminou?: boolean }) => void;
  /** Verdadeiro enquanto esta janela está mudando de parada (a captura não fecha o tour ao sumir). */
  navegando: { readonly current: boolean };
}

/** A parada do tour como esta janela a vê, pelo evento que todas recebem. */
export function useTour(): Tour {
  const [parada, setParada] = useState<Parada | null>(null);
  const atual = useRef<Parada | null>(null);
  const navegando = useRef(false);

  useEffect(() => {
    const parar = eventos
      .listen<unknown>(EVENTO_PARADA, (e) => {
        const nova = eParada(e.payload) ? e.payload : null;
        atual.current = nova;
        setParada(nova);
      })
      .catch(() => () => undefined);
    return () => {
      void parar.then((f) => f());
    };
  }, []);

  const ir = useCallback((nova: Parada | null, opcoes?: { terminou?: boolean }) => {
    navegando.current = true;
    void irPara(nova, atual.current, opcoes).finally(() => {
      navegando.current = false;
    });
  }, []);

  return { parada, ir, navegando };
}

/** A parada seguinte e a anterior; nas pontas, nenhuma. */
export const proxima = (p: Parada): Parada | null => (p < TOTAL_PARADAS ? ((p + 1) as Parada) : null);
export const anterior = (p: Parada): Parada | null => (p > 1 ? ((p - 1) as Parada) : null);

/**
 * O teclado do tour na janela que tem o foco: Esc pula, → e ← andam entre as paradas. Vem antes
 * do teclado da própria janela (o Esc do painel e da captura fecha a janela, aqui fecha o tour).
 */
export function useTecladoTour({ parada, ir }: Pick<Tour, "parada" | "ir">): void {
  useEffect(() => {
    if (parada === null) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const alvo =
        e.key === "Escape"
          ? { nova: null }
          : e.key === "ArrowRight"
            ? { nova: proxima(parada) }
            : e.key === "ArrowLeft"
              ? { nova: anterior(parada) }
              : undefined;
      if (!alvo) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (alvo.nova !== null || e.key === "Escape") ir(alvo.nova);
    };
    window.addEventListener("keydown", aoTeclar, true);
    return () => window.removeEventListener("keydown", aoTeclar, true);
  }, [parada, ir]);
}
