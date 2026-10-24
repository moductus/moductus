import type { EstadoPrimeiroUso } from "@moductus/contrato";
import { listen } from "@tauri-apps/api/event";
import { startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AREA_INICIAL, areaDoAtalho, escreverDestino, lerDestino, type Destino } from "../../areas/areas.ts";
import { useConfig } from "../../areas/configuracoes/useConfig.ts";
import { PrimeirosPassos, useMostrarPrimeirosPassos } from "../../areas/inicio/PrimeirosPassos.tsx";
import { registrar } from "../../nativo/eventos.ts";
import { servico } from "../../servico/conexao.ts";
import { CamadaTour } from "../tour/CamadaTour.tsx";
import { EVENTO_REVER_TUTORIAL, EVENTO_VER_TOUR, useTour, type Tour } from "../tour/tour.ts";
import { BarraLateral } from "./BarraLateral.tsx";
import { BarraTitulo } from "./BarraTitulo.tsx";
import { AcoesSistemaContexto, useAcoesSistema, usePrimeiroUso } from "./primeiro-uso/estado.ts";
import { sobDemanda } from "./sobDemanda.tsx";
import "./Sistema.css";

// Cada área (e a configuração inicial) vem num chunk à parte, na primeira vez que abre.
const Inicio = sobDemanda(() => import("../../areas/inicio/Inicio.tsx").then((m) => m.Inicio));
const Agentes = sobDemanda(() => import("../../areas/agentes/Agentes.tsx").then((m) => m.Agentes));
const Sessoes = sobDemanda(() => import("../../areas/sessoes/Sessoes.tsx").then((m) => m.Sessoes));
const Tarefas = sobDemanda(() => import("../../areas/tarefas/Tarefas.tsx").then((m) => m.Tarefas));
const Foco = sobDemanda(() => import("../../areas/foco/Foco.tsx").then((m) => m.Foco));
const Financas = sobDemanda(() => import("../../areas/financas/Financas.tsx").then((m) => m.Financas));
const Dev = sobDemanda(() => import("../../areas/dev/Dev.tsx").then((m) => m.Dev));
const Notas = sobDemanda(() => import("../../areas/notas/Notas.tsx").then((m) => m.Notas));
const Arquivos = sobDemanda(() => import("../../areas/arquivos/Arquivos.tsx").then((m) => m.Arquivos));
const Memoria = sobDemanda(() => import("../../areas/memoria/Memoria.tsx").then((m) => m.Memoria));
const Ferramentas = sobDemanda(() =>
  import("../../areas/ferramentas/Ferramentas.tsx").then((m) => m.Ferramentas),
);
const Configuracoes = sobDemanda(() =>
  import("../../areas/configuracoes/Configuracoes.tsx").then((m) => m.Configuracoes),
);
const PrimeiroUso = sobDemanda(() => import("./primeiro-uso/PrimeiroUso.tsx").then((m) => m.PrimeiroUso));

const TELAS = [
  Inicio,
  Agentes,
  Sessoes,
  Tarefas,
  Foco,
  Financas,
  Dev,
  Notas,
  Arquivos,
  Memoria,
  Ferramentas,
  Configuracoes,
  PrimeiroUso,
];

/** Baixa todas as áreas de uma vez: o teste troca de área e lê a tela no mesmo quadro. */
export function carregarAreas(): Promise<unknown> {
  return Promise.all(TELAS.map((t) => t.carregar()));
}

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

/** A lateral é o que a parada 3 do tour aponta (TutorialTour.dc.html). */
const medirLateral = () => document.querySelector(".barra-lateral")?.getBoundingClientRect() ?? null;

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
  const tour = useTour();
  const emTour = tour.parada !== null;

  // Em transição: a área que ainda não veio deixa a atual na tela até chegar, sem piscar vazio.
  const ir = useCallback((novo: Destino) => {
    startTransition(() => setDestino(novo));
    guardar(novo);
  }, []);

  const acoes = useMemo(() => ({ ir, aoMudarPrimeiroUso: setPrimeiroUso }), [ir, setPrimeiroUso]);

  // Atalhos locais da janela: Ctrl+1…9 trocam de área, Ctrl+K foca a busca.
  useEffect(() => {
    if (configurando || emTour) return;
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
  }, [ir, configurando, emTour]);

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

  // A Ajuda da bandeja: o tour de novo, ou os Primeiros passos de volta no Início. Durante a
  // configuração inicial o tour não vem: ele começa sozinho quando ela termina.
  const { ir: andar, navegando } = tour;
  useEffect(() => {
    const paradas = [
      listen(EVENTO_VER_TOUR, () => {
        if (configurando) registrar(`${EVENTO_VER_TOUR} ignorado na configuração`);
        else andar(1);
      }),
      listen(EVENTO_REVER_TUTORIAL, () => {
        ir({ area: "inicio" });
        servico
          .pedir("primeiroUso.marcar", { alvo: "tutorial", estado: "pendente" })
          .then(setPrimeiroUso)
          .catch(() => registrar(`${EVENTO_REVER_TUTORIAL} sem serviço`));
      }),
    ].map((p) => p.catch(() => () => undefined));
    return () => paradas.forEach((p) => void p.then((f) => f()));
  }, [andar, ir, setPrimeiroUso, configurando]);

  // Na parada 3 a bolha é do Sistema: se ele some (o atalho ou a bandeja o escondem), o tour acaba
  // ali, para o resto não ficar escurecido sem bolha.
  const naParada = tour.parada === 3;
  useEffect(() => {
    if (!naParada) return;
    const aoMudar = () => {
      if (document.visibilityState === "hidden" && !navegando.current) andar(null);
    };
    document.addEventListener("visibilitychange", aoMudar);
    return () => document.removeEventListener("visibilitychange", aoMudar);
  }, [naParada, andar, navegando]);

  return (
    <AcoesSistemaContexto.Provider value={acoes}>
      {/* Durante o tour, a janela fica escurecida e fora do teclado; só a camada responde. */}
      <div className="sistema" inert={emTour || undefined}>
        <BarraTitulo />
        <Suspense fallback={null}>
          {configurando ? (
            <PrimeiroUso
              aoConcluir={(estado, depois) => {
                startTransition(() => setPrimeiroUso(estado));
                ir(depois);
                // O tour começa logo depois da configuração; quem vai importar de outro PC segue lá.
                if (depois.area === "inicio") andar(1);
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
        </Suspense>
      </div>
      {emTour && <TourNoSistema tour={tour} />}
    </AcoesSistemaContexto.Provider>
  );
}

/** A parte do tour no Sistema: véu nas paradas das outras janelas; na 3, o anel na lateral. */
function TourNoSistema({ tour }: { tour: Tour }) {
  const { estado } = useConfig();
  return (
    <CamadaTour
      parada={tour.parada}
      ir={tour.ir}
      minha={3}
      medir={medirLateral}
      lado="direita"
      atalho={estado?.config.atalhos.sistema}
    />
  );
}

interface PropsConteudoArea {
  destino: Destino;
  ir: (d: Destino) => void;
  primeiroUso: EstadoPrimeiroUso | null;
}

function ConteudoArea({ destino, ir, primeiroUso }: PropsConteudoArea) {
  const { aoMudarPrimeiroUso } = useAcoesSistema();
  const mostrarPassos = useMostrarPrimeirosPassos(primeiroUso);
  switch (destino.area) {
    case "inicio":
      return (
        <Inicio
          antes={
            mostrarPassos && primeiroUso ? (
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
      return <Notas secao={destino.secao} ir={ir} />;
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
