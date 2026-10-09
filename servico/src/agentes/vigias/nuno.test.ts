import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Execucao, ItemGithub, MudancaSessao, SessaoIa } from "@moductus/contrato";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { abrirBanco } from "../../banco/conexao.ts";
import type { PedidoExecucao, ResultadoExecucao } from "../runtime.ts";
import {
  gravarAvisoDoNuno,
  INTERVALO_MINIMO_MS,
  JANELA_SESSAO_MS,
  VigiaNuno,
  type AvisoDoNuno,
} from "./nuno.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T12:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const item = (numero: number, mudanca: Partial<ItemGithub> = {}): ItemGithub => ({
  id: `i${numero}`,
  repositorio: "loja/api",
  numero,
  tipo: "pr",
  titulo: `PR ${numero}`,
  autor: "colega",
  estado: "aberto",
  meuPapel: "revisor",
  precisaDeMim: true,
  ciEstado: null,
  atualizadoNoGithub: null,
  url: `https://github.com/loja/api/pull/${numero}`,
  ...mudanca,
});

const sessao = (id: string, estado: SessaoIa["estado"], mudanca: Partial<SessaoIa> = {}): MudancaSessao => ({
  sessao: {
    id,
    projetoId: "p1",
    ferramenta: "claude-code",
    idExterno: id,
    modelo: null,
    estado,
    iniciadaEm: null,
    ultimoEventoEm: null,
    encerradaEm: null,
    contexto: null,
    ultimoEvento: null,
    ...mudanca,
  },
  projeto: { id: "p1", nome: "moductus", caminho: "V:\\moductus", repositorio: null, arquivado: false },
});

const contexto = (sessaoId: string) => ({
  sessaoId,
  titulo: "Contexto em 85%",
  corpo:
    "A sessão do Claude Code em moductus chegou a 85% do contexto. Vale compactar com /compact ou encerrar.",
  usadoTokens: 170_000,
  janelaTokens: 200_000,
});

/** O runtime de mentira: cada despertar responde o próximo resultado do roteiro (padrão: ok). */
function montar(conhecidos: ItemGithub[] = []) {
  const pedidos: PedidoExecucao[] = [];
  const avisos: AvisoDoNuno[] = [];
  const respostas: { estado: Execucao["estado"]; texto: string }[] = [];
  let n = 0;
  const executar = (pedido: PedidoExecucao): Promise<ResultadoExecucao> => {
    pedidos.push(pedido);
    const r = respostas.shift() ?? { estado: "ok" as const, texto: "O #412 vem primeiro: review pedido." };
    const execucao = { id: `e${++n}`, estado: r.estado } as Execucao;
    return Promise.resolve({ execucao, texto: r.texto, continuacao: null, falha: null, sono: null });
  };
  const vigia = new VigiaNuno({ executar, githubConhecido: conhecidos, avisar: (a) => avisos.push(a) });
  return { vigia, pedidos, avisos, respostas };
}

