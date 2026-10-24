import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  ConclusaoTarefa,
  Lista,
  Tarefa,
  type ChamadaFerramenta,
  type MudancaTarefas,
} from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { RepositorioAgentes } from "../../agentes/agentes.ts";
import { MENSAGENS_DESFAZER, RepositorioExecucoes, ServicoExecucoes } from "../../agentes/execucoes.ts";
import { Runtime } from "../../agentes/runtime.ts";
import { TempoDoDia } from "../../areas/dia/tempo.ts";
import { RepositorioNotas, ServicoNotas } from "../../areas/notas/notas.ts";
import { RepositorioTarefas } from "../../areas/tarefas/repositorio.ts";
import {
  MENSAGEM_DESFAZER_MUDOU,
  MENSAGEM_DESFAZER_SAIU,
  MENSAGEM_DESFAZER_SUBTAREFAS,
  ServicoTarefas,
} from "../../areas/tarefas/tarefas.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import { ProvedorFalso, roteiros, type PassoRoteiro } from "../../provedores/falso.ts";
import { RegistroProvedores } from "../../provedores/registro.ts";
import { Catalogo } from "../catalogo.ts";
import { ferramentasTarefas } from "./tarefas.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** São Paulo, UTC−3 o ano todo: sexta, 09/10/2026, 10:00. */
const FUSO = "America/Sao_Paulo";
const HOJE = "2026-10-09";
const AMANHA = "2026-10-10";

/**
 * Banco migrado de verdade, as Tarefas de verdade, as ferramentas no catálogo e o runtime com um
 * provedor falso para a Alba e outro para o Nuno. O desfazer roda pelo histórico, numa transação,
 * como na interface.
 */
function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-ferramentas-tarefas-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta, { duravel: false });
  bancos.push(db);
  db.exec(`
    INSERT OR IGNORE INTO provedores (id, tipo, nome) VALUES ('p-alba', 'claude-cli', 'Falso'), ('p-nuno', 'claude-cli', 'Falso');
    UPDATE agentes SET provedor_id = 'p-' || id WHERE id IN ('alba', 'nuno');
  `);
  const relogio = { ms: Date.parse(`${HOJE}T10:00:00.000-03:00`) };
  const agora = () => new Date(relogio.ms);
  const avisos: MudancaTarefas[] = [];
  const notas = new ServicoNotas(new RepositorioNotas(db), { mudou: () => {} }, { agora });
  const tarefas = new ServicoTarefas(
    new RepositorioTarefas(db),
    { lerFuso: () => FUSO, notas },
    { tarefas: (mudanca) => avisos.push(mudanca), listas: () => {}, lembretes: () => {} },
    { agora },
  );
  const catalogo = new Catalogo(ferramentasTarefas(tarefas, new TempoDoDia(() => FUSO, agora)));
  const falsos = { alba: new ProvedorFalso("p-alba"), nuno: new ProvedorFalso("p-nuno") };
  const execucoes = new RepositorioExecucoes(db);
  const runtime = new Runtime(
    {
      agentes: new RepositorioAgentes(db),
      execucoes,
      provedores: new RegistroProvedores().registrar(
        "claude-cli",
        (config) => falsos[config.id.slice(2) as keyof typeof falsos],
      ),
      catalogo,
    },
    { execucao: () => {}, agente: () => {} },
    { agora },
  );
  const historico = new ServicoExecucoes(execucoes, catalogo, { agora, fuso: FUSO });
  const rodar = async (
    agenteId: "alba" | "nuno",
    ...passos: PassoRoteiro[]
  ): Promise<ChamadaFerramenta[]> => {
    falsos[agenteId].roteirizar([...passos, ...roteiros.resposta("Feito.")]);
    const r = await runtime.executar({
      agenteId,
      gatilho: "mensagem",
      mensagens: [{ papel: "usuario", texto: "pode fazer" }],
    });
    expect(r.execucao.estado).toBe("ok");
    relogio.ms += 1000;
    return historico.obter({ id: r.execucao.id }).chamadas;
  };
  const alba = (...passos: PassoRoteiro[]) => rodar("alba", ...passos);
  const lembretesDa = (tarefaId: string) =>
    db.prepare("SELECT id FROM lembretes WHERE tarefa_id = ? AND apagado_em IS NULL").all(tarefaId);
  return { db, relogio, tarefas, catalogo, historico, rodar, alba, lembretesDa, avisos };
}

