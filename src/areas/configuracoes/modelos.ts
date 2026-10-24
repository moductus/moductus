import {
  TIPOS_PROVEDOR_CLI,
  type Agente,
  type Execucao,
  type FalhaProvedor,
  type MoedaTeto,
  type MudancaAgente,
  type MudancaProvedor,
  type Provedor,
  type ProvedorDetectado,
} from "@moductus/contrato";
import type { TomSelo } from "../../componentes/Selo.tsx";
import {
  comandoDoCli,
  eFalhaDoProvedor,
  type FalhaDoProvedor,
} from "../../componentes/personagem/situacao.ts";
import { formatarHora } from "../../componentes/personagem/quando.ts";
import { formatarLatencia } from "../../janelas/sistema/primeiro-uso/modelo.ts";
import { haQuanto } from "../tempo.ts";

/**
 * Configurações › Modelos (ConfigModelos.dc.html): como cada provedor aparece, o estado dele e a
 * troca de modelo de um agente. Quem decide se o provedor funciona é o teste do serviço; quem
 * grava a troca é `agentes.definir`. Aqui só se diz em texto e se monta o pedido.
 */

/** O teste que o usuário pediu nesta tela: rodando, ou o que voltou dele. */
export type TesteProvedor =
  | { fase: "testando" }
  /** `ferramentas: false`: o modelo respondeu, mas não chamou a ferramenta do teste. */
  | { fase: "ok"; latenciaMs: number; testadoEm: string; ferramentas?: boolean | null }
  | { fase: "falhou"; falha: FalhaProvedor; testadoEm: string };

/** O aviso de um modelo que passou no teste sem chamar a ferramenta. */
export const AVISO_SEM_FERRAMENTAS =
  "O modelo respondeu, mas não chamou a ferramenta do teste. Com ele, os agentes só conversam: não consultam nem fazem nada. Escolha um modelo com suporte a ferramentas (function calling).";

/** O mesmo aviso, curto, para um modelo que o endereço diz não ter ferramentas. */
export const AVISO_MODELO_SEM_FERRAMENTAS =
  "O endereço diz que este modelo não usa ferramentas (function calling): com ele, os agentes só conversam.";

/** Uma linha da tabela de provedores: o selo do estado, a resposta e o erro, quando há. */
export interface EstadoProvedor {
  /** O selo: o estado nunca vai só pela cor. */
  texto: string;
  tom: TomSelo;
  /** "2,1 s", ou "—" sem número medido nesta tela. */
  resposta: string;
  /** "testado há 3 min", "falhou às 14:02"; `null` quando não há o que dizer. */
  quando: string | null;
  /** O que deu errado, dito ao usuário (a mensagem do serviço). */
  erro: string | null;
  /** O comando para rodar no terminal (o login do CLI), mostrado como código depois do erro. */
  comando?: string;
  /** Funciona, mas com um porém que o usuário precisa saber (o modelo só conversa). */
  aviso?: string;
}

const ehCli = (tipo: Provedor["tipo"]) => (TIPOS_PROVEDOR_CLI as readonly string[]).includes(tipo);

/**
 * Provedor de API com chave guardada, ou a OpenAI (que sempre pede uma): o usuário troca a chave
 * por aqui. CLI usa o login dele; modelo local sem chave não tem o que trocar.
 */
export const temChaveTrocavel = (provedor: Provedor) =>
  !ehCli(provedor.tipo) && (provedor.temChave || provedor.tipo === "openai");

/**
 * O que a falha diz ao usuário quando o agente dorme por ela e a tela não testou nada. Credencial
 * num CLI é login, não chave (o CLI roda com a conta do usuário): diz o comando para entrar.
 */
