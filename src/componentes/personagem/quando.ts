/**
 * Quando um agente volta, como o Estados.dc.html escreve: curto no dock ("seg 9h", "às 17:40") e
 * por extenso no cartão do painel ("segunda às 9h"). Hora cheia vira "9h"; com minutos, a hora do
 * relógio do dock ("02:46"), para a dica e o relógio ao lado nunca escreverem a mesma hora de dois
 * jeitos.
 */

const DIA_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DIA_LONGO = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const DIA_MS = 24 * 60 * 60_000;

/** "09:05": hora e minuto com dois dígitos, sempre 24 h, como o relógio do dock. */
export function formatarHora(data: Date): string {
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${dois(data.getHours())}:${dois(data.getMinutes())}`;
}

/** "9h", "17:40", "02:46", na hora local. */
export function horaDoDia(data: Date): string {
  return data.getMinutes() === 0 ? `${data.getHours()}h` : formatarHora(data);
}

/** Dias de calendário entre hoje e a data (0 hoje, 1 amanhã), na hora local. */
function diasAte(data: Date, agora: Date): number {
  const meiaNoite = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((meiaNoite(data) - meiaNoite(agora)) / DIA_MS);
}

/**
 * O instante dito a partir de agora: hoje "às 17:40", amanhã "amanhã às 9h", na semana o dia
 * ("seg 9h" curto, "segunda às 9h" longo), mais longe o dia do mês ("dia 12 às 9h"). Instante
 * inválido ou já passado vale `null`: quem mostra diz "em breve" em vez de inventar uma hora.
 */
export function quando(instante: string, agora: Date, forma: "curta" | "longa"): string | null {
  const data = new Date(instante);
  if (Number.isNaN(data.getTime()) || data.getTime() <= agora.getTime()) return null;
  const hora = horaDoDia(data);
  const dias = diasAte(data, agora);
  if (dias === 0) return `às ${hora}`;
  if (dias === 1) return forma === "curta" ? `amanhã ${hora}` : `amanhã às ${hora}`;
  if (dias < 7) {
    const dia = data.getDay();
    return forma === "curta" ? `${DIA_CURTO[dia]} ${hora}` : `${DIA_LONGO[dia]} às ${hora}`;
  }
  return forma === "curta" ? `dia ${data.getDate()} ${hora}` : `dia ${data.getDate()} às ${hora}`;
}

/**
 * Um instante já passado ou de qualquer dia, curto, para listas (o histórico do agente): a hora
 * hoje ("09:02", "14h"), com o dia da semana em outro dia ("sáb 9h").
 */
export function horaCurta(instante: string, agora: Date = new Date()): string {
  const data = new Date(instante);
  const hora = horaDoDia(data);
  return diasAte(data, agora) === 0 ? hora : `${DIA_CURTO[data.getDay()]} ${hora}`;
}

/** O fim de uma pausa: "até 14h" hoje, "até amanhã às 9h" depois; `null` como em {@link quando}. */
export function ateQuando(instante: string, agora: Date): string | null {
  const dito = quando(instante, agora, "longa");
  if (dito === null) return null;
  return `até ${dito.startsWith("às ") ? dito.slice(3) : dito}`;
}