const chamar = (nome: string, entrada: unknown): PassoRoteiro => ({ tipo: "ferramenta", nome, entrada });

function valor<T>(chamada: ChamadaFerramenta | undefined, schema: z.ZodType<T>): T {
  const resultado = chamada?.resultado as { ok: boolean; valor?: unknown; erro?: string } | undefined;
  expect(resultado?.ok, resultado?.erro).toBe(true);
  return schema.parse(resultado?.valor);
}

const recusa = (motivo: string) => MENSAGENS_DESFAZER.areaRecusou(motivo);

describe("tarefas.criar", () => {
  test("amanhã com hora ganha o lembrete; desfazer leva a tarefa e o lembrete para a lixeira", async () => {
    const m = montar();
    const [criar] = await m.alba(
      chamar("tarefas__criar", { titulo: "Ligar pro banco", venceEm: "amanha", hora: "15:00" }),
    );
    const tarefa = valor(criar, Tarefa);
    expect(tarefa).toMatchObject({
      listaId: "entrada",
      venceEm: AMANHA,
      hora: "15:00",
      lembreteMinutosAntes: 15,
      origem: "agente",
      agenteId: "alba",
    });
    expect(m.lembretesDa(tarefa.id)).toHaveLength(1);

    m.historico.desfazer({ chamadaId: criar!.id });
    expect(() => m.tarefas.obter({ id: tarefa.id })).toThrow("tarefa não encontrada");
    expect(m.lembretesDa(tarefa.id)).toHaveLength(0);
  });

  test("mudada por você, ou com subtarefa nova, não se desfaz", async () => {
    const m = montar();
    const [a, b] = await m.alba(
      chamar("tarefas__criar", { titulo: "A" }),
      chamar("tarefas__criar", { titulo: "B" }),
    );
    const idA = valor(a, Tarefa).id;
    const idB = valor(b, Tarefa).id;
    m.tarefas.definir({ id: idA, prioridade: 3 });
    m.tarefas.criar({ titulo: "B.1", tarefaPaiId: idB });

    expect(() => m.historico.desfazer({ chamadaId: a!.id })).toThrow(recusa(MENSAGEM_DESFAZER_MUDOU));
    expect(() => m.historico.desfazer({ chamadaId: b!.id })).toThrow(recusa(MENSAGEM_DESFAZER_SUBTAREFAS));
    expect(m.tarefas.obter({ id: idA }).prioridade).toBe(3);
    expect(m.tarefas.obter({ id: idB }).titulo).toBe("B");
  });

  test("o Nuno também cria, com o carimbo dele", async () => {
    const m = montar();
    const [criar] = await m.rodar("nuno", chamar("tarefas__criar", { titulo: "Atender o review do #142" }));
    expect(valor(criar, Tarefa)).toMatchObject({ agenteId: "nuno", origem: "agente" });
  });
});

