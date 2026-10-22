import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icone } from "../../componentes/Icone.tsx";
import { useConfiguracaoDock, useServico } from "../../nativo/eventos.ts";
import { useCanal } from "../../servico/conexao.ts";
import { DADOS_AREAS, eAreaPainel, type AreaPainel } from "../areas.ts";
import { CabecalhoPainel } from "./Cabecalho.tsx";
import { PainelAgentes } from "./PainelAgentes.tsx";
import { PainelDev } from "./PainelDev.tsx";
import { PainelHoje } from "./PainelHoje.tsx";
import { PainelNotas } from "./PainelNotas.tsx";
import { PainelFoco, type Recusas } from "./PainelFoco.tsx";
import { PainelTarefas } from "./PainelTarefas.tsx";
import { CamadaTour } from "../tour/CamadaTour.tsx";
import { AREA_TOUR, useTour } from "../tour/tour.ts";
import "./Painel.css";

/**
 * O que a parada 2 do tour aponta: o alto do cartão, do cabeçalho até o fim do primeiro bloco
 * (TutorialTour.dc.html). No Hoje, o primeiro bloco é o primeiro filho do corpo (o lembrete ou o
 * Foco); sem corpo (o estado vazio), é o filho do cartão logo depois do cabeçalho.
 */
function medirTopoDoCartao() {
  const cartao = document.querySelector(".painel-cartao");
  if (!cartao) return null;
  const caixa = cartao.getBoundingClientRect();
  const corpo = cartao.querySelector(":scope > .painel-corpo");
  const bloco = corpo ? corpo.firstElementChild : (cartao.children[1] ?? cartao.firstElementChild);
  const fim = bloco ? Math.max(caixa.top, bloco.getBoundingClientRect().bottom) : caixa.bottom;
  const folga = parseFloat(getComputedStyle(cartao).paddingTop) || 0;
  return { left: caixa.left, top: caixa.top, width: caixa.width, height: fim - caixa.top + folga };
}

/** O estado vazio das áreas que ainda não leem o serviço. */
function Vazio({ area }: { area: AreaPainel }) {
  const { vazio, icone } = DADOS_AREAS[area];
  return (
    <div className="painel-vazio">
      <span className="painel-vazio-icone">
        <Icone nome={icone} tamanho={24} />
      </span>
      <h2 className="painel-vazio-titulo">{vazio.titulo}</h2>
      <p className="painel-vazio-texto">{vazio.texto}</p>
    </div>
  );
}

/**
 * Painel lateral: a casca diz qual área abrir. Agentes, Dev, Hoje, Tarefas, Notas e Foco mostram
 * os dados do serviço (Agentes.dc.html, PainelDev.dc.html, Main.dc.html, PainelTarefas.dc.html,
 * PainelNotas.dc.html, PainelFoco.dc.html); as outras áreas mostram o próprio estado vazio.
 */
export function Painel() {
  // O contador muda a cada abertura, mesmo quando a área é a mesma.
  const [abertura, setAbertura] = useState<{ area: string; n: number } | null>(null);
  const { lado } = useConfiguracaoDock();
  const canal = useCanal(useServico({ silencioso: true }));
  const area = abertura && eAreaPainel(abertura.area) ? abertura.area : null;
  // O "Não" às sugestões do Foco vale enquanto a janela vive, mesmo trocando de área.
  const [recusados, setRecusados] = useState<ReadonlySet<string>>(() => new Set());
  const recusar = useCallback((chave: string) => setRecusados((atual) => new Set(atual).add(chave)), []);
  const recusas = useMemo<Recusas>(() => ({ recusados, recusar }), [recusados, recusar]);
  // As paradas 1 e 2 do tour são do painel: a 1 só com a bolha ao lado do dock, a 2 sobre o Hoje.
  const tour = useTour();
  const paradaDoPainel = tour.parada === 1 || tour.parada === 2 ? tour.parada : null;
  const soBolha = abertura?.area === AREA_TOUR;

  useEffect(() => {
    let n = 0;
    const parar = listen<string>("painel:area", (evento) => setAbertura({ area: evento.payload, n: ++n }));
    return () => {
      void parar.then((f) => f());
    };
  }, []);

  // Fecha a medição de abertura depois que o navegador pintou a área nova.
  useEffect(() => {
    if (!abertura) return;
    const { area } = abertura;
    requestAnimationFrame(() => requestAnimationFrame(() => void invoke("painel_pronto", { area })));
  }, [abertura]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") void invoke("painel_fechar");
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  const dados = area ? DADOS_AREAS[area] : null;
  return (
    <main className="painel" data-lado={lado} aria-label={`Painel ${dados?.nome ?? ""}`.trim()}>
      {tour.parada !== null && (
        <CamadaTour
          parada={tour.parada}
          ir={tour.ir}
          minha={paradaDoPainel}
          medir={paradaDoPainel === 2 ? medirTopoDoCartao : undefined}
          lado="abaixo"
        />
      )}
      {!soBolha && (
        <section className="painel-cartao" inert={tour.parada !== null || undefined}>
          {area === "agentes" ? (
            <PainelAgentes canal={canal} abertura={abertura?.n ?? 0} />
          ) : area === "dev" ? (
            <PainelDev canal={canal} />
          ) : area === "hoje" ? (
            <PainelHoje canal={canal} abertura={abertura?.n ?? 0} />
          ) : area === "tarefas" ? (
            <PainelTarefas canal={canal} abertura={abertura?.n ?? 0} />
          ) : area === "notas" ? (
            <PainelNotas canal={canal} />
          ) : area === "foco" ? (
            <PainelFoco canal={canal} abertura={abertura?.n ?? 0} recusas={recusas} />
          ) : (
            <>
              <CabecalhoPainel titulo={dados?.nome ?? ""} icone={dados?.icone} />
              {area && <Vazio area={area} />}
            </>
          )}
        </section>
      )}
    </main>
  );
}
