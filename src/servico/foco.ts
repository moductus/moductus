import type { EstadoFoco, EtapaFoco } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useEffect, useRef, useState } from "react";
import { servico } from "./conexao.ts";

/**
 * O foco na janela (PRODUCT.md §4 e §5): o painel Foco e o tempo no ícone do dock leem o mesmo
 * `EstadoFoco` e contam o tempo sozinhos a partir de `terminaEm`, sem tique pelo canal. Os dois
 * passam pelas mesmas contas daqui: o minuto do dock é sempre o minuto do relógio do painel.
 */

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;

/** Quanto falta da etapa, em ms, nunca negativo. Em pausa, o que faltava quando ela parou. */
export function restanteMs(etapa: EtapaFoco, agora: number): number {
  const ate = Date.parse(etapa.terminaEm);
  const desde = etapa.pausadaEm !== null ? Date.parse(etapa.pausadaEm) : agora;
  return Math.max(0, ate - desde);
}

/** Os segundos que faltam, arredondados para cima: o relógio só chega a 00:00 no fim. */
export function segundosRestantes(etapa: EtapaFoco, agora: number): number {
  return Math.ceil(restanteMs(etapa, agora) / SEGUNDO);
}

const dois = (n: number) => String(n).padStart(2, "0");

/** O relógio grande do painel: "18:42"; com uma hora ou mais, "1:05:00". */
export function relogioDoFoco(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const horas = Math.floor(s / 3600);
  const minutos = Math.floor((s % 3600) / 60);
  return horas > 0 ? `${horas}:${dois(minutos)}:${dois(s % 60)}` : `${dois(minutos)}:${dois(s % 60)}`;
}

/** O número no ícone do dock: os minutos inteiros do relógio do painel (18:42 vira 18). */
export function minutosDoDock(segundos: number): number {
  return Math.floor(Math.max(0, segundos) / 60);
}

/** O mesmo relógio dito para o leitor de tela: "18 minutos e 42 segundos". */
export function relogioFalado(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const minutos = Math.floor(s / 60);
  const resto = s % 60;
  const min = `${minutos} ${minutos === 1 ? "minuto" : "minutos"}`;
  if (resto === 0) return min;
  return `${min} e ${resto} ${resto === 1 ? "segundo" : "segundos"}`;
}

/**
 * Quanto da etapa já passou, de 0 a 1, pelos segundos que faltam e pela duração planejada (que o
 * "+5 min" estica): a barra anda com o mesmo número do relógio.
 */
export function fracaoFeita(etapa: EtapaFoco, segundos: number): number {
  const total = etapa.duracaoPlanejadaMin * MINUTO;
  return total > 0 ? Math.min(1, Math.max(0, 1 - (segundos * SEGUNDO) / total)) : 1;
}

/**
 * Daqui a quanto o número mostrado muda, em ms: a cada segundo no painel (`passo` 1) e a cada
 * minuto do relógio no dock (`passo` 60). Nunca menos de 1 ms; sem nada para contar, `null`.
 */
export function esperaAteMudar(etapa: EtapaFoco, agora: number, passo: number): number | null {
  if (etapa.pausadaEm !== null || etapa.fim !== null) return null;
  const ms = restanteMs(etapa, agora);
  if (ms <= 0) return null;
  const mostrado = Math.floor(Math.ceil(ms / SEGUNDO) / passo);
  // O número cai quando os segundos (para cima) passam abaixo de `mostrado * passo`.
  const alvoS = mostrado > 0 ? mostrado * passo - 1 : 0;
  return Math.max(1, ms - alvoS * SEGUNDO);
}

/**
 * Os segundos restantes da etapa, contados pela janela: acorda só quando o número de `passo` em
 * `passo` segundos muda (o dock, de minuto em minuto do relógio; o painel, a cada segundo).
 * `acordar` muda quando a janela volta à tela, para reler o relógio depois de um tempo escondida.
 */
export function useSegundosRestantes(etapa: EtapaFoco | null, passo = 1, acordar?: unknown): number | null {
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    if (etapa === null) return;
    const real = Date.now();
    // A etapa mudou (ou a janela voltou) com o relógio da tela parado: relê já.
    const atrasado =
      Math.floor(segundosRestantes(etapa, agora) / passo) !==
      Math.floor(segundosRestantes(etapa, real) / passo);
    const espera = atrasado ? 0 : esperaAteMudar(etapa, real, passo);
    if (espera === null) return;
    const relogio = setTimeout(() => setAgora(Date.now()), espera);
    return () => clearTimeout(relogio);
  }, [etapa, passo, agora, acordar]);

  return etapa === null ? null : segundosRestantes(etapa, agora);
}

/** Duração curta do dia: "40 min", "1h15", "2h". */
export function duracaoCurta(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  if (m < 60) return `${m} min`;
  const horas = Math.floor(m / 60);
  const resto = m % 60;
  return resto === 0 ? `${horas}h` : `${horas}h${dois(resto)}`;
}

/** A hora como a Alba fala: "16h", "17h30". */
export function horaFalada(instante: string | Date): string {
  const data = new Date(instante);
  const minutos = data.getMinutes();
  return minutos === 0 ? `${data.getHours()}h` : `${data.getHours()}h${dois(minutos)}`;
}

/** Como fica cada trilho dos ciclos da rodada no painel. */
export type SituacaoCiclo = "feito" | "atual" | "falta";

/**
 * Os trilhos da rodada ("Ciclo 2 de 4"): os focos feitos, o que está correndo (ou pausado) e os
 * que faltam. Na pausa e no ciclo que acabou de terminar, o ciclo atual já conta como feito; sem
 * nada correndo, `cicloAtual` é o próximo foco.
 */
export function ciclosDaRodada(estado: EstadoFoco): SituacaoCiclo[] {
  const total = estado.ciclosAtePausaLonga;
  const { etapa, cicloAtual, proxima } = estado;
  const focando = etapa?.tipo === "foco";
  const parado = etapa === null && proxima === "foco";
  const feitos = Math.min(total, focando || parado ? cicloAtual - 1 : cicloAtual);
  return Array.from({ length: total }, (_, i) =>
    i < feitos ? "feito" : i === feitos && focando ? "atual" : "falta",
  );
}

const pedirFoco = () => servico.pedir("foco.obter");

/**
 * O foco como o serviço guarda: a carga ao conectar (e a cada `recarregar`) e o estado novo a cada
 * `foco.mudou`. Aviso que chega com a carga a caminho vale mais que ela. Sem conexão, ou com a
 * carga recusada, `null`: quem mostra diz que não sabe.
 */
export function useEstadoFoco(canal: EstadoConexao, recarregar?: unknown): EstadoFoco | null {
  const [estado, setEstado] = useState<EstadoFoco | null>(null);
  // Quantos `foco.mudou` já chegaram: a resposta de um pedido mais velho que o último não vale.
  const avisos = useRef(0);

  useEffect(
    () =>
      servico.ouvir("foco.mudou", (valor) => {
        avisos.current += 1;
        setEstado(valor);
      }),
    [],
  );

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    const antes = avisos.current;
    pedirFoco()
      .then((valor) => {
        if (vivo && avisos.current === antes) setEstado(valor);
      })
      .catch(() => {
        if (vivo) setEstado(null);
      });
    return () => {
      vivo = false;
    };
  }, [canal, recarregar]);

  return canal === "conectado" ? estado : null;
}
