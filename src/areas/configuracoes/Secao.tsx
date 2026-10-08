import type { ReactNode } from "react";

/** Moldura de uma seção de Configurações: o título (h2) e o conteúdo da seção. */
export function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="config-secao" aria-label={titulo}>
      <h2 className="config-secao-titulo">{titulo}</h2>
      {children}
    </section>
  );
}
