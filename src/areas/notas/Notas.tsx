import { NOTA_BLOCO_RAPIDO, type ResultadoBuscaNota, type ResumoNota } from "@moductus/contrato";
import { RecusaDoServico, type EstadoConexao } from "@moductus/contrato/cliente";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { Campo } from "../../componentes/Campo.tsx";
import { Cartao } from "../../componentes/Cartao.tsx";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { abrirEndereco, useAbrir } from "../../nativo/abrir.ts";
import { useServico } from "../../nativo/eventos.ts";
import { servico, useCanal } from "../../servico/conexao.ts";
import type { Destino } from "../areas.ts";
import type { Leitura } from "../leitura.ts";
import { useAgora } from "../tempo.ts";
import { AvisosRascunho } from "./AvisosRascunho.tsx";
import { TrechoMarcado } from "./Trecho.tsx";
import {
  diaDaTarefa,
  ehBlocoRapido,
  gruposLigados,
  quandoDaNota,
  TAMANHO_BUSCA,
  textoDoSalvo,
  tituloDaNota,
  useBuscaNotas,
  useNotas,
  useRascunho,
  useTarefasDaNota,
} from "./notas.ts";
import type { EstadoRascunho, RascunhoNota } from "./salvamento.ts";
import "./Notas.css";

interface PropsNotas {
  /** A nota aberta, pelo destino do Sistema ("notas/<id>"); sem ela, a mais recente. */
  secao?: string;
  ir: (destino: Destino) => void;
}

/** A nota que abre quando nenhuma foi pedida: a mais mexida, ou o bloco rápido se não houver outra. */
function notaPadrao(lista: readonly ResumoNota[]): string {
  return lista.find((n) => !ehBlocoRapido(n.id))?.id ?? NOTA_BLOCO_RAPIDO;
}

/**
 * Sistema · Notas (AreaNotas.dc.html): a lista com o bloco rápido fixo no topo e a busca sem
 * acento; o texto aberto, que salva sozinho e se lê renderizado (clicar edita); e, ao lado, as
 * tarefas que nasceram dela. O plano da Tula e a memória do time chegam com as fases 4 e 5.
 */
export function Notas({ secao, ir }: PropsNotas) {
  const canal = useCanal(useServico({ silencioso: true }));
  const lista = useNotas(canal);
  const [busca, setBusca] = useState("");
  const resultados = useBuscaNotas(canal, busca);
  // A nota que acabou de nascer ainda não está na lista até o próximo aviso.
  const [criada, setCriada] = useState<string | null>(null);
  const [erroNova, setErroNova] = useState<string | null>(null);
  const agora = useAgora();

  const notas = lista.estado === "pronta" ? lista.dados : null;
  const conhecida = (id: string) => id === criada || ehBlocoRapido(id) || !!notas?.some((n) => n.id === id);
  const aberta = notas ? (secao && conhecida(secao) ? secao : notaPadrao(notas)) : (secao ?? null);
  const abrir = (id: string) => ir({ area: "notas", secao: id });

  const novaNota = (texto?: { titulo: string; conteudo: string }) =>
    servico.pedir("notas.criar", texto ?? {}).then((nota) => {
      setCriada(nota.id);
      abrir(nota.id);
    });

  const bloco = notas?.find((n) => ehBlocoRapido(n.id)) ?? null;
  const outras = notas?.filter((n) => !ehBlocoRapido(n.id)) ?? [];

  return (
    <div className="notas">
      <div className="notas-lista">
        <div className="notas-lista-cabecalho">
          <h1 className="notas-titulo">Notas</h1>
          <Botao
            tamanho="pequeno"
            disabled={canal !== "conectado"}
            onClick={() => {
              setErroNova(null);
              novaNota().catch((e: unknown) =>
                setErroNova(e instanceof RecusaDoServico ? e.message : "Não consegui criar a nota agora."),
              );
            }}
          >
            Nova nota
          </Botao>
        </div>
        {erroNova && (
          <p className="notas-erro" role="alert">
            {erroNova}
          </p>
        )}
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
            if (e.key === "Escape" && busca) {
              e.preventDefault();
              setBusca("");
            }
          }}
        />
        {resultados ? (
          <ResultadosBusca
            resultados={resultados}
            busca={busca}
            aberta={aberta}
            agora={agora}
            aoAbrir={abrir}
          />
        ) : (
          <ListaDeNotas
            lista={lista}
            bloco={bloco}
            outras={outras}
            aberta={aberta}
            agora={agora}
            aoAbrir={abrir}
          />
        )}
      </div>
      {aberta ? (
        <NotaAberta
          key={aberta}
          canal={canal}
          id={aberta}
          focarTitulo={aberta === criada}
          aoApagar={() => ir({ area: "notas" })}
          aoSalvarComoNova={(texto) => novaNota(texto)}
        />
      ) : (
        <p className="area-carregando notas-carregando" role="status">
          Lendo as notas.
        </p>
      )}
    </div>
  );
}