function falhaDoAgente(
  motivo: FalhaDoProvedor,
  provedor: Provedor,
): Pick<EstadoProvedor, "erro" | "comando"> {
  switch (motivo) {
    case "fora_do_ar":
      return { erro: `O ${provedor.nome} não respondeu na última execução. Teste de novo para conferir.` };
    case "ausente":
      return { erro: `O ${provedor.nome} não foi encontrado na última execução. Instale de novo e teste.` };
    case "credencial": {
      const comando = comandoDoCli(provedor);
      if (comando) {
        return {
          erro: `O ${provedor.nome} está sem login. Entre no terminal com o comando abaixo e teste de novo.`,
          comando,
        };
      }
      return { erro: "A chave foi recusada na última execução. Troque a chave e teste de novo." };
    }
  }
}

/**
 * O estado de um provedor na tabela, do mais novo para o mais velho: o teste desta tela (rodando,
 * passou ou falhou), um agente que dorme porque este principal falhou, o último teste que passou
 * (gravado pelo serviço) ou "não testado". Latência só aparece quando foi medida aqui: o serviço
 * não guarda o número, e ele não é inventado.
 */
export function estadoDoProvedor(
  provedor: Provedor,
  teste: TesteProvedor | undefined,
  agentes: readonly Agente[],
  agora: Date,
): EstadoProvedor {
  if (teste?.fase === "testando") {
    return { texto: "testando", tom: "neutro", resposta: "…", quando: "esperando a resposta", erro: null };
  }
  if (teste?.fase === "falhou") {
    return {
      texto: "erro",
      tom: "perigo",
      resposta: "—",
      quando: `falhou às ${formatarHora(new Date(teste.testadoEm))}`,
      erro: teste.falha.mensagem,
    };
  }
  if (teste?.fase === "ok") {
    const soConversa = teste.ferramentas === false;
    return {
      texto: soConversa ? "só conversa" : "funcionando",
      tom: soConversa ? "aviso" : "sucesso",
      resposta: formatarLatencia(teste.latenciaMs),
      quando: `testado ${haQuanto(teste.testadoEm, agora)}`,
      erro: null,
      ...(soConversa ? { aviso: AVISO_SEM_FERRAMENTAS } : {}),
    };
  }
  const caiu = agentes.find(
    (a) =>
      a.provedorId === provedor.id &&
      a.situacao.estado === "dormindo" &&
      eFalhaDoProvedor(a.situacao.motivoSono),
  );
  const motivo = caiu?.situacao.motivoSono ?? null;
  if (eFalhaDoProvedor(motivo)) {
    return { texto: "erro", tom: "perigo", resposta: "—", quando: null, ...falhaDoAgente(motivo, provedor) };
  }
  if (provedor.testadoEm) {
    return {
      texto: "funcionando",
      tom: "sucesso",
      resposta: "—",
      quando: `testado ${haQuanto(provedor.testadoEm, agora)}`,
      erro: null,
    };
  }
  return { texto: "não testado", tom: "apagado", resposta: "—", quando: null, erro: null };
}

/** O host de um endereço, nunca o endereço inteiro (pode levar mais do que devia). */
function hostDe(endereco: string | null): string | null {
  if (!endereco) return null;
  try {
    return new URL(endereco).host || null;
  } catch {
    return null;
  }
}

/**
 * A linha de baixo do nome: "CLI · sua assinatura · versão 2.4", "Compatível com OpenAI ·
 * 127.0.0.1:11434 · llama3.1:8b", "OpenAI · gpt-5-mini · chave no Gerenciador de Credenciais".
 */
export function descreverProvedor(provedor: Provedor, detectado?: ProvedorDetectado): string {
  if (ehCli(provedor.tipo)) {
    const partes = ["CLI", "sua assinatura"];
    if (detectado?.versao) partes.push(`versão ${detectado.versao}`);
    return partes.join(" · ");
  }
  const partes = [provedor.tipo === "openai" ? "OpenAI" : "Compatível com OpenAI"];
  const host = hostDe(provedor.baseUrl);
  if (host) partes.push(host);
  if (provedor.modelo) partes.push(provedor.modelo);
  if (provedor.temChave) partes.push("chave no Gerenciador de Credenciais");
  return partes.join(" · ");
}

