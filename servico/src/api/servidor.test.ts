import { CONFIG_PADRAO, MISSOES_TUTORIAL, PASSOS_PRIMEIRO_USO } from "@moductus/contrato";
import { ClienteServico } from "@moductus/contrato/cliente";
import { afterEach, describe, expect, test } from "vitest";
import { abrirServidorWs, type ServidorWs } from "./servidor.ts";

const TOKEN = "a".repeat(64);
const estadoConfig = { config: CONFIG_PADRAO, portable: false, falhasAtalhos: {} };
const pendentes = <T extends string>(ids: readonly T[]) =>
  Object.fromEntries(ids.map((id) => [id, "pendente" as const])) as Record<T, "pendente">;
const estadoPrimeiroUso = {
  concluido: false,
  concluidoEm: null,
  passos: pendentes(PASSOS_PRIMEIRO_USO),
  tutorial: "pendente" as const,
  missoes: pendentes(MISSOES_TUTORIAL),
};
const atendentes = {
  "sistema.ping": () => ({ protocolo: 1, pid: process.pid }),
  "config.obter": () => estadoConfig,
  "config.definir": () => estadoConfig,
  "config.exportar": ({ caminho }: { caminho: string }) => ({ caminho, bytes: 0, chaves: [] }),
  "config.previaImportar": () => ({
    pc_origem: "casa",
    criado_em: "2026-10-07T21:14:00.000Z",
    versao_app: "0.5.0-alpha",
    mudancas: [],
  }),
  "config.importar": () => estadoConfig,
  "primeiroUso.obter": () => estadoPrimeiroUso,
  "primeiroUso.concluir": () => estadoPrimeiroUso,
  "primeiroUso.marcar": () => estadoPrimeiroUso,
};

const abertos: ServidorWs[] = [];
const clientes: ClienteServico[] = [];
afterEach(async () => {
  for (const c of clientes.splice(0)) c.fechar();
  for (const s of abertos.splice(0)) await s.fechar();
});

async function servidor(porta = 0) {
  const s = await abrirServidorWs(TOKEN, atendentes, porta);
  abertos.push(s);
  return s;
}

function cliente() {
  const c = new ClienteServico();
  clientes.push(c);
  return c;
}

const ate = (c: ClienteServico, estado: ClienteServico["estado"], ms = 5000) =>
  new Promise<void>((pronto, falhou) => {
    if (c.estado === estado) return pronto();
    const prazo = setTimeout(() => falhou(new Error(`não chegou a ${estado}`)), ms);
    const parar = c.aoMudarEstado((e) => {
      if (e === estado) {
        clearTimeout(prazo);
        parar();
        pronto();
      }
    });
  });

describe("canal WebSocket", () => {
  test("pedido e resposta com o token certo, e evento do serviço", async () => {
    const s = await servidor();
    const c = cliente();
    const ola = new Promise((pronto) => c.ouvir("sistema.ola", pronto));
    c.conectar({ porta: s.porta, token: TOKEN });
    await ate(c, "conectado");
    await expect(c.pedir("sistema.ping")).resolves.toEqual({ protocolo: 1, pid: process.pid });
    await expect(ola).resolves.toEqual({ protocolo: 1 });
  });

  test("conexão sem token ou com token errado é recusada", async () => {
    const s = await servidor();
    for (const url of [`ws://127.0.0.1:${s.porta}/`, `ws://127.0.0.1:${s.porta}/?token=errado`]) {
      const recusada = await new Promise<boolean>((pronto) => {
        const ws = new WebSocket(url);
        ws.onopen = () => pronto(false);
        ws.onerror = () => pronto(true);
      });
      expect(recusada, url).toBe(true);
    }
  });

  test("método desconhecido e entrada inválida voltam como erro", async () => {
    const s = await servidor();
    const ws = new WebSocket(`ws://127.0.0.1:${s.porta}/?token=${TOKEN}`);
    await new Promise((pronto) => (ws.onopen = pronto));
    const respostas: unknown[] = [];
    const duas = new Promise<void>((pronto) => {
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as { tipo: string };
        if (m.tipo === "resposta") respostas.push(m);
        if (respostas.length === 2) pronto();
      };
    });
    ws.send(JSON.stringify({ tipo: "pedido", id: 1, metodo: "nada.existe" }));
    ws.send(JSON.stringify({ tipo: "pedido", id: 2, metodo: "sistema.ping", dados: { x: 1 } }));
    await duas;
    ws.close();
    expect(respostas).toContainEqual({
      tipo: "resposta",
      id: 1,
      ok: false,
      erro: "método desconhecido: nada.existe",
    });
    expect(respostas).toContainEqual(expect.objectContaining({ id: 2, ok: false }));
  });

  test("a interface reconecta sozinha quando o serviço volta na mesma porta", async () => {
    const s = await servidor();
    const porta = s.porta;
    const c = cliente();
    c.conectar({ porta, token: TOKEN });
    await ate(c, "conectado");
    await s.fechar();
    abertos.length = 0;
    await ate(c, "desconectado");
    await servidor(porta);
    await ate(c, "conectado");
    await expect(c.pedir("sistema.ping")).resolves.toMatchObject({ protocolo: 1 });
  });

  test("troca de endereço quando a casca sobe outro serviço", async () => {
    const a = await servidor();
    const c = cliente();
    c.conectar({ porta: a.porta, token: TOKEN });
    await ate(c, "conectado");
    const b = await servidor();
    c.conectar({ porta: b.porta, token: TOKEN });
    await ate(c, "conectado");
    await expect(c.pedir("sistema.ping")).resolves.toMatchObject({ protocolo: 1 });
  });
});