describe("tarefas.definir e tarefas.adiar", () => {
  test("desfazer volta cada campo como era, com as etiquetas e o lembrete", async () => {
    const m = montar();
    const base = m.tarefas.criar({
      titulo: "Relatório",
      venceEm: HOJE,
      hora: "16:00",
      etiquetas: ["trabalho"],
      prioridade: 1,
    });
    const [definir] = await m.alba(
      chamar("tarefas__definir", {
        id: base.id,
        titulo: "Relatório mensal",
        venceEm: null,
        etiquetas: [],
        prioridade: 3,
      }),
    );
    const { tarefa, anterior } = valor(definir, z.object({ tarefa: Tarefa, anterior: z.unknown() }));
    expect(tarefa).toMatchObject({ venceEm: null, hora: null, etiquetas: [], lembreteMinutosAntes: null });
    expect(anterior).toMatchObject({ titulo: "Relatório", venceEm: HOJE, hora: "16:00" });
    expect(m.lembretesDa(base.id)).toHaveLength(0);

    m.historico.desfazer({ chamadaId: definir!.id });
    expect(m.tarefas.obter({ id: base.id })).toMatchObject({
      titulo: "Relatório",
      venceEm: HOJE,
      hora: "16:00",
      prioridade: 1,
      lembreteMinutosAntes: 15,
      etiquetas: [expect.objectContaining({ nome: "trabalho" })],
      origem: "usuario",
    });
    expect(m.lembretesDa(base.id)).toHaveLength(1);
  });

  test("desfazer só volta o que a chamada mexeu: a etiqueta apagada e o lembrete concluído depois não voltam", async () => {
    const m = montar();
    const base = m.tarefas.criar({
      titulo: "Relatório",
      venceEm: HOJE,
      hora: "16:00",
      etiquetas: ["trabalho"],
    });
    const [renomear] = await m.alba(chamar("tarefas__definir", { id: base.id, titulo: "Relatório mensal" }));
    expect(valor(renomear, z.object({ anterior: z.unknown() })).anterior).toEqual({
      id: base.id,
      titulo: "Relatório",
    });
    // Depois da Alba, você apaga a etiqueta e dá Feito no lembrete (o de uma vez vai para a lixeira).
    const [etiqueta] = m.tarefas.obter({ id: base.id }).etiquetas;
    m.tarefas.apagarEtiqueta({ id: etiqueta!.id });
    m.db
      .prepare("UPDATE lembretes SET apagado_em = ?, atualizado_em = ? WHERE tarefa_id = ?")
      .run(new Date(m.relogio.ms).toISOString(), new Date(m.relogio.ms).toISOString(), base.id);

    m.historico.desfazer({ chamadaId: renomear!.id });
    expect(m.tarefas.obter({ id: base.id })).toMatchObject({
      titulo: "Relatório",
      etiquetas: [],
      lembreteMinutosAntes: null,
    });
    expect(m.tarefas.etiquetas()).toEqual([]);
    expect(m.lembretesDa(base.id)).toHaveLength(0);
  });

  test("tirar o dia guarda a hora e o lembrete que saíram junto, e o desfazer os traz", async () => {
    const m = montar();
    const base = m.tarefas.criar({
      titulo: "Dentista",
      venceEm: HOJE,
      hora: "16:00",
      lembreteMinutosAntes: 30,
    });
    const [semDia] = await m.alba(chamar("tarefas__definir", { id: base.id, venceEm: null }));
    expect(valor(semDia, z.object({ anterior: z.unknown() })).anterior).toEqual({
      id: base.id,
      venceEm: HOJE,
      hora: "16:00",
      lembreteMinutosAntes: 30,
    });
    m.historico.desfazer({ chamadaId: semDia!.id });
    expect(m.tarefas.obter({ id: base.id })).toMatchObject({
      venceEm: HOJE,
      hora: "16:00",
      lembreteMinutosAntes: 30,
    });
  });

  test("o aviso do desfazer sai depois da transação dele", async () => {
    const m = montar();
    const [criar] = await m.alba(chamar("tarefas__criar", { titulo: "Pão" }));
    const id = valor(criar, Tarefa).id;
    const antes = m.avisos.length;
    m.historico.desfazer({ chamadaId: criar!.id });
    expect(m.avisos).toHaveLength(antes);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(m.avisos.slice(antes)).toEqual([{ tarefas: [], apagadas: [id] }]);
  });

  test("adiar várias para amanhã volta todas; se uma mudou depois, nenhuma volta", async () => {
    const m = montar();
    const a = m.tarefas.criar({ titulo: "A", venceEm: "2026-10-08" });
    const b = m.tarefas.criar({ titulo: "B", venceEm: HOJE, hora: "09:00" });
    const [adiar] = await m.alba(chamar("tarefas__adiar", { ids: [a.id, b.id], para: "amanha" }));
    expect(valor(adiar, z.object({ tarefas: z.array(Tarefa) })).tarefas.map((t) => t.venceEm)).toEqual([
      AMANHA,
      AMANHA,
    ]);
    const [adiar2] = await m.alba(
      chamar("tarefas__adiar", { ids: [a.id, b.id], para: "hoje", hora: "11:00" }),
    );

    m.historico.desfazer({ chamadaId: adiar2!.id });
    expect(
      [m.tarefas.obter({ id: a.id }), m.tarefas.obter({ id: b.id })].map((t) => [t.venceEm, t.hora]),
    ).toEqual([
      [AMANHA, null],
      [AMANHA, "09:00"],
    ]);

    m.tarefas.definir({ id: b.id, titulo: "B do usuário" });
    expect(() => m.historico.desfazer({ chamadaId: adiar!.id })).toThrow(recusa(MENSAGEM_DESFAZER_MUDOU));
    // A primeira conferia e passava: todas são conferidas antes de a primeira voltar.
    expect(m.tarefas.obter({ id: a.id }).venceEm).toBe(AMANHA);
  });
});

