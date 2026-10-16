import type { ReactNode } from "react";
import { Icone, type NomeIcone } from "../componentes/Icone.tsx";
import { Selo } from "../componentes/Selo.tsx";
import { Personagem } from "../componentes/personagem/Personagem.tsx";
import type { Agente } from "../componentes/personagem/agentes.ts";
import "./areas.css";

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const MES = new Intl.DateTimeFormat("pt-BR", { month: "long" });

/** "Quinta, 8 de outubro", como no cabeçalho do canvas (sem o "-feira"). */
export function dataCurta(data: Date): string {
  return `${DIAS[data.getDay()]}, ${data.getDate()} de ${MES.format(data)}`;
}

interface PropsPagina {
  titulo: string;
  /** Linha acima do título no lugar da data: quem cuida da área ("Nuno · GitHub"). */
  rotulo?: string;
  /** Ação ou situação contextual à direita do título ("atualizado há 2 min"). */
  acao?: ReactNode;
  children: ReactNode;
}

/** Cabeçalho de página do Sistema (data curta, ou o rótulo da área, e título de 26) e o conteúdo. */
export function Pagina({ titulo, rotulo, acao, children }: PropsPagina) {
  return (
    <div className="pagina">
      <header className="pagina-cabecalho">
        <div className="pagina-titulos">
          <span className="pagina-data">{rotulo ?? dataCurta(new Date())}</span>
          <h1 className="pagina-titulo">{titulo}</h1>
        </div>
        {acao}
      </header>
      {children}
    </div>
  );
}

interface PropsEstadoVazio {
  titulo: string;
  texto: string;
  /** Quando a área passa a funcionar ("Fase 2"); área que já funciona não tem. */
  quando?: string;
  /** O que fazer para sair do vazio ("Abrir Conexões"), logo abaixo do texto (Estados.dc.html). */
  acoes?: ReactNode;
  /** Um agente aparece de corpo inteiro; vários, só as cabeças lado a lado. */
  agentes?: readonly Agente[];
  /** Área sem agente dono mostra o próprio ícone. */
  icone?: NomeIcone;
  /** Nível do título: 2 numa área, 3 dentro de uma seção que já tem o próprio h2. */
  nivel?: 2 | 3;
}

/**
 * Estado vazio: quem cuida da área (ou o ícone dela), o que vem e em que fase, ou como ligar. Nunca
 * tela em branco: toda área mostra pelo menos isto.
 */
export function EstadoVazio({
  titulo,
  texto,
  quando,
  acoes,
  agentes = [],
  icone,
  nivel = 2,
}: PropsEstadoVazio) {
  const [unico] = agentes;
  const Titulo = nivel === 2 ? "h2" : "h3";
  return (
    <section className="estado-vazio" aria-label={titulo}>
      {agentes.length === 1 && unico ? (
        <Personagem agente={unico} modo="inteiro" tamanho="vazio" estado="ocioso" />
      ) : agentes.length > 1 ? (
        <div className="estado-vazio-time">
          {agentes.map((a) => (
            <Personagem key={a} agente={a} tamanho="dock" estado="ocioso" />
          ))}
        </div>
      ) : (
        icone && (
          <span className="estado-vazio-icone">
            <Icone nome={icone} tamanho={24} />
          </span>
        )
      )}
      <Titulo className="estado-vazio-titulo">{titulo}</Titulo>
      <p className="estado-vazio-texto">{texto}</p>
      {quando && <Selo>{quando}</Selo>}
      {acoes && <div className="estado-vazio-acoes">{acoes}</div>}
    </section>
  );
}