/** O que o formulário de edição de um provedor tem escrito. A chave começa vazia: nunca volta. */
export interface EdicaoProvedor {
  nome: string;
  baseUrl: string;
  modelo: string;
  chave: string;
}

export const edicaoInicial = (provedor: Provedor): EdicaoProvedor => ({
  nome: provedor.nome,
  baseUrl: provedor.baseUrl ?? "",
  modelo: provedor.modelo ?? "",
  chave: "",
});

/**
 * Trocar o endereço de quem tem chave pede a chave de novo (o serviço não manda a guardada a um
 * servidor que o usuário não confirmou junto com ela): com o campo vazio, ela sai.
 */
export const trocaApagaChave = (provedor: Provedor, edicao: EdicaoProvedor) =>
  provedor.temChave &&
  provedor.tipo === "openai-compativel" &&
  edicao.baseUrl.trim() !== (provedor.baseUrl ?? "") &&
  !edicao.chave.trim();

/**
 * O pedido de gravar a edição: só o que mudou; `null` quando nada mudou. CLI só muda o nome (o
 * resto é do login dele); a OpenAI não tem endereço. Campo de modelo vazio tira o modelo.
 */
export function mudancaDaEdicao(provedor: Provedor, edicao: EdicaoProvedor): MudancaProvedor | null {
  const mudanca: MudancaProvedor = { id: provedor.id };
  const nome = edicao.nome.trim();
  if (nome && nome !== provedor.nome) mudanca.nome = nome;
  if (!ehCli(provedor.tipo)) {
    const baseUrl = edicao.baseUrl.trim();
    if (provedor.tipo === "openai-compativel" && baseUrl !== (provedor.baseUrl ?? "")) {
      mudanca.baseUrl = baseUrl || null;
    }
    const modelo = edicao.modelo.trim();
    if (modelo !== (provedor.modelo ?? "")) mudanca.modelo = modelo || null;
    const chave = edicao.chave.trim();
    if (chave) mudanca.chave = chave;
    else if (trocaApagaChave(provedor, edicao)) mudanca.chave = null;
  }
  return Object.keys(mudanca).length > 1 ? mudanca : null;
}

/** Endereço, modelo ou chave novos: o teste de antes não vale, e a tela testa de novo. */
export const mudancaPedeTeste = (mudanca: MudancaProvedor) =>
  mudanca.baseUrl !== undefined || mudanca.modelo !== undefined || mudanca.chave !== undefined;

/** Quem usa um provedor, e como. */
export interface UsoDoProvedor {
  agente: Agente;
  papel: "principal" | "reserva";
}

export function usosDoProvedor(id: string, agentes: readonly Agente[]): UsoDoProvedor[] {
  return agentes.flatMap((agente): UsoDoProvedor[] => {
    if (agente.provedorId === id) return [{ agente, papel: "principal" }];
    if (agente.provedorReservaId === id) return [{ agente, papel: "reserva" }];
    return [];
  });
}

/** "Alba", "Alba e Nuno", "Alba, Tula e Nuno". */
function emLista(nomes: readonly string[]): string {
  return nomes.length < 2 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
}

/**
 * O que remover faz, antes do sim: quem perde o provedor e como fica, e a chave que sai do
 * Gerenciador de Credenciais.
 */
export function textoDaRemocao(provedor: Provedor, usos: readonly UsoDoProvedor[]): string {
  const partes: string[] = [];
  if (usos.length === 0) {
    partes.push(`Nenhum agente usa o ${provedor.nome}.`);
  } else {
    const quem = emLista(usos.map((u) => `${u.agente.nome} (${u.papel})`));
    partes.push(`${quem} ${usos.length === 1 ? "usa" : "usam"} o ${provedor.nome}.`);
    partes.push(
      usos.some((u) => u.papel === "principal")
        ? "Sem ele, quem o tem como principal fica sem modelo e dorme até ganhar outro; troque antes, se quiser."
        : "Sem ele, a reserva fica vazia; troque antes, se quiser.",
    );
  }
  if (provedor.temChave) partes.push("A chave sai do Gerenciador de Credenciais.");
  return partes.join(" ");
}

