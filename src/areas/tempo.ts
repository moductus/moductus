import { useEffect, useState } from "react";

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/**
 * Quanto tempo passou, do jeito que as áreas escrevem: "agora", "há 5 min", "há 26 h", "há 3
 * dias". Até dois dias fica em horas, como no AreaDev.dc.html ("espera seu review há 26 h").
 * Instante inválido ou no futuro (relógio adiantado de quem gravou) vale "agora".
 */
export function haQuanto(desde: string | Date, agora: Date): string {
  const passou = agora.getTime() - new Date(desde).getTime();
  if (!(passou >= MINUTO)) return "agora";
  if (passou < HORA) return `há ${Math.floor(passou / MINUTO)} min`;
  if (passou < 2 * DIA) return `há ${Math.floor(passou / HORA)} h`;
  return `há ${Math.floor(passou / DIA)} dias`;
}

/** O dia local `AAAA-MM-DD` de um instante, o mesmo que o serviço usa em `uso_ia`. */
export function diaLocal(data: Date): string {
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${data.getFullYear()}-${mes}-${dia}`;
}

/** O relógio da tela, de minuto em minuto: "há 2 min" anda sem esperar o próximo evento. */
export function useAgora(intervaloMs = MINUTO): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const relogio = setInterval(() => setAgora(new Date()), intervaloMs);
    return () => clearInterval(relogio);
  }, [intervaloMs]);
  return agora;
}
