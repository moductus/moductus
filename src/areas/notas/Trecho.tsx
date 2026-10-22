import type { ResultadoBuscaNota } from "@moductus/contrato";
import { pedacosDoTrecho } from "./notas.ts";
import "./Trecho.css";

/** O trecho de um resultado da busca com o que bateu marcado (na área e no painel). */
export function TrechoMarcado({ resultado }: { resultado: ResultadoBuscaNota }) {
  return (
    <>
      {pedacosDoTrecho(resultado.trecho, resultado.destaques).map((p, i) =>
        p.marcado ? (
          <mark key={i} className="nota-marca">
            {p.texto}
          </mark>
        ) : (
          <span key={i}>{p.texto}</span>
        ),
      )}
    </>
  );
}