interface PropsLista {
  lista: Leitura<ResumoNota[]>;
  bloco: ResumoNota | null;
  outras: readonly ResumoNota[];
  aberta: string | null;
  agora: Date;
  aoAbrir: (id: string) => void;
}

function ListaDeNotas({ lista, bloco, outras, aberta, agora, aoAbrir }: PropsLista) {
  if (lista.estado === "esperando") {
    return (
      <p className="notas-lista-vazia" role="status">
        Lendo as notas.
      </p>
    );
  }
  if (lista.estado === "falhou") {
    return (
      <div className="notas-lista-vazia">
        <p>Não consegui ler as notas agora.</p>
        <Botao tamanho="pequeno" onClick={lista.tentarDeNovo}>
          Tentar de novo
        </Botao>
      </div>
    );
  }
  return (
    <>
      {bloco && (
        <button
          type="button"
          className="notas-bloco"
          aria-current={aberta === bloco.id ? "page" : undefined}
          onClick={() => aoAbrir(bloco.id)}
        >
          <span className="notas-bloco-rotulo">Bloco rápido · fixo</span>
          <span className="notas-bloco-trecho">
            {bloco.trecho || "Vazio. Anote aqui o que não pode esquecer."}
          </span>
        </button>
      )}
      {outras.length === 0 ? (
        <p className="notas-lista-vazia">Nenhuma nota ainda. Nova nota abre uma em branco.</p>
      ) : (
        <ul className="notas-itens" aria-label="Notas">
          {outras.map((n) => (
            <li key={n.id}>
              <ItemNota
                id={n.id}
                titulo={n.titulo}
                aberta={aberta === n.id}
                linha={[quandoDaNota(n.atualizadoEm, agora), n.trecho].filter(Boolean).join(" · ")}
                aoAbrir={aoAbrir}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

interface PropsItem {
  id: string;
  titulo: string;
  aberta: boolean;
  linha: ReactNode;
  aoAbrir: (id: string) => void;
}

function ItemNota({ id, titulo, aberta, linha, aoAbrir }: PropsItem) {
  return (
    <button
      type="button"
      className="notas-item"
      aria-current={aberta ? "page" : undefined}
      onClick={() => aoAbrir(id)}
    >
      <span className="notas-item-titulo">{ehBlocoRapido(id) ? "Bloco rápido" : tituloDaNota(titulo)}</span>
      {linha && <span className="notas-item-linha">{linha}</span>}
    </button>
  );
}

interface PropsResultados {
  resultados: Leitura<ResultadoBuscaNota[]>;
  busca: string;
  aberta: string | null;
  agora: Date;
  aoAbrir: (id: string) => void;
}

function ResultadosBusca({ resultados, busca, aberta, agora, aoAbrir }: PropsResultados) {
  if (resultados.estado === "esperando") {
    return (
      <p className="notas-lista-vazia" role="status">
        Buscando.
      </p>
    );
  }
  if (resultados.estado === "falhou") {
    return (
      <div className="notas-lista-vazia">
        <p>Não consegui buscar agora.</p>
        <Botao tamanho="pequeno" onClick={resultados.tentarDeNovo}>
          Tentar de novo
        </Botao>
      </div>
    );
  }
  const itens = resultados.dados;
  if (itens.length === 0) {
    return (
      <p className="notas-lista-vazia" role="status">
        {`Nenhuma nota com “${busca.trim()}”. A busca ignora acento e caixa.`}
      </p>
    );
  }
  return (
    <ul
      className="notas-itens"
      aria-label={`${itens.length} ${itens.length === 1 ? "nota achada" : "notas achadas"}`}
    >
      {itens.map((r) => (
        <li key={r.id}>
          <ItemNota
            id={r.id}
            titulo={r.titulo}
            aberta={aberta === r.id}
            linha={
              <>
                {quandoDaNota(r.atualizadoEm, agora)}
                {r.trecho && " · "}
                <TrechoMarcado resultado={r} />
              </>
            }
            aoAbrir={aoAbrir}
          />
        </li>
      ))}
    </ul>
  );
}

interface PropsNotaAberta {
  canal: EstadoConexao;
  id: string;
  focarTitulo: boolean;
  aoApagar: () => void;
  aoSalvarComoNova: (texto: { titulo: string; conteudo: string }) => Promise<void>;
}

function NotaAberta({ canal, id, focarTitulo, aoApagar, aoSalvarComoNova }: PropsNotaAberta) {
  const { leitura, rascunho } = useRascunho(canal, id);
  const agora = useAgora();

  if (leitura.estado !== "pronta" || !rascunho) {
    return (
      <div className="nota-vazia">
        {leitura.estado === "falhou" ? (
          <>
            <p>Não consegui abrir esta nota agora.</p>
            <Botao tamanho="pequeno" onClick={leitura.tentarDeNovo}>
              Tentar de novo
            </Botao>
          </>
        ) : (
          <p className="area-carregando" role="status">
            Lendo a nota.
          </p>
        )}
      </div>
    );
  }
  const estado = leitura.dados;
  const bloco = ehBlocoRapido(id);

  return (
    <div className="nota-aberta">
      <article className="nota" aria-label={bloco ? "Bloco rápido" : tituloDaNota(estado.titulo)}>
        <AvisosRascunho estado={estado} rascunho={rascunho} aoSalvarComoNova={aoSalvarComoNova} />
        <div className="nota-topo">
          <span>{bloco ? "Fixa no topo, aqui e no painel" : (estado.nota.pasta ?? "")}</span>
          <span className="nota-salvo">{textoDoSalvo(estado, agora)}</span>
        </div>
        {bloco ? (
          <h2 className="nota-titulo">Bloco rápido</h2>
        ) : (
          <TituloNota estado={estado} rascunho={rascunho} focar={focarTitulo} />
        )}
        <TextoNota estado={estado} rascunho={rascunho} />
      </article>
      <LadoDaNota canal={canal} id={id} estado={estado} rascunho={rascunho} aoApagar={aoApagar} />
    </div>
  );
}

function TituloNota({
  estado,
  rascunho,
  focar,
}: {
  estado: EstadoRascunho;
  rascunho: RascunhoNota;
  focar: boolean;
}) {
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focar) campo.current?.focus();
  }, [focar]);
  return (
    <input
      ref={campo}
      className="nota-titulo nota-titulo-campo"
      aria-label="Título da nota"
      placeholder="Sem título"
      maxLength={500}
      value={estado.titulo}
      onChange={(e) => rascunho.editar({ titulo: e.target.value })}
      onBlur={() => rascunho.descarregar()}
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

type Renderizar = (texto: string) => string;

/**
 * O `markdown-it` vem à parte, na primeira nota aberta: o dock e o painel não o carregam (spec da
 * fase 3, §7). Até ele chegar, o texto aparece cru.
 */
function useRenderizar(): Renderizar | null {
  const [renderizar, setRenderizar] = useState<Renderizar | null>(null);
  useEffect(() => {
    let vivo = true;
    void import("./markdown.ts").then((m) => {
      if (vivo) setRenderizar(() => m.renderizar);
    });
    return () => {
      vivo = false;
    };
  }, []);
  return renderizar;
}

/**
 * O corpo da nota (ADR-0036): o Markdown cru num campo próprio enquanto você escreve; fora dele,
 * renderizado. Clicar no texto (ou Enter nele) edita, e sair do campo salva na hora. Link abre no
 * navegador pela casca, sem trocar de modo.
 */
function TextoNota({ estado, rascunho }: { estado: EstadoRascunho; rascunho: RascunhoNota }) {
  const [editando, setEditando] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  const renderizar = useRenderizar();
  const link = useAbrir();
  const html = useMemo(
    () => (renderizar && estado.conteudo ? renderizar(estado.conteudo) : null),
    [renderizar, estado.conteudo],
  );
  const idDica = useId();

  useEffect(() => {
    const el = campo.current;
    if (!editando || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editando]);

  if (editando || !estado.conteudo) {
    return (
      <>
        <textarea
          ref={campo}
          className="nota-campo"
          aria-label="Texto da nota, em Markdown"
          placeholder="Escreva em Markdown. Salva sozinha."
          value={estado.conteudo}
          onChange={(e) => rascunho.editar({ conteudo: e.target.value })}
          onFocus={() => setEditando(true)}
          onBlur={() => {
            setEditando(false);
            rascunho.descarregar();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
        {link.erro && <p className="nota-aviso-erro">{link.erro}</p>}
      </>
    );
  }

  const aoClicar = (e: MouseEvent<HTMLDivElement>) => {
    const alvo = e.target instanceof Element ? e.target.closest("a") : null;
    if (alvo) {
      e.preventDefault();
      const endereco = alvo.getAttribute("href") ?? "";
      link.abrir(() => abrirEndereco(endereco));
      return;
    }
    setEditando(true);
  };
  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.target !== e.currentTarget) return;
    e.preventDefault();
    setEditando(true);
  };

  return (
    <>
      <span id={idDica} className="so-leitor">
        Enter ou clique para editar.
      </span>
      {html === null ? (
        <div
          className="nota-leitura nota-leitura-crua"
          role="group"
          tabIndex={0}
          aria-label="Texto da nota"
          aria-describedby={idDica}
          onClick={aoClicar}
          onKeyDown={aoTeclar}
        >
          {estado.conteudo}
        </div>
      ) : (
        <div
          className="nota-leitura"
          role="group"
          tabIndex={0}
          aria-label="Texto da nota"
          aria-describedby={idDica}
          onClick={aoClicar}
          onKeyDown={aoTeclar}
          // O HTML vem do markdown-it com `html: false`: nada do texto vira marcação (markdown.ts).
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
      {link.erro && <p className="nota-aviso-erro">{link.erro}</p>}
    </>
  );
}

interface PropsLado {
  canal: EstadoConexao;
  id: string;
  estado: EstadoRascunho;
  rascunho: RascunhoNota;
  aoApagar: () => void;
}

/**
 * Ao lado do texto (AreaNotas.dc.html): o que está ligado à nota (nesta fase, as tarefas que
 * nasceram dela), como ela funciona e o apagar no pé, dizendo para onde vai. O bloco rápido
 * esvazia em vez de ir à Lixeira, com a confirmação no lugar.
 */
function LadoDaNota({ canal, id, estado, rascunho, aoApagar }: PropsLado) {
  const tarefas = useTarefasDaNota(canal, id);
  const agora = useAgora();
  const idLigado = useId();
  const idComo = useId();
  return (
    <aside className="nota-lado" aria-label="Sobre esta nota">
      <section className="nota-lado-secao" aria-labelledby={idLigado}>
        <h2 id={idLigado} className="nota-lado-rotulo">
          Ligado a esta nota
        </h2>
        {tarefas.estado === "esperando" ? (
          <p className="nota-lado-texto">Lendo as tarefas.</p>
        ) : tarefas.estado === "falhou" ? (
          <div className="nota-lado-texto">
            <p>Não consegui ler as tarefas desta nota.</p>
            <Botao tamanho="pequeno" onClick={tarefas.tentarDeNovo}>
              Tentar de novo
            </Botao>
          </div>
        ) : tarefas.dados.length === 0 ? (
          <p className="nota-lado-texto">Nenhuma tarefa criada a partir desta nota.</p>
        ) : (
          gruposLigados(tarefas.dados).map((g) => (
            <div key={g.agente ?? "voce"} className="nota-ligado">
              <div className="nota-ligado-linha">
                {g.agente && (
                  <span className="nota-ligado-cabeca">
                    <Personagem agente={g.agente} modo="cabeca" tamanho="ligado" estado="ocioso" />
                  </span>
                )}
                <p className="nota-lado-texto">{g.texto}</p>
              </div>
              <ul className="nota-ligado-tarefas">
                {g.tarefas.map((t) => (
                  <li
                    key={t.id}
                    className="nota-ligado-tarefa"
                    data-feita={t.estado === "feita" || undefined}
                  >
                    <span className="nota-ligado-tarefa-titulo">{t.titulo}</span>
                    {t.estado === "feita" ? (
                      <span className="nota-ligado-tarefa-meta">feita</span>
                    ) : (
                      t.venceEm && (
                        <span className="nota-ligado-tarefa-meta">{diaDaTarefa(t.venceEm, agora)}</span>
                      )
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
      <section className="nota-lado-secao" aria-labelledby={idComo}>
        <h2 id={idComo} className="nota-lado-rotulo">
          Markdown
        </h2>
        <p className="nota-lado-texto nota-lado-texto--apagado">
          Salva sozinha. A busca acha qualquer nota, com ou sem acento.
        </p>
      </section>
      <ApagarNota canal={canal} id={id} estado={estado} rascunho={rascunho} aoApagar={aoApagar} />
    </aside>
  );
}

function ApagarNota({ canal, id, estado, rascunho, aoApagar }: PropsLado) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const idConfirmacao = useId();
  const manter = useRef<HTMLButtonElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const bloco = ehBlocoRapido(id);

  useEffect(() => {
    if (confirmando) manter.current?.focus();
  }, [confirmando]);

  const apagar = () => {
    setEnviando(true);
    setErro(null);
    // O texto pendente não importa mais: a nota sai (ou o bloco esvazia) como está no banco.
    rascunho.descartar();
    servico
      .pedir("notas.apagar", { id })
      .then(() => {
        setConfirmando(false);
        if (!bloco) aoApagar();
      })
      .catch((e: unknown) =>
        setErro(e instanceof RecusaDoServico ? e.message : "Não consegui apagar agora. Tente de novo."),
      )
      .finally(() => setEnviando(false));
  };

  const fechar = () => {
    setConfirmando(false);
    botao.current?.focus();
  };

  if (!bloco) {
    return (
      <div className="nota-lado-rodape">
        <Botao
          variante="fantasma"
          tamanho="pequeno"
          className="nota-apagar"
          disabled={enviando || canal !== "conectado"}
          onClick={apagar}
        >
          Apagar nota
        </Botao>
        <span className="nota-lado-texto nota-lado-texto--apagado">fica 30 dias na Lixeira</span>
        {erro && <p className="nota-aviso-erro">{erro}</p>}
      </div>
    );
  }

  return (
    <div className="nota-lado-rodape">
      <Botao
        ref={botao}
        variante="fantasma"
        tamanho="pequeno"
        className="nota-apagar"
        disabled={canal !== "conectado" || (!estado.conteudo && !estado.nota.conteudo)}
        aria-expanded={confirmando}
        aria-controls={confirmando ? idConfirmacao : undefined}
        onClick={() => setConfirmando((c) => !c)}
      >
        Esvaziar o bloco
      </Botao>
      {confirmando && (
        <Cartao
          como="section"
          variante="elevado"
          id={idConfirmacao}
          className="nota-confirmacao"
          aria-label="Esvaziar o bloco rápido"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !enviando) {
              e.preventDefault();
              fechar();
            }
          }}
        >
          <p className="nota-lado-texto">
            O texto do bloco rápido sai; o bloco continua fixo no topo, aqui e no painel.
          </p>
          <p className="nota-lado-texto nota-lado-texto--apagado">Não dá para desfazer.</p>
          <div className="nota-confirmacao-acoes">
            <Botao
              ref={manter}
              tamanho="pequeno"
              disabled={enviando}
              aria-keyshortcuts="Escape"
              onClick={fechar}
            >
              Manter como está
            </Botao>
            <Botao tamanho="pequeno" variante="primario" disabled={enviando} onClick={apagar}>
              Esvaziar o bloco
            </Botao>
          </div>
          {erro && <p className="nota-aviso-erro">{erro}</p>}
        </Cartao>
      )}
    </div>
  );
}
