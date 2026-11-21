import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Nota, ResultadoSalvarNota, type ChamadaFerramenta } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { RepositorioAgentes } from "../../agentes/agentes.ts";
import { MENSAGENS_DESFAZER, RepositorioExecucoes, ServicoExecucoes } from "../../agentes/execucoes.ts";
import { Runtime } from "../../agentes/runtime.ts";
import { MENSAGEM_DESFAZER_MUDOU, RepositorioNotas, ServicoNotas } from "../../areas/notas/notas.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import { ProvedorFalso, roteiros, type PassoRoteiro } from "../../provedores/falso.ts";
import { RegistroProvedores } from "../../provedores/registro.ts";
import { Catalogo } from "../catalogo.ts";
import { MENSAGEM_NADA_GRAVADO, ferramentasNotas } from "./notas.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** Banco migrado de verdade, as Notas de verdade e o runtime com um provedor falso na Alba. */
function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-ferramentas-notas-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta, { duravel: false });
  bancos.push(db);
  db.exec(`
    INSERT OR IGNORE INTO provedores (id, tipo, nome) VALUES ('p-alba', 'claude-cli', 'Falso');
    UPDATE agentes SET provedor_id = 'p-alba' WHERE id = 'alba';
  `);
  const relogio = { ms: Date.parse("2026-10-09T13:00:00.000Z") };
  const agora = () => new Date(relogio.ms);
  const notas = new ServicoNotas(new RepositorioNotas(db), { mudou: () => {} }, { agora });
  const catalogo = new Catalogo(ferramentasNotas(notas));
  const falso = new ProvedorFalso("p-alba");
  const execucoes = new RepositorioExecucoes(db);
  const runtime = new Runtime(
    {
      agentes: new RepositorioAgentes(db),
      execucoes,
      provedores: new RegistroProvedores().registrar("claude-cli", () => falso),
      catalogo,
    },
    { execucao: () => {}, agente: () => {} },
    { agora },
  );
  const historico = new ServicoExecucoes(execucoes, catalogo, { agora });
  const alba = async (...passos: PassoRoteiro[]): Promise<ChamadaFerramenta[]> => {
    falso.roteirizar([...passos, ...roteiros.resposta("Feito.")]);
    const r = await runtime.executar({
      agenteId: "alba",
      gatilho: "mensagem",
      mensagens: [{ papel: "usuario", texto: "anota aí" }],
    });
    expect(r.execucao.estado).toBe("ok");
    relogio.ms += 1000;
    return historico.obter({ id: r.execucao.id }).chamadas;
  };
  return { notas, historico, alba, relogio };
}

const chamar = (nome: string, entrada: unknown): PassoRoteiro => ({ tipo: "ferramenta", nome, entrada });

function valor<T>(chamada: ChamadaFerramenta | undefined, schema: z.ZodType<T>): T {
  const resultado = chamada?.resultado as { ok: boolean; valor?: unknown; erro?: string } | undefined;
  expect(resultado?.ok, resultado?.erro).toBe(true);
  return schema.parse(resultado?.valor);
}

const recusa = (motivo: string) => MENSAGENS_DESFAZER.areaRecusou(motivo);

describe("notas.criar", () => {
  test("desfazer leva a nota à lixeira; fixada ou editada por você depois, não", async () => {
    const m = montar();
    const [a, b, c] = await m.alba(
      chamar("notas__criar", { titulo: "Viagem", conteudo: "- passagem\n- hotel" }),
      chamar("notas__criar", { titulo: "Mercado", conteudo: "pão" }),
      chamar("notas__criar", { titulo: "Livros" }),
    );
    const viagem = valor(a, Nota);
    expect(viagem).toMatchObject({ origem: "agente", agenteId: "alba", fixada: false });
    const mercado = valor(b, Nota);
    const livros = valor(c, Nota);
    m.notas.definir({ id: mercado.id, fixada: true });
    m.notas.salvar({ id: livros.id, versao: livros.atualizadoEm, conteudo: "Duna" });

    m.historico.desfazer({ chamadaId: a!.id });
    expect(() => m.notas.obter({ id: viagem.id })).toThrow("nota não encontrada");
    expect(() => m.historico.desfazer({ chamadaId: b!.id })).toThrow(recusa(MENSAGEM_DESFAZER_MUDOU));
    expect(() => m.historico.desfazer({ chamadaId: c!.id })).toThrow(recusa(MENSAGEM_DESFAZER_MUDOU));
    expect(m.notas.obter({ id: mercado.id }).fixada).toBe(true);
  });
});

