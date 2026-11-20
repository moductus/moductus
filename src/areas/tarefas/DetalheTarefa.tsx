import type { Lista, MudancaTarefa, Tarefa } from "@moductus/contrato";
import { useId, useState } from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { Caixa } from "../../componentes/Caixa.tsx";
import { Seletor } from "../../componentes/Seletor.tsx";

import { Icone } from "../../componentes/Icone.tsx";
import { useAcoesSistema } from "../../janelas/sistema/primeiro-uso/estado.ts";
import { servico } from "../../servico/conexao.ts";

import { opcoesDuracao, opcoesLembrete, opcoesRepeticao, valorDaRepeticao } from "./detalhe.ts";
import {
  AreaDeTexto,
  ChipQueSai,
  Entrada,
  LinhaOrigem,
  ListaSuspensa,
  PainelDetalhe,
  RodapeDetalhe,
  useGravacao,
} from "./PecasDetalhe.tsx";

const PRIORIDADES = [
  { valor: "0", rotulo: "Nenhuma" },
  { valor: "1", rotulo: "Baixa" },
  { valor: "2", rotulo: "Média" },
  { valor: "3", rotulo: "Alta" },
] as const;

interface PropsDetalheTarefa {
  tarefa: Tarefa;
  /** As subtarefas que as vistas trouxeram, na ordem delas. */
  subtarefas: readonly Tarefa[];
  listas: readonly Lista[];
  fuso: string;
  agora: Date;
  /** A tarefa que voltou de um pedido: o detalhe fica com ela mesmo que saia da vista. */
  aoReceber: (tarefa: Tarefa) => void;
  aoAbrir: (id: string) => void;
  aoFechar: () => void;
}

/**
 * O detalhe da tarefa (DetalheTarefa.dc.html): título, notas, prioridade, lista, dia, hora,
 * duração, repetição, lembrete, subtarefas e etiquetas, cada um gravado sozinho ao mudar. Mudar a
 * hora leva o lembrete junto: quem faz isso é o serviço (`tarefas.definir`).
 */
