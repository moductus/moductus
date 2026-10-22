import type { Lista, PreviaCaptura, Tarefa, TipoCaptura, TipoLancavel } from "@moductus/contrato";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Atalho } from "../../componentes/Atalho.tsx";
import { Botao } from "../../componentes/Botao.tsx";
import { Caixa } from "../../componentes/Caixa.tsx";
import { Icone } from "../../componentes/Icone.tsx";
import { Selo } from "../../componentes/Selo.tsx";
import { servico } from "../../servico/conexao.ts";
import { chipsDaPrevia, NOME_DO_TIPO, notaDaTarefa, prioridadeDa, quandoDaTarefa } from "./tarefas.ts";
import "./Dia.css";

/*
 * Peças comuns aos painéis Hoje e Tarefas (Main.dc.html, LembreteHoje.dc.html,
 * PainelTarefas.dc.html): a linha de tarefa com a caixa, o campo que entende uma frase e a linha
 * de "feita. Desfazer". A regra de cada ação mora no serviço; aqui só se pede e se mostra.
 */

/** Quanto tempo o "Desfazer" de uma tarefa marcada fica na tela, o mesmo da captura (ADR-0034). */
export const DESFAZER_MS = 10_000;

/** A `key` da linha de Desfazer: um aviso novo é outra linha. */
export const chaveDoAviso = (aviso: AvisoDesfazer) => `${aviso.ate}|${aviso.texto}`;

/**
 * A pausa na digitação depois da qual a prévia pode perguntar ao modelo da Alba: tecla a tecla, só
 * o entendedor de frases do serviço, que não gasta nada (ADR-0034).
 */
export const PAUSA_PARA_O_MODELO_MS = 1500;

/** O que pode ser desfeito agora: o texto da linha e o pedido que desfaz. */
export interface AvisoDesfazer {
  texto: string;
  desfazer: () => Promise<unknown>;
  /** Até quando, em ms desde a época; depois disso a linha some. */
  ate: number;
}

/** A linha de "Desfazer" da última ação, que some sozinha no prazo. */
export function useAvisoDesfazer() {
  const [aviso, setAviso] = useState<AvisoDesfazer | null>(null);
  useEffect(() => {
    if (!aviso) return;
    const prazo = setTimeout(() => setAviso(null), Math.max(0, aviso.ate - Date.now()));
    return () => clearTimeout(prazo);
  }, [aviso]);
  return [aviso, setAviso] as const;
}

/**
 * "Regar as plantas: feita." com o Desfazer ao lado (PainelTarefas.dc.html). Quem usa dá a `key`
 * do aviso, para o erro de um não ficar no seguinte.
 */
export function LinhaDesfazer({ aviso, aoAcabar }: { aviso: AvisoDesfazer; aoAcabar: () => void }) {
  const [erro, setErro] = useState<string | null>(null);
  const [desfazendo, setDesfazendo] = useState(false);
  const desfazer = () => {
    setDesfazendo(true);
    aviso
      .desfazer()
      .then(aoAcabar)
      .catch(() => setErro("Não consegui desfazer agora."))
      .finally(() => setDesfazendo(false));
  };
  return (
    <div className="dia-desfazer" role="status">
      <span className="dia-desfazer-texto">{erro ?? aviso.texto}</span>
      <button type="button" className="dia-link" onClick={desfazer} disabled={desfazendo}>
        Desfazer
      </button>
    </div>
  );
}

interface PropsLinhaTarefa {
  tarefa: Tarefa;
  listas: readonly Lista[] | null;
  hoje: string;
  /** Minutos desde a meia-noite, no fuso: a aberta de hoje cuja hora passou fica em aviso. */
  minutoAgora: number;
  aoMarcar: (tarefa: Tarefa, feita: boolean) => void;
}

/**
 * Uma tarefa (PainelTarefas.dc.html): a caixa, a prioridade na barrinha, o título com a linha de
 * baixo, o sino quando tem lembrete e a hora (ou o dia, na atrasada). A feita fica apagada e
 * riscada.
 */
