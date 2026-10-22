import type {
  CamposCaptura,
  LancamentoCaptura,
  PreviaCaptura,
  TipoCaptura,
  TipoLancavel,
} from "@moductus/contrato";
import { RecusaDoServico, ServicoIndisponivel, type EstadoConexao } from "@moductus/contrato/cliente";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { servico } from "../../servico/conexao.ts";
import {
  aplicarEdicoes,
  desfeito,
  edicoesDoTipo,
  ehLancavel,
  type CampoEditavel,
  type Contexto,
  type Edicoes,
} from "./previa.ts";

/**
 * O estado da captura rápida sobre o serviço (`captura.*`, F3-32). A janela não entende frase nem
 * decide o que dá para lançar: pede a prévia a cada pausa curta, mostra, e lança o que mostrou.
 *
 * - A prévia vem do código a cada tecla (com uma espera curta) e o modelo da Alba só é chamado
 *   depois de uma pausa longa (`comModelo`), para cada tecla não virar uma execução.
 * - Resposta de uma frase que já não está no campo é descartada.
 * - O Enter só lança o que está na tela: com a prévia atrasada, pede a nova na hora e lança só se
 *   ela disser o mesmo que a pessoa viu; se mudou, mostra a nova e espera outro Enter.
 */

/** Espera depois da última tecla para pedir a prévia do código. */
export const ESPERA_PREVIA_MS = 100;
/** Pausa na digitação depois da qual a prévia pode perguntar ao modelo da Alba. */
export const PAUSA_PARA_O_MODELO_MS = 1500;

export const MENSAGEM_SEM_SERVICO = "O Moductus está reconectando. A frase fica aqui até ele voltar.";
export const MENSAGEM_SEM_RESPOSTA = "A captura ficou sem resposta do serviço. Tente de novo.";
export const MENSAGEM_LANCAR_INCERTO =
  "A conexão caiu durante o lançamento: confira na área antes de lançar de novo.";

export interface LancamentoNaTela {
  lancamento: LancamentoCaptura;
  titulo: string;
}

export interface EstadoCaptura {
  texto: string;
  mudarTexto: (texto: string) => void;
  /** A última prévia recebida; `atual` diz se é da frase que está no campo. */
  previa: PreviaCaptura | null;
  atual: boolean;
  /** O tipo que vai ser lançado: o da prévia, ou o escolhido no "Na verdade é". */
  tipo: TipoCaptura | null;
  escolherTipo: (tipo: TipoLancavel) => void;
  edicoes: Edicoes;
  editar: (campo: CampoEditavel, texto: string) => void;
  /** Os campos que vão no lançamento: os da prévia com as correções por cima. */
  campos: CamposCaptura | null;
  errosCampos: Partial<Record<CampoEditavel, string>>;
  /** O que o serviço recusou ou não respondeu, como veio. */
  erro: string | null;
  /** O desfazer que deu certo. */
  aviso: string | null;
  lancando: boolean;
  lancamento: LancamentoNaTela | null;
  /** Enter: lança o que está na tela. Devolve se lançou. */
  lancar: () => Promise<boolean>;
  desfazer: () => Promise<void>;
  /** Esc: a próxima captura começa do zero (o desfazer em curso continua valendo). */
  limpar: () => void;
  /**
   * Uma frase de exemplo já entendida (o tour): só o entendimento local, sem o modelo, que gastaria
   * por uma frase que ninguém vai lançar. Digitar ou limpar volta ao normal.
   */
  mostrarExemplo: (texto: string) => void;
}

function mensagemDe(erro: unknown, incerto = MENSAGEM_SEM_RESPOSTA): string {
  if (erro instanceof RecusaDoServico) return erro.message;
  if (erro instanceof ServicoIndisponivel) return MENSAGEM_SEM_SERVICO;
  return incerto;
}

