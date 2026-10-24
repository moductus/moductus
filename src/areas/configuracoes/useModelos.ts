import type {
  Agente,
  Cambio,
  Cotacao,
  CotacaoBuscada,
  Execucao,
  MoedaComCotacao,
  MudancaAgente,
  MudancaProvedor,
  NovoProvedor,
  PedidoModelosProvedor,
  Provedor,
  ProvedorDetectado,
  ResultadoModelosProvedor,
} from "@moductus/contrato";
import { useCallback, useEffect, useState } from "react";
import { useServico } from "../../nativo/eventos.ts";
import { juntarExecucao } from "../../servico/agente.ts";
import { mensagemDeErro } from "../../servico/conversas.ts";
import { servico, useCanal } from "../../servico/conexao.ts";
import { mudancaPedeTeste, type TesteProvedor } from "./modelos.ts";

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
  /** Grava a edição; endereço, modelo ou chave novos testam de novo. */
  editar: (mudanca: MudancaProvedor) => Promise<boolean>;
  /** Manda para a lixeira; a chave sai do Gerenciador e os agentes que o usavam ficam sem ele. */
  remover: (id: string) => Promise<boolean>;
  /** "Testar" no formulário: os modelos do endereço; a recusa do serviço volta como falha. */
  listarModelos: (pedido: PedidoModelosProvedor) => Promise<ResultadoModelosProvedor>;
  /** As cotações do teto gravadas na configuração; `null` até o serviço responder. */
  cambio: Cambio | null;
  /** "Buscar cotação": a fonte responde sem gravar; `null` quando falhou (o motivo vai em `erro`). */
  buscarCotacao: (moeda: MoedaComCotacao) => Promise<CotacaoBuscada | null>;
  /** Grava a cotação de uma moeda, digitada ou confirmada da busca; as outras ficam. */
  gravarCotacao: (moeda: MoedaComCotacao, cotacao: Cotacao) => Promise<boolean>;
}

const trocar = <T extends { id: string }>(lista: T[] | null, item: T) =>
  lista?.some((x) => x.id === item.id) ? lista.map((x) => (x.id === item.id ? item : x)) : lista;

/**
 * Provedores, agentes, as execuções de hoje e as cotações do teto pelo canal, acompanhando
 * `provedores.mudou`, `agentes.mudou`, `execucoes.mudou` e `config.mudou` de qualquer janela. O teste é o do serviço: uma chamada
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
  const [cambio, setCambio] = useState<Cambio | null>(null);

  useEffect(() => {
    const paradas = [
      servico.ouvir("provedores.mudou", setProvedores),
      servico.ouvir("config.mudou", (estado) => setCambio(estado.config.cambio)),
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
      .pedir("config.obter")
      .then((estado) => vivo && setCambio(estado.config.cambio))
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
          ? {
              fase: "ok",
              latenciaMs: r.latenciaMs,
              testadoEm: r.testadoEm,
              ferramentas: r.ferramentas ?? null,
            }
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

  const editar = useCallback(
    async (mudanca: MudancaProvedor) => {
      const mudou = await pedir(() => servico.pedir("provedores.definir", mudanca));
      if (!mudou) return false;
      setProvedores((lista) => trocar(lista, mudou));
      // Só o nome mudou: o teste feito aqui vale para a mesma configuração.
      if (mudancaPedeTeste(mudanca)) await testar(mudou.id);
      return true;
    },
    [pedir, testar],
  );

  const remover = useCallback(
    async (id: string) => {
      const lista = await pedir(() => servico.pedir("provedores.remover", { id }));
      if (!lista) return false;
      setProvedores(lista);
      setTestes(({ [id]: _, ...resto }) => resto);
      return true;
    },
    [pedir],
  );

  // A recusa (endereço inválido, com senha) vai junto do campo, não no aviso do topo.
  const listarModelos = useCallback(async (pedido: PedidoModelosProvedor) => {
    try {
      return await servico.pedir("provedores.modelos", pedido);
    } catch (e) {
      return {
        ok: false as const,
        falha: { motivo: "ausente" as const, mensagem: mensagemDeErro(e), voltaEm: null },
      };
    }
  }, []);

  const buscarCotacao = useCallback(
    (moeda: MoedaComCotacao) => pedir(() => servico.pedir("cambio.buscar", { moeda })),
    [pedir],
  );

  const gravarCotacao = useCallback(
    async (moeda: MoedaComCotacao, cotacao: Cotacao) => {
      // A configuração grava a chave inteira: as cotações das outras moedas vão junto, como estão.
      const atual = cambio ?? { cotacoes: {} };
      const estado = await pedir(() =>
        servico.pedir("config.definir", { cambio: { cotacoes: { ...atual.cotacoes, [moeda]: cotacao } } }),
      );
      if (estado) setCambio(estado.config.cambio);
      return estado !== null;
    },
    [cambio, pedir],
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
    editar,
    remover,
    listarModelos,
    cambio,
    buscarCotacao,
    gravarCotacao,
  };
}
