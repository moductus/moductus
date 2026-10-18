import type { LancamentoCaptura, Lista, PreviaCaptura } from "@moductus/contrato";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Atalho } from "../../componentes/Atalho.tsx";
import { Botao } from "../../componentes/Botao.tsx";
import { Icone } from "../../componentes/Icone.tsx";
import { Selo } from "../../componentes/Selo.tsx";
import { servico } from "../../servico/conexao.ts";
import {
  lancamentoDaPrevia,
  mensagemDaRecusa,
  pedacosDoEntendi,
  textoDoCriado,
  type ContextoDaFrase,
} from "./tarefas.ts";

/** Quanto a digitação para antes de pedir a prévia do código, que é instantânea. */
export const ESPERA_PREVIA_MS = 200;
/**
 * A pausa longa (PRODUCT.md §3; F3-32): só depois dela a frase que o código não entendeu vai ao
 * modelo da Alba, para cada tecla não virar uma execução.
 */
export const PAUSA_MODELO_MS = 1500;

interface Criado {
  lancamento: LancamentoCaptura;
  texto: string;
}

interface PropsCampoFrase {
  listas: readonly Lista[];
  contexto: ContextoDaFrase;
}

/**
 * O campo em linguagem natural do alto das Tarefas (AreaTarefas.dc.html): a frase, o "Entendi:"
 * do que ela vai virar antes do Enter, e o desfazer por 10 s depois de lançar. Quem entende e quem
 * cria é a captura do serviço (`captura.entender`, `captura.lancar`), a mesma da janela flutuante.
 * Esc limpa a frase.
 */
export function CampoFrase({ listas, contexto }: PropsCampoFrase) {
  const id = useId();
  const [texto, setTexto] = useState("");
  const [previa, setPrevia] = useState<PreviaCaptura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criado, setCriado] = useState<Criado | null>(null);
  // A resposta que chega depois de outra frase já não vale: só a do último pedido entra.
  const ultimo = useRef(0);
  const lancando = useRef(false);

  const frase = texto.trim();
  const atual = previa && frase !== "" ? previa : null;

  useEffect(() => {
    const pedido = ++ultimo.current;
    if (frase === "") return;
    const entender = (comModelo: boolean) =>
      servico
        .pedir("captura.entender", comModelo ? { texto: frase, comModelo } : { texto: frase })
        .then((p) => {
          if (pedido === ultimo.current) setPrevia(p);
          return p;
        })
        .catch(() => null);
    let modelo: ReturnType<typeof setTimeout> | undefined;
    const codigo = setTimeout(() => {
      void entender(false).then((p) => {
        // Só a frase em que o código não achou nada além do título vale a pergunta ao modelo.
        if (!p || p.trechos.length > 0 || pedido !== ultimo.current) return;
        modelo = setTimeout(() => void entender(true), PAUSA_MODELO_MS - ESPERA_PREVIA_MS);
      });
    }, ESPERA_PREVIA_MS);
    return () => {
      clearTimeout(codigo);
      clearTimeout(modelo);
    };
  }, [frase]);

  // O desfazer some quando o prazo do serviço passa.
  useEffect(() => {
    if (!criado) return;
    const resta = Date.parse(criado.lancamento.desfazerAte) - Date.now();
    const relogio = setTimeout(() => setCriado(null), Math.max(0, resta));
    return () => clearTimeout(relogio);
  }, [criado]);

  const lancar = async () => {
    if (frase === "" || lancando.current) return;
    lancando.current = true;
    setErro(null);
    try {
      // Enter antes da prévia chegar: entende agora e lança o que entendeu.
      const base = atual?.texto === frase ? atual : await servico.pedir("captura.entender", { texto: frase });
      const { tipo, campos } = lancamentoDaPrevia(base, contexto);
      const lancamento = await servico.pedir("captura.lancar", { texto: frase, tipo, campos });
      ultimo.current++;
      setTexto("");
      setPrevia(null);
      setCriado({ lancamento, texto: textoDoCriado(tipo, campos.titulo) });
    } catch (e) {
      setErro(mensagemDaRecusa(e));
    } finally {
      lancando.current = false;
    }
  };

  const desfazer = async (lancamento: LancamentoCaptura) => {
    try {
      await servico.pedir("captura.desfazer", { id: lancamento.id });
      setCriado(null);
    } catch (e) {
      setCriado(null);
      setErro(mensagemDaRecusa(e));
    }
  };

  const aoTeclar = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void lancar();
    } else if (e.key === "Escape" && texto !== "") {
      e.preventDefault();
      setTexto("");
      setPrevia(null);
      setErro(null);
    }
  };

  const lancamento = atual ? lancamentoDaPrevia(atual, contexto) : null;
  const idEntendi = `${id}-entendi`;
  return (
    <div className="tarefas-frase">
      <label htmlFor={id} className="so-leitor">
        Nova tarefa
      </label>
      <div className="tarefas-frase-caixa">
        <Icone nome="mais" tamanho={14} />
        <input
          id={id}
          className="tarefas-frase-entrada"
          value={texto}
          placeholder="ligar pro banco amanhã 15h"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={lancamento ? idEntendi : undefined}
          onChange={(e) => {
            setTexto(e.target.value);
            setErro(null);
            // A frase apagada leva a prévia junto: a próxima não começa com a velha na tela.
            if (e.target.value.trim() === "") setPrevia(null);
          }}
          onKeyDown={aoTeclar}
        />
        <Atalho teclas="Enter" />
      </div>
      {lancamento && (
        <div id={idEntendi} className="tarefas-entendi">
          <span>Entendi:</span>
          {pedacosDoEntendi(lancamento, listas).map((pedaco, i) => (
            <Selo key={i}>{pedaco}</Selo>
          ))}
          {atual?.aviso && <span className="tarefas-entendi-aviso">{atual.aviso}</span>}
        </div>
      )}
      {erro && (
        <p className="tarefas-frase-erro" role="alert">
          {erro}
        </p>
      )}
      {criado && (
        <p className="tarefas-frase-criado" role="status">
          <span>{criado.texto}</span>
          <Botao variante="fantasma" tamanho="pequeno" onClick={() => void desfazer(criado.lancamento)}>
            Desfazer
          </Botao>
        </p>
      )}
    </div>
  );
}
