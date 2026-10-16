import type { EstadoPrimeiroUso } from "@moductus/contrato";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Agentes } from "../../areas/agentes/Agentes.tsx";
import { AREA_INICIAL, areaDoAtalho, escreverDestino, lerDestino, type Destino } from "../../areas/areas.ts";
import { Arquivos } from "../../areas/arquivos/Arquivos.tsx";
import { Configuracoes } from "../../areas/configuracoes/Configuracoes.tsx";
import { Dev } from "../../areas/dev/Dev.tsx";
import { Ferramentas } from "../../areas/ferramentas/Ferramentas.tsx";
import { Financas } from "../../areas/financas/Financas.tsx";
import { Foco } from "../../areas/foco/Foco.tsx";
import { Inicio } from "../../areas/inicio/Inicio.tsx";
import { PrimeirosPassos } from "../../areas/inicio/PrimeirosPassos.tsx";
import { Memoria } from "../../areas/memoria/Memoria.tsx";
import { Notas } from "../../areas/notas/Notas.tsx";
import { Sessoes } from "../../areas/sessoes/Sessoes.tsx";
import { Tarefas } from "../../areas/tarefas/Tarefas.tsx";
import { registrar } from "../../nativo/eventos.ts";
import { BarraLateral } from "./BarraLateral.tsx";
import { BarraTitulo } from "./BarraTitulo.tsx";
import { AcoesSistemaContexto, useAcoesSistema, usePrimeiroUso } from "./primeiro-uso/estado.ts";
import { PrimeiroUso } from "./primeiro-uso/PrimeiroUso.tsx";
import "./Sistema.css";

/** Evento que o dock (ou a casca) manda para abrir uma área: "dev", "configuracoes/modelos". */
export const EVENTO_IR = "sistema:ir";
export const CHAVE_DESTINO = "moductus.sistema.destino";

/** Última área aberta. O armazenamento pode faltar (modo privado, perfil novo): vale o Início. */
function lembrar(): Destino {
  try {
    return lerDestino(localStorage.getItem(CHAVE_DESTINO)) ?? { area: AREA_INICIAL };
  } catch {
    return { area: AREA_INICIAL };
  }
}

function guardar(destino: Destino): void {
  try {
    localStorage.setItem(CHAVE_DESTINO, escreverDestino(destino));
  } catch {
    // Sem armazenamento, o Sistema só não lembra a área na próxima vez.
  }
}

/** Número do Ctrl+1…9, pela tecla física (vale em qualquer layout) ou pelo caractere. */
function numeroDoAtalho(e: KeyboardEvent): number | null {
  if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return null;
  const tecla = /^Digit([1-9])$/.exec(e.code)?.[1] ?? /^[1-9]$/.exec(e.key)?.[0];
  return tecla ? Number(tecla) : null;
}

export function Sistema() {
  const [destino, setDestino] = useState<Destino>(lembrar);
  const busca = useRef<HTMLInputElement>(null);
  const [primeiroUso, setPrimeiroUso] = usePrimeiroUso();
  // Banco novo: a configuração inicial ocupa a janela até ser concluída ou pulada.
  const configurando = primeiroUso !== null && !primeiroUso.concluido;

  const ir = useCallback((novo: Destino) => {
    setDestino(novo);
    guardar(novo);
  }, []);

  const acoes = useMemo(() => ({ ir, aoMudarPrimeiroUso: setPrimeiroUso }), [ir, setPrimeiroUso]);

  // Atalhos locais da janela: Ctrl+1…9 trocam de área, Ctrl+K foca a busca.
  useEffect(() => {
    if (configurando) return;
    const aoTeclar = (e: KeyboardEvent) => {
      const numero = numeroDoAtalho(e);
      const area = numero === null ? null : areaDoAtalho(numero);
      if (area) {
        e.preventDefault();
        ir({ area });
        return;
      }
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        busca.current?.focus();
        busca.current?.select();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [ir, configurando]);

  // O dock pede uma área pelo evento; destino que não existe é ignorado e fica no log.
  useEffect(() => {
    const parar = listen<string>(EVENTO_IR, (e) => {
      const pedido = lerDestino(e.payload);
      registrar(`${EVENTO_IR} ${String(e.payload)}${pedido ? "" : " ignorado"}`);
      if (pedido) ir(pedido);
    }).catch(() => () => undefined);
    return () => {
      void parar.then((f) => f());
    };
  }, [ir]);

  return (
    <AcoesSistemaContexto.Provider value={acoes}>
      <div className="sistema">
        <BarraTitulo />
        {configurando ? (
          <PrimeiroUso
            aoConcluir={(estado, depois) => {
              setPrimeiroUso(estado);
              ir(depois);
            }}
          />
        ) : (
          <div className="sistema-corpo">
            <BarraLateral ativa={destino.area} aoEscolher={(area) => ir({ area })} refBusca={busca} />
            <main className="sistema-conteudo" key={destino.area} data-area={destino.area}>
              <ConteudoArea destino={destino} ir={ir} primeiroUso={primeiroUso} />
            </main>
          </div>
        )}
      </div>
    </AcoesSistemaContexto.Provider>
  );
}

interface PropsConteudoArea {
  destino: Destino;
  ir: (d: Destino) => void;
  primeiroUso: EstadoPrimeiroUso | null;
}

function ConteudoArea({ destino, ir, primeiroUso }: PropsConteudoArea) {
  const { aoMudarPrimeiroUso } = useAcoesSistema();
  switch (destino.area) {
    case "inicio":
      return (
        <Inicio
          antes={
            primeiroUso?.concluido && primeiroUso.tutorial === "pendente" ? (
              <PrimeirosPassos estado={primeiroUso} aoMudar={aoMudarPrimeiroUso} />
            ) : null
          }
        />
      );
    case "agentes":
      return <Agentes secao={destino.secao} ir={ir} />;
    case "sessoes":
      return <Sessoes />;
    case "tarefas":
      return <Tarefas />;
    case "foco":
      return <Foco />;
    case "financas":
      return <Financas />;
    case "dev":
      return <Dev />;
    case "notas":
      return <Notas />;
    case "arquivos":
      return <Arquivos />;
    case "memoria":
      return <Memoria />;
    case "ferramentas":
      return <Ferramentas />;
    case "configuracoes":
      return (
        <Configuracoes
          secao={destino.secao}
          aoEscolherSecao={(secao) => ir({ area: "configuracoes", secao })}
        />
      );
  }
}
