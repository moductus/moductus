import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icone } from "../../componentes/Icone.tsx";
import { Marca } from "../../componentes/Marca.tsx";
import { AGENTES, DADOS_AGENTES } from "../../componentes/personagem/agentes.ts";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { CONVITE_MODELO, lerSituacao } from "../../componentes/personagem/situacao.ts";
import { Contagem } from "../../componentes/Selo.tsx";
import {
  useAwake,
  useConfiguracaoDock,
  useMic,
  useMidia,
  useServico,
  useTelaCheia,
} from "../../nativo/eventos.ts";
import { useDadosDev } from "../../areas/dev/dev.ts";
import { useCanal } from "../../servico/conexao.ts";
import { marcarVistasDe, usePontosTime } from "../../servico/notificacoes.ts";
import { useTime } from "../../servico/time.ts";
import { AREAS_DOCK, DADOS_AREAS, type AreaDock } from "../areas.ts";
import { sessoesEsperando } from "../painel/agentes.ts";
import { usePendentesDoTerminal } from "../painel/dados.ts";
import { pontoDoAgente, rotuloDoAgente } from "./agentes.ts";
import { proximoIndice } from "./navegacao.ts";
import { useRelogio } from "./relogio.ts";
import "./Dock.css";

/** Convite das cabeças do time enquanto nenhum modelo está conectado. */
export const CONVITE_AGENTES = CONVITE_MODELO;

/** Área aberta no painel lateral, para marcar o botão; `null` com o painel fechado. */
function useAreaAberta(): string | null {
  const [area, setArea] = useState<string | null>(null);
  useEffect(() => {
    const paradas = [
      listen<string>("painel:area", (e) => setArea(e.payload)),
      listen("painel:fechado", () => setArea(null)),
    ];
    return () => paradas.forEach((p) => void p.then((f) => f()));
  }, []);
  return area;
}

/**
 * O dock, de cima para baixo (Dock.dc.html): marca, áreas, o time, mídia, Mic, Awake e
 * relógio. A janela não ativa ao clicar; o Ctrl+Alt+D dá o foco a ele (modo teclado), e aí
 * setas, Tab, Home e End andam pelos botões e Esc devolve o foco a quem estava antes.
 */