describe("vigia do GitHub", () => {
  test("o que já estava no cache não acorda; item novo que precisa de você acorda uma vez", async () => {
    const { vigia, pedidos, avisos } = montar([item(1)]);
    vigia.aoLerGithub({ itens: [item(1), item(2, { precisaDeMim: false })], atualizadoEm: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(pedidos).toHaveLength(0);

    vigia.aoLerGithub({ itens: [item(1), item(412)], atualizadoEm: null });
    await vi.advanceTimersByTimeAsync(0);
    await vigia.ocioso();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({ agenteId: "nuno", gatilho: "evento" });
    const texto = pedidos[0]!.mensagens[0]!.texto;
    expect(texto).toContain('- PR #412 de loja/api ("PR 412"): review pedido a você.');
    expect(texto).not.toContain("#1 ");
    expect(texto).toContain("Não comente, não aprove e não aja fora do Moductus");
    expect(avisos).toEqual([
      {
        titulo: "1 item precisa de você",
        corpo: "O #412 vem primeiro: review pedido.",
        referencia: "vigia:nuno:e1",
        execucaoId: "e1",
      },
    ]);

    // A leitura seguinte, igual, não traz novidade.
    vigia.aoLerGithub({ itens: [item(1), item(412)], atualizadoEm: null });
    await vi.advanceTimersByTimeAsync(INTERVALO_MINIMO_MS);
    expect(pedidos).toHaveLength(1);
  });

  test("motivo novo no mesmo item (o CI quebrou) é novidade; o que deixou de precisar sai da pauta", async () => {
    const meu = item(9, { meuPapel: "autor", ciEstado: "rodando" });
    const { vigia, pedidos, respostas } = montar([meu]);
    vigia.aoLerGithub({ itens: [{ ...meu, ciEstado: "falhou" }], atualizadoEm: null });
    expect(vigia.anotados()).toEqual(["github:loja/api#9"]);
    respostas.push({ estado: "erro", texto: "" });
    await vi.advanceTimersByTimeAsync(0);
    await vigia.ocioso();
    expect(pedidos[0]!.mensagens[0]!.texto).toContain("CI quebrado no seu PR");
    // Falhou: fica na pauta até a leitura dizer que o item não precisa mais de você.
    expect(vigia.anotados()).toEqual(["github:loja/api#9"]);
    vigia.aoLerGithub({ itens: [{ ...meu, ciEstado: "passou", precisaDeMim: false }], atualizadoEm: null });
    expect(vigia.anotados()).toEqual([]);
  });

  test("sem modelo, a pauta espera; a leitura depois do intervalo tenta de novo, uma vez", async () => {
    const { vigia, pedidos, avisos, respostas } = montar();
    respostas.push({ estado: "erro", texto: "" });
    vigia.aoLerGithub({ itens: [item(5)], atualizadoEm: null });
    await vi.advanceTimersByTimeAsync(0);
    await vigia.ocioso();
    expect(pedidos).toHaveLength(1);
    expect(avisos).toHaveLength(0);

    // A leitura de 15 em 15 minutos é a hora de tentar de novo; antes do intervalo, não.
    await vi.advanceTimersByTimeAsync(INTERVALO_MINIMO_MS - 1000);
    vigia.aoLerGithub({ itens: [item(5)], atualizadoEm: null });
    await vi.advanceTimersByTimeAsync(500);
    expect(pedidos).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    await vigia.ocioso();
    expect(pedidos).toHaveLength(2);
    expect(avisos).toHaveLength(1);
    expect(vigia.anotados()).toEqual([]);
  });

  test("desligar o GitHub esvazia o que era dele na pauta", () => {
    const { vigia } = montar();
    vigia.parar();
    vigia.aoLerGithub({ itens: [item(5)], atualizadoEm: null });
    expect(vigia.anotados()).toEqual(["github:loja/api#5"]);
    vigia.aoLerGithub({ itens: [], atualizadoEm: null });
    expect(vigia.anotados()).toEqual([]);
  });
});

describe("vigias de sessão e de contexto", () => {
  test("um aviso de contexto sozinho não acorda: ele já está no dock", async () => {
    const { vigia, pedidos } = montar();
    vigia.aoAvisarContexto(contexto("s1"));
    await vi.advanceTimersByTimeAsync(INTERVALO_MINIMO_MS * 4);
    expect(pedidos).toHaveLength(0);
    expect(vigia.anotados()).toEqual(["contexto:s1"]);
  });

  test("sessão esperando você passa da janela e, com o contexto alto, acorda para priorizar", async () => {
    const { vigia, pedidos, avisos } = montar();
    vigia.aoAvisarContexto(contexto("s1"));
    vigia.aoMudarSessao(sessao("s2", "trabalhando"));
    vigia.aoMudarSessao(sessao("s2", "esperando"));
    await vi.advanceTimersByTimeAsync(JANELA_SESSAO_MS - 1);
    expect(pedidos).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await vigia.ocioso();
    expect(pedidos).toHaveLength(1);
    const texto = pedidos[0]!.mensagens[0]!.texto;
    expect(texto).toContain("- A sessão do Claude Code em moductus está esperando você.");
    expect(texto).toContain("chegou a 85% do contexto");
    expect(avisos[0]?.titulo).toBe("2 itens precisam de você");
    expect(vigia.anotados()).toEqual([]);
  });

  test("quem responde dentro da janela não entra na conta; compactar tira o aviso de contexto", async () => {
    const { vigia, pedidos } = montar();
    vigia.aoAvisarContexto(contexto("s1"));
    vigia.aoMudarSessao(sessao("s2", "esperando"));
    await vi.advanceTimersByTimeAsync(JANELA_SESSAO_MS / 2);
    vigia.aoMudarSessao(sessao("s2", "trabalhando"));
    await vi.advanceTimersByTimeAsync(JANELA_SESSAO_MS);
    expect(pedidos).toHaveLength(0);
    expect(vigia.anotados()).toEqual(["contexto:s1"]);

    vigia.aoMudarSessao(
      sessao("s1", "trabalhando", { contexto: { usadoTokens: 30_000, janelaTokens: 200_000 } }),
    );
    expect(vigia.anotados()).toEqual([]);
  });

  test("continuar esperando não anota de novo; sessão encerrada leva o aviso de contexto", () => {
    const { vigia } = montar();
    vigia.parar();
    vigia.aoMudarSessao(sessao("s2", "esperando"));
    vigia.aoMudarSessao(sessao("s2", "esperando"));
    expect(vigia.anotados()).toEqual(["sessao:s2"]);
    vigia.aoAvisarContexto(contexto("s2"));
    vigia.aoMudarSessao(sessao("s2", "terminou", { encerradaEm: "2026-10-09T12:00:00.000Z" }));
    expect(vigia.anotados()).toEqual([]);
  });

  test("sem novidade do GitHub, dois despertares ficam a pelo menos 15 minutos um do outro", async () => {
    const { vigia, pedidos } = montar();
    vigia.aoAvisarContexto(contexto("s1"));
    vigia.aoAvisarContexto(contexto("s2"));
    await vi.advanceTimersByTimeAsync(0);
    await vigia.ocioso();
    expect(pedidos).toHaveLength(1);

    vigia.aoAvisarContexto(contexto("s3"));
    vigia.aoAvisarContexto(contexto("s4"));
    await vi.advanceTimersByTimeAsync(INTERVALO_MINIMO_MS - 1);
    expect(pedidos).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await vigia.ocioso();
    expect(pedidos).toHaveLength(2);
  });

  test("o que chega durante o despertar fica para o próximo", async () => {
    let soltar: (() => void) | null = null;
    const pedidos: PedidoExecucao[] = [];
    const vigia = new VigiaNuno({
      githubConhecido: [],
      avisar: () => {},
      executar: async (pedido) => {
        pedidos.push(pedido);
        if (pedidos.length === 1) await new Promise<void>((r) => (soltar = r));
        return {
          execucao: { id: `e${pedidos.length}`, estado: "ok" } as Execucao,
          texto: "ok",
          continuacao: null,
          falha: null,
          sono: null,
        };
      },
    });
    vigia.aoLerGithub({ itens: [item(1)], atualizadoEm: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(pedidos).toHaveLength(1);
    vigia.aoLerGithub({ itens: [item(1), item(2)], atualizadoEm: null });
    expect(vigia.anotados()).toEqual(["github:loja/api#1", "github:loja/api#2"]);
    soltar!();
    await vi.advanceTimersByTimeAsync(0);
    await vigia.ocioso();
    expect(pedidos).toHaveLength(2);
    expect(pedidos[1]!.mensagens[0]!.texto).toContain("#2");
    expect(pedidos[1]!.mensagens[0]!.texto).not.toContain("#1 ");
    expect(vigia.anotados()).toEqual([]);
  });
});

describe("aviso do Nuno no banco", () => {
  test("vai para notificacoes com o carimbo da execução, para a área de notificações entregar", () => {
    const pasta = mkdtempSync(join(tmpdir(), "moductus-vigia-nuno-"));
    pastas.push(pasta);
    const db = abrirBanco(pasta);
    bancos.push(db);
    gravarAvisoDoNuno(db)({
      titulo: "1 item precisa de você",
      corpo: "O #412.",
      referencia: "vigia:nuno:e1",
      execucaoId: "e1",
    });
    expect(
      db
        .prepare(
          "SELECT do_agente_id, tipo, titulo, corpo, referencia, canal, origem, agente_id, execucao_id, vista_em FROM notificacoes",
        )
        .all(),
    ).toEqual([
      {
        do_agente_id: "nuno",
        tipo: "aviso",
        titulo: "1 item precisa de você",
        corpo: "O #412.",
        referencia: "vigia:nuno:e1",
        canal: "dock",
        origem: "agente",
        agente_id: "nuno",
        execucao_id: "e1",
        vista_em: null,
      },
    ]);
  });
});
