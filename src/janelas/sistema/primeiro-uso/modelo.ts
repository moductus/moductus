import type { NovoProvedor, ProvedorDetectado, TipoProvedorCli } from "@moductus/contrato";
import type { TomSelo } from "../../../componentes/Selo.tsx";

/**
 * O passo "Modelo" do primeiro uso (Uso3Modelo.dc.html): como cada CLI achado aparece e o que vai
 * ao serviço para conectar uma chave de API. Quem decide se dá para usar é o serviço (detecção);
 * aqui só se diz isso em texto.
 */

/** Na ordem do quadro: Claude, Gemini, Codex e OpenCode. */
export const CLIS: readonly { tipo: TipoProvedorCli; nome: string }[] = [
  { tipo: "claude-cli", nome: "Claude Code" },
  { tipo: "gemini-cli", nome: "Gemini CLI" },
  { tipo: "codex-cli", nome: "Codex" },
  { tipo: "opencode-cli", nome: "OpenCode" },
];

export interface SituacaoCli {
  /** O selo: o estado nunca vai só pela cor. */
  estado: string;
  tom: TomSelo;
  texto: string;
  /** Dá para escolher e testar agora. */
  escolhivel: boolean;
}

/** Como um CLI aparece na lista, pelo que a detecção do serviço achou (ou não). */
export function situacaoDoCli(nome: string, achado: ProvedorDetectado | undefined): SituacaoCli {
  if (!achado) {
    return {
      estado: "não encontrado",
      tom: "apagado",
      texto: `Instale o ${nome} e volte aqui.`,
      escolhivel: false,
    };
  }
  const versao = achado.versao ? `CLI no PATH, versão ${achado.versao}` : "CLI no PATH";
  if (achado.impedimento === "sem_adaptador") {
    return {
      estado: "detectado",
      tom: "neutro",
      texto: `${versao} · esta versão do Moductus ainda não conecta a ele.`,
      escolhivel: false,
    };
  }
  if (achado.impedimento === "instalado_pelo_npm") {
    return {
      estado: "instalado pelo npm",
      tom: "aviso",
      texto: `${versao} · o Moductus usa o ${nome} do instalador nativo. Instale por ele e procure de novo.`,
      escolhivel: false,
    };
  }
  if (achado.versaoMinima) {
    return {
      estado: "desatualizado",
      tom: "aviso",
      texto: `${versao} · o Moductus pede a ${achado.versaoMinima} ou mais nova. Atualize e procure de novo.`,
      escolhivel: false,
    };
  }
  if (achado.logado === false) {
    return {
      estado: "sem login",
      tom: "aviso",
      texto: `${versao} · entre com a sua conta no terminal e procure de novo.`,
      escolhivel: false,
    };
  }
  if (achado.logado) {
    return {
      estado: "detectado · conectado",
      tom: "sucesso",
      texto: `${versao} · login da assinatura`,
      escolhivel: true,
    };
  }
  return { estado: "detectado", tom: "sucesso", texto: versao, escolhivel: true };
}

const SEGUNDOS = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "2,1 s": o tempo da resposta inteira, como no quadro. */
export function formatarLatencia(ms: number): string {
  return `${SEGUNDOS.format(ms / 1000)} s`;
}

export type TipoApi = "openai" | "openai-compativel";

export interface FormularioApi {
  tipo: TipoApi;
  baseUrl: string;
  modelo: string;
  chave: string;
}

export const FORMULARIO_API_VAZIO: FormularioApi = { tipo: "openai", baseUrl: "", modelo: "", chave: "" };

/**
 * O pedido de criar o provedor da chave de API. O nome é o do serviço (OpenAI) ou o host do
 * endereço, nunca o endereço inteiro, que pode levar mais do que devia. Campo vazio não vai.
 */
export function novoDaApi(formulario: FormularioApi): NovoProvedor {
  const modelo = formulario.modelo.trim();
  const chave = formulario.chave.trim();
  if (formulario.tipo === "openai") {
    return { tipo: "openai", nome: "OpenAI", ...(modelo ? { modelo } : {}), ...(chave ? { chave } : {}) };
  }
  const baseUrl = formulario.baseUrl.trim();
  return {
    tipo: "openai-compativel",
    nome: hostDe(baseUrl) ?? "Compatível com OpenAI",
    baseUrl,
    ...(modelo ? { modelo } : {}),
    ...(chave ? { chave } : {}),
  };
}

/** O que o usuário escolheu: um dos CLIs ou a chave de API. */
export type EscolhaModelo = TipoProvedorCli | "api";

export type ResultadoModelo =
  | { fase: "parado" }
  | { fase: "testando"; nome: string }
  | { fase: "ok"; nome: string; latenciaMs: number; assinatura: boolean }
  | { fase: "falhou"; nome: string; mensagem: string };

/**
 * O passo inteiro, guardado fora dele: voltar um passo e seguir de novo não perde o teste feito.
 * `criadosAqui`: os provedores que este passo criou e ainda valem (o que passou e os que falharam
 * depois dele). Nunca leva um que já existia antes do passo.
 */
export interface EstadoModelo {
  escolha: EscolhaModelo | null;
  formulario: FormularioApi;
  criadosAqui: readonly string[];
  resultado: ResultadoModelo;
}

export const MODELO_INICIAL: EstadoModelo = {
  escolha: null,
  formulario: FORMULARIO_API_VAZIO,
  criadosAqui: [],
  resultado: { fase: "parado" },
};

/**
 * O que o teste leva e como o passo fica depois dele. O time fica com um modelo só porque o teste
 * pede ao serviço para o testado substituir os outros que este passo criou; o serviço só tira os
 * antigos se o novo passar, e ignora o que já não existe. Depois de passar, sobra só o testado
 * (se foi criado aqui); depois de falhar, ele entra na lista para sair no próximo que passar.
 */
export function substituicao(criadosAqui: readonly string[], alvo: string): string[] {
  return criadosAqui.filter((id) => id !== alvo);
}

export function criadosDepois(
  criadosAqui: readonly string[],
  alvo: string,
  criadoAgora: boolean,
  passou: boolean,
): string[] {
  const doPasso = criadoAgora || criadosAqui.includes(alvo);
  if (passou) return doPasso ? [alvo] : [];
  return doPasso && !criadosAqui.includes(alvo) ? [...criadosAqui, alvo] : [...criadosAqui];
}

function hostDe(endereco: string): string | null {
  try {
    return new URL(endereco).host || null;
  } catch {
    return null;
  }
}
