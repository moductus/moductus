import { useState } from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { Cartao } from "../../componentes/Cartao.tsx";
import type { EstadoRascunho, RascunhoNota } from "./salvamento.ts";
import "./AvisosRascunho.css";

interface PropsAvisos {
  estado: EstadoRascunho;
  rascunho: RascunhoNota;
  /** Guarda o texto daqui numa nota nova, quando esta foi para a Lixeira em outra janela. */
  aoSalvarComoNova?: (texto: { titulo: string; conteudo: string }) => Promise<void>;
}

/**
 * O que impede o texto de salvar, no alto da nota e nunca num modal (DESIGN.md §5, "Confirmação no
 * lugar"): a nota mudou em outra janela (você escolhe qual texto fica, ADR-0036), foi para a
 * Lixeira, ou o salvar falhou. Em todos, o que você escreveu continua na tela.
 */
export function AvisosRascunho({ estado, rascunho, aoSalvarComoNova }: PropsAvisos) {
  const [erroNova, setErroNova] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  if (estado.situacao === "conflito") {
    return (
      <Cartao
        como="section"
        variante="elevado"
        className="nota-aviso"
        role="alert"
        aria-label="Esta nota mudou em outra janela"
      >
        <p className="nota-aviso-titulo">Esta nota mudou em outra janela.</p>
        <p className="nota-aviso-texto">
          O que você escreveu aqui ainda não foi salvo. Escolha qual texto fica.
        </p>
        <div className="nota-aviso-acoes">
          <Botao tamanho="pequeno" onClick={() => rascunho.usarAOutra()}>
            Usar o da outra janela
          </Botao>
          <Botao tamanho="pequeno" variante="primario" onClick={() => rascunho.ficarComAMinha()}>
            Salvar o meu texto
          </Botao>
        </div>
      </Cartao>
    );
  }

  if (estado.situacao === "apagada") {
    const salvarComoNova = aoSalvarComoNova;
    return (
      <Cartao
        como="section"
        variante="elevado"
        className="nota-aviso"
        role="alert"
        aria-label="Esta nota foi para a Lixeira"
      >
        <p className="nota-aviso-titulo">Esta nota foi para a Lixeira em outra janela.</p>
        {rascunho.pendente && salvarComoNova && (
          <>
            <p className="nota-aviso-texto">O que você escreveu aqui ainda está na tela.</p>
            <div className="nota-aviso-acoes">
              <Botao
                tamanho="pequeno"
                variante="primario"
                disabled={criando}
                onClick={() => {
                  setCriando(true);
                  setErroNova(null);
                  salvarComoNova({ titulo: estado.titulo, conteudo: estado.conteudo })
                    .catch(() => setErroNova("Não consegui criar a nota agora. Tente de novo."))
                    .finally(() => setCriando(false));
                }}
              >
                Salvar como nota nova
              </Botao>
            </div>
            {erroNova && <p className="nota-aviso-erro">{erroNova}</p>}
          </>
        )}
      </Cartao>
    );
  }

  if (estado.situacao === "falhou") {
    return (
      <p className="nota-aviso-erro" role="status">
        {estado.erro
          ? `Não salvou: ${estado.erro}.`
          : "Sem conexão com o serviço. O texto continua aqui e salva quando ela voltar."}
      </p>
    );
  }

  return null;
}