export function Dock() {
  const telaCheia = useTelaCheia();
  const midia = useMidia();
  const mic = useMic();
  const awake = useAwake();
  const servico = useServico();
  const canal = useCanal(servico);
  const { situacoes: time, modelos } = useTime(canal);
  const pontos = usePontosTime(canal);
  // As sessões do terminal esperando você são do Nuno, que fica de olho nelas (Dock.dc.html).
  const esperandoNoTerminal = sessoesEsperando(usePendentesDoTerminal(canal) ?? []);
  const github = useDadosDev(canal);
  // O badge do Dev conta o que precisa de você no GitHub; sem conexão, nada.
  const contagens: Partial<Record<AreaDock, number>> = {
    dev:
      github.estado === "pronta"
        ? github.dados.situacao.itens.filter((i) => i.estado === "aberto" && i.precisaDeMim).length
        : 0,
  };
  const config = useConfiguracaoDock();
  const aberta = useAreaAberta();
  const hora = useRelogio();
  const nav = useRef<HTMLElement>(null);

  // A casca avisa que o dock ganhou o foco pelo atalho: o teclado começa na primeira área.
  useEffect(() => {
    const parar = listen<boolean>("dock:teclado", (e) => {
      if (e.payload) nav.current?.querySelector<HTMLElement>("[data-area]")?.focus();
    });
    // Clicar fora tira o foco do dock: a casca devolve o "sem ativar".
    const aoSair = () => void invoke("dock_soltar_foco", { devolver: false }).catch(() => undefined);
    window.addEventListener("blur", aoSair);
    return () => {
      void parar.then((f) => f());
      window.removeEventListener("blur", aoSair);
    };
  }, []);

  const aoTeclar = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      void invoke("dock_soltar_foco", { devolver: true }).catch(() => undefined);
      return;
    }
    const botoes = Array.from(
      nav.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
    const atual = botoes.indexOf(document.activeElement as HTMLButtonElement);
    const proximo = proximoIndice(e.key, e.shiftKey, atual, botoes.length);
    if (proximo === null) return;
    e.preventDefault();
    botoes[proximo]?.focus();
  };

  const aviso =
    servico.estado !== "pronto" ? `Serviço ${servico.estado}` : canal !== "conectado" ? `Canal ${canal}` : "";

  return (
    <nav
      ref={nav}
      aria-label="Dock"
      className="dock"
      data-forma={config.forma}
      data-lado={config.lado}
      data-tela-cheia={telaCheia}
      onKeyDown={aoTeclar}
    >
      <button
        type="button"
        className="dock-marca"
        aria-label="Abrir o Sistema"
        title="Abrir o Sistema (Ctrl+Alt+N)"
        onClick={() => void invoke("sistema_alternar")}
      >
        <Marca tamanho={26} />
      </button>

      {AREAS_DOCK.map((id) => {
        const area = DADOS_AREAS[id];
        return (
          <button
            key={id}
            type="button"
            className="dock-botao"
            data-area={id}
            data-ativo={aberta === id || undefined}
            aria-label={area.nome}
            aria-expanded={aberta === id}
            title={area.nome}
            onClick={() => void invoke("painel_abrir", { area: id })}
          >
            <Icone nome={area.icone} tamanho={20} />
            {/* Área sem número ao vivo ainda conta zero, e zero não desenha o badge. */}
            {area.contagem && <Contagem valor={contagens[id] ?? 0} rotulo={area.contagem} />}
          </button>
        );
      })}

      <div className="dock-divisor" role="separator" />

      <div
        className="dock-agentes"
        role="group"
        aria-label="Time"
        data-ativo={aberta === "agentes" || undefined}
      >
        {AGENTES.map((agente) => {
          // A cabeça segue o runtime: expressão, anel no tom do status e o status no rótulo. O
          // relógio do dock acorda na virada do minuto, e a hora da dica anda com ele.
          const leitura = lerSituacao(time[agente], new Date(), modelos[agente] ?? null);
          const { expressao, moldura } = leitura;
          const avisos = pontos[agente] ?? 0;
          const esperando = agente === "nuno" ? esperandoNoTerminal : 0;
          const rotulo = rotuloDoAgente(DADOS_AGENTES[agente].nome, leitura, avisos, esperando);
          const ponto = pontoDoAgente(leitura, avisos, esperando);
          return (
            <button
              key={agente}
              type="button"
              className="dock-agente"
              data-agente={agente}
              aria-label={rotulo}
              aria-expanded={aberta === "agentes"}
              title={rotulo}
              onClick={() => {
                if (avisos > 0) marcarVistasDe(agente);
                void invoke("painel_abrir", { area: "agentes" });
              }}
            >
              <Personagem agente={agente} modo="cabeca" tamanho="dock" estado={expressao} moldura={moldura} />
              {/* Ponto no canto (Dock.dc.html, Estados.dc.html): algo para você, teto ou erro. */}
              {ponto && (
                <span className="dock-agente-ponto" data-ponto="" data-tom={ponto} aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>

      <div className="dock-divisor" role="separator" />

      <div className="dock-espaco" />

      {midia && (
        <button
          type="button"
          className="dock-botao dock-midia"
          data-midia=""
          aria-label={midia.tocando ? `Pausar ${midia.titulo}` : `Tocar ${midia.titulo}`}
          title={midia.artista ? `${midia.titulo} · ${midia.artista}` : midia.titulo}
          onClick={() => void invoke("midia_alternar")}
        >
          <span className="dock-capa">
            {midia.capa && <img className="dock-capa-imagem" src={midia.capa} alt="" />}
            <Icone nome={midia.tocando ? "pausar" : "tocar"} tamanho={12} />
          </span>
        </button>
      )}
      <button
        type="button"
        className="dock-botao dock-controle"
        aria-label="Microfone mudo"
        aria-pressed={mic === true}
        title={mic === null ? "Nenhum microfone" : mic ? "Microfone mudo" : "Microfone aberto"}
        disabled={mic === null}
        onClick={() => void invoke("mic_alternar")}
      >
        <Icone nome={mic ? "mic-mudo" : "mic"} tamanho={18} />
      </button>
      <button
        type="button"
        className="dock-botao dock-controle"
        aria-label="Manter acordado"
        aria-pressed={awake}
        title={awake ? "Manter acordado: ligado" : "Manter acordado: desligado"}
        onClick={() => void invoke("awake_definir", { ligar: !awake })}
      >
        <Icone nome="awake" tamanho={18} />
      </button>

      <time className="dock-relogio" aria-label={`Agora são ${hora}`}>
        {hora}
      </time>
      <p role="status" className="dock-estado" title={aviso || undefined}>
        {aviso && (
          <>
            <span className="dock-estado-ponto" aria-hidden="true" />
            <span className="so-leitor">{aviso}</span>
          </>
        )}
      </p>
    </nav>
  );
}