describe("notas.salvar", () => {
  test("com a versão lida, troca o texto e o desfazer volta o de antes", async () => {
    const m = montar();
    const nota = m.notas.criar({ titulo: "Ideias", conteudo: "uma" });
    m.relogio.ms += 1000;
    const [salvar] = await m.alba(
      chamar("notas__salvar", { id: nota.id, versao: nota.atualizadoEm, conteudo: "uma\nduas" }),
    );
    expect(valor(salvar, ResultadoSalvarNota)).toMatchObject({
      salvou: true,
      nota: { conteudo: "uma\nduas" },
    });

    m.historico.desfazer({ chamadaId: salvar!.id });
    const depois = m.notas.obter({ id: nota.id });
    expect(depois).toMatchObject({ titulo: "Ideias", conteudo: "uma", origem: "usuario" });
    // Volta com versão nova: a janela aberta com a versão da Alba não grava por cima.
    expect(depois.atualizadoEm > nota.atualizadoEm).toBe(true);
  });

  test("com a versão velha não grava, devolve as duas, e não há o que desfazer", async () => {
    const m = montar();
    const nota = m.notas.criar({ titulo: "Ideias", conteudo: "uma" });
    m.relogio.ms += 1000;
    m.notas.salvar({ id: nota.id, versao: nota.atualizadoEm, conteudo: "do usuário" });
    const [salvar] = await m.alba(
      chamar("notas__salvar", { id: nota.id, versao: nota.atualizadoEm, conteudo: "da Alba" }),
    );
    expect(valor(salvar, ResultadoSalvarNota)).toMatchObject({
      salvou: false,
      atual: { conteudo: "do usuário" },
      recusada: { conteudo: "da Alba" },
    });
    expect(() => m.historico.desfazer({ chamadaId: salvar!.id })).toThrow(recusa(MENSAGEM_NADA_GRAVADO));
    expect(m.notas.obter({ id: nota.id }).conteudo).toBe("do usuário");
  });

  test("editada depois da Alba, o desfazer recusa e não passa por cima", async () => {
    const m = montar();
    const nota = m.notas.criar({ titulo: "Ideias", conteudo: "uma" });
    m.relogio.ms += 1000;
    const [salvar] = await m.alba(
      chamar("notas__salvar", { id: nota.id, versao: nota.atualizadoEm, titulo: "Ideias!" }),
    );
    const daAlba = m.notas.obter({ id: nota.id });
    m.notas.salvar({ id: nota.id, versao: daAlba.atualizadoEm, conteudo: "três" });
    expect(() => m.historico.desfazer({ chamadaId: salvar!.id })).toThrow(recusa(MENSAGEM_DESFAZER_MUDOU));
    expect(m.notas.obter({ id: nota.id })).toMatchObject({ titulo: "Ideias!", conteudo: "três" });
  });
});

describe("leitura", () => {
  test("listar, obter e buscar sem acento", async () => {
    const m = montar();
    const nota = m.notas.criar({ titulo: "Amanhã", conteudo: "levar o guarda-chuva" });
    const [listar, obter, buscar] = await m.alba(
      chamar("notas__listar", {}),
      chamar("notas__obter", { id: nota.id }),
      chamar("notas__buscar", { texto: "amanha" }),
    );
    expect(valor(listar, z.array(z.object({ id: z.string() }))).map((n) => n.id)).toContain(nota.id);
    expect(valor(obter, Nota).conteudo).toBe("levar o guarda-chuva");
    expect(valor(buscar, z.array(z.object({ id: z.string() }))).map((n) => n.id)).toEqual([nota.id]);
  });
});
