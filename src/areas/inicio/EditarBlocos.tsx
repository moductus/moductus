import type { ConfigInicio, IdBlocoInicio } from "@moductus/contrato";
import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Atalho } from "../../componentes/Atalho.tsx";
import { Botao } from "../../componentes/Botao.tsx";
import { Icone } from "../../componentes/Icone.tsx";
import {
  colunasDosEscondidos,
  DADOS_BLOCOS,
  escondidos,
  esconder,
  mostrar,
  mover,
  posicao,
  soltar,
  textoDaMudanca,
  visiveis,
} from "./inicio.ts";

interface PropsEditar {
  inicio: ConfigInicio;
  /** Cada mudança vale na hora: quem chama grava no serviço; a linha de status diz o que mudou. */
  aplicar: (novo: ConfigInicio, status: string) => void;
  status: string;
  /** A mudança não foi gravada: a linha de status vira erro. */
  erro: boolean;
}

/**
 * O Início no modo de editar (InicioEditar.dc.html): cada bloco que aparece vira um cartão com o
 * esboço do conteúdo, arrastável, com mover para cima, para baixo e esconder; o bloco selecionado
 * também anda com Alt ↑ e Alt ↓. Os escondidos ficam no fim, com Mostrar.
 */
/** Onde o foco fica depois de uma mudança. */
type AlvoDoFoco = "cartao" | "subir" | "descer" | "mostrar";

