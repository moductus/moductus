import type { ComponentType } from "react";
import type { Janela } from "./rotas.ts";

/**
 * A tela de cada janela vem num chunk à parte: as quatro abrem o mesmo index.html, e cada WebView
 * só baixa, compila e guarda na memória o código do próprio rótulo (o dock não carrega o Sistema).
 */
const TELAS: Readonly<Record<Janela, () => Promise<ComponentType>>> = {
  dock: () => import("./dock/Dock.tsx").then((m) => m.Dock),
  painel: () => import("./painel/Painel.tsx").then((m) => m.Painel),
  sistema: () => import("./sistema/Sistema.tsx").then((m) => m.Sistema),
  captura: () => import("./captura/Captura.tsx").then((m) => m.Captura),
};

export function carregarJanela(janela: Janela): Promise<ComponentType> {
  return TELAS[janela]();
}