export function LinhaTarefa({ tarefa, listas, hoje, minutoAgora, aoMarcar }: PropsLinhaTarefa) {
  const feita = tarefa.estado === "feita";
  const prioridade = prioridadeDa(tarefa);
  const nota = notaDaTarefa(tarefa, listas);
  const quando = quandoDaTarefa(tarefa, hoje, minutoAgora);
  return (
    <li className="tarefa-linha" data-feita={feita || undefined}>
      <Caixa marcado={feita} aoMudar={(marcada) => aoMarcar(tarefa, marcada)} aria-label={tarefa.titulo} />
      <span className="tarefa-prioridade" data-tom={prioridade?.tom} aria-hidden="true" />
      <span className="tarefa-corpo">
        <span className="tarefa-titulo" title={tarefa.titulo}>
          {tarefa.titulo}
        </span>
        {prioridade && <span className="so-leitor">{`, ${prioridade.texto}`}</span>}
        {nota && <span className="tarefa-nota">{nota}</span>}
      </span>
      {tarefa.lembreteMinutosAntes !== null && tarefa.hora !== null && (
        <span className="tarefa-sino">
          <Icone nome="sino" tamanho={12} rotulo="com lembrete" />
        </span>
      )}
      <span className="tarefa-quando" data-aviso={quando.aviso || undefined}>
        {quando.texto}
        {quando.aviso && <span className="so-leitor"> (passou da hora)</span>}
      </span>
    </li>
  );
}

/**
 * Marca ou desmarca pelo serviço. Marcada, devolve o aviso com o Desfazer (que reabre); a falha
 * vira a mensagem de erro do painel, sem o texto cru do serviço.
 */
export function marcarTarefa(
  tarefa: Tarefa,
  feita: boolean,
  avisar: (aviso: AvisoDesfazer) => void,
  falhar: (erro: string) => void,
) {
  if (!feita) {
    servico
      .pedir("tarefas.reabrir", { id: tarefa.id })
      .catch(() => falhar("Não consegui reabrir a tarefa agora."));
    return;
  }
  servico
    .pedir("tarefas.concluir", { id: tarefa.id })
    .then(() =>
      avisar({
        texto: `${tarefa.titulo}: feita.`,
        desfazer: () => servico.pedir("tarefas.reabrir", { id: tarefa.id }),
        ate: Date.now() + DESFAZER_MS,
      }),
    )
    .catch(() => falhar("Não consegui marcar a tarefa agora. Tente de novo."));
}

const LANCAVEIS: ReadonlySet<TipoCaptura> = new Set<TipoLancavel>(["tarefa", "lembrete", "evento", "nota"]);
const ehLancavel = (tipo: TipoCaptura): tipo is TipoLancavel => LANCAVEIS.has(tipo);

/** Como o lançado aparece na linha do Desfazer. */
const CRIADO: Readonly<Record<TipoLancavel, string>> = {
  tarefa: "criada",
  nota: "criada",
  lembrete: "criado",
  evento: "criado",
};

interface PropsCampoFrase {
  rotulo: string;
  /** No painel Tarefas o rótulo aparece ("Adicionar por frase"); no Hoje fica só para o leitor. */
  rotuloVisivel?: boolean;
  placeholder?: string;
  /** O "+" à esquerda, como no PainelTarefas.dc.html. */
  comIcone?: boolean;
  aoLancar: (aviso: AvisoDesfazer) => void;
}

/**
 * O campo que entende uma frase ("ligar pro banco amanhã 15h"): a cada mudança o serviço devolve a
 * prévia ("Entendi: tarefa · sex, 9 out · 15:00"), e o Enter lança o que a prévia mostrou, nunca
 * antes dela. O modelo da Alba só é chamado depois de uma pausa na digitação; resposta de uma frase
 * que já mudou é descartada. Digitar pede o teclado à casca, porque o painel não ativa sozinho.
 */
