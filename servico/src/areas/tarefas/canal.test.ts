import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { METODOS, type MudancaTarefas, type NomeMetodo } from "@moductus/contrato";
import { ClienteServico } from "@moductus/contrato/cliente";
import { afterEach, describe, expect, test, vi } from "vitest";
import { abrirServidorWs, semAtendente, type ServidorWs } from "../../api/servidor.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import { RepositorioNotas, ServicoNotas } from "../notas/notas.ts";
import { atendentesDasTarefas, MENSAGEM_ERRO_INTERNO } from "./canal.ts";
import { RepositorioTarefas } from "./repositorio.ts";
import { MENSAGEM_LISTA_PADRAO, MENSAGEM_TAREFA_NAO_ENCONTRADA, ServicoTarefas } from "./tarefas.ts";

const TOKEN = "b".repeat(64);
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

/**
 * O serviço como o `main.ts` monta: a área ligada ao canal WebSocket de verdade, os avisos saindo
 * por `emitir`, e uma janela (o cliente do contrato) conectada.
 */
async function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-tarefas-canal-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  let servidor: ServidorWs | null = null;
  const notas = new ServicoNotas(new RepositorioNotas(db), { mudou: () => {} });
  const tarefas = new ServicoTarefas(
    new RepositorioTarefas(db),
    { lerFuso: () => "America/Sao_Paulo", notas },
    {
      tarefas: (m) => servidor?.emitir("tarefas.mudou", m),
      listas: (l) => servidor?.emitir("listas.mudou", l),
      lembretes: (m) => servidor?.emitir("lembretes.mudou", m),
    },
  );
  servidor = await abrirServidorWs(TOKEN, {
    ...semAtendente(Object.keys(METODOS) as NomeMetodo[]),
    ...atendentesDasTarefas(tarefas),
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

/** O próximo evento daquele nome que a janela recebe. */
const proximo = <D>(janela: ClienteServico, nome: "tarefas.mudou" | "listas.mudou" | "lembretes.mudou") =>
  new Promise<D>((pronto) => {
    const parar = janela.ouvir(nome, (dados) => {
      parar();
      pronto(dados as D);
    });
  });

describe("Tarefas no canal", () => {
  test("criar pela janela faz `tarefas.mudou` e `lembretes.mudou` chegarem a ela", async () => {
    const { janela } = await montar();
    const mudou = proximo<MudancaTarefas>(janela, "tarefas.mudou");
    const lembrete = proximo<{ lembretes: { tarefaId: string | null }[] }>(janela, "lembretes.mudou");
    const criada = await janela.pedir("tarefas.criar", {
      titulo: "Ligar pro banco",
      venceEm: "2026-10-19",
      hora: "15:00",
    });
    expect(criada).toMatchObject({ listaId: "entrada", lembreteMinutosAntes: 15 });
    await expect(mudou).resolves.toEqual({ tarefas: [criada], apagadas: [] });
    expect((await lembrete).lembretes.map((l) => l.tarefaId)).toEqual([criada.id]);

    const concluida = proximo<MudancaTarefas>(janela, "tarefas.mudou");
    await janela.pedir("tarefas.concluir", { id: criada.id });
    expect((await concluida).tarefas[0]).toMatchObject({ id: criada.id, estado: "feita" });
  });

  test("`listas.mudou` chega com todas as listas", async () => {
    const { janela } = await montar();
    const mudou = proximo<{ id: string }[]>(janela, "listas.mudou");
    const lista = await janela.pedir("listas.criar", { nome: "Casa" });
    expect((await mudou).map((l) => l.id)).toEqual(["entrada", "trabalho", "pessoal", lista.id]);
  });

  test("erro da regra chega legível; erro de dentro chega como texto genérico, sem o detalhe", async () => {
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, janela } = await montar();
    await expect(janela.pedir("tarefas.obter", { id: "nao-existe" })).rejects.toThrow(
      MENSAGEM_TAREFA_NAO_ENCONTRADA,
    );
    await expect(janela.pedir("listas.apagar", { id: "entrada" })).rejects.toThrow(MENSAGEM_LISTA_PADRAO);
    db.close();
    const falha = janela.pedir("tarefas.listar", {});
    await expect(falha).rejects.toThrow(MENSAGEM_ERRO_INTERNO);
    await falha.catch((erro: unknown) => expect(String(erro)).not.toMatch(/database|sqlite/i));
    expect(erros).toHaveBeenCalledWith(expect.stringContaining("tarefas: pedido falhou por dentro"));
  });
});
