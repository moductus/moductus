import {
  TIPOS_PROVEDOR_CLI,
  type Agente,
  type Execucao,
  type FalhaProvedor,
  type MudancaAgente,
  type Provedor,
  type ProvedorDetectado,
} from "@moductus/contrato";
import type { TomSelo } from "../../componentes/Selo.tsx";
import { eFalhaDoProvedor } from "../../componentes/personagem/situacao.ts";
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
  | { fase: "ok"; latenciaMs: number; testadoEm: string }
  | { fase: "falhou"; falha: FalhaProvedor; testadoEm: string };

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
}

const ehCli = (tipo: Provedor["tipo"]) => (TIPOS_PROVEDOR_CLI as readonly string[]).includes(tipo);

/**
 * Provedor de API com chave guardada, ou a OpenAI (que sempre pede uma): o usuário troca a chave
 * por aqui. CLI usa o login dele; modelo local sem chave não tem o que trocar.
 */
export const temChaveTrocavel = (provedor: Provedor) =>
  !ehCli(provedor.tipo) && (provedor.temChave || provedor.tipo === "openai");

const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** O que a falha diz ao usuário quando o agente dorme por ela e a tela não testou nada. */
const FALHA_DO_AGENTE: Readonly<Record<string, string>> = {
  fora_do_ar: "O provedor não respondeu na última execução. Teste de novo para conferir.",
  credencial: "A chave foi recusada na última execução. Troque a chave e teste de novo.",
  ausente: "O CLI não foi encontrado na última execução. Instale de novo e teste.",
};

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
      quando: `falhou às ${HORA.format(new Date(teste.testadoEm))}`,
      erro: teste.falha.mensagem,
    };
  }
  if (teste?.fase === "ok") {
    return {
      texto: "funcionando",
      tom: "sucesso",
      resposta: formatarLatencia(teste.latenciaMs),
      quando: `testado ${haQuanto(teste.testadoEm, agora)}`,
      erro: null,
    };
  }
  const caiu = agentes.find(
    (a) =>
      a.provedorId === provedor.id &&
      a.situacao.estado === "dormindo" &&
      eFalhaDoProvedor(a.situacao.motivoSono),
  );
  if (caiu?.situacao.motivoSono) {
    return {
      texto: "erro",
      tom: "perigo",
      resposta: "—",
      quando: null,
      erro: FALHA_DO_AGENTE[caiu.situacao.motivoSono] ?? null,
    };
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

/**
 * O pedido de trocar o principal. Escolher como principal o que era a reserva troca os dois de
 * lugar: o de antes vira a reserva, em vez de o agente perder a reserva sem pedir.
 */
export function trocarPrincipal(agente: Agente, novo: string): MudancaAgente {
  if (novo === agente.provedorReservaId) {
    return { id: agente.id, provedorId: novo, provedorReservaId: agente.provedorId };
  }
  return { id: agente.id, provedorId: novo };
}

/** O pedido de trocar a reserva; `null` é nenhuma. */
export function trocarReserva(agente: Agente, nova: string | null): MudancaAgente {
  return { id: agente.id, provedorReservaId: nova };
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