export function CampoFrase({
  rotulo,
  rotuloVisivel = false,
  placeholder,
  comIcone = false,
  aoLancar,
}: PropsCampoFrase) {
  const id = useId();
  const idPrevia = useId();
  const [texto, setTexto] = useState("");
  // A prévia guarda a frase de que ela fala: Enter só lança se for a mesma que está no campo.
  const [entendida, setEntendida] = useState<{ frase: string; previa: PreviaCaptura } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lancando, setLancando] = useState(false);
  const ultimo = useRef(0);

  useEffect(() => {
    const frase = texto.trim();
    // Campo vazio: a resposta que ainda vem não vale mais (e a prévia guardada não casa com "").
    if (frase === "") {
      ultimo.current++;
      return;
    }
    const entender = (comModelo: boolean) => {
      const pedido = ++ultimo.current;
      servico
        .pedir("captura.entender", comModelo ? { texto: frase, comModelo } : { texto: frase })
        .then((previa) => {
          if (ultimo.current === pedido) setEntendida({ frase, previa });
        })
        .catch(() => {
          if (ultimo.current === pedido) setEntendida(null);
        });
    };
    entender(false);
    const pausa = setTimeout(() => entender(true), PAUSA_PARA_O_MODELO_MS);
    return () => clearTimeout(pausa);
  }, [texto]);

  const atual = entendida && entendida.frase === texto.trim() ? entendida : null;

  const lancar = (tipo: TipoLancavel) => {
    if (!atual || lancando) return;
    const { frase, previa } = atual;
    setLancando(true);
    setErro(null);
    servico
      .pedir("captura.lancar", { texto: frase, tipo, campos: previa.campos })
      .then((lancamento) => {
        // A prévia do que foi lançado sai junto: a mesma frase escrita de novo espera a prévia nova.
        setTexto("");
        setEntendida(null);
        aoLancar({
          texto: `${previa.campos.titulo}: ${CRIADO[tipo]}.`,
          desfazer: () => servico.pedir("captura.desfazer", { id: lancamento.id }),
          ate: Date.parse(lancamento.desfazerAte),
        });
      })
      .catch(() => setErro("Não consegui lançar agora. Tente de novo."))
      .finally(() => setLancando(false));
  };

  const aoTeclar = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (atual && ehLancavel(atual.previa.tipo)) lancar(atual.previa.tipo);
  };

  const pedirTeclado = () => void invoke("painel_foco", { quer: true });
  const previa = atual?.previa ?? null;
  return (
    <div className="campo frase">
      <label htmlFor={id} className={rotuloVisivel ? "frase-rotulo" : "so-leitor"}>
        {rotulo}
      </label>
      <div className="campo-caixa frase-caixa">
        {comIcone && <Icone nome="mais" tamanho={14} />}
        <input
          id={id}
          className="campo-entrada"
          value={texto}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={previa ? idPrevia : undefined}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={aoTeclar}
          onPointerDown={pedirTeclado}
          onFocus={pedirTeclado}
          onBlur={() => void invoke("painel_foco", { quer: false })}
        />
        <Atalho teclas="Enter" />
      </div>
      {previa && (
        <div id={idPrevia} className="frase-previa">
          <span>Entendi:</span>
          {chipsDaPrevia(previa).map((chip, i) => (
            <Selo key={i}>{chip}</Selo>
          ))}
        </div>
      )}
      {previa?.aviso && (
        <div className="frase-aviso">
          <p>{previa.aviso}</p>
          {previa.alternativas.map((tipo) => (
            <Botao key={tipo} tamanho="pequeno" onClick={() => lancar(tipo)} disabled={lancando}>
              {`Lançar como ${NOME_DO_TIPO[tipo]}`}
            </Botao>
          ))}
        </div>
      )}
      {erro && (
        <p className="dia-erro" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
