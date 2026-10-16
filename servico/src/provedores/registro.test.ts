import { describe, expect, test } from "vitest";
import { ProvedorFalso, roteiros } from "./falso.ts";
import type { ConfigProvedor, EventoAgente, PedidoDoAgente, Provedor } from "./provedor.ts";
import { RegistroProvedores } from "./registro.ts";

const config = (mudanca: Partial<ConfigProvedor> = {}): ConfigProvedor => ({
  id: "01JA0000000000000000000001",
  tipo: "claude-cli",
  modelo: null,
  baseUrl: null,
  credencial: null,
  ...mudanca,
});

const pedido: PedidoDoAgente = {
  agenteId: "alba",
  execucaoId: "exec-1",
  instrucoes: "",
  mensagens: [],
  ferramentas: [],
  executarFerramenta: () => Promise.reject(new Error("nenhuma ferramenta esperada")),
  continuarDe: null,
};

async function coletar(provedor: Provedor): Promise<EventoAgente[]> {
  const lista: EventoAgente[] = [];
  for await (const evento of provedor.executar(pedido, new AbortController().signal)) lista.push(evento);
  return lista;
}

describe("registro de provedores", () => {
  test("o tipo registrado atende, com a configuração da linha", async () => {
    const recebidas: ConfigProvedor[] = [];
    const registro = new RegistroProvedores().registrar("claude-cli", (c) => {
      recebidas.push(c);
      return new ProvedorFalso(c.id, roteiros.resposta("oi"));
    });
    const provedor = registro.obter(config({ modelo: "sonnet" }));
    expect(provedor.id).toBe("01JA0000000000000000000001");
    expect(recebidas).toEqual([config({ modelo: "sonnet" })]);
    expect((await coletar(provedor)).map((e) => e.tipo)).toEqual(["texto", "uso", "fim"]);
  });

  test("reaproveita o adaptador enquanto a configuração não muda", () => {
    let criados = 0;
    const registro = new RegistroProvedores().registrar("openai-compativel", (c) => {
      criados++;
      return new ProvedorFalso(c.id);
    });
    const base = config({ tipo: "openai-compativel", baseUrl: "http://127.0.0.1:11434/v1" });
    const primeiro = registro.obter(base);
    expect(registro.obter({ ...base })).toBe(primeiro);
    expect(criados).toBe(1);

    const outro = registro.obter({ ...base, modelo: "llama3.2" });
    expect(outro).not.toBe(primeiro);
    expect(criados).toBe(2);

    registro.esquecer(base.id);
    expect(registro.obter({ ...base, modelo: "llama3.2" })).not.toBe(outro);
    expect(criados).toBe(3);
  });

  test("registrar de novo um tipo troca o adaptador dos provedores dele", () => {
    const registro = new RegistroProvedores().registrar("claude-cli", (c) => new ProvedorFalso(c.id));
    const antigo = registro.obter(config());
    const novo = new ProvedorFalso(config().id);
    registro.registrar("claude-cli", () => novo);
    expect(registro.obter(config())).toBe(novo);
    expect(antigo).not.toBe(novo);
  });

  test("tipo sem adaptador nesta versão falha com ausente, e o agente dorme em vez de quebrar", async () => {
    const registro = new RegistroProvedores();
    const provedor = registro.obter(config({ tipo: "codex-cli" }));
    expect(await coletar(provedor)).toEqual([
      {
        tipo: "erro",
        falha: {
          motivo: "ausente",
          mensagem:
            "Esta versão do Moductus ainda não fala com codex-cli. Escolha outro modelo para o agente.",
          voltaEm: null,
        },
      },
    ]);
  });

  test("o adaptador registrado depois substitui o ausente", async () => {
    const registro = new RegistroProvedores();
    expect((await coletar(registro.obter(config())))[0]?.tipo).toBe("erro");
    registro.registrar("claude-cli", (c) => new ProvedorFalso(c.id, roteiros.resposta("voltei")));
    expect((await coletar(registro.obter(config())))[0]).toEqual({ tipo: "texto", texto: "voltei" });
  });
});
