import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { Icone } from "../../componentes/Icone.tsx";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { haQuanto } from "../tempo.ts";
import { mensagemDaRecusa } from "./tarefas.ts";
import { origemDoItem, type Opcao } from "./detalhe.ts";
import "./Detalhe.css";

/**
 * As peças que o detalhe da tarefa e o do evento repetem (DetalheTarefa.dc.html,
 * DetalheEvento.dc.html): a coluna com o alto e o fechar, os campos que gravam ao sair, a lista
 * suspensa, o chip que sai, a origem e o rodapé com o apagar e o "salvo agora".
 */

interface PropsPainel {
  /** Nome da região para o leitor de tela ("Detalhe da tarefa"). */
  rotulo: string;
  /** O que vai no alto, à esquerda ("Trabalho · tarefa"). */
  alto: ReactNode;
  /** Botões do alto, antes do fechar ("Começar foco"). */
  acoes?: ReactNode;
  aoFechar: () => void;
  children: ReactNode;
}

/**
 * A coluna do detalhe. `Esc` fecha de qualquer ponto dela: antes, o campo em edição perde o foco e
 * grava o que tinha (os campos gravam ao sair).
 */
export function PainelDetalhe({ rotulo, alto, acoes, aoFechar, children }: PropsPainel) {
  const aoTeclar = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    const ativo = document.activeElement;
    if (ativo instanceof HTMLElement && e.currentTarget.contains(ativo)) ativo.blur();
    aoFechar();
  };
  return (
    <aside className="tarefas-detalhe" aria-label={rotulo} onKeyDown={aoTeclar}>
      <div className="tarefas-detalhe-alto">
        <span className="tarefas-detalhe-rotulo">{alto}</span>
        {acoes}
        <Botao
          variante="fantasma"
          tamanho="pequeno"
          icone="fechar"
          aria-label="Fechar o detalhe"
          aria-keyshortcuts="Escape"
          onClick={aoFechar}
        />
      </div>
      {children}
    </aside>
  );
}

interface PropsEntrada {
  rotulo: string;
  /** O rótulo só para o leitor de tela (o título, que já se explica). */
  rotuloOculto?: boolean;
  tipo?: "text" | "date" | "time";
  /** O valor gravado; mudar por fora troca o que está no campo. */
  valor: string;
  /** Saiu do campo (ou Enter) com outro valor. */
  aoGravar: (valor: string) => void;
  className?: string;
  placeholder?: string;
  desativada?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  /** Vazio não vale (o título): sair com o campo vazio o devolve ao que era. */
  obrigatoria?: boolean;
}

/**
 * O valor gravado escrito no campo quando ele muda por fora (a resposta do serviço, o fim que o
 * começo levou), sempre no mesmo elemento: o foco e o Esc continuam onde estavam. No campo em que
 * você está e já digitou, o que você digitou fica; ao sair, ele é comparado com o valor novo. O
 * campo focado em que nada foi digitado (o fim, logo depois do Tab) recebe o valor novo.
 */
function useValorNoCampo<T extends HTMLInputElement | HTMLTextAreaElement>(valor: string) {
  const campo = useRef<T>(null);
  const anterior = useRef(valor);
  useEffect(() => {
    const el = campo.current;
    const digitou = el === document.activeElement && el?.value !== anterior.current;
    anterior.current = valor;
    if (el && !digitou && el.value !== valor) el.value = valor;
  }, [valor]);
  return campo;
}

/**
 * Campo que grava ao sair (ou no Enter, que sai do campo): enquanto você digita, nada vai ao
 * serviço. O que o navegador não consegue ler (a data pela metade) volta ao valor gravado.
 */
