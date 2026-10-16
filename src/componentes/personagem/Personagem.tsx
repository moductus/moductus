import type { CSSProperties } from "react";
import {
  TAMANHO_PERSONAGEM,
  TAMANHO_PERSONAGEM_MAX,
  TAMANHO_PERSONAGEM_MIN,
  type TamanhoPersonagem,
} from "../../tokens/personagens.ts";
import {
  DADOS_AGENTES,
  MOLDURA_DA_EXPRESSAO,
  ROTULO_ESTADO,
  eAgente,
  eEstadoPersonagem,
  type Agente,
  type EstadoPersonagem,
  type TomMoldura,
} from "./agentes.ts";
import "./personagem.css";

/*
 * Desenho transcrito de docs/design/canvas/Personagem.dc.html: grade de 100 × 120, corpo
 * inteiro mostra tudo, modo cabeça recorta 68 × 68 no alto da cabeça. Os números abaixo são
 * coordenadas do desenho (unidades do viewBox), não medidas de tela; a cor sai dos tokens.
 */

export type ModoPersonagem = "inteiro" | "cabeca";

export interface PersonagemProps {
  agente: Agente;
  modo?: ModoPersonagem;
  /** Altura em px (16 a 168) ou um tamanho nomeado de src/tokens/personagens.ts. */
  tamanho?: TamanhoPersonagem | number;
  estado?: EstadoPersonagem;
  /** Substitui o rótulo acessível padrão ("Alba, dormindo"). */
  rotulo?: string;
  /**
   * Anel de estado em volta da cabeça, como nas listas (Time.dc.html). `true` usa o anel da
   * expressão; um tom troca o anel quando o status diz outra coisa (teto: cara de preocupado,
   * anel de aviso).
   */
  moldura?: boolean | TomMoldura;
}

/** Diferenças de desenho entre os quatro: braços e o quanto o rosto desce no corpo. */
const FORMA: Record<Agente, { bracoE: number; bracoD: number; dy: number; topo: number }> = {
  alba: { bracoE: 21, bracoD: 79, dy: 2, topo: 14 },
  tula: { bracoE: 20, bracoD: 80, dy: 2, topo: 18 },
  faina: { bracoE: 21, bracoD: 79, dy: 6, topo: 14 },
  nuno: { bracoE: 27, bracoD: 73, dy: -2, topo: 16 },
};

interface Expressao {
  olhos: "abertos" | "fechados";
  olhoY: number;
  olhoRx: number;
  olhoRy: number;
  sobrancelha?: string;
  boca: { tipo: "traco"; d: string } | { tipo: "o" };
  zz?: boolean;
}

/** Estado do produto → expressão do canvas (descansando, focado, atento, preocupado, dormindo). */
const EXPRESSAO: Record<EstadoPersonagem, Expressao> = {
  ocioso: {
    olhos: "abertos",
    olhoY: 58,
    olhoRx: 3.2,
    olhoRy: 4,
    boca: { tipo: "traco", d: "M45 70Q50 74.5 55 70" },
  },
  trabalhando: {
    olhos: "abertos",
    olhoY: 59.5,
    olhoRx: 3.4,
    olhoRy: 2.3,
    sobrancelha: "M38 52.5l7 1M55 53.5l7-1",
    boca: { tipo: "traco", d: "M46 71.5H54" },
  },
  esperando: {
    olhos: "abertos",
    olhoY: 58,
    olhoRx: 3.8,
    olhoRy: 4.9,
    sobrancelha: "M38 48.5l7-1.5M55 47l7 1.5",
    boca: { tipo: "o" },
  },
  erro: {
    olhos: "abertos",
    olhoY: 58.5,
    olhoRx: 3.2,
    olhoRy: 3.8,
    sobrancelha: "M38 50l7 2.5M55 52.5l7-2.5",
    boca: { tipo: "traco", d: "M45 73Q50 68.5 55 73" },
  },
  dormindo: {
    olhos: "fechados",
    olhoY: 58,
    olhoRx: 3,
    olhoRy: 4,
    boca: { tipo: "traco", d: "M47.5 71.5H52.5" },
    zz: true,
  },
};

const ESTADO_PADRAO: EstadoPersonagem = "ocioso";

