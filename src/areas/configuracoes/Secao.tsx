import type { ReactNode } from "react";

interface PropsSecao {
  titulo: string;
  /** A frase que explica a seção, logo abaixo do título. */
  intro?: ReactNode;
  /** Botões da seção inteira, ao lado do título (ConfigModelos.dc.html). */
  acoes?: ReactNode;
  children: ReactNode;
}

/**
 * Moldura de uma seção de Configurações: o título (h2), a frase e as ações dela no alto, e o
 * conteúdo da seção. Sem largura para as ações ao lado, elas descem para baixo da frase.
 */
export function Secao({ titulo, intro, acoes, children }: PropsSecao) {
  const tituloH2 = <h2 className="config-secao-titulo">{titulo}</h2>;
  return (
    <section className="config-secao" aria-label={titulo}>
      {intro || acoes ? (
        <div className="config-secao-topo">
          <div className="config-secao-cabeca">
            {tituloH2}
            {intro && <p className="config-intro">{intro}</p>}
          </div>
          {acoes && <div className="config-secao-acoes">{acoes}</div>}
        </div>
      ) : (
        tituloH2
      )}
      {children}
    </section>
  );
}
