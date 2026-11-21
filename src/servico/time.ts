import type { Agente as AgenteServico, Provedor, SituacaoAgente } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useEffect, useState } from "react";
import { eAgente, type Agente } from "../componentes/personagem/agentes.ts";
import { modeloDoAgente, type ModeloDoAgente } from "../componentes/personagem/situacao.ts";
import { servico } from "./conexao.ts";
import { gastoNaDica } from "./teto.ts";

/** O que o runtime diz de cada agente do time; quem não veio fica de fora. */
export type SituacaoTime = Partial<Record<Agente, SituacaoAgente>>;

/** O modelo de cada agente do time; sem modelo, ou sem a lista de provedores, fica de fora. */
export type ModelosDoTime = Partial<Record<Agente, ModeloDoAgente>>;

/** O provedor (id) de cada agente, como veio do serviço. */
type ProvedoresDoTime = Partial<Record<Agente, string | null>>;

/** O gasto de hoje contra o teto de cada agente, já escrito como estimativa; sem número, fica de fora. */
export type GastosDoTime = Partial<Record<Agente, string>>;

const SEM_NOTICIA: SituacaoTime = {};
const SEM_PROVEDORES: ProvedoresDoTime = {};
const SEM_GASTOS: GastosDoTime = {};

/** Junta agentes do serviço ao que já se sabia; agente fora do time de fábrica fica de fora. */
export function juntarSituacoes(atual: SituacaoTime, agentes: readonly AgenteServico[]): SituacaoTime {
  const proximo = { ...atual };
  for (const a of agentes) if (eAgente(a.id)) proximo[a.id] = a.situacao;
  return proximo;
}

/** Junta o provedor de cada agente do serviço ao que já se sabia, como {@link juntarSituacoes}. */
function juntarProvedores(atual: ProvedoresDoTime, agentes: readonly AgenteServico[]): ProvedoresDoTime {
  const proximo = { ...atual };
  for (const a of agentes) if (eAgente(a.id)) proximo[a.id] = a.provedorId;
  return proximo;
}

/** Junta o gasto contra o teto de cada agente do serviço ao que já se sabia; sem teto, sai. */
export function juntarGastos(atual: GastosDoTime, agentes: readonly AgenteServico[]): GastosDoTime {
  const proximo = { ...atual };
  for (const a of agentes) {
    if (!eAgente(a.id)) continue;
    const texto = gastoNaDica(a.gastoDeHoje, a.tetoMoeda);
    if (texto) proximo[a.id] = texto;
    else delete proximo[a.id];
  }
  return proximo;
}

/** O modelo de cada um, pelo provedor dele e pela lista de provedores. */
export function modelosDoTime(
  provedoresDoTime: ProvedoresDoTime,
  provedores: readonly Provedor[] | null,
): ModelosDoTime {
  const modelos: ModelosDoTime = {};
  for (const [id, provedorId] of Object.entries(provedoresDoTime) as [Agente, string | null][]) {
    const modelo = modeloDoAgente(provedorId, provedores);
    if (modelo) modelos[id] = modelo;
  }
  return modelos;
}

/** O time pelo canal: o que cada um está fazendo e com que modelo. */
export interface TimeDoRuntime {
  situacoes: SituacaoTime;
  /** Para dizer a falha do jeito do modelo: CLI sem login não é chave recusada. */
  modelos: ModelosDoTime;
  /** Para a dica do teto dizer o valor, como estimativa. */
  gastos: GastosDoTime;
}

/**
 * A situação real do time, pelo canal: a lista ao conectar (`agentes.listar`) e cada mudança
 * depois (`agentes.mudou`), com o modelo de cada um (`provedores.listar` e `provedores.mudou`).
 * Sem conexão, ou com o serviço ainda sem resposta para o método, fica vazia e quem mostra cai no
 * time dormindo da fase 1: sem serviço, nenhum agente trabalha. Sem a lista de provedores, a
 * situação vale do mesmo jeito; só a falha de credencial não diz se é login ou chave.
 */
export function useTime(canal: EstadoConexao): TimeDoRuntime {
  const [time, setTime] = useState<SituacaoTime>(SEM_NOTICIA);
  const [provedoresDoTime, setProvedoresDoTime] = useState<ProvedoresDoTime>(SEM_PROVEDORES);
  const [provedores, setProvedores] = useState<readonly Provedor[] | null>(null);
  const [gastos, setGastos] = useState<GastosDoTime>(SEM_GASTOS);

  useEffect(
    () =>
      servico.ouvir("agentes.mudou", (a) => {
        setTime((t) => juntarSituacoes(t, [a]));
        setProvedoresDoTime((p) => juntarProvedores(p, [a]));
        setGastos((g) => juntarGastos(g, [a]));
      }),
    [],
  );
  useEffect(() => servico.ouvir("provedores.mudou", setProvedores), []);

  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    // A lista nova substitui o que ficou; sem resposta, não sobra situação de antes.
    servico
      .pedir("agentes.listar")
      .then((agentes) => {
        if (!vivo) return;
        setTime(juntarSituacoes(SEM_NOTICIA, agentes));
        setProvedoresDoTime(juntarProvedores(SEM_PROVEDORES, agentes));
        setGastos(juntarGastos(SEM_GASTOS, agentes));
      })
      .catch(() => {
        if (vivo) setTime(SEM_NOTICIA);
      });
    servico
      .pedir("provedores.listar")
      .then((lista) => {
        if (vivo) setProvedores(lista);
      })
      .catch(() => {
        if (vivo) setProvedores(null);
      });
    return () => {
      // O canal saiu de "conectado": o que se sabia do runtime deixa de valer.
      vivo = false;
      setTime(SEM_NOTICIA);
      setProvedoresDoTime(SEM_PROVEDORES);
      setProvedores(null);
      setGastos(SEM_GASTOS);
    };
  }, [canal]);

  if (canal !== "conectado") return { situacoes: SEM_NOTICIA, modelos: {}, gastos: SEM_GASTOS };
  return { situacoes: time, modelos: modelosDoTime(provedoresDoTime, provedores), gastos };
}