export function DetalheTarefa({
  tarefa,
  subtarefas,
  listas,
  fuso,
  agora,
  aoReceber,
  aoAbrir,
  aoFechar,
}: PropsDetalheTarefa) {
  const gravacao = useGravacao();
  const { ir } = useAcoesSistema();
  const { id } = tarefa;
  const lista = listas.find((l) => l.id === tarefa.listaId);
  const ehSubtarefa = tarefa.tarefaPaiId !== null;
  const aberta = tarefa.estado === "aberta";

  const definir = (mudanca: Omit<MudancaTarefa, "id">) =>
    gravacao.gravar(() => servico.pedir("tarefas.definir", { id, ...mudanca }), aoReceber);

  const opcoesLista = listas
    .filter((l) => !l.arquivada || l.id === tarefa.listaId)
    .map((l) => ({ valor: l.id, rotulo: l.nome }));

  return (
    <PainelDetalhe
      rotulo="Detalhe da tarefa"
      alto={`${lista?.nome ?? "Entrada"} · ${ehSubtarefa ? "subtarefa" : "tarefa"}`}
      acoes={
        aberta && (
          <Botao
            tamanho="pequeno"
            onClick={() =>
              gravacao.gravar(
                () => servico.pedir("foco.iniciar", { tipo: "foco", tarefaId: id }),
                () => ir({ area: "foco" }),
              )
            }
          >
            Começar foco
          </Botao>
        )
      }
      aoFechar={aoFechar}
    >
      <div className="tarefas-detalhe-titulo">
        <Caixa
          marcado={tarefa.estado === "feita"}
          aria-label="Feita"
          aoMudar={(feita) =>
            gravacao.gravar(
              () =>
                feita
                  ? servico.pedir("tarefas.concluir", { id }).then((c) => c.tarefa)
                  : servico.pedir("tarefas.reabrir", { id }),
              aoReceber,
            )
          }
        />
        <Entrada
          rotulo="Título"
          rotuloOculto
          className="tarefas-detalhe-titulo-campo"
          valor={tarefa.titulo}
          maxLength={500}
          autoFocus
          obrigatoria
          aoGravar={(titulo) => definir({ titulo: titulo.trim() })}
        />
      </div>
      <LinhaOrigem item={tarefa} genero="a" fuso={fuso} agora={agora} />
      <AreaDeTexto
        rotulo="Notas"
        valor={tarefa.notas ?? ""}
        maxLength={10_000}
        aoGravar={(notas) => definir({ notas: notas.trim() === "" ? null : notas })}
      />
      <div className="tarefas-detalhe-campo">
        <span className="tarefas-detalhe-rot" aria-hidden="true">
          Prioridade
        </span>
        <Seletor
          rotulo="Prioridade"
          opcoes={PRIORIDADES}
          valor={String(tarefa.prioridade) as (typeof PRIORIDADES)[number]["valor"]}
          aoMudar={(p) => definir({ prioridade: Number(p) })}
        />
      </div>
      <div className="tarefas-detalhe-grade">
        <ListaSuspensa
          rotulo="Lista"
          valor={tarefa.listaId}
          opcoes={opcoesLista}
          aoMudar={(listaId) =>
            gravacao.gravar(() => servico.pedir("tarefas.mover", { id, listaId }), aoReceber)
          }
        />
        <Entrada
          rotulo="Data"
          tipo="date"
          valor={tarefa.venceEm ?? ""}
          aoGravar={(dia) => definir({ venceEm: dia === "" ? null : dia })}
        />
        <Entrada
          rotulo="Hora"
          tipo="time"
          valor={tarefa.hora ?? ""}
          desativada={tarefa.venceEm === null}
          aoGravar={(hora) => definir({ hora: hora === "" ? null : hora })}
        />
        <ListaSuspensa
          rotulo="Duração"
          valor={tarefa.duracaoEstimadaMin === null ? "" : String(tarefa.duracaoEstimadaMin)}
          opcoes={opcoesDuracao(tarefa.duracaoEstimadaMin)}
          aoMudar={(m) => definir({ duracaoEstimadaMin: m === "" ? null : Number(m) })}
        />
        <ListaSuspensa
          rotulo="Repetir"
          valor={valorDaRepeticao(tarefa.recorrencia)}
          opcoes={opcoesRepeticao(tarefa.recorrencia)}
          aoMudar={(regra) => definir({ recorrencia: regra === "" ? null : regra })}
        />
        <ListaSuspensa
          rotulo="Lembrete"
          valor={tarefa.lembreteMinutosAntes === null ? "" : String(tarefa.lembreteMinutosAntes)}
          opcoes={opcoesLembrete(tarefa.lembreteMinutosAntes, tarefa.hora)}
          desativada={tarefa.hora === null}
          aoMudar={(m) => definir({ lembreteMinutosAntes: m === "" ? null : Number(m) })}
        />
      </div>

      {!ehSubtarefa && (
        <Subtarefas mae={tarefa} subtarefas={subtarefas} aoAbrir={aoAbrir} gravar={gravacao.gravar} />
      )}
      <Etiquetas
        nomes={tarefa.etiquetas.map((e) => e.nome)}
        aoMudar={(etiquetas) => definir({ etiquetas })}
      />
      <div className="tarefas-detalhe-espaco" />
      <RodapeDetalhe
        apagar={{
          texto: "Apagar tarefa",
          aoApagar: () => gravacao.gravar(() => servico.pedir("tarefas.apagar", { id }), aoFechar),
        }}
        nota="fica 30 dias na Lixeira"
        gravacao={gravacao}
        atualizadoEm={tarefa.atualizadoEm}
        agora={agora}
      />
    </PainelDetalhe>
  );
}

