import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icone } from "../../componentes/Icone.tsx";
import { Marca } from "../../componentes/Marca.tsx";
import { AGENTES, DADOS_AGENTES } from "../../componentes/personagem/agentes.ts";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { formatarHora } from "../../componentes/personagem/quando.ts";
import { CONVITE_MODELO, lerSituacao } from "../../componentes/personagem/situacao.ts";
import { Contagem, textoDaContagem } from "../../componentes/Selo.tsx";
import {
  useAwake,
  useConfiguracaoDock,
  useMic,
  useMidia,
  useServico,
  useTelaCheia,
} from "../../nativo/eventos.ts";
import { useAgora } from "../../areas/tempo.ts";
import { useCanal } from "../../servico/conexao.ts";
import { ROTULOS_CONTAGEM, useContagens } from "../../servico/contagens.ts";
import { minutosDoDock, useEstadoFoco, useSegundosRestantes } from "../../servico/foco.ts";
import { marcarVistasDe, usePontosTime } from "../../servico/notificacoes.ts";
import { useTime } from "../../servico/time.ts";
import { AREAS_DOCK, DADOS_AREAS } from "../areas.ts";
import { useTour } from "../tour/tour.ts";
import { pontoDoAgente, rotuloDoAgente } from "./agentes.ts";
import { proximoIndice } from "./navegacao.ts";
import "./Dock.css";

/** Convite das cabeças do time enquanto nenhum modelo está conectado. */
export const CONVITE_AGENTES = CONVITE_MODELO;

/**
 * O tempo no ícone do Foco (Dock.dc.html): os minutos inteiros do relógio do painel, que a janela
 * conta sozinha e só acorda quando o número muda. Sem etapa, nada; o rótulo diz o mesmo em texto.
 */
function useTempoDoFoco(canal: ReturnType<typeof useCanal>) {
  const foco = useEstadoFoco(canal);
  const etapa = foco?.etapa ?? null;
  const segundos = useSegundosRestantes(etapa, 60);
  if (etapa === null || segundos === null) return null;
  const minutos = minutosDoDock(segundos);
  const pausada = etapa.pausadaEm !== null;
  const situacao = pausada ? "em pausa, " : etapa.tipo === "foco" ? "" : "na pausa, ";
  return { minutos, pausada, rotulo: `${situacao}${minutos} min restantes` };
}

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
  const { situacoes: time, modelos, gastos } = useTime(canal);
  const pontos = usePontosTime(canal);
  // Os badges e as sessões esperando vêm contados do serviço, os mesmos da barra lateral do Sistema.
  const contagens = useContagens(canal);
  const tempoDoFoco = useTempoDoFoco(canal);
  // As sessões do terminal esperando você são do Nuno, que fica de olho nelas (Dock.dc.html).
  const esperandoNoTerminal = contagens.sessoesEsperando;
  const config = useConfiguracaoDock();
  const aberta = useAreaAberta();
  // Um relógio só para o dock: a hora no rodapé e a hora das dicas viram juntas, no minuto.
  const agora = useAgora();
  const hora = formatarHora(agora);
  const nav = useRef<HTMLElement>(null);
  // No tour, o dock é a parada 1 (com o anel) e escurece nas outras; nada nele recebe clique.
  const { parada } = useTour();

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
      data-tour={parada === null ? undefined : parada === 1 ? "parada" : "veu"}
      inert={parada !== null || undefined}
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
        const valor = area.contagem ? contagens[area.contagem] : 0;
        // O nome do botão leva a contagem ("Tarefas, 4 tarefas pendentes"): o aria-label cobre o badge.
        const tempo = id === "foco" ? tempoDoFoco : null;
        const rotulo =
          area.contagem && valor > 0
            ? `${area.nome}, ${textoDaContagem(valor, ROTULOS_CONTAGEM[area.contagem])}`
            : tempo
              ? `${area.nome}, ${tempo.rotulo}`
              : area.nome;
        return (
          <button
            key={id}
            type="button"
            className="dock-botao"
            data-area={id}
            data-ativo={aberta === id || undefined}
            aria-label={rotulo}
            aria-expanded={aberta === id}
            title={rotulo}
            onClick={() => void invoke("painel_abrir", { area: id })}
          >
            <Icone nome={area.icone} tamanho={20} />
            {/* Zero não desenha o badge. */}
            {area.contagem && <Contagem valor={valor} rotulo={ROTULOS_CONTAGEM[area.contagem]} />}
            {/* O tempo restante embaixo do ícone; o aria-label já diz o mesmo. */}
            {tempo && (
              <span className="dock-tempo" data-pausado={tempo.pausada || undefined} aria-hidden="true">
                {tempo.minutos}
              </span>
            )}
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
          // A cabeça segue o runtime: expressão, anel no tom do status e o status no rótulo; no
          // teto, a dica diz o gasto e o limite, como estimativa (Estados.dc.html).
          const leitura = lerSituacao(time[agente], agora, modelos[agente] ?? null, gastos[agente] ?? null);
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
