import { eAgente, type Agente } from "../../componentes/personagem/agentes.ts";
import { useServico } from "../../nativo/eventos.ts";
import { useCanal } from "../../servico/conexao.ts";
import type { Interlocutor } from "../../servico/conversas.ts";
import type { Destino } from "../areas.ts";
import { Conversas } from "./Conversas.tsx";
import { PaginaAgente } from "./PaginaAgente.tsx";
import "./Agentes.css";

/** Onde a área está: a conversa com alguém (ou com o time) ou a página de um agente. */
export type LugarAgentes = { tipo: "conversa"; com: Interlocutor } | { tipo: "pagina"; agente: Agente };

/**
 * A seção da área no destino do Sistema: vazia é a conversa do time, "tula" é a conversa com a
 * Tula e "tula/pagina" é a página dela. O que não se reconhece abre o time.
 */
export function lerLugar(secao: string | undefined): LugarAgentes {
  const [quem, oQue] = (secao ?? "").split("/");
  if (!eAgente(quem)) return { tipo: "conversa", com: null };
  return oQue === "pagina" ? { tipo: "pagina", agente: quem } : { tipo: "conversa", com: quem };
}

export function escreverLugar(lugar: LugarAgentes): string | undefined {
  if (lugar.tipo === "pagina") return `${lugar.agente}/pagina`;
  return lugar.com ?? undefined;
}

interface PropsAgentes {
  secao?: string;
  ir: (destino: Destino) => void;
}

/**
 * Sistema · Agentes: a conversa com o time e com cada um (Conversas.dc.html) e a página de cada
 * agente (AreaAgente.dc.html). Quem decide é o serviço; a área mostra e pede.
 */
export function Agentes({ secao, ir }: PropsAgentes) {
  const canal = useCanal(useServico({ silencioso: true }));
  const lugar = lerLugar(secao);
  const irPara = (novo: LugarAgentes) => {
    const secao = escreverLugar(novo);
    ir(secao ? { area: "agentes", secao } : { area: "agentes" });
  };

  if (lugar.tipo === "pagina") {
    return (
      <PaginaAgente
        key={lugar.agente}
        canal={canal}
        agente={lugar.agente}
        aoConversar={() => irPara({ tipo: "conversa", com: lugar.agente })}
        aoTrocarModelo={() => ir({ area: "configuracoes", secao: "modelos" })}
      />
    );
  }
  return (
    <Conversas
      canal={canal}
      com={lugar.com}
      aoEscolher={(com) => irPara({ tipo: "conversa", com })}
      aoAbrirPagina={(agente) => irPara({ tipo: "pagina", agente })}
      aoAbrirMemoria={() => ir({ area: "memoria" })}
    />
  );
}