export function Entrada({
  rotulo,
  rotuloOculto,
  tipo = "text",
  valor,
  aoGravar,
  className,
  placeholder,
  desativada,
  autoFocus,
  maxLength,
  obrigatoria,
}: PropsEntrada) {
  const id = useId();
  const campo = useValorNoCampo<HTMLInputElement>(valor);
  // O detalhe abre no título, pronto para editar; só ao montar (a ref não muda).
  const focoInicial = useRef(autoFocus);
  useEffect(() => {
    if (focoInicial.current) campo.current?.focus();
  }, [campo]);
  const aoSair = (e: FocusEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    // Data ou hora pela metade: o navegador dá vazio, que não é "tirar a data".
    if (el.validity.badInput || (obrigatoria && el.value.trim() === "")) {
      el.value = valor;
      return;
    }
    if (el.value !== valor) aoGravar(el.value);
  };
  return (
    <div className={["tarefas-detalhe-campo", className].filter(Boolean).join(" ")}>
      <label htmlFor={id} className={rotuloOculto ? "so-leitor" : "tarefas-detalhe-rot"}>
        {rotulo}
      </label>
      <input
        ref={campo}
        id={id}
        type={tipo}
        className="tarefas-detalhe-entrada"
        data-tipo={tipo}
        defaultValue={valor}
        placeholder={placeholder}
        disabled={desativada}
        maxLength={maxLength}
        onBlur={aoSair}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

/** O texto longo (notas, descrição): Enter é linha nova; grava ao sair. */
export function AreaDeTexto({
  rotulo,
  valor,
  aoGravar,
  maxLength,
}: {
  rotulo: string;
  valor: string;
  aoGravar: (valor: string) => void;
  maxLength?: number;
}) {
  const id = useId();
  const campo = useValorNoCampo<HTMLTextAreaElement>(valor);
  return (
    <div className="tarefas-detalhe-campo">
      <label htmlFor={id} className="tarefas-detalhe-rot">
        {rotulo}
      </label>
      <textarea
        ref={campo}
        id={id}
        rows={2}
        className="tarefas-detalhe-texto"
        defaultValue={valor}
        maxLength={maxLength}
        onBlur={(e) => {
          if (e.currentTarget.value !== valor) aoGravar(e.currentTarget.value);
        }}
      />
    </div>
  );
}

/** Lista suspensa nativa (teclado e Esc do Windows) com a seta do campo, como o "Onde" das Notificações. */
export function ListaSuspensa({
  rotulo,
  valor,
  opcoes,
  aoMudar,
  desativada,
}: {
  rotulo: string;
  valor: string;
  opcoes: readonly Opcao[];
  aoMudar: (valor: string) => void;
  desativada?: boolean;
}) {
  const id = useId();
  return (
    <div className="tarefas-detalhe-campo">
      <label htmlFor={id} className="tarefas-detalhe-rot">
        {rotulo}
      </label>
      <span className="tarefas-detalhe-lista" data-desativada={desativada || undefined}>
        <select id={id} value={valor} disabled={desativada} onChange={(e) => aoMudar(e.target.value)}>
          {opcoes.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
        <Icone nome="abrirLista" tamanho={12} />
      </span>
    </div>
  );
}

/** Um chip com o "x" que o tira (alerta, etiqueta). */
export function ChipQueSai({
  texto,
  rotuloTirar,
  aoTirar,
}: {
  texto: string;
  rotuloTirar: string;
  aoTirar: () => void;
}) {
  return (
    <span className="tarefas-detalhe-chip">
      {texto}
      <button type="button" className="tarefas-detalhe-chip-tirar" aria-label={rotuloTirar} onClick={aoTirar}>
        <Icone nome="fechar" tamanho={12} />
      </button>
    </span>
  );
}

/** "Criada pela Alba · ontem, 18:12", com a cabeça de quem fez. */
export function LinhaOrigem({
  item,
  genero,
  fuso,
  agora,
}: {
  item: Parameters<typeof origemDoItem>[0];
  genero: "a" | "o";
  fuso: string | null;
  agora: Date;
}) {
  const { agente, quem, quando } = origemDoItem(item, genero, fuso, agora);
  return (
    <p className="tarefas-detalhe-origem">
      {agente && <Personagem agente={agente} modo="cabeca" tamanho="detalhe" estado="ocioso" />}
      <span className="tarefas-detalhe-origem-quem" data-agente={agente ?? undefined}>
        {quem}
      </span>
      <span className="tarefas-detalhe-rot">· {quando}</span>
    </p>
  );
}

// ---------- Gravar ----------

/** O que o rodapé diz: gravando, a recusa, ou desde quando está salvo. */
export interface Gravacao {
  /** Manda um pedido e acompanha: a resposta vai a `aoVoltar`, a recusa fica na tela. */
  gravar: <T>(pedido: () => Promise<T>, aoVoltar?: (resposta: T) => void) => void;
  gravando: boolean;
  erro: string | null;
}

export function useGravacao(): Gravacao {
  const [emVoo, setEmVoo] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const gravar = <T,>(pedido: () => Promise<T>, aoVoltar?: (resposta: T) => void) => {
    setErro(null);
    setEmVoo((n) => n + 1);
    pedido()
      .then((resposta) => aoVoltar?.(resposta))
      .catch((e: unknown) => setErro(mensagemDaRecusa(e)))
      .finally(() => setEmVoo((n) => n - 1));
  };
  return { gravar, gravando: emVoo > 0, erro };
}

/** O fim da coluna: apagar (para a Lixeira), o que acontece com isso e o "salvo agora". */
export function RodapeDetalhe({
  apagar,
  nota,
  gravacao,
  atualizadoEm,
  agora,
}: {
  apagar: { texto: string; aoApagar: () => void };
  nota: string;
  gravacao: Gravacao;
  atualizadoEm: string;
  agora: Date;
}) {
  return (
    <>
      {gravacao.erro && (
        <p className="tarefas-erro" role="alert">
          {gravacao.erro}
        </p>
      )}
      <div className="tarefas-detalhe-rodape">
        <Botao
          variante="fantasma"
          tamanho="pequeno"
          className="tarefas-detalhe-apagar"
          onClick={apagar.aoApagar}
        >
          {apagar.texto}
        </Botao>
        <span className="tarefas-detalhe-rot">{nota}</span>
        <span className="tarefas-detalhe-salvo" role="status">
          {gravacao.gravando ? "salvando…" : `salvo ${haQuanto(atualizadoEm, agora)}`}
        </span>
      </div>
    </>
  );
}
