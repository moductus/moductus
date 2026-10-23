import type { Calendario, Conexao } from "@moductus/contrato";
import { haQuanto } from "../tempo.ts";
import { momentoCurto } from "../tarefas/detalhe.ts";

/**
 * Configurações › Conexões › Google Agenda (ConfigConexoesGoogle*.dc.html, Uso5Conexoes.dc.html):
 * o texto do cartão a partir da conexão, dos calendários e da situação que o serviço manda. Quem
 * decide o que a Alba lê e escreve é o serviço; aqui só se conta e se escreve.
 */

/** O intervalo da leitura do Calendar no serviço (`INTERVALO_LEITURA_MS`, F3-23). */
const INTERVALO_LEITURA = "a cada 10 min";

/** Os que a Alba lê para montar o dia: os marcados, fora o "Moductus", que ela escreve. */
export const calendariosLidos = (calendarios: readonly Calendario[]) =>
  calendarios.filter((c) => c.ler && !c.espelho);

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "voce@gmail.com · lê 3 calendários e escreve no "Moductus".", a linha do cartão conectado. */
export function resumoConectado(conexao: Conexao, calendarios: readonly Calendario[]): string {
  const conta = conexao.conta ?? "Conta do Google";
  const lidos = plural(calendariosLidos(calendarios).length, "calendário", "calendários");
  const escreve = calendarios.some((c) => c.espelho) ? ' e escreve no "Moductus"' : "";
  return `${conta} · lê ${lidos}${escreve}.`;
}

/** "há 3 min · a cada 10 min"; sem nenhuma leitura ainda, diz isso. */
export function leituraGoogle(lidaEm: string | null, agora: Date): string {
  return `${lidaEm ? haQuanto(lidaEm, agora) : "ainda não lido"} · ${INTERVALO_LEITURA}`;
}

/** A fila para o "Moductus": "vazia", "1 item", "3 itens". */
export const filaGoogle = (n: number) => (n === 0 ? "vazia" : plural(n, "item", "itens"));

/** "3 itens esperam na fila para o "Moductus"."; vazia, nada a dizer. */
export function esperandoNaFila(n: number): string | null {
  if (n === 0) return null;
  return `${plural(n, "item espera", "itens esperam")} na fila para o "Moductus".`;
}

/** "hoje, 14:31": quando a autorização foi dada, na hora deste PC. */
export const autorizadoEm = (conectadaEm: string | null, agora: Date) =>
  conectadaEm ? momentoCurto(conectadaEm, null, agora) : "—";

/** "4:12": quanto falta para o prazo da autorização no navegador; passou, "0:00". */
export function prazoRestante(venceEm: string, agora: Date): string {
  const segundos = Math.max(0, Math.ceil((new Date(venceEm).getTime() - agora.getTime()) / 1000));
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
}

/** O que cada calendário é, ao lado do nome. */
export function sobreCalendario(calendario: Calendario): string {
  if (calendario.espelho) return "do Moductus · a Alba escreve aqui sem pedir";
  return calendario.podeEscrever ? "você pode editar" : "só leitura";
}

/**
 * "Criar ou mudar evento em Pessoal ou Trabalho sempre pede sua aprovação antes.", com os que a
 * Alba lê; sem nenhum, a regra vale para todos os outros.
 */
export function avisoDeAprovacao(calendarios: readonly Calendario[]): string {
  const nomes = calendariosLidos(calendarios).map((c) => c.nome);
  const ou = nomes.length <= 1 ? nomes.join("") : `${nomes.slice(0, -1).join(", ")} ou ${nomes.at(-1)}`;
  const onde = nomes.length > 0 ? `em ${ou}` : "nos outros calendários";
  return `Criar ou mudar evento ${onde} sempre pede sua aprovação antes.`;
}