export function EditarBlocos({ inicio, aplicar, status, erro }: PropsEditar) {
  const idDica = useId();
  const lista = visiveis(inicio);
  const fora = escondidos(inicio);
  const [selecionado, setSelecionado] = useState<IdBlocoInicio | null>(null);
  const [arrastando, setArrastando] = useState<IdBlocoInicio | null>(null);
  // Reordenar move os cartões no DOM e o foco cairia no fim da página: depois da mudança ele volta
  // ao cartão, ao botão que foi clicado (ou ao cartão, se o botão desabilitou na ponta) ou ao Mostrar.
  const [focar, setFocar] = useState<{ id: IdBlocoInicio; alvo: AlvoDoFoco } | null>(null);
  const cartoes = useRef(new Map<IdBlocoInicio, HTMLElement>());
  const grade = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focar) return;
    const cartao = cartoes.current.get(focar.id);
    const alvo =
      focar.alvo === "mostrar"
        ? grade.current?.querySelector<HTMLElement>(`[data-mostrar="${focar.id}"]`)
        : focar.alvo === "cartao"
          ? cartao
          : cartao?.querySelector<HTMLButtonElement>(`[data-mover="${focar.alvo}"]:not(:disabled)`);
    (alvo ?? cartao)?.focus();
  }, [focar]);

  const andar = (id: IdBlocoInicio, passo: -1 | 1, alvo: AlvoDoFoco) => {
    const novo = mover(inicio, id, passo);
    if (!novo) return;
    aplicar(novo, textoDaMudanca(novo, id, "moveu"));
    setFocar({ id, alvo });
  };

  const aoTeclar = (id: IdBlocoInicio) => (e: KeyboardEvent<HTMLElement>) => {
    if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    andar(id, e.key === "ArrowUp" ? -1 : 1, "cartao");
  };

  const aoSoltar = (alvo: IdBlocoInicio) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    const id = arrastando;
    setArrastando(null);
    if (!id) return;
    const novo = soltar(inicio, id, alvo);
    if (novo) aplicar(novo, textoDaMudanca(novo, id, "moveu"));
  };

  return (
    <>
      <p id={idDica} className="inicio-dica">
        <Icone nome="arrastar" />
        <span>
          Arraste para mudar a ordem, ou selecione um bloco e use <Atalho teclas="Alt+↑" /> e{" "}
          <Atalho teclas="Alt+↓" />. Esconder não apaga nada: o bloco vai para Escondidos.
        </span>
      </p>
      <div ref={grade} className="inicio-grade">
        {lista.map((id, i) => {
          const { nome, descricao, esboco } = DADOS_BLOCOS[id];
          const lugar = posicao(inicio, id);
          return (
            <section
              key={id}
              ref={(no) => {
                if (no) cartoes.current.set(id, no);
                else cartoes.current.delete(id);
              }}
              className="inicio-editar-bloco"
              data-faixa={id === "briefing" || undefined}
              data-selecionado={selecionado === id || undefined}
              data-arrastando={arrastando === id || undefined}
              aria-label={`Bloco ${nome}`}
              aria-describedby={idDica}
              tabIndex={0}
              draggable
              onFocus={() => setSelecionado(id)}
              onKeyDown={aoTeclar(id)}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", id);
                setArrastando(id);
                setSelecionado(id);
              }}
              onDragEnd={() => setArrastando(null)}
              onDragOver={(e) => {
                if (arrastando) e.preventDefault();
              }}
              onDrop={aoSoltar(id)}
            >
              <div className="inicio-editar-topo">
                <span className="inicio-editar-alca">
                  <Icone nome="arrastar" />
                </span>
                <span className="inicio-editar-nome">{nome}</span>
                {lugar && <span className="inicio-meta">{`${lugar.numero} de ${lugar.total}`}</span>}
              </div>
              <span className="inicio-editar-descricao">{descricao}</span>
              <div className="inicio-esboco" aria-hidden="true">
                {esboco.map((largura, j) => (
                  <div key={j} className="inicio-esboco-linha" style={{ width: `${largura}%` }} />
                ))}
              </div>
              <div className="inicio-editar-acoes">
                <Botao
                  tamanho="pequeno"
                  icone="subir"
                  aria-label={`Mover ${nome} para cima`}
                  data-mover="subir"
                  disabled={i === 0}
                  onClick={() => andar(id, -1, "subir")}
                />
                <Botao
                  tamanho="pequeno"
                  icone="descer"
                  aria-label={`Mover ${nome} para baixo`}
                  data-mover="descer"
                  disabled={i === lista.length - 1}
                  onClick={() => andar(id, 1, "descer")}
                />
                <span className="inicio-editar-vao" />
                <Botao
                  tamanho="pequeno"
                  icone="esconder"
                  aria-label={`Esconder ${nome}`}
                  onClick={() => {
                    aplicar(esconder(inicio, id), textoDaMudanca(inicio, id, "escondeu"));
                    // O cartão sai da grade: o foco fica no vizinho; sem vizinho, no Mostrar dele.
                    const vizinho = lista[i + 1] ?? lista[i - 1];
                    setFocar(vizinho ? { id: vizinho, alvo: "cartao" } : { id, alvo: "mostrar" });
                  }}
                >
                  Esconder
                </Botao>
              </div>
            </section>
          );
        })}
        <section
          className="inicio-escondidos"
          aria-label="Blocos escondidos"
          data-colunas={colunasDosEscondidos(lista)}
        >
          <div className="inicio-escondidos-topo">
            <span>{`Escondidos · ${fora.length}`}</span>
            <span>somem do Início, voltam quando você quiser</span>
          </div>
          {fora.length === 0 && <p className="inicio-texto">Nenhum bloco escondido.</p>}
          {fora.map((id) => {
            const { nome, descricao } = DADOS_BLOCOS[id];
            return (
              <div key={id} className="inicio-escondido">
                <span className="inicio-editar-alca">
                  <Icone nome="esconder" />
                </span>
                <div className="inicio-escondido-corpo">
                  <span className="inicio-editar-nome">{nome}</span>
                  <span className="inicio-editar-descricao">{descricao}</span>
                </div>
                <Botao
                  tamanho="pequeno"
                  icone="mostrar"
                  aria-label={`Mostrar ${nome}`}
                  data-mostrar={id}
                  onClick={() => {
                    const novo = mostrar(inicio, id);
                    aplicar(novo, textoDaMudanca(novo, id, "mostrou"));
                    setFocar({ id, alvo: "cartao" });
                  }}
                >
                  Mostrar
                </Botao>
              </div>
            );
          })}
          <p className="inicio-status" role={erro ? "alert" : "status"} data-erro={erro || undefined}>
            <span className="inicio-status-ponto" aria-hidden="true" />
            {status}
          </p>
        </section>
      </div>
    </>
  );
}