describe("tarefas.concluir e tarefas.cancelar", () => {
  test("desfazer reabre a tarefa e as subtarefas que fecharam junto, e tira a próxima da recorrente", async () => {
    const m = montar();
    const mae = m.tarefas.criar({ titulo: "Regar", venceEm: HOJE, recorrencia: "FREQ=DAILY" });
    const aberta = m.tarefas.criar({ titulo: "Samambaia", tarefaPaiId: mae.id });
    const jaFeita = m.tarefas.criar({ titulo: "Cacto", tarefaPaiId: mae.id });
    m.tarefas.concluir({ id: jaFeita.id });

    const [concluir] = await m.alba(chamar("tarefas__concluir", { id: mae.id }));
    const { proxima } = valor(concluir, ConclusaoTarefa);
    expect(proxima).toMatchObject({ venceEm: AMANHA, estado: "aberta" });
    expect(m.tarefas.obter({ id: aberta.id }).estado).toBe("feita");

    m.historico.desfazer({ chamadaId: concluir!.id });
    expect(m.tarefas.obter({ id: mae.id }).estado).toBe("aberta");
    expect(m.tarefas.obter({ id: aberta.id }).estado).toBe("aberta");
    // A que você já tinha feito antes continua feita.
    expect(m.tarefas.obter({ id: jaFeita.id }).estado).toBe("feita");
    expect(() => m.tarefas.obter({ id: proxima!.id })).toThrow("tarefa não encontrada");
  });

  test("descartar se desfaz; a tarefa que não está aberta volta ao modelo como erro", async () => {
    const m = montar();
    const t = m.tarefas.criar({ titulo: "Academia" });
    const feita = m.tarefas.criar({ titulo: "Pão" });
    m.tarefas.concluir({ id: feita.id });
    const [cancelar, deNovo] = await m.alba(
      chamar("tarefas__cancelar", { id: t.id }),
      chamar("tarefas__concluir", { id: feita.id }),
    );
    expect(valor(cancelar, Tarefa).estado).toBe("cancelada");
    expect((deNovo!.resultado as { erro: string }).erro).toBe(
      "tarefas.concluir falhou: a tarefa já está feita",
    );

    m.historico.desfazer({ chamadaId: cancelar!.id });
    expect(m.tarefas.obter({ id: t.id }).estado).toBe("aberta");
    m.tarefas.apagar({ id: t.id });
    expect(() => m.historico.desfazer({ chamadaId: cancelar!.id })).toThrow(/Já foi desfeita/);
  });

  test("a tarefa que foi para a lixeira não se desfaz", async () => {
    const m = montar();
    const t = m.tarefas.criar({ titulo: "Academia" });
    const [concluir] = await m.alba(chamar("tarefas__concluir", { id: t.id }));
    m.tarefas.apagar({ id: t.id });
    expect(() => m.historico.desfazer({ chamadaId: concluir!.id })).toThrow(recusa(MENSAGEM_DESFAZER_SAIU));
  });
});

describe("leitura", () => {
  test("listas.listar e tarefas.listar com a data de hoje no fuso do usuário", async () => {
    const m = montar();
    m.tarefas.criar({ titulo: "Hoje", venceEm: HOJE });
    m.tarefas.criar({ titulo: "Amanhã", venceEm: AMANHA });
    const [listas, hoje] = await m.alba(
      chamar("listas__listar", {}),
      chamar("tarefas__listar", { vista: "hoje" }),
    );
    expect(valor(listas, z.array(Lista)).map((l) => l.id)).toEqual(["entrada", "trabalho", "pessoal"]);
    const lido = valor(hoje, z.object({ hoje: z.string(), tarefas: z.array(Tarefa) }));
    expect(lido.hoje).toBe(HOJE);
    expect(lido.tarefas.map((t) => t.titulo)).toEqual(["Hoje"]);
  });
});