/** As subtarefas: marcar, abrir e acrescentar, com o "1 de 3" no alto. */
function Subtarefas({
  mae,
  subtarefas,
  aoAbrir,
  gravar,
}: {
  mae: Tarefa;
  subtarefas: readonly Tarefa[];
  aoAbrir: (id: string) => void;
  gravar: ReturnType<typeof useGravacao>["gravar"];
}) {
  const idNova = useId();
  const idTitulo = useId();
  const [nova, setNova] = useState("");
  const contadas = subtarefas.filter((s) => s.estado !== "cancelada");
  const criar = () => {
    const titulo = nova.trim();
    if (titulo === "") return;
    setNova("");
    gravar(() => servico.pedir("tarefas.criar", { titulo, tarefaPaiId: mae.id, listaId: mae.listaId }));
  };
  return (
    <section className="tarefas-detalhe-subtarefas" aria-labelledby={idTitulo}>
      <div className="tarefas-detalhe-subtarefas-cabeca">
        <h3 id={idTitulo} className="tarefas-detalhe-rot">
          Subtarefas
        </h3>
        {contadas.length > 0 && (
          <span className="tarefas-detalhe-rot">
            {contadas.filter((s) => s.estado === "feita").length} de {contadas.length}
          </span>
        )}
      </div>
      <ul className="tarefas-detalhe-subtarefas-lista">
        {contadas.map((s) => (
          <li key={s.id} className="tarefas-detalhe-subtarefa" data-feita={s.estado === "feita" || undefined}>
            <Caixa
              marcado={s.estado === "feita"}
              aria-label={s.titulo}
              aoMudar={(feita) =>
                gravar<unknown>(() =>
                  feita
                    ? servico.pedir("tarefas.concluir", { id: s.id })
                    : servico.pedir("tarefas.reabrir", { id: s.id }),
                )
              }
            />
            <button type="button" className="tarefas-detalhe-subtarefa-titulo" onClick={() => aoAbrir(s.id)}>
              {s.titulo}
            </button>
          </li>
        ))}
      </ul>
      <div className="tarefas-detalhe-nova">
        <Icone nome="mais" tamanho={14} />
        <label htmlFor={idNova} className="so-leitor">
          Nova subtarefa
        </label>
        <input
          id={idNova}
          className="tarefas-detalhe-nova-entrada"
          placeholder="Adicionar subtarefa"
          maxLength={500}
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              criar();
            }
          }}
        />
      </div>
    </section>
  );
}

/** As etiquetas: o "x" tira, "+ Etiqueta" abre o campo; Enter põe, Esc desiste. */
function Etiquetas({ nomes, aoMudar }: { nomes: readonly string[]; aoMudar: (nomes: string[]) => void }) {
  const idCampo = useId();
  const [pondo, setPondo] = useState(false);
  const [nome, setNome] = useState("");
  const por = () => {
    const limpo = nome.trim();
    setNome("");
    setPondo(false);
    if (limpo === "" || nomes.some((n) => n.toLowerCase() === limpo.toLowerCase())) return;
    aoMudar([...nomes, limpo]);
  };
  return (
    <div className="tarefas-detalhe-etiquetas">
      <span className="tarefas-detalhe-rot">Etiquetas</span>
      {nomes.map((n) => (
        <ChipQueSai
          key={n}
          texto={n}
          rotuloTirar={`Tirar a etiqueta ${n}`}
          aoTirar={() => aoMudar(nomes.filter((x) => x !== n))}
        />
      ))}
      {pondo ? (
        <span className="tarefas-detalhe-etiqueta-nova">
          <label htmlFor={idCampo} className="so-leitor">
            Nova etiqueta
          </label>
          <input
            id={idCampo}
            className="tarefas-detalhe-nova-entrada"
            autoFocus
            maxLength={60}
            value={nome}
            placeholder="pr-142"
            onChange={(e) => setNome(e.target.value)}
            onBlur={por}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                por();
              } else if (e.key === "Escape") {
                // Desistir da etiqueta não fecha o detalhe.
                e.preventDefault();
                setNome("");
                setPondo(false);
              }
            }}
          />
        </span>
      ) : (
        nomes.length < 20 && (
          <Botao tamanho="pequeno" onClick={() => setPondo(true)}>
            + Etiqueta
          </Botao>
        )
      )}
    </div>
  );
}