/** O que o usuário escolheu numa lista da tabela, antes de confirmar no painel do agente. */
export interface EscolhaModelo {
  principal?: string;
  /** `null` é nenhuma reserva. */
  reserva?: string | null;
}

/** O principal e a reserva que o painel mostra marcados, e o teto com a moeda, quando mexido. */
export interface ModeloEscolhido {
  principal: string | null;
  reserva: string | null;
  /** `centavos: null` é sem teto. */
  teto?: { centavos: number | null; moeda: MoedaTeto };
}

/**
 * Como o painel abre: o que está gravado, com a escolha feita na tabela por cima. Escolher como
 * principal o que era a reserva troca os dois de lugar (o de antes vira a reserva), em vez de o
 * agente perder a reserva sem pedir; a reserva nunca é o próprio principal.
 */
export function escolhaInicial(agente: Agente, escolha: EscolhaModelo = {}): ModeloEscolhido {
  const principal = escolha.principal ?? agente.provedorId;
  let reserva = escolha.reserva === undefined ? agente.provedorReservaId : escolha.reserva;
  if (escolha.principal !== undefined && escolha.principal === agente.provedorReservaId) {
    reserva = agente.provedorId;
  }
  return { principal, reserva: reserva === principal ? null : reserva };
}

/**
 * O pedido de gravar o que o painel tem marcado: só o que mudou. `null` quando nada mudou ou a
 * troca de modelo ficou sem principal. Sem teto, trocar a moeda não muda nada.
 */
export function mudancaDoPainel(agente: Agente, escolhido: ModeloEscolhido): MudancaAgente | null {
  const trocouModelo =
    escolhido.principal !== agente.provedorId || escolhido.reserva !== agente.provedorReservaId;
  if (trocouModelo && !escolhido.principal) return null;
  const t = escolhido.teto;
  const trocouTeto =
    t !== undefined &&
    (t.centavos !== agente.tetoDiarioCentavos || (t.centavos !== null && t.moeda !== agente.tetoMoeda));
  if (!trocouModelo && !trocouTeto) return null;
  return {
    id: agente.id,
    ...(trocouModelo ? { provedorId: escolhido.principal, provedorReservaId: escolhido.reserva } : {}),
    ...(trocouTeto && t ? { tetoDiarioCentavos: t.centavos, tetoMoeda: t.moeda } : {}),
  };
}

/** "14 execuções", "1 execução", "nenhuma"; acima do que a tela leu, "200 ou mais". */
export function execucoesEmTexto(quantas: number, temMais: boolean): string {
  if (temMais) return `${quantas} ou mais`;
  if (quantas === 0) return "nenhuma";
  return `${quantas} ${quantas === 1 ? "execução" : "execuções"}`;
}

/** Quantas execuções começaram hoje (relógio local), numa lista da mais nova para a mais velha. */
export function contarDeHoje(execucoes: readonly Execucao[], agora: Date): number {
  const desde = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).toISOString();
  return execucoes.filter((e) => (e.inicio ?? "") >= desde).length;
}

/** A frase do agente no painel de troca, até duas frases (AGENTS.md §2 Voz). */
export function falaDaTroca(nomeNovo: string, nomeAtual: string | null): string {
  if (!nomeAtual) return `Na próxima execução eu passo a usar o ${nomeNovo}.`;
  return `Na próxima execução eu passo a usar o ${nomeNovo}. O que estou fazendo agora termina no ${nomeAtual}.`;
}
