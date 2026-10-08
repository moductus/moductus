import { useEffect, useState } from "react";

/** "09:05": hora e minuto com dois dígitos, sempre 24 h. */
export function formatarHora(data: Date): string {
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${dois(data.getHours())}:${dois(data.getMinutes())}`;
}

/** Milissegundos até a virada do próximo minuto. */
export function ateProximoMinuto(data: Date): number {
  return 60_000 - (data.getSeconds() * 1000 + data.getMilliseconds());
}

/**
 * Hora do relógio do dock. Acorda só na virada do minuto (um timer por minuto, sem
 * consulta por segundo), e recalcula a espera a cada vez para não acumular atraso.
 */
export function useRelogio(): string {
  const [hora, setHora] = useState(() => formatarHora(new Date()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const agendar = () => {
      timer = setTimeout(() => {
        setHora(formatarHora(new Date()));
        agendar();
      }, ateProximoMinuto(new Date()));
    };
    agendar();
    return () => clearTimeout(timer);
  }, []);
  return hora;
}
