import { NOTA_BLOCO_RAPIDO, type ResumoNota } from "@moductus/contrato";
import { RecusaDoServico, type EstadoConexao } from "@moductus/contrato/cliente";
import { invoke } from "@tauri-apps/api/core";
import { useId, useState, type ReactNode } from "react";
import { AvisosRascunho } from "../../areas/notas/AvisosRascunho.tsx";
import {
  ehBlocoRapido,
  origemDaNota,
  quandoDaNota,
  TAMANHO_BUSCA,
  textoDoSalvo,
  tituloDaNota,
  useBuscaNotas,
  useNotas,
  useRascunho,
} from "../../areas/notas/notas.ts";
import { TrechoMarcado } from "../../areas/notas/Trecho.tsx";
import { useAgora } from "../../areas/tempo.ts";
import { Botao } from "../../componentes/Botao.tsx";
import { Campo } from "../../componentes/Campo.tsx";
import { Cartao } from "../../componentes/Cartao.tsx";
import { servico } from "../../servico/conexao.ts";
import { CabecalhoPainel } from "./Cabecalho.tsx";
import { abrirNoSistema } from "./PedidosSessoes.tsx";

/** Quantas notas recentes o painel mostra (PainelNotas.dc.html). */
export const RECENTES_NO_PAINEL = 5;

/**
 * O painel não ativa sozinho (o dock não rouba o foco): um campo de texto pede o teclado à casca
 * quando você clica nele e devolve ao sair (PRODUCT.md §4 "Foco").
 */
const teclado = {
  onPointerDown: () => void invoke("painel_foco", { quer: true }),
  onFocus: () => void invoke("painel_foco", { quer: true }),
  onBlur: () => void invoke("painel_foco", { quer: false }),
};

const quantas = (n: number) => `${n} ${n === 1 ? "nota" : "notas"}`;

/**
 * O painel Notas do dock (PainelNotas.dc.html): a nota fixa, editável, que salva sozinha e é a
 * mesma do Sistema; a busca sem acento; as recentes, que abrem no Sistema; e a nota nova.
 */
