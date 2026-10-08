import type { ReactElement } from "react";
import "./Icone.css";

/*
 * Os 24 desenhos canônicos de traço 1,6 em caixa 24 (DESIGN.md, ícones). "hoje" e "inicio" são
 * o mesmo desenho com dois nomes, porque a área Hoje é o início do Sistema.
 */
const CASA = <path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />;

const DESENHOS = {
  hoje: CASA,
  inicio: CASA,
  tarefas: <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />,
  foco: <path d="M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />,
  financas: (
    <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
  ),
  dev: (
    <path d="M6 9v12M18 15V9a3 3 0 0 0-3-3h-4M14 3l-3 3 3 3M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
  ),
  notas: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8" />,
  arquivos: (
    <path d="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  ),
  agentes: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  sessoes: <path d="M4 17l6-6-6-6M12 19h8" />,
  memoria: <path d="M12 3a9 9 0 1 0 9 9M12 7v5l3 3M21 3v6h-6" />,
  ferramentas: (
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />
  ),
  configuracoes: (
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4" />
  ),
  busca: <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5" />,
  mic: <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />,
  "mic-mudo": (
    <path d="M2 2l20 20M12 19v3M19 10v2a7 7 0 0 1-1.3 4M5 10v2a7 7 0 0 0 9.7 6.5M9 9V5a3 3 0 0 1 5.12-2.12M15 9.34V12a3 3 0 0 1-.45 1.57" />
  ),
  awake: (
    <path d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
  ),
  "awake-desligado": <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  // Mídia é cheia, sem traço: em tamanho pequeno o contorno some.
  tocar: <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" />,
  pausar: (
    <>
      <rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none" />
      <rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none" />
    </>
  ),
  anterior: <path d="M6 5h2v14H6zM20 5v14L9 12z" fill="currentColor" stroke="none" />,
  proxima: <path d="M16 5h2v14h-2zM4 5v14l11-7z" fill="currentColor" stroke="none" />,
  minimizar: <path d="M4 12h16" />,
  maximizar: <path d="M5 5h14v14H5z" />,
  fechar: <path d="M6 6l12 12M18 6L6 18" />,
} satisfies Record<string, ReactElement>;

export type NomeIcone = keyof typeof DESENHOS;
export const NOMES_ICONES = Object.keys(DESENHOS) as NomeIcone[];

/** Tamanhos de uso; cada um é um token `--icone-N`. */
export type TamanhoIcone = 12 | 14 | 16 | 18 | 20 | 24;

export function ehNomeIcone(nome: string): nome is NomeIcone {
  return Object.hasOwn(DESENHOS, nome);
}

interface PropsIcone {
  nome: NomeIcone;
  tamanho?: TamanhoIcone;
  /** Sem rótulo o ícone é decorativo (aria-hidden): o texto ao lado já diz o que é. */
  rotulo?: string;
  className?: string;
}

/** Ícone de traço em currentColor. Nome desconhecido (vindo de dado, não do código) não desenha nada. */
export function Icone({ nome, tamanho = 16, rotulo, className }: PropsIcone) {
  if (!ehNomeIcone(nome)) return null;
  const classes = ["icone", `icone-${tamanho}`, nome === "busca" && "icone-busca", className]
    .filter(Boolean)
    .join(" ");
  return (
    <svg
      className={classes}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(rotulo ? { role: "img", "aria-label": rotulo } : { "aria-hidden": true })}
    >
      {DESENHOS[nome]}
    </svg>
  );
}
