import "./Atalho.css";

/**
 * Teclas de uma combinação escrita como na configuração ("Ctrl+Alt+N"). O "+" sozinho também
 * é tecla: "Ctrl++" vira Ctrl e +.
 */
export function teclasDoAtalho(atalho: string): string[] {
  return [...atalho.matchAll(/([^+]+|\+)(?:\+|$)/g)].map((m) => m[1]!.trim()).filter(Boolean);
}

/** Chip de atalho em fonte mono: um kbd por tecla dentro do kbd da combinação (HTML). */
export function Atalho({ teclas }: { teclas: string }) {
  const lista = teclasDoAtalho(teclas);
  return (
    <kbd className="atalho">
      {lista.map((tecla, i) => (
        <kbd key={i} className="atalho-tecla">
          {tecla}
        </kbd>
      ))}
    </kbd>
  );
}
