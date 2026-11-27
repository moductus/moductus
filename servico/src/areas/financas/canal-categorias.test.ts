import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { METODOS, type MudancaFinancas, type NomeMetodo } from "@moductus/contrato";
import { ClienteServico } from "@moductus/contrato/cliente";
import { afterEach, describe, expect, test, vi } from "vitest";
import { abrirServidorWs, semAtendente, type ServidorWs } from "../../api/servidor.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import { atendentesDasCategorias, MENSAGEM_ERRO_INTERNO } from "./canal-categorias.ts";
import { MENSAGEM_REGEX_CATASTROFICA, RepositorioCategorias, ServicoCategorias } from "./categorias.ts";

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

/** A área ligada ao canal WebSocket de verdade, como o `main.ts` monta, e uma janela conectada. */
async function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-categorias-canal-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta, { duravel: false });
  bancos.push(db);
  let servidor: ServidorWs | null = null;
  const categorias = new ServicoCategorias(new RepositorioCategorias(db), {
    mudou: (m) => servidor?.emitir("financas.mudou", m),
  });
  servidor = await abrirServidorWs(TOKEN, {
    ...semAtendente(Object.keys(METODOS) as NomeMetodo[]),
    ...atendentesDasCategorias(categorias),
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

describe("Categorias e regras no canal", () => {
  test("criar regra pela janela faz `financas.mudou` chegar com a parte das regras", async () => {
    const { janela } = await montar();
    const mudou = new Promise<MudancaFinancas>((pronto) => {
      const parar = janela.ouvir("financas.mudou", (dados) => {
        parar();
        pronto(dados as MudancaFinancas);
      });
    });
    const regra = await janela.pedir("financas.criarRegra", {
      padrao: "IFOOD",
      tipoPadrao: "contem",
      categoriaId: "restaurantes",
    });
    expect(regra).toMatchObject({ criadaPor: "usuario", vezesAplicada: 0 });
    await expect(mudou).resolves.toEqual({ partes: ["regras"], lancamentos: [], apagados: [] });
    expect((await janela.pedir("financas.regras")).map((r) => r.id)).toEqual([regra.id]);
    expect((await janela.pedir("financas.categorias")).length).toBe(22);
  });

  test("erro da regra chega legível; erro de dentro chega como texto genérico, sem o detalhe", async () => {
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, janela } = await montar();
    await expect(
      janela.pedir("financas.criarRegra", { padrao: "(A+)+$", tipoPadrao: "regex", categoriaId: "mercado" }),
    ).rejects.toThrow(MENSAGEM_REGEX_CATASTROFICA);
    db.close();
    const falha = janela.pedir("financas.categorias");
    await expect(falha).rejects.toThrow(MENSAGEM_ERRO_INTERNO);
    await falha.catch((erro: unknown) => expect(String(erro)).not.toMatch(/database|sqlite/i));
    expect(erros).toHaveBeenCalledWith(expect.stringContaining("categorias: pedido falhou por dentro"));
  });
});
