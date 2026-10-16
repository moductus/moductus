import { invoke } from "@tauri-apps/api/core";
import { Atalho } from "../../componentes/Atalho.tsx";
import { Botao } from "../../componentes/Botao.tsx";
import { Icone, type NomeIcone } from "../../componentes/Icone.tsx";
import { AGENTES } from "../../componentes/personagem/agentes.ts";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { DADOS_AREAS } from "../areas.ts";
import { abrirNoSistema } from "./PedidosSessoes.tsx";

interface PropsCabecalho {
  titulo: string;
  icone?: NomeIcone;
  /** A linha de baixo do título ("1 trabalhando · 2 esperando você"). */
  subtitulo?: string;
  /** Área do Sistema que o "Abrir no sistema" abre; sem ela, o link não aparece. */
  sistema?: string;
  /** Atalho mostrado ao lado do link, como no Agentes.dc.html. */
  atalho?: string;
}

/**
 * O alto do painel (Main.dc.html, Agentes.dc.html, PainelDev.dc.html): título, a linha de
 * situação, o "Abrir no sistema" e o fechar (Esc também fecha).
 */
export function CabecalhoPainel({ titulo, icone, subtitulo, sistema, atalho }: PropsCabecalho) {
  return (
    <header className="painel-cabecalho">
      <div className="painel-cabecalho-linha">
        {icone && <Icone nome={icone} tamanho={20} />}
        <h1 className="painel-titulo">{titulo}</h1>
        {sistema && (
          <button type="button" className="painel-abrir" onClick={() => abrirNoSistema(sistema)}>
            Abrir no sistema
            {atalho && <Atalho teclas={atalho} />}
          </button>
        )}
        <Botao
          variante="fantasma"
          tamanho="pequeno"
          icone="fechar"
          aria-label="Fechar painel"
          title="Fechar (Esc)"
          onClick={() => void invoke("painel_fechar")}
        />
      </div>
      {/* Embaixo do título, na largura toda: o painel tem 360 px e a linha não pode quebrar. */}
      {subtitulo && <p className="painel-subtitulo">{subtitulo}</p>}
    </header>
  );
}

/**
 * O serviço ainda não disse como o time está (subindo, canal caído ou pedido recusado): o painel
 * diz que não sabe, sem convidar a conectar um modelo que talvez já esteja conectado.
 */
export function SemNoticiaDoTime() {
  return (
    <div className="painel-vazio" role="status">
      <h2 className="painel-vazio-titulo">Sem notícia do time agora</h2>
      <p className="painel-vazio-texto">
        Esperando o serviço dizer como estão a Alba, a Tula, a Faina e o Nuno.
      </p>
    </div>
  );
}

/**
 * O time sem modelo (fase 1 e "sem_modelo" do runtime): os quatro dormindo e o convite para
 * conectar um modelo, que leva às Configurações › Modelos.
 */
export function ConviteModelo() {
  const { vazio } = DADOS_AREAS.agentes;
  return (
    <div className="painel-vazio">
      <div className="painel-time" aria-label="O time, dormindo" role="group">
        {AGENTES.map((a) => (
          <Personagem key={a} agente={a} modo="cabeca" tamanho="painel" estado="dormindo" moldura />
        ))}
      </div>
      <h2 className="painel-vazio-titulo">{vazio.titulo}</h2>
      <p className="painel-vazio-texto">{vazio.texto}</p>
      <Botao variante="primario" onClick={() => abrirNoSistema("configuracoes/modelos")}>
        Abrir Configurações
      </Botao>
    </div>
  );
}