export function PainelNotas({ canal }: { canal: EstadoConexao }) {
  const lista = useNotas(canal);
  const [busca, setBusca] = useState("");
  const resultados = useBuscaNotas(canal, busca);
  const [erro, setErro] = useState<string | null>(null);
  const agora = useAgora();
  const idRecentes = useId();

  const outras = lista.estado === "pronta" ? lista.dados.filter((n) => !ehBlocoRapido(n.id)) : null;
  const subtitulo = outras ? `Alba · ${quantas(outras.length)}` : undefined;

  const novaNota = () => {
    setErro(null);
    servico
      .pedir("notas.criar", {})
      .then((nota) => abrirNoSistema(`notas/${nota.id}`))
      .catch((e: unknown) =>
        setErro(e instanceof RecusaDoServico ? e.message : "Não consegui criar a nota agora."),
      );
  };

  return (
    <>
      <CabecalhoPainel titulo="Notas" subtitulo={subtitulo} sistema="notas" />
      <div className="painel-corpo">
        <NotaFixa canal={canal} />
        <Campo
          rotulo="Buscar nas notas"
          rotuloOculto
          icone="busca"
          type="search"
          placeholder="Buscar nas notas"
          maxLength={TAMANHO_BUSCA}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => {
            // Esc com busca limpa a busca; sem ela, fecha o painel (o ouvinte da janela).
            if (e.key === "Escape" && busca) {
              e.preventDefault();
              e.stopPropagation();
              setBusca("");
            }
          }}
          {...teclado}
        />
        <section className="painel-secao" aria-labelledby={idRecentes}>
          {resultados ? (
            <>
              <header className="painel-secao-cabecalho">
                <h2 id={idRecentes} className="painel-secao-titulo">
                  Achadas
                </h2>
                {resultados.estado === "pronta" && <span>{quantas(resultados.dados.length)}</span>}
              </header>
              {resultados.estado === "esperando" ? (
                <p className="painel-notas-vazio" role="status">
                  Buscando.
                </p>
              ) : resultados.estado === "falhou" ? (
                <div className="painel-secao-vazia">
                  <p>Não consegui buscar agora.</p>
                  <Botao tamanho="pequeno" onClick={resultados.tentarDeNovo}>
                    Tentar de novo
                  </Botao>
                </div>
              ) : resultados.dados.length === 0 ? (
                <p className="painel-notas-vazio" role="status">
                  {`Nenhuma nota com “${busca.trim()}”.`}
                </p>
              ) : (
                <ul className="painel-notas">
                  {resultados.dados.map((r) => (
                    <li key={r.id}>
                      <LinhaNota nota={r} agora={agora}>
                        <TrechoMarcado resultado={r} />
                      </LinhaNota>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <header className="painel-secao-cabecalho">
                <h2 id={idRecentes} className="painel-secao-titulo">
                  Recentes
                </h2>
                {outras && outras.length > 0 && (
                  <span>{`${Math.min(RECENTES_NO_PAINEL, outras.length)} de ${outras.length}`}</span>
                )}
              </header>
              {lista.estado === "esperando" ? (
                <p className="painel-notas-vazio" role="status">
                  Lendo as notas.
                </p>
              ) : lista.estado === "falhou" ? (
                <div className="painel-secao-vazia">
                  <p>Não consegui ler as notas agora.</p>
                  <Botao tamanho="pequeno" onClick={lista.tentarDeNovo}>
                    Tentar de novo
                  </Botao>
                </div>
              ) : outras && outras.length === 0 ? (
                <p className="painel-notas-vazio">
                  Nenhuma nota além da fixa. Nova nota abre uma no Sistema.
                </p>
              ) : (
                <ul className="painel-notas">
                  {outras?.slice(0, RECENTES_NO_PAINEL).map((n) => (
                    <li key={n.id}>
                      <LinhaNota nota={n} agora={agora}>
                        {n.trecho}
                      </LinhaNota>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
        {erro && (
          <p className="painel-secao-erro" role="alert">
            {erro}
          </p>
        )}
        <div className="painel-notas-acoes">
          <Botao variante="primario" disabled={canal !== "conectado"} onClick={novaNota}>
            Nova nota
          </Botao>
        </div>
      </div>
    </>
  );
}

/** Uma nota na lista do painel: título, quando, o trecho e quem a escreveu, se foi um agente. */
function LinhaNota({ nota, agora, children }: { nota: ResumoNota; agora: Date; children: ReactNode }) {
  const origem = origemDaNota(nota);
  return (
    <button
      type="button"
      className="painel-nota"
      aria-label={`${tituloDaNota(nota.titulo)}, abrir no Sistema`}
      onClick={() => abrirNoSistema(`notas/${nota.id}`)}
    >
      <span className="painel-nota-linha">
        <span className="painel-nota-titulo">{tituloDaNota(nota.titulo)}</span>
        <span className="painel-nota-quando">{quandoDaNota(nota.atualizadoEm, agora)}</span>
      </span>
      {nota.trecho && <span className="painel-nota-trecho">{children}</span>}
      {origem && <span className="painel-nota-origem">{origem}</span>}
    </button>
  );
}

/**
 * A nota fixa (o bloco rápido) no alto do painel: escreve e salva sozinha, a mesma do Sistema. Se o
 * Sistema mudou o texto enquanto você escrevia aqui, as duas versões aparecem para você escolher.
 */
function NotaFixa({ canal }: { canal: EstadoConexao }) {
  const { leitura, rascunho } = useRascunho(canal, NOTA_BLOCO_RAPIDO);
  const agora = useAgora();
  const id = useId();
  const idDica = useId();
  const estado = leitura.estado === "pronta" ? leitura.dados : null;

  return (
    <Cartao variante="elevado" className="painel-nota-fixa">
      <div className="painel-nota-fixa-topo">
        {estado && rascunho ? (
          <label htmlFor={id} className="painel-nota-fixa-rotulo">
            Nota fixa
          </label>
        ) : (
          <span className="painel-nota-fixa-rotulo">Nota fixa</span>
        )}
        {estado && <span className="painel-nota-quando">{textoDoSalvo(estado, agora, "salva")}</span>}
      </div>
      {estado && rascunho ? (
        <>
          <AvisosRascunho estado={estado} rascunho={rascunho} />
          <textarea
            id={id}
            className="painel-nota-fixa-campo"
            rows={5}
            aria-describedby={idDica}
            value={estado.conteudo}
            onChange={(e) => rascunho.editar({ conteudo: e.target.value })}
            onPointerDown={teclado.onPointerDown}
            onFocus={teclado.onFocus}
            onBlur={() => {
              rascunho.descarregar();
              teclado.onBlur();
            }}
            onKeyDown={(e) => {
              // Esc fecha o painel (o ouvinte da janela); o texto sai antes.
              if (e.key === "Escape") rascunho.descarregar();
            }}
          />
        </>
      ) : leitura.estado === "falhou" ? (
        <div className="painel-nota-fixa-falhou">
          <p>Não consegui abrir a nota fixa agora.</p>
          <Botao tamanho="pequeno" onClick={leitura.tentarDeNovo}>
            Tentar de novo
          </Botao>
        </div>
      ) : (
        <p className="painel-notas-vazio" role="status">
          Lendo a nota fixa.
        </p>
      )}
      <span id={idDica} className="painel-nota-fixa-dica">
        Salva sozinha. Fica sempre no topo, aqui e no Sistema.
      </span>
    </Cartao>
  );
}
