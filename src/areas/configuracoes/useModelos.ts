import type {
  Agente,
  Execucao,
  MudancaAgente,
  NovoProvedor,
  Provedor,
  ProvedorDetectado,
} from "@moductus/contrato";
import { useCallback, useEffect, useState } from "react";
import { useServico } from "../../nativo/eventos.ts";
import { juntarExecucao } from "../../servico/agente.ts";
import { mensagemDeErro } from "../../servico/conversas.ts";
import { servico, useCanal } from "../../servico/conexao.ts";
import type { TesteProvedor } from "./modelos.ts";

/** Quantas execuções a tela lê de cada agente para contar as de hoje. */
export const LIMITE_EXECUCOES_HOJE = 200;

/** As execuções que a tela leu de um agente e se há mais antigas que elas. */
export interface ExecucoesLidas {
  itens: readonly Execucao[];
  temMais: boolean;
}

export interface ModelosDaSecao {
  /** Null até o serviço responder. */
  provedores: Provedor[] | null;
  agentes: Agente[] | null;
  execucoes: Readonly<Record<string, ExecucoesLidas>>;
  /** Os CLIs achados no PC; `null` antes de procurar ou enquanto procura. */
  detectados: ProvedorDetectado[] | null;
  procurando: boolean;
  testes: Readonly<Record<string, TesteProvedor>>;
  conectado: boolean;
  /** Motivo da última recusa do serviço, como veio; some no próximo pedido. */
  erro: string | null;
  definir: (mudanca: MudancaAgente) => Promise<boolean>;
  testar: (id: string) => Promise<void>;
  procurar: () => Promise<void>;
  /** Cria o provedor e já testa: é assim que ele chega aos agentes que estão sem modelo. */
  conectar: (novo: NovoProvedor) => Promise<boolean>;
  trocarChave: (id: string, chave: string) => Promise<boolean>;
}

const trocar = <T extends { id: string }>(lista: T[] | null, item: T) =>
  lista?.some((x) => x.id === item.id) ? lista.map((x) => (x.id === item.id ? item : x)) : lista;

/**
 * Provedores, agentes e as execuções de hoje pelo canal, acompanhando `provedores.mudou`,
 * `agentes.mudou` e `execucoes.mudou` de qualquer janela. O teste é o do serviço: uma chamada
 * curta de verdade, só quando o usuário pede.
 */
export function useModelos(): ModelosDaSecao {
  const canal = useCanal(useServico({ silencioso: true }));
  const conectado = canal === "conectado";
  const [provedores, setProvedores] = useState<Provedor[] | null>(null);
  const [agentes, setAgentes] = useState<Agente[] | null>(null);
  const [execucoes, setExecucoes] = useState<Record<string, ExecucoesLidas>>({});
  const [detectados, setDetectados] = useState<ProvedorDetectado[] | null>(null);
  const [procurando, setProcurando] = useState(false);
  const [testes, setTestes] = useState<Record<string, TesteProvedor>>({});
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const paradas = [
      servico.ouvir("provedores.mudou", setProvedores),
      servico.ouvir("agentes.mudou", (a) => setAgentes((lista) => trocar(lista, a))),
      servico.ouvir("execucoes.mudou", (e) =>
        setExecucoes((todas) => {
          const lidas = todas[e.agenteId];
          if (!lidas) return todas;
          return { ...todas, [e.agenteId]: { ...lidas, itens: juntarExecucao(lidas.itens, e) } };
        }),
      ),
    ];
    return () => paradas.forEach((parar) => parar());
  }, []);

  useEffect(() => {
    if (!conectado) return;
    let vivo = true;
    servico
      .pedir("provedores.listar")
      .then((p) => vivo && setProvedores(p))
      .catch(() => undefined);
    servico
      .pedir("agentes.listar")
      .then(async (lista) => {
        if (!vivo) return;
        setAgentes(lista);
        // "Hoje" é complemento: sem resposta, a coluna diz que não sabe.
        for (const a of lista) {
          servico
            .pedir("execucoes.listar", { agenteId: a.id, limite: LIMITE_EXECUCOES_HOJE })
            .then(
              (pagina) =>
                vivo &&
                setExecucoes((todas) => ({
                  ...todas,
                  [a.id]: { itens: pagina.itens, temMais: pagina.proximo !== null },
                })),
            )
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [conectado]);

  const pedir = useCallback(async <T>(fazer: () => Promise<T>): Promise<T | null> => {
    setErro(null);
    try {
      return await fazer();
    } catch (e) {
      setErro(mensagemDeErro(e));
      return null;
    }
  }, []);

  const definir = useCallback(
    async (mudanca: MudancaAgente) => {
      const agente = await pedir(() => servico.pedir("agentes.definir", mudanca));
      if (agente) setAgentes((lista) => trocar(lista, agente));
      return agente !== null;
    },
    [pedir],
  );

  const testar = useCallback(async (id: string) => {
    setErro(null);
    setTestes((t) => ({ ...t, [id]: { fase: "testando" } }));
    try {
      const r = await servico.pedir("provedores.testar", { id });
      setTestes((t) => ({
        ...t,
        [id]: r.ok
          ? { fase: "ok", latenciaMs: r.latenciaMs, testadoEm: r.testadoEm }
          : { fase: "falhou", falha: r.falha, testadoEm: r.testadoEm },
      }));
    } catch (e) {
      setTestes((t) => ({
        ...t,
        [id]: {
          fase: "falhou",
          falha: { motivo: "fora_do_ar", mensagem: mensagemDeErro(e), voltaEm: null },
          testadoEm: new Date().toISOString(),
        },
      }));
    }
  }, []);

  const procurar = useCallback(async () => {
    setProcurando(true);
    setDetectados(null);
    const achados = await pedir(() => servico.pedir("provedores.detectar"));
    setDetectados(achados ?? []);
    setProcurando(false);
  }, [pedir]);

  const conectar = useCallback(
    async (novo: NovoProvedor) => {
      const criado = await pedir(() => servico.pedir("provedores.criar", novo));
      if (!criado) return false;
      setProvedores((lista) =>
        lista && !lista.some((p) => p.id === criado.id) ? [...lista, criado] : lista,
      );
      await testar(criado.id);
      return true;
    },
    [pedir, testar],
  );

  const trocarChave = useCallback(
    async (id: string, chave: string) => {
      const mudou = await pedir(() => servico.pedir("provedores.definir", { id, chave }));
      if (!mudou) return false;
      setProvedores((lista) => trocar(lista, mudou));
      await testar(id);
      return true;
    },
    [pedir, testar],
  );

  return {
    provedores,
    agentes,
    execucoes,
    detectados,
    procurando,
    testes,
    conectado,
    erro,
    definir,
    testar,
    procurar,
    conectar,
    trocarChave,
  };
}