/** O que a pessoa viu: o tipo e os campos. Duas prévias iguais nisso lançam o mesmo. */
function mesmaPrevia(a: PreviaCaptura, b: PreviaCaptura): boolean {
  return a.tipo === b.tipo && JSON.stringify(a.campos) === JSON.stringify(b.campos);
}

export function useCaptura(canal: EstadoConexao, contexto: Contexto): EstadoCaptura {
  const [texto, setTexto] = useState("");
  const [previa, setPrevia] = useState<PreviaCaptura | null>(null);
  const [escolhido, setEscolhido] = useState<TipoLancavel | null>(null);
  const [edicoes, setEdicoes] = useState<Edicoes>({});
  // A prévia e as ações (lançar, desfazer) erram em separado: a prévia que chega depois não apaga
  // a recusa do lançamento.
  const [erroPrevia, setErroPrevia] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [lancando, setLancando] = useState(false);
  const [lancamento, setLancamento] = useState<LancamentoNaTela | null>(null);

  const textoAtual = useRef("");
  const lancandoAgora = useRef(false);
  const desfazendoAgora = useRef(false);
  const relogios = useRef<ReturnType<typeof setTimeout>[]>([]);
  const soExemplo = useRef(false);

  const pararRelogios = () => {
    for (const r of relogios.current) clearTimeout(r);
    relogios.current = [];
  };

  /** Pede a prévia da frase do campo; a resposta que chega para outra frase não vale. */
  const entender = useCallback(async (comModelo: boolean): Promise<PreviaCaptura | null> => {
    const alvo = textoAtual.current.trim();
    if (alvo === "") return null;
    try {
      const veio = await servico.pedir(
        "captura.entender",
        comModelo ? { texto: alvo, comModelo } : { texto: alvo },
      );
      if (veio.texto !== textoAtual.current.trim()) return null;
      setPrevia(veio);
      setErroPrevia(null);
      return veio;
    } catch (e) {
      if (alvo === textoAtual.current.trim()) setErroPrevia(mensagemDe(e));
      return null;
    }
  }, []);

  const agendar = useCallback(() => {
    pararRelogios();
    if (textoAtual.current.trim() === "") return;
    relogios.current = [setTimeout(() => void entender(false), ESPERA_PREVIA_MS)];
    if (!soExemplo.current) {
      relogios.current.push(setTimeout(() => void entender(true), PAUSA_PARA_O_MODELO_MS));
    }
  }, [entender]);

  const mudarTexto = useCallback(
    (novo: string) => {
      soExemplo.current = false;
      const mudouAFrase = novo.trim() !== textoAtual.current.trim();
      textoAtual.current = novo;
      setTexto(novo);
      if (!mudouAFrase) return;
      // Correção e tipo escolhido eram da frase anterior.
      setEscolhido(null);
      setEdicoes({});
      setErroPrevia(null);
      setErroAcao(null);
      setAviso(null);
      if (novo.trim() === "") {
        pararRelogios();
        setPrevia(null);
        return;
      }
      agendar();
    },
    [agendar],
  );

  // O serviço voltou: a frase que ficou no campo ganha a prévia.
  useEffect(() => {
    if (canal === "conectado" && textoAtual.current.trim() !== "") agendar();
  }, [canal, agendar]);

  useEffect(() => pararRelogios, []);

  // O desfazer some da tela quando o prazo do serviço passa.
  useEffect(() => {
    if (!lancamento) return;
    const resta = Date.parse(lancamento.lancamento.desfazerAte) - Date.now();
    const relogio = setTimeout(() => setLancamento(null), Math.max(0, resta));
    return () => clearTimeout(relogio);
  }, [lancamento]);

  const atual = previa !== null && previa.texto === texto.trim();
  const tipo: TipoCaptura | null = previa === null ? null : (escolhido ?? previa.tipo);

  const { campos, erros: errosCampos } = useMemo(() => {
    if (previa === null || tipo === null) return { campos: null, erros: {} };
    return aplicarEdicoes(previa.campos, edicoesDoTipo(tipo, previa.campos, edicoes), contexto);
  }, [previa, tipo, edicoes, contexto]);

  const lancar = useCallback(async (): Promise<boolean> => {
    // A trava vem antes de qualquer espera: dois Enter com a prévia atrasada são um lançamento só.
    if (lancandoAgora.current) return false;
    const alvo = textoAtual.current.trim();
    if (alvo === "") return false;
    lancandoAgora.current = true;
    setLancando(true);
    try {
      let mostrada = previa;
      if (mostrada === null || mostrada.texto !== alvo) {
        // A prévia na tela é de outra frase: só lança se a nova disser o mesmo.
        pararRelogios();
        const nova = await entender(false);
        if (nova === null || mostrada === null || !mesmaPrevia(mostrada, nova)) return false;
        mostrada = nova;
      }
      const vai = escolhido ?? mostrada.tipo;
      if (!ehLancavel(vai)) return false;
      const corrigidos = aplicarEdicoes(
        mostrada.campos,
        edicoesDoTipo(vai, mostrada.campos, edicoes),
        contexto,
      );
      if (Object.keys(corrigidos.erros).length > 0) return false;
      const feito = await servico.pedir("captura.lancar", {
        texto: alvo,
        tipo: vai,
        campos: corrigidos.campos,
      });
      pararRelogios();
      setLancamento({ lancamento: feito, titulo: corrigidos.campos.titulo });
      textoAtual.current = "";
      setTexto("");
      setPrevia(null);
      setEscolhido(null);
      setEdicoes({});
      setErroPrevia(null);
      setErroAcao(null);
      setAviso(null);
      return true;
    } catch (e) {
      setErroAcao(mensagemDe(e, MENSAGEM_LANCAR_INCERTO));
      return false;
    } finally {
      lancandoAgora.current = false;
      setLancando(false);
    }
  }, [previa, escolhido, edicoes, contexto, entender]);

  const desfazer = useCallback(async () => {
    // Ctrl+Z repetido ou botão e atalho juntos: um pedido só ao serviço.
    if (!lancamento || desfazendoAgora.current) return;
    const { lancamento: feito } = lancamento;
    desfazendoAgora.current = true;
    try {
      await servico.pedir("captura.desfazer", { id: feito.id });
      setLancamento(null);
      setErroAcao(null);
      setAviso(desfeito(feito.tipo));
    } catch (e) {
      // Passou do prazo ou já foi desfeito: o serviço diz por quê e o botão sai.
      if (e instanceof RecusaDoServico) setLancamento(null);
      setErroAcao(mensagemDe(e));
    } finally {
      desfazendoAgora.current = false;
    }
  }, [lancamento]);

  const editar = useCallback((campo: CampoEditavel, valor: string) => {
    setEdicoes((atuais) => ({ ...atuais, [campo]: valor }));
  }, []);

  const limpar = useCallback(() => {
    pararRelogios();
    soExemplo.current = false;
    textoAtual.current = "";
    setTexto("");
    setPrevia(null);
    setEscolhido(null);
    setEdicoes({});
    setErroPrevia(null);
    setErroAcao(null);
    setAviso(null);
  }, []);

  const mostrarExemplo = useCallback(
    (exemplo: string) => {
      limpar();
      soExemplo.current = true;
      textoAtual.current = exemplo;
      setTexto(exemplo);
      void entender(false);
    },
    [limpar, entender],
  );

  return {
    texto,
    mudarTexto,
    previa,
    atual,
    tipo,
    escolherTipo: setEscolhido,
    edicoes,
    editar,
    campos,
    errosCampos,
    erro: erroAcao ?? erroPrevia,
    aviso,
    lancando,
    lancamento,
    lancar,
    desfazer,
    limpar,
    mostrarExemplo,
  };
}
