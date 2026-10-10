/** "09:05": hora e minuto com dois dígitos, sempre 24 h. */
export function formatarHora(data: Date): string {
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${dois(data.getHours())}:${dois(data.getMinutes())}`;
}
