import { useEffect, useState, type CSSProperties } from "react";
import { BolhaTour } from "./BolhaTour.tsx";
import { useTecladoTour, type Parada, type Tour } from "./tour.ts";
import "./Tour.css";

/** Onde a bolha fica em relação ao anel: ao lado (o Sistema) ou embaixo (o painel). */
export type LadoBolha = "direita" | "abaixo";

interface Retangulo {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * O retângulo do que a parada aponta, refeito quando a janela muda de tamanho. `medir` precisa ser
 * estável (função do módulo), senão a medida se refaz a cada desenho.
 */
function useRetangulo(medir: (() => Retangulo | null) | undefined): Retangulo | null {
  const [medido, setMedido] = useState<{ de: () => Retangulo | null; ret: Retangulo | null } | null>(null);
  useEffect(() => {
    if (!medir) return;
    const refazer = () => setMedido({ de: medir, ret: medir() });
    // Depois de pintar: a janela da parada acabou de aparecer e a área acabou de montar.
    const quadro = requestAnimationFrame(refazer);
    window.addEventListener("resize", refazer);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener("resize", refazer);
    };
  }, [medir]);
  // A medida de outro alvo (a parada mudou) não vale até a nova chegar.
  return medido && medido.de === medir ? medido.ret : null;
}

interface PropsCamadaTour extends Pick<Tour, "parada" | "ir"> {
  /** A parada desta janela, se a de agora for dela: com anel e bolha. Senão, só o véu. */
  minha?: Parada | null;
  /** O que a parada aponta; sem ele, a bolha fica no alto, sem anel. */
  medir?: () => Retangulo | null;
  lado?: LadoBolha;
  atalho?: string;
}

/**
 * Por cima da janela durante o tour (TutorialTour.dc.html; DESIGN.md §5 "Tour"): fora da parada,
 * tudo escurece e não recebe clique nem teclado; na parada, um anel de 2 px no destaque e a bolha
 * ao lado do que aponta, nunca por cima. O teclado do tour vale em qualquer janela com o foco.
 */
export function CamadaTour({ parada, ir, minha = null, medir, lado = "direita", atalho }: PropsCamadaTour) {
  useTecladoTour({ parada, ir });
  const daqui = parada !== null && parada === minha;
  const ret = useRetangulo(daqui ? medir : undefined);
  if (parada === null) return null;

  const anel: CSSProperties | undefined = ret
    ? { left: ret.left, top: ret.top, width: ret.width, height: ret.height }
    : undefined;
  return (
    <div className="tour-camada" data-tour={daqui ? "parada" : "veu"} data-lado={lado}>
      {/* Sem anel (a parada é de outra janela, ou desta sem alvo), o véu é a camada inteira. */}
      {daqui && anel ? (
        <div className="tour-anel" style={anel} aria-hidden="true" />
      ) : (
        !daqui && <div className="tour-veu" aria-hidden="true" />
      )}
      {daqui && (
        <BolhaTour
          parada={parada}
          ir={ir}
          atalho={atalho}
          className="tour-bolha--solta"
          style={ret ? posicaoDaBolha(ret, lado) : undefined}
        />
      )}
    </div>
  );
}

/**
 * Ao lado: à direita do anel, um pouco abaixo do topo. Embaixo: centrada sob o anel. Sem anel (a
 * parada 1, no painel ao lado do dock), a bolha fica no alto, com a margem do painel.
 */
function posicaoDaBolha(ret: Retangulo, lado: LadoBolha): CSSProperties {
  return lado === "direita"
    ? { left: ret.left + ret.width, top: ret.top }
    : { left: ret.left + ret.width / 2, top: ret.top + ret.height, transform: "translateX(-50%)" };
}