function alturaEmPx(tamanho: TamanhoPersonagem | number | undefined, modo: ModoPersonagem): number {
  const bruto =
    typeof tamanho === "string"
      ? (TAMANHO_PERSONAGEM[tamanho] ?? TAMANHO_PERSONAGEM.dock)
      : (tamanho ?? (modo === "cabeca" ? TAMANHO_PERSONAGEM.dock : TAMANHO_PERSONAGEM.cartao));
  if (!Number.isFinite(bruto)) return TAMANHO_PERSONAGEM.dock;
  return Math.min(TAMANHO_PERSONAGEM_MAX, Math.max(TAMANHO_PERSONAGEM_MIN, Math.round(bruto)));
}

/** Borda direita do recorte da cabeça (`16 + 68` no viewBox). */
const DIREITA_DA_CABECA = 84;

/**
 * O nó da bandana da Faina vai até x 86 e o recorte da cabeça corta em 84: cortado, o nó vira um
 * zigue-zague no canto, que no dock se lê como o "z" de quem dorme. Na cabeça ele encolhe na
 * largura a partir de onde sai da bandana (x 76) e cabe inteiro; no corpo inteiro fica como no
 * canvas.
 */
const NO_NA_CABECA = `translate(76 0) scale(${(DIREITA_DA_CABECA - 1 - 76) / 10} 1) translate(-76 0)`;

/** O traço próprio de cada um, que diz quem é mesmo a 16 px. */
function Traco({ agente, modo }: { agente: Agente; modo: ModoPersonagem }) {
  switch (agente) {
    case "alba":
      return (
        <path
          data-traco="raios"
          className="personagem-tinta-acessorio"
          d="M50 20V11M36 24l-5-7M64 24l5-7"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
      );
    case "tula":
      return <circle data-traco="coque" className="personagem-cor-acessorio" cx="50" cy="28" r="9" />;
    case "faina":
      return (
        <g data-traco="bandana" className="personagem-cor-acessorio">
          <rect x="24" y="40" width="52" height="9" />
          <path
            data-no=""
            d="M76 43l10-6-2 9zM76 46l9 6-8 2z"
            transform={modo === "cabeca" ? NO_NA_CABECA : undefined}
          />
        </g>
      );
    case "nuno":
      return (
        <g data-traco="fones">
          <path
            className="personagem-tinta-acessorio"
            d="M25 56A25 25 0 0 1 75 56"
            strokeWidth="4"
            fill="none"
            strokeLinecap="round"
          />
          <rect className="personagem-cor-acessorio" x="20" y="49" width="9" height="17" rx="4" />
          <rect className="personagem-cor-acessorio" x="71" y="49" width="9" height="17" rx="4" />
        </g>
      );
  }
}

/** Silhueta: ovo, pera, bloco ou cápsula. */
function Corpo({ agente }: { agente: Agente }) {
  switch (agente) {
    case "alba":
      return <ellipse className="personagem-cor-corpo" cx="50" cy="66" rx="30" ry="40" />;
    case "tula":
      return (
        <path
          className="personagem-cor-corpo"
          d="M50 30C70 30 80 52 80 78C80 96 68 104 50 104C32 104 20 96 20 78C20 52 30 30 50 30Z"
        />
      );
    case "faina":
      return <rect className="personagem-cor-corpo" x="22" y="32" width="56" height="72" rx="20" />;
    case "nuno":
      return <rect className="personagem-cor-corpo" x="28" y="22" width="44" height="84" rx="22" />;
  }
}

