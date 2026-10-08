import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { Icone } from "../../componentes/Icone.tsx";
import { AGENTES } from "../../componentes/personagem/agentes.ts";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { useConfiguracaoDock } from "../../nativo/eventos.ts";
import { DADOS_AREAS, eAreaPainel, type AreaPainel } from "../areas.ts";
import "./Painel.css";

/** Abre o Sistema na seção de modelos e fecha o painel: o convite do time leva para lá. */
function abrirConfiguracoes() {
  void invoke("sistema_abrir", { area: "configuracoes/modelos" });
  void invoke("painel_fechar");
}

function Vazio({ area }: { area: AreaPainel }) {
  const { vazio, icone } = DADOS_AREAS[area];
  if (area === "agentes") {
    return (
      <div className="painel-vazio">
        <div className="painel-time" aria-label="O time, dormindo" role="group">
          {AGENTES.map((a) => (
            <Personagem key={a} agente={a} modo="cabeca" tamanho="painel" estado="dormindo" moldura />
          ))}
        </div>
        <h2 className="painel-vazio-titulo">{vazio.titulo}</h2>
        <p className="painel-vazio-texto">{vazio.texto}</p>
        <Botao variante="primario" onClick={abrirConfiguracoes}>
          Abrir Configurações
        </Botao>
      </div>
    );
  }
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

/** Painel lateral genérico: a casca diz qual área abrir; cada área mostra o próprio estado vazio. */
export function Painel() {
  // O contador muda a cada abertura, mesmo quando a área é a mesma.
  const [abertura, setAbertura] = useState<{ area: string; n: number } | null>(null);
  const { lado } = useConfiguracaoDock();
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
        <header className="painel-cabecalho">
          {dados && <Icone nome={dados.icone} tamanho={20} />}
          <h1 className="painel-titulo">{dados?.nome}</h1>
          <Botao
            variante="fantasma"
            tamanho="pequeno"
            icone="fechar"
            aria-label="Fechar painel"
            title="Fechar (Esc)"
            onClick={() => void invoke("painel_fechar")}
          />
        </header>
        {area && <Vazio area={area} />}
      </section>
    </main>
  );
}
