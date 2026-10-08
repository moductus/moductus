import "./Marca.css";

export type TamanhoMarca = 16 | 26 | 32 | 48;

/** A marca "Borda e ponto" (docs/design/marca/marca.svg) em currentColor. */
export function Marca({ tamanho = 26, rotulo }: { tamanho?: TamanhoMarca; rotulo?: string }) {
  return (
    <svg
      className={`marca marca-${tamanho}`}
      viewBox="0 0 100 100"
      focusable="false"
      {...(rotulo ? { role: "img", "aria-label": rotulo } : { "aria-hidden": true })}
    >
      <rect x="24" y="4" width="15" height="92" rx="7.5" fill="currentColor" />
      <circle cx="66" cy="24" r="16" fill="currentColor" />
    </svg>
  );
}
