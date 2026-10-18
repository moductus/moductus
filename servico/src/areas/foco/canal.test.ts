import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CONFIG_PADRAO, METODOS, type EstadoFoco, type NomeMetodo } from "@moductus/contrato";
import { ClienteServico } from "@moductus/contrato/cliente";
import { afterEach, describe, expect, test, vi } from "vitest";
import { abrirServidorWs, semAtendente, type ServidorWs } from "../../api/servidor.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import { ATALHO_DO_FOCO, atendentesDoFoco, MENSAGEM_ERRO_INTERNO, ouvirAtalhoDoFoco } from "./canal.ts";
import { MENSAGEM_PARADO, RepositorioFoco, ServicoFoco } from "./foco.ts";

const TOKEN = "c".repeat(64);
const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
const servidores: ServidorWs[] = [];
const clientes: ClienteServico[] = [];
afterEach(async () => {
  for (const c of clientes.splice(0)) c.fechar();
  for (const s of servidores.splice(0)) await s.fechar();
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A área sobre um banco de verdade, sem relógio e com notificações que só respondem. */
function servicoFoco(mudou: (estado: EstadoFoco) => void = () => {}) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-foco-canal-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  const mudancas: EstadoFoco[] = [];
  const foco = new ServicoFoco(
    new RepositorioFoco(db),
    {
      lerDia: () => CONFIG_PADRAO.dia,
      notificacoes: {
        avisar: () => Promise.reject(new Error("sem avisos neste teste")),
        resolvido: () => Promise.resolve(),
        registrarAcao: () => () => {},
      },
    },
    {
      mudou: (estado) => {
        mudancas.push(estado);
        mudou(estado);
      },
    },
  );
  return { db, foco, mudancas };
}

/** O serviço como o `main.ts` monta: a área no canal WebSocket de verdade e uma janela conectada. */
async function montar() {
  let servidor: ServidorWs | null = null;
  const { db, foco } = servicoFoco((estado) => servidor?.emitir("foco.mudou", estado));
  servidor = await abrirServidorWs(TOKEN, {
    ...semAtendente(Object.keys(METODOS) as NomeMetodo[]),
    ...atendentesDoFoco(foco),
  });
  servidores.push(servidor);
  const janela = new ClienteServico();
  clientes.push(janela);
  const conectada = new Promise<void>((pronto) => {
    const parar = janela.aoMudarEstado((e) => {
      if (e === "conectado") {
        parar();
        pronto();
      }
    });
  });
  janela.conectar({ porta: servidor.porta, token: TOKEN });
  await conectada;
  return { db, janela };
}

describe("Foco no canal", () => {
  test("iniciar pela janela faz `foco.mudou` chegar a ela, e o histórico responde", async () => {
    const { janela } = await montar();
    const mudou = new Promise<EstadoFoco>((pronto) => {
      const parar = janela.ouvir("foco.mudou", (dados) => {
        parar();
        pronto(dados as EstadoFoco);
      });
    });
    const estado = await janela.pedir("foco.iniciar", {});
    expect(estado).toMatchObject({ etapa: { tipo: "foco", duracaoPlanejadaMin: 25 }, cicloAtual: 1 });
    await expect(mudou).resolves.toEqual(estado);
    await expect(janela.pedir("foco.obter")).resolves.toEqual(estado);
    await expect(
      janela.pedir("foco.historico", { de: "2026-01-01", ate: "2099-12-31" }),
    ).resolves.toMatchObject({
      etapas: [{ id: estado.etapa?.id }],
    });
  });

  test("erro da regra chega legível; erro de dentro chega como texto genérico, sem o detalhe", async () => {
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, janela } = await montar();
    await expect(janela.pedir("foco.pausar")).rejects.toThrow(MENSAGEM_PARADO);
    db.close();
    const falha = janela.pedir("foco.obter");
    await expect(falha).rejects.toThrow(MENSAGEM_ERRO_INTERNO);
    await falha.catch((erro: unknown) => expect(String(erro)).not.toMatch(/database|sqlite/i));
    expect(erros).toHaveBeenCalledWith(expect.stringContaining("foco: pedido falhou por dentro"));
  });
});

describe("atalho do foco", () => {
  /** A casca de mentira: guarda quem escuta cada aviso e entrega quando o teste aperta o atalho. */
  function casca() {
    const ouvintes = new Map<string, (aviso: Record<string, unknown>) => void>();
    return {
      aoAvisar: (tipo: string, ouvinte: (aviso: Record<string, unknown>) => void) =>
        ouvintes.set(tipo, ouvinte),
      apertar: () => ouvintes.get(ATALHO_DO_FOCO)?.({ tipo: ATALHO_DO_FOCO }),
    };
  }

  test("Ctrl+Alt+P inicia, pausa e retoma, e a janela fica sabendo", () => {
    const { foco, mudancas } = servicoFoco();
    const atalho = casca();
    ouvirAtalhoDoFoco(atalho, foco);
    atalho.apertar();
    expect(foco.obter().etapa).toMatchObject({ tipo: "foco", pausadaEm: null });
    atalho.apertar();
    expect(foco.obter().etapa?.pausadaEm).not.toBeNull();
    atalho.apertar();
    expect(foco.obter().etapa?.pausadaEm).toBeNull();
    expect(mudancas).toHaveLength(3);
  });

  test("uma falha por dentro vai ao log e não derruba quem avisou", () => {
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, foco } = servicoFoco();
    const atalho = casca();
    ouvirAtalhoDoFoco(atalho, foco);
    db.close();
    expect(() => atalho.apertar()).not.toThrow();
    expect(erros).toHaveBeenCalledWith(expect.stringContaining("foco: atalho falhou"));
  });
});