function Rosto({ agente, e }: { agente: Agente; e: Expressao }) {
  return (
    <g transform={`translate(0,${FORMA[agente].dy})`}>
      <ellipse className="personagem-cor-bochecha" cx="37" cy="67" rx="3.4" ry="2.2" />
      <ellipse className="personagem-cor-bochecha" cx="63" cy="67" rx="3.4" ry="2.2" />
      {e.olhos === "abertos" ? (
        <>
          <ellipse
            className="personagem-olho personagem-cor-rosto"
            cx="42"
            cy={e.olhoY}
            rx={e.olhoRx}
            ry={e.olhoRy}
          />
          <ellipse
            className="personagem-olho personagem-cor-rosto"
            cx="58"
            cy={e.olhoY}
            rx={e.olhoRx}
            ry={e.olhoRy}
          />
        </>
      ) : (
        <path
          data-olhos="fechados"
          className="personagem-tinta-rosto"
          d="M38.5 58Q42 61.5 45.5 58M54.5 58Q58 61.5 61.5 58"
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        />
      )}
      {e.sobrancelha && (
        <path
          className="personagem-tinta-rosto"
          d={e.sobrancelha}
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />
      )}
      {agente === "tula" && (
        <g data-traco="oculos" className="personagem-tinta-rosto" strokeWidth="1.8" fill="none">
          <circle cx="42" cy="58" r="7.5" />
          <circle cx="58" cy="58" r="7.5" />
          <path d="M49.5 58h1" />
        </g>
      )}
      {e.boca.tipo === "traco" ? (
        <path
          className="personagem-tinta-rosto"
          d={e.boca.d}
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        />
      ) : (
        <ellipse className="personagem-cor-rosto" cx="50" cy="71.5" rx="2.6" ry="3.2" />
      )}
    </g>
  );
}

/**
 * Um dos quatro agentes, em SVG, com a expressão do estado. Agente ou estado fora da lista
 * (dado vindo do serviço, por exemplo) não quebra a tela: cai na Alba e em "ocioso", como o
 * canvas faz.
 */
export function Personagem({
  agente: agentePedido,
  modo: modoPedido = "cabeca",
  tamanho,
  estado: estadoPedido = ESTADO_PADRAO,
  rotulo,
  moldura = false,
}: PersonagemProps) {
  const agente: Agente = eAgente(agentePedido) ? agentePedido : "alba";
  const estado: EstadoPersonagem = eEstadoPersonagem(estadoPedido) ? estadoPedido : ESTADO_PADRAO;
  const modo: ModoPersonagem = modoPedido === "inteiro" ? "inteiro" : "cabeca";
  const forma = FORMA[agente];
  const e = EXPRESSAO[estado];

  const altura = alturaEmPx(tamanho, modo);
  const largura = modo === "cabeca" ? altura : Math.round((altura * 100) / 120);
  const caixa = modo === "cabeca" ? `16 ${forma.topo} 68 68` : "0 0 100 120";
  // Tamanho vem da prop (já preso à faixa dos tokens); o CSS lê as variáveis.
  const medidas = {
    "--personagem-largura": `${largura}px`,
    "--personagem-altura": `${altura}px`,
  } as CSSProperties;

  const desenho = (
    <svg
      className="personagem"
      data-agente={agente}
      data-estado={estado}
      data-modo={modo}
      style={medidas}
      viewBox={caixa}
      role="img"
      aria-label={rotulo ?? `${DADOS_AGENTES[agente].nome}, ${ROTULO_ESTADO[estado]}`}
    >
      <g className="personagem-corpo">
        <ellipse className="personagem-cor-acessorio" cx="40" cy="108" rx="9" ry="5" />
        <ellipse className="personagem-cor-acessorio" cx="60" cy="108" rx="9" ry="5" />
        <ellipse className="personagem-cor-sombra" cx={forma.bracoE} cy="78" rx="6" ry="10" />
        <ellipse className="personagem-cor-sombra" cx={forma.bracoD} cy="78" rx="6" ry="10" />
        {/* O coque da Tula fica atrás da cabeça; os outros traços vão por cima do corpo. */}
        {agente === "tula" && <Traco agente={agente} modo={modo} />}
        <Corpo agente={agente} />
        {agente !== "tula" && <Traco agente={agente} modo={modo} />}
        <Rosto agente={agente} e={e} />
      </g>
      {e.zz && (
        <path
          data-zz=""
          className="personagem-tinta-sombra"
          d="M76 20h7l-7 8h7M86 10h5l-5 6h5"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
    </svg>
  );

  if (!moldura) return desenho;
  const tom = moldura === true ? MOLDURA_DA_EXPRESSAO[estado] : moldura;
  return (
    <span className="personagem-moldura" data-estado={estado} data-tom={tom}>
      {desenho}
    </span>
  );
}
