// @vitest-environment happy-dom
import type { Agente, Aprovacao, SituacaoAgente } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * A leitura dos painéis: a carga e os avisos do canal. O serviço de mentira segura a resposta de
 * `agentes.listar` até o teste mandar, para o aviso chegar com a carga a caminho.
 */
const ouvintes = new Map<string, Set<(dados: unknown) => void>>();
const respostas = new Map<string, (valor: unknown) => void>();
vi.mock("../../servico/conexao.ts", () => ({
  servico: {
    ouvir: (nome: string, fn: (dados: unknown) => void) => {
      if (!ouvintes.has(nome)) ouvintes.set(nome, new Set());
      ouvintes.get(nome)!.add(fn);
      return () => ouvintes.get(nome)?.delete(fn);
    },
    pedir: vi.fn((metodo: string) => new Promise((pronto) => respostas.set(metodo, pronto))),
  },
}));

const { juntarPendente, useAgentes } = await import("./dados.ts");

const ATIVO: SituacaoAgente = {
  estado: "ativo",
  atividade: "ocioso",
  motivoSono: null,
  dormeAte: null,
  pausadoAte: null,
  fila: 0,
};

const agente = (id: string, situacao: Partial<SituacaoAgente> = {}): Agente => ({
  id,
  nome: id,
  funcao: "",
  instrucoes: "",
  personagem: { silhueta: "ovo", traco: "raios", tom: "ambar" },
  ferramentas: [],
  provedorId: null,
  provedorReservaId: null,
  gatilhos: [],
  escoposMemoria: [],
  tetoDiarioCentavos: null,
  deFabrica: true,
  situacao: { ...ATIVO, ...situacao },
});

let raiz: Root | null = null;
let visto: Agente[] | null = null;

/** Publica o que o hook leu depois de cada render, para o teste conferir. */
function Leitor({ canal }: { canal: EstadoConexao }) {
  const lido = useAgentes(canal);
  useEffect(() => {
    visto = lido;
  });
  return null;
}

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  visto = null;
  ouvintes.clear();
  respostas.clear();
});

function avisar(evento: string, dados: unknown) {
  act(() => ouvintes.get(evento)?.forEach((fn) => fn(dados)));
}

describe("useCarga", () => {
  it("o aviso que chega antes de agentes.listar responder vale sobre a lista que chega depois", async () => {
    raiz = createRoot(document.createElement("div"));
    await act(async () => raiz!.render(<Leitor canal="conectado" />));
    expect(visto).toBeNull();
    // A lista saiu antes do aviso e volta sem ele: a Tula ainda ociosa.
    avisar("agentes.mudou", agente("tula", { atividade: "trabalhando" }));
    expect(visto).toBeNull();
    await act(async () => respostas.get("agentes.listar")!([agente("alba"), agente("tula")]));
    expect(visto!.map((a) => [a.id, a.situacao.atividade])).toEqual([
      ["alba", "ocioso"],
      ["tula", "trabalhando"],
    ]);
    // Depois da carga, o aviso vale direto.
    avisar("agentes.mudou", agente("alba", { estado: "pausado" }));
    expect(visto!.find((a) => a.id === "alba")?.situacao.estado).toBe("pausado");
  });

  it("sem conexão, nada: o painel diz que não sabe", async () => {
    raiz = createRoot(document.createElement("div"));
    await act(async () => raiz!.render(<Leitor canal="desconectado" />));
    expect(visto).toBeNull();
    expect(respostas.has("agentes.listar")).toBe(false);
  });
});

describe("pendentes do terminal no dock", () => {
  const pedido = (id: string, estado: Aprovacao["estado"]): Aprovacao => ({
    id,
    fonte: "claude-code",
    agenteId: null,
    execucaoId: null,
    sessaoId: "s1",
    descricao: "Quer rodar o comando abaixo.",
    acao: { ferramenta: "Bash", entrada: {}, rotulo: null, rotuloRecusar: null, desfazivel: false },
    estado,
    criadoEm: "2026-10-09T12:00:00.000Z",
    decididaEm: null,
    regraCriadaId: null,
    admiteSempre: true,
  });

  it("decidido ou expirado sai; a lista não guarda o que já foi respondido", () => {
    const lista = juntarPendente([pedido("a1", "pendente")], pedido("a2", "pendente"));
    expect(lista.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(juntarPendente(lista, pedido("a1", "aprovada")).map((a) => a.id)).toEqual(["a2"]);
    expect(juntarPendente([], pedido("a3", "expirada"))).toEqual([]);
  });
});
