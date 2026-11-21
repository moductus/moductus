import { CONFIG_PADRAO } from "@moductus/contrato";
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { Atalho } from "../../componentes/Atalho.tsx";
import { Botao } from "../../componentes/Botao.tsx";
import { textoDoAtalho } from "../../componentes/CampoAtalho.tsx";
import { anterior, PARADAS, proxima, TOTAL_PARADAS, type Parada, type Tour } from "./tour.ts";
import "./Tour.css";

/** O título e as até duas frases de cada parada (TutorialTour.dc.html). */
function conteudo(parada: Parada, atalho: string): { titulo: string; texto: ReactNode } {
  switch (parada) {
    case 1:
      return {
        titulo: "O dock",
        texto:
          "Os painéis abrem daqui, e cada agente mostra o que está fazendo. Ele fica na borda da tela, por cima das janelas.",
      };
    case 2:
      return {
        titulo: "Um painel",
        texto: (
          <>
            Cada ícone abre o seu painel ao lado do dock. <Atalho teclas="Esc" /> ou um clique fora fecha.
          </>
        ),
      };
    case 3:
      return {
        titulo: "O Sistema",
        texto: (
          <>
            Aqui as áreas têm espaço: tarefas, foco, notas e configurações. <Atalho teclas={atalho} /> abre e
            esconde de qualquer lugar.
          </>
        ),
      };
    case 4:
      return {
        titulo: "A captura rápida",
        texto: (
          <>
            <Atalho teclas={atalho} /> abre de qualquer lugar. Escreva do seu jeito e a Alba entende; Enter
            guarda.
          </>
        ),
      };
  }
}

const ATALHO_PADRAO: Readonly<Partial<Record<Parada, string>>> = {
  3: CONFIG_PADRAO.atalhos.sistema,
  4: CONFIG_PADRAO.atalhos.captura,
};

interface PropsBolhaTour extends Pick<Tour, "ir"> {
  parada: Parada;
  /** O atalho de quem a parada apresenta, como está na configuração ("Ctrl+Alt+N"). */
  atalho?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * A bolha de uma parada: "n de 4", os pontos, o título, até duas frases e [Pular tour] [Voltar]
 * [Próximo]; na última, [Voltar] [Terminar o tour]. O foco vai para o botão de seguir.
 */
export function BolhaTour({ parada, ir, atalho, className, style }: PropsBolhaTour) {
  const idTexto = useId();
  const seguir = useRef<HTMLButtonElement>(null);
  const { titulo, texto } = conteudo(parada, textoDoAtalho(atalho ?? ATALHO_PADRAO[parada] ?? ""));
  const depois = proxima(parada);
  const antes = anterior(parada);

  useEffect(() => {
    seguir.current?.focus();
  }, [parada]);

  return (
    <div
      role="dialog"
      aria-label={`Tour, ${parada} de ${TOTAL_PARADAS}`}
      aria-describedby={idTexto}
      className={["tour-bolha", className].filter(Boolean).join(" ")}
      style={style}
      data-parada={parada}
    >
      <div className="tour-bolha-topo">
        <span>
          {parada} de {TOTAL_PARADAS}
        </span>
        <span className="tour-pontos" aria-hidden="true">
          {PARADAS.map((p) => (
            <span key={p} className="tour-ponto" data-atual={p === parada || undefined} />
          ))}
        </span>
      </div>
      <h2 className="tour-bolha-titulo">{titulo}</h2>
      <p id={idTexto} className="tour-bolha-texto">
        {texto}
      </p>
      <div className="tour-bolha-acoes">
        {depois !== null && (
          <Botao variante="fantasma" onClick={() => ir(null)}>
            Pular tour
          </Botao>
        )}
        {antes !== null && <Botao onClick={() => ir(antes)}>Voltar</Botao>}
        {depois !== null ? (
          <Botao ref={seguir} variante="primario" onClick={() => ir(depois)}>
            Próximo
          </Botao>
        ) : (
          <Botao ref={seguir} variante="primario" onClick={() => ir(null, { terminou: true })}>
            Terminar o tour
          </Botao>
        )}
      </div>
    </div>
  );
}
