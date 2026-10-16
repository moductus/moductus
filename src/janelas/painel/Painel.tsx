import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { Icone } from "../../componentes/Icone.tsx";
import { useConfiguracaoDock, useServico } from "../../nativo/eventos.ts";
import { useCanal } from "../../servico/conexao.ts";
import { DADOS_AREAS, eAreaPainel, type AreaPainel } from "../areas.ts";
import { CabecalhoPainel } from "./Cabecalho.tsx";
import { PainelAgentes } from "./PainelAgentes.tsx";
import { PainelDev } from "./PainelDev.tsx";
import "./Painel.css";

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
 * Painel lateral: a casca diz qual área abrir. Agentes e Dev mostram os dados do serviço
 * (Agentes.dc.html, PainelDev.dc.html); as outras áreas mostram o próprio estado vazio.
 */
export function Painel() {
  // O contador muda a cada abertura, mesmo quando a área é a mesma.
  const [abertura, setAbertura] = useState<{ area: string; n: number } | null>(null);
  const { lado } = useConfiguracaoDock();
  const canal = useCanal(useServico({ silencioso: true }));
  const area = abertura && eAreaPainel(abertura.area) ? abertura.area : null;

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
      <section className="painel-cartao">
        {area === "agentes" ? (
          <PainelAgentes canal={canal} abertura={abertura?.n ?? 0} />
        ) : area === "dev" ? (
          <PainelDev canal={canal} />
        ) : (
          <>
            <CabecalhoPainel titulo={dados?.nome ?? ""} icone={dados?.icone} />
            {area && <Vazio area={area} />}
          </>
        )}
      </section>
    </main>
  );
}
