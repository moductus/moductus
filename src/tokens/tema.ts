import type { Tema } from "@moductus/contrato";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { registrar, useServico } from "../nativo/eventos.ts";
import { servico, useCanal } from "../servico/conexao.ts";

export type { Tema };
export type TemaConcreto = Exclude<Tema, "automatico">;
export type Material = "acrylic" | "solido";

const CONSULTA_ESCURO = "(prefers-color-scheme: dark)";

/** "Automático" segue o Windows: Grafite no escuro, Papel no claro. */
export function resolverTema(tema: Tema, escuro: boolean): TemaConcreto {
  if (tema !== "automatico") return tema;
  return escuro ? "grafite" : "papel";
}

let pararAutomatico: (() => void) | null = null;

/**
 * Troca o tema mudando só `data-tema` na raiz: as variáveis de src/tokens mudam e a janela
 * continua a mesma, sem recarregar. Em "automatico", segue a mudança do Windows ao vivo.
 * `aoAplicar` recebe cada tema concreto aplicado (na hora e a cada mudança do Windows).
 */
export function aplicarTema(tema: Tema, aoAplicar?: (concreto: TemaConcreto) => void): TemaConcreto {
  pararAutomatico?.();
  pararAutomatico = null;
  const raiz = document.documentElement;
  // A primeira aplicação sempre avisa (o material depende dela); a mudança do Windows só
  // avisa quando o tema concreto muda de fato.
  const definir = (concreto: TemaConcreto, sempre: boolean) => {
    if (!sempre && raiz.dataset.tema === concreto) return;
    raiz.dataset.tema = concreto;
    aoAplicar?.(concreto);
  };

  if (tema !== "automatico" || typeof window.matchMedia !== "function") {
    const concreto = resolverTema(tema, true);
    definir(concreto, true);
    return concreto;
  }
  const consulta = window.matchMedia(CONSULTA_ESCURO);
  const aoMudar = (e: MediaQueryListEvent) => definir(resolverTema("automatico", e.matches), false);
  consulta.addEventListener("change", aoMudar);
  pararAutomatico = () => consulta.removeEventListener("change", aoMudar);
  const concreto = resolverTema("automatico", consulta.matches);
  definir(concreto, true);
  return concreto;
}

let pedidoMaterial = 0;

/**
 * Pede à casca o material da janela (Acrylic só no Vidro, quando o Windows deixa) e marca
 * `data-material`. Sem casca (testes, navegador), o material é sólido.
 */
export async function aplicarMaterial(tema: TemaConcreto): Promise<Material> {
  const pedido = ++pedidoMaterial;
  const material = await invoke<Material>("tema_material", { vidro: tema === "vidro" }).catch(
    (): Material => "solido",
  );
  // Uma troca mais nova já passou por aqui: esta resposta não vale mais.
  if (pedido !== pedidoMaterial) return material;
  document.documentElement.dataset.material = material;
  registrar(`tema ${tema} material ${material}`);
  return material;
}

/**
 * Aplica na janela o tema da configuração do serviço e acompanha `config.mudou`. Antes de
 * conectar, vale "automatico".
 */
export function useTema(): void {
  const canal = useCanal(useServico({ silencioso: true }));
  const [tema, setTema] = useState<Tema>("automatico");

  useEffect(() => servico.ouvir("config.mudou", (estado) => setTema(estado.config.tema)), []);

  useEffect(() => {
    if (canal !== "conectado") return;
    servico
      .pedir("config.obter")
      .then((estado) => setTema(estado.config.tema))
      .catch(() => undefined);
  }, [canal]);

  useEffect(() => {
    aplicarTema(tema, (concreto) => void aplicarMaterial(concreto));
  }, [tema]);
}
