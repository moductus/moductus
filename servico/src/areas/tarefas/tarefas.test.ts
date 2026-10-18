import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  METODOS,
  type Lista,
  type MudancaLembretes,
  type MudancaTarefas,
  type Tarefa,
} from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../../banco/conexao.ts";
import { MENSAGEM_NOTA_DA_TAREFA, RepositorioNotas, ServicoNotas } from "../notas/notas.ts";
import { RepositorioTarefas } from "./repositorio.ts";
import {
  LIMITE_IDS,
  MENSAGEM_ENTRADA_ARQUIVADA,
  MENSAGEM_ETIQUETA_NOME,
  MENSAGEM_ELA_MESMA,
  MENSAGEM_ETIQUETA_REPETIDA,
  MENSAGEM_HORA_SEM_DIA,
  MENSAGEM_IDS_DEMAIS,
  MENSAGEM_IDS_REPETIDOS,
  MENSAGEM_LEMBRETE_SEM_HORA,
  MENSAGEM_LISTA_DA_MAE,
  MENSAGEM_LISTA_NAO_ENCONTRADA,
  MENSAGEM_LISTA_PADRAO,
  MENSAGEM_MAE_FECHADA,
  MENSAGEM_TAREFA_NAO_ENCONTRADA,
  MENSAGEM_UM_NIVEL,
  proximaOcorrencia,
  ServicoTarefas,
} from "./tarefas.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** Quanto um pedido de milhares de ids pode levar (a meta é bem menos; folga para a máquina do CI). */
const PRAZO_LOTE_MS = 1000;

/** Domingo, 18/10/2026, 09:00 em São Paulo (UTC−3, sem horário de verão). */
const DOMINGO_9H = "2026-10-18T12:00:00.000Z";

/**
 * Banco migrado de verdade (as três listas padrão semeadas), as Notas de verdade para o `nota_id` e
 * um relógio que só anda quando o teste manda.
 */
function montar(agora = DOMINGO_9H) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-tarefas-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  const relogio = { agora: new Date(agora) };
  const andar = (ms = 1000) => {
    relogio.agora = new Date(relogio.agora.getTime() + ms);
  };
  const eventos = {
    tarefas: [] as MudancaTarefas[],
    listas: [] as Lista[][],
    lembretes: [] as MudancaLembretes[],
  };
  const notas = new ServicoNotas(
    new RepositorioNotas(db),
    { mudou: () => {} },
    { agora: () => relogio.agora },
  );
  // Quantas vezes o fuso foi lido do config (no serviço, cada leitura vai ao banco).
  const leituras = { fuso: 0 };
  const tarefas = new ServicoTarefas(
    new RepositorioTarefas(db),
    {
      lerFuso: () => {
        leituras.fuso++;
        return "America/Sao_Paulo";
      },
      notas,
    },
    {
      tarefas: (m) => eventos.tarefas.push(m),
      listas: (l) => eventos.listas.push(l),
      lembretes: (m) => eventos.lembretes.push(m),
    },
    { agora: () => relogio.agora },
  );
  const limpar = () => {
    eventos.tarefas.length = 0;
    eventos.listas.length = 0;
    eventos.lembretes.length = 0;
  };
  return { db, tarefas, notas, eventos, andar, relogio, limpar, leituras };
}

/** A resposta passa pelo schema de saída do contrato, como no canal. */
const confere = <M extends keyof typeof METODOS>(metodo: M, saida: unknown) => {
  const r = METODOS[metodo].saida.safeParse(saida);
  expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
};

interface LinhaLembreteTeste {
  id: string;
  texto: string;
  quando: string;
  estado: string;
  disparado_em: string | null;
  apagado_em: string | null;
}

/** Os lembretes ligados à tarefa, vivos e na lixeira, direto do banco. */
const lembretesDe = (db: DatabaseSync, tarefaId: string) =>
  db
    .prepare(
      "SELECT id, texto, quando, estado, disparado_em, apagado_em FROM lembretes WHERE tarefa_id = ? ORDER BY criado_em, id",
    )
    .all(tarefaId) as unknown as LinhaLembreteTeste[];

const vivos = (db: DatabaseSync, tarefaId: string) =>
  lembretesDe(db, tarefaId).filter((l) => l.apagado_em === null);

const apagadoEm = (db: DatabaseSync, tabela: string, id: string) =>
  (db.prepare(`SELECT apagado_em FROM ${tabela} WHERE id = ?`).get(id) as { apagado_em: string | null })
    .apagado_em;

describe("listas", () => {
  test("as três padrão vêm em ordem; a nova vai para o fim e avisa todas", () => {
    const { tarefas, eventos } = montar();
    expect(tarefas.listas().map((l) => l.id)).toEqual(["entrada", "trabalho", "pessoal"]);
    const viagem = tarefas.criarLista({ nome: "Viagem de dezembro", cor: "ambar" });
    confere("listas.criar", viagem);
    expect(viagem).toMatchObject({ nome: "Viagem de dezembro", cor: "ambar", ordem: 3, arquivada: false });
    expect(eventos.listas.at(-1)?.map((l) => l.id)).toEqual(["entrada", "trabalho", "pessoal", viagem.id]);
    confere("listas.listar", tarefas.listas());
  });

  test("renomear, arquivar e ordenar; a Entrada não se arquiva", () => {
    const { tarefas } = montar();
    expect(tarefas.definirLista({ id: "trabalho", nome: "Firma", arquivada: true })).toMatchObject({
      nome: "Firma",
      arquivada: true,
    });
    expect(() => tarefas.definirLista({ id: "entrada", arquivada: true })).toThrow(
      MENSAGEM_ENTRADA_ARQUIVADA,
    );
    const ordem = tarefas.ordenarListas({ ids: ["pessoal", "entrada", "trabalho"] });
    confere("listas.ordenar", ordem);
    expect(ordem.map((l) => l.id)).toEqual(["pessoal", "entrada", "trabalho"]);
    expect(() => tarefas.ordenarListas({ ids: ["pessoal", "pessoal"] })).toThrow(MENSAGEM_IDS_REPETIDOS);
    expect(() => tarefas.definirLista({ id: "nao-existe", nome: "x" })).toThrow(
      MENSAGEM_LISTA_NAO_ENCONTRADA,
    );
  });

  test("as padrão não vão à lixeira; a lista apagada leva as tarefas e os lembretes delas", () => {
    const { db, tarefas, eventos, limpar } = montar();
    for (const id of ["entrada", "trabalho", "pessoal"]) {
      expect(() => tarefas.apagarLista({ id })).toThrow(MENSAGEM_LISTA_PADRAO);
    }
    const viagem = tarefas.criarLista({ nome: "Viagem" });
    const mala = tarefas.criar({
      titulo: "Fazer a mala",
      listaId: viagem.id,
      venceEm: "2026-12-20",
      hora: "08:00",
    });
    const meias = tarefas.criar({ titulo: "Meias", tarefaPaiId: mala.id });
    const [lembrete] = vivos(db, mala.id);
    limpar();
    const ficam = tarefas.apagarLista({ id: viagem.id });
    confere("listas.apagar", ficam);
    expect(ficam.map((l) => l.id)).toEqual(["entrada", "trabalho", "pessoal"]);
    expect(apagadoEm(db, "listas", viagem.id)).not.toBeNull();
    expect(apagadoEm(db, "tarefas", mala.id)).not.toBeNull();
    expect(apagadoEm(db, "tarefas", meias.id)).not.toBeNull();
    expect(apagadoEm(db, "lembretes", lembrete!.id)).not.toBeNull();
    expect(eventos.tarefas).toEqual([{ tarefas: [], apagadas: expect.arrayContaining([mala.id, meias.id]) }]);
    expect(eventos.lembretes).toEqual([{ lembretes: [], removidos: [lembrete!.id] }]);
    expect(eventos.listas.at(-1)?.map((l) => l.id)).toEqual(["entrada", "trabalho", "pessoal"]);
    expect(tarefas.listar({})).toEqual([]);
  });
});

describe("criar", () => {
  test("sem lista vai para a Entrada, por último entre as irmãs, e avisa", () => {
    const { tarefas, eventos } = montar();
    const a = tarefas.criar({ titulo: "Ligar pro banco" });
    const b = tarefas.criar({ titulo: "Comprar ração", prioridade: 2, etiquetas: ["casa"] });
    confere("tarefas.criar", b);
    expect(a).toMatchObject({
      listaId: "entrada",
      tarefaPaiId: null,
      estado: "aberta",
      venceEm: null,
      hora: null,
      lembreteMinutosAntes: null,
      ordem: 0,
      origem: "usuario",
    });
    expect(b).toMatchObject({ ordem: 1, prioridade: 2, etiquetas: [{ nome: "casa" }] });
    expect(eventos.tarefas.map((e) => e.tarefas.map((t) => t.id))).toEqual([[a.id], [b.id]]);
  });

  test("a da ferramenta leva o carimbo do agente", () => {
    const { tarefas } = montar();
    const t = tarefas.criar(
      { titulo: "Revisar PR" },
      { origem: "agente", agenteId: "alba", execucaoId: "e1" },
    );
    expect(t).toMatchObject({ origem: "agente", agenteId: "alba", execucaoId: "e1" });
  });

  test("a criada de uma nota leva o `nota_id`; nota que não existe é recusada", () => {
    const { tarefas, notas } = montar();
    const nota = notas.criar({ titulo: "Reunião" });
    const t = tarefas.criar({ titulo: "Mandar a ata", notaId: nota.id });
    expect(t.notaId).toBe(nota.id);
    expect(tarefas.listar({ notaId: nota.id }).map((x) => x.id)).toEqual([t.id]);
    expect(() => tarefas.criar({ titulo: "Órfã", notaId: "sumiu" })).toThrow(MENSAGEM_NOTA_DA_TAREFA);
  });

  test("lista que não existe, data fora do calendário e lembrete sem hora são recusados", () => {
    const { tarefas } = montar();
    expect(() => tarefas.criar({ titulo: "x", listaId: "nada" })).toThrow(MENSAGEM_LISTA_NAO_ENCONTRADA);
    expect(() => tarefas.criar({ titulo: "x", venceEm: "0000-01-01" })).toThrow(/calendário/);
    expect(() => tarefas.criar({ titulo: "x", venceEm: "2026-10-20", lembreteMinutosAntes: 10 })).toThrow(
      MENSAGEM_LEMBRETE_SEM_HORA,
    );
    expect(tarefas.listar({ todas: true })).toEqual([]);
  });
});

describe("lembrete da tarefa com hora", () => {
  test("nasce 15 min antes, no fuso de config, e sai no aviso dos lembretes", () => {
    const { db, tarefas, eventos } = montar();
    const t = tarefas.criar({ titulo: "Ligar pro banco", venceEm: "2026-10-19", hora: "15:00" });
    expect(t.lembreteMinutosAntes).toBe(15);
    const [l] = lembretesDe(db, t.id);
    // 15:00 em São Paulo é 18:00 UTC.
    expect(l).toMatchObject({
      texto: "Ligar pro banco",
      quando: "2026-10-19T17:45:00.000Z",
      estado: "agendado",
    });
    expect(eventos.lembretes).toHaveLength(1);
    const evento = eventos.lembretes[0]!;
    expect(evento.lembretes.map((x) => [x.id, x.tarefaId])).toEqual([[l!.id, t.id]]);
    expect(METODOS["lembretes.concluir"].saida.safeParse(evento).success).toBe(true);
  });

  test("com outros minutos, ou nenhum", () => {
    const { db, tarefas } = montar();
    const trinta = tarefas.criar({
      titulo: "a",
      venceEm: "2026-10-19",
      hora: "10:00",
      lembreteMinutosAntes: 30,
    });
    expect(trinta.lembreteMinutosAntes).toBe(30);
    expect(lembretesDe(db, trinta.id)[0]?.quando).toBe("2026-10-19T12:30:00.000Z");
    const sem = tarefas.criar({
      titulo: "b",
      venceEm: "2026-10-19",
      hora: "10:00",
      lembreteMinutosAntes: null,
    });
    expect(sem.lembreteMinutosAntes).toBeNull();
    expect(lembretesDe(db, sem.id)).toEqual([]);
    expect(lembretesDe(db, tarefas.criar({ titulo: "c", venceEm: "2026-10-19" }).id)).toEqual([]);
  });

  test("acompanha a hora (volta a agendado) e o título (o estado fica)", () => {
    const { db, tarefas, andar } = montar();
    const t = tarefas.criar({ titulo: "Dentista", venceEm: "2026-10-19", hora: "15:00" });
    const id = lembretesDe(db, t.id)[0]!.id;
    db.prepare("UPDATE lembretes SET estado = 'disparado', disparado_em = ? WHERE id = ?").run(
      DOMINGO_9H,
      id,
    );
    andar();
    tarefas.definir({ id: t.id, titulo: "Dentista (Dra. Ana)" });
    expect(vivos(db, t.id)).toEqual([
      expect.objectContaining({ id, texto: "Dentista (Dra. Ana)", estado: "disparado" }),
    ]);
    andar();
    const mudou = tarefas.definir({ id: t.id, hora: "16:30" });
    expect(mudou.lembreteMinutosAntes).toBe(15);
    expect(vivos(db, t.id)).toEqual([
      expect.objectContaining({
        id,
        quando: "2026-10-19T19:15:00.000Z",
        estado: "agendado",
        disparado_em: null,
      }),
    ]);
    andar();
    tarefas.definir({ id: t.id, lembreteMinutosAntes: 60 });
    expect(vivos(db, t.id)[0]?.quando).toBe("2026-10-19T18:30:00.000Z");
  });

  test("sem hora ou sem dia o lembrete vai para a lixeira; ganhar hora traz o padrão", () => {
    const { db, tarefas, eventos, andar, limpar } = montar();
    const t = tarefas.criar({ titulo: "Pagar boleto", venceEm: "2026-10-19", hora: "09:00" });
    const id = lembretesDe(db, t.id)[0]!.id;
    andar();
    limpar();
    const semHora = tarefas.definir({ id: t.id, hora: null });
    expect(semHora).toMatchObject({ hora: null, lembreteMinutosAntes: null });
    expect(vivos(db, t.id)).toEqual([]);
    expect(eventos.lembretes).toEqual([{ lembretes: [], removidos: [id] }]);
    andar();
    expect(tarefas.definir({ id: t.id, hora: "11:00" }).lembreteMinutosAntes).toBe(15);
    andar();
    // Sem o dia, a hora sai junto, e o lembrete também.
    const semDia = tarefas.definir({ id: t.id, venceEm: null });
    expect(semDia).toMatchObject({ venceEm: null, hora: null, lembreteMinutosAntes: null });
    expect(vivos(db, t.id)).toEqual([]);
    expect(() => tarefas.definir({ id: t.id, hora: "10:00" })).toThrow(MENSAGEM_HORA_SEM_DIA);
    expect(() => tarefas.definir({ id: t.id, lembreteMinutosAntes: 5 })).toThrow(MENSAGEM_LEMBRETE_SEM_HORA);
  });

  test("quem tirou o lembrete não o ganha de volta ao mudar a hora", () => {
    const { db, tarefas, andar } = montar();
    const t = tarefas.criar({ titulo: "Reunião", venceEm: "2026-10-19", hora: "10:00" });
    andar();
    expect(tarefas.definir({ id: t.id, lembreteMinutosAntes: null }).lembreteMinutosAntes).toBeNull();
    andar();
    expect(tarefas.definir({ id: t.id, hora: "11:00" }).lembreteMinutosAntes).toBeNull();
    andar();
    expect(tarefas.adiar({ ids: [t.id], para: "amanha" })[0]?.lembreteMinutosAntes).toBeNull();
    expect(vivos(db, t.id)).toEqual([]);
  });

  test("concluir manda o lembrete à lixeira e reabrir o traz de volta, mesmo depois de editar a fechada", () => {
    const { db, tarefas, eventos, andar, limpar } = montar();
    const t = tarefas.criar({
      titulo: "Remédio",
      venceEm: "2026-10-19",
      hora: "20:00",
      lembreteMinutosAntes: 5,
    });
    const id = lembretesDe(db, t.id)[0]!.id;
    andar();
    limpar();
    const feita = tarefas.concluir({ id: t.id }).tarefa;
    expect(feita).toMatchObject({ estado: "feita", concluidaEm: "2026-10-18T12:00:01.000Z" });
    expect(vivos(db, t.id)).toEqual([]);
    expect(eventos.lembretes).toEqual([{ lembretes: [], removidos: [id] }]);
    andar();
    // Editar a fechada (outra hora) leva o lembrete junto, na lixeira.
    tarefas.definir({ id: t.id, titulo: "Remédio da noite", hora: "21:00" });
    expect(vivos(db, t.id)).toEqual([]);
    andar();
    limpar();
    const aberta = tarefas.reabrir({ id: t.id });
    expect(aberta).toMatchObject({ estado: "aberta", concluidaEm: null, lembreteMinutosAntes: 5 });
    expect(vivos(db, t.id)).toEqual([
      expect.objectContaining({ id, texto: "Remédio da noite", quando: "2026-10-19T23:55:00.000Z" }),
    ]);
    expect(eventos.lembretes[0]?.lembretes.map((l) => l.id)).toEqual([id]);
  });

  test("o lembrete tirado com a tarefa fechada não volta ao reabrir", () => {
    const { db, tarefas, andar } = montar();
    const t = tarefas.criar({ titulo: "x", venceEm: "2026-10-19", hora: "20:00" });
    andar();
    tarefas.cancelar({ id: t.id });
    andar();
    tarefas.definir({ id: t.id, lembreteMinutosAntes: null });
    andar();
    expect(tarefas.reabrir({ id: t.id }).lembreteMinutosAntes).toBeNull();
    expect(vivos(db, t.id)).toEqual([]);
  });
});

describe("concluir, cancelar e reabrir", () => {
  test("concluir a mãe conclui as subtarefas abertas; concluir de novo não muda nada", () => {
    const { tarefas, andar, eventos, limpar } = montar();
    const mae = tarefas.criar({ titulo: "Revisar PR do relatório" });
    const a = tarefas.criar({ titulo: "Testes", tarefaPaiId: mae.id });
    const b = tarefas.criar({ titulo: "Docs", tarefaPaiId: mae.id });
    andar();
    tarefas.cancelar({ id: b.id });
    andar();
    limpar();
    const r = tarefas.concluir({ id: mae.id });
    confere("tarefas.concluir", r);
    expect(r).toMatchObject({ tarefa: { estado: "feita" }, proxima: null });
    expect(tarefas.obter({ id: a.id }).estado).toBe("feita");
    expect(tarefas.obter({ id: b.id }).estado).toBe("cancelada");
    expect(eventos.tarefas[0]?.tarefas.map((t) => t.id).sort()).toEqual([mae.id, a.id].sort());
    andar();
    limpar();
    expect(tarefas.concluir({ id: mae.id }).tarefa.atualizadoEm).toBe(r.tarefa.atualizadoEm);
    expect(eventos.tarefas).toEqual([]);
  });

  test("reabrir a subtarefa de uma mãe fechada reabre a mãe", () => {
    const { tarefas, andar } = montar();
    const mae = tarefas.criar({ titulo: "Mudança" });
    const filha = tarefas.criar({ titulo: "Caixas", tarefaPaiId: mae.id });
    andar();
    tarefas.concluir({ id: mae.id });
    andar();
    const reaberta = tarefas.reabrir({ id: filha.id });
    confere("tarefas.reabrir", reaberta);
    expect(reaberta.estado).toBe("aberta");
    expect(tarefas.obter({ id: mae.id }).estado).toBe("aberta");
  });

  test("cancelar fica fora das abertas e sem data de conclusão", () => {
    const { tarefas } = montar();
    const t = tarefas.criar({ titulo: "Curso", venceEm: "2026-10-18" });
    const c = tarefas.cancelar({ id: t.id });
    confere("tarefas.cancelar", c);
    expect(c).toMatchObject({ estado: "cancelada", concluidaEm: null });
    expect(tarefas.listar({ vista: "hoje" })).toEqual([]);
    expect(tarefas.listar({ vista: "hoje", todas: true }).map((x) => x.id)).toEqual([t.id]);
  });
});

describe("recorrente concluída gera a próxima", () => {
  test("toda segunda: a próxima segunda, com hora, lembrete, etiquetas e subtarefas de novo abertas", () => {
    const { db, tarefas, andar } = montar();
    const t = tarefas.criar({
      titulo: "Planejar a semana",
      listaId: "trabalho",
      venceEm: "2026-10-19",
      hora: "09:00",
      lembreteMinutosAntes: 10,
      recorrencia: "FREQ=WEEKLY;BYDAY=MO",
      etiquetas: ["rotina"],
      duracaoEstimadaMin: 30,
    });
    const filha = tarefas.criar({ titulo: "Olhar a agenda", tarefaPaiId: t.id, venceEm: "2026-10-19" });
    andar();
    const { tarefa, proxima } = tarefas.concluir({ id: t.id });
    expect(tarefa.estado).toBe("feita");
    expect(proxima).toMatchObject({
      titulo: "Planejar a semana",
      listaId: "trabalho",
      venceEm: "2026-10-26",
      hora: "09:00",
      lembreteMinutosAntes: 10,
      recorrencia: "FREQ=WEEKLY;BYDAY=MO",
      etiquetas: [{ nome: "rotina" }],
      duracaoEstimadaMin: 30,
      estado: "aberta",
    });
    expect(vivos(db, proxima!.id)).toEqual([expect.objectContaining({ quando: "2026-10-26T11:50:00.000Z" })]);
    const filhas = tarefas.listar({ vista: "proximas" }).filter((x) => x.tarefaPaiId === proxima!.id);
    expect(filhas).toEqual([
      expect.objectContaining({ titulo: "Olhar a agenda", venceEm: "2026-10-26", estado: "aberta" }),
    ]);
    expect(tarefas.obter({ id: filha.id }).estado).toBe("feita");
  });

  test("atrasada concluída hoje volta hoje; o COUNT desconta o que ficou para trás", () => {
    expect(proximaOcorrencia("FREQ=DAILY", "2026-10-15", "2026-10-18")).toEqual({
      dia: "2026-10-18",
      recorrencia: "FREQ=DAILY",
    });
    expect(proximaOcorrencia("FREQ=DAILY", "2026-10-18", "2026-10-18")?.dia).toBe("2026-10-19");
    // 15, 16 e 17 ficaram para trás: das 5, sobram 2 a partir do dia 18.
    expect(proximaOcorrencia("FREQ=DAILY;COUNT=5", "2026-10-15", "2026-10-18")).toEqual({
      dia: "2026-10-18",
      recorrencia: "FREQ=DAILY;COUNT=2",
    });
    expect(proximaOcorrencia("FREQ=DAILY;COUNT=1", "2026-10-18", "2026-10-18")).toBeNull();
    expect(proximaOcorrencia("FREQ=DAILY;UNTIL=20261018", "2026-10-18", "2026-10-18")).toBeNull();
    // Todo dia 31: de 31/10 pula novembro.
    expect(proximaOcorrencia("FREQ=MONTHLY", "2026-10-31", "2026-10-18")?.dia).toBe("2026-12-31");
    // Fora do subconjunto: guardada, sem próxima.
    expect(proximaOcorrencia("FREQ=HOURLY", "2026-10-18", "2026-10-18")).toBeNull();
    // Sem dia, conta de hoje.
    expect(proximaOcorrencia("FREQ=DAILY", null, "2026-10-18")?.dia).toBe("2026-10-19");
  });

  test("COUNT=2 gera uma próxima, a última, e ela não gera outra", () => {
    const { tarefas, andar } = montar();
    const t = tarefas.criar({ titulo: "Dose", venceEm: "2026-10-18", recorrencia: "FREQ=DAILY;COUNT=2" });
    andar();
    const { proxima } = tarefas.concluir({ id: t.id });
    expect(proxima).toMatchObject({ venceEm: "2026-10-19", recorrencia: "FREQ=DAILY;COUNT=1" });
    andar();
    expect(tarefas.concluir({ id: proxima!.id }).proxima).toBeNull();
  });

  test("descartar uma recorrente pula só esta vez; reabrir e concluir a descartada não gera outra", () => {
    const { tarefas, eventos, andar, limpar } = montar();
    const t = tarefas.criar({
      titulo: "Beber água",
      venceEm: "2026-10-18",
      hora: "15:00",
      recorrencia: "FREQ=DAILY",
    });
    andar();
    limpar();
    tarefas.cancelar({ id: t.id });
    const nova = eventos.tarefas[0]?.tarefas.find((x) => x.id !== t.id);
    expect(nova).toMatchObject({ venceEm: "2026-10-19", hora: "15:00", lembreteMinutosAntes: 15 });
    andar();
    expect(tarefas.concluir({ id: t.id }).proxima).toBeNull();
    expect(tarefas.listar({ vista: "proximas" }).map((x) => x.id)).toEqual([nova!.id]);
  });
});

describe("vistas e as abertas de ontem", () => {
  test("hoje, atrasadas, sem data e próximas no dia do fuso; a de ontem vem marcada pelo dia dela", () => {
    const { tarefas, andar } = montar();
    const ontem = tarefas.criar({ titulo: "Devolver o livro", venceEm: "2026-10-17" });
    const hoje = tarefas.criar({ titulo: "Daily", venceEm: "2026-10-18", hora: "09:30" });
    const semDia = tarefas.criar({ titulo: "Comprar ração" });
    const amanha = tarefas.criar({ titulo: "Dentista", venceEm: "2026-10-19" });
    const feitaHoje = tarefas.criar({ titulo: "Ligar pro contador", venceEm: "2026-10-16" });
    andar();
    tarefas.concluir({ id: feitaHoje.id });
    const ids = (vista: "hoje" | "atrasadas" | "semData" | "proximas") =>
      tarefas.listar({ vista }).map((t) => t.id);
    const vistaHoje = tarefas.listar({ vista: "hoje" });
    confere("tarefas.listar", vistaHoje);
    expect(vistaHoje.map((t) => t.id)).toEqual([feitaHoje.id, hoje.id]);
    expect(ids("atrasadas")).toEqual([ontem.id]);
    expect(tarefas.listar({ vista: "atrasadas" })[0]).toMatchObject({
      venceEm: "2026-10-17",
      estado: "aberta",
    });
    expect(ids("semData")).toEqual([semDia.id]);
    expect(ids("proximas")).toEqual([amanha.id]);
    expect(tarefas.listar({}).map((t) => t.id)).toEqual([ontem.id, hoje.id, amanha.id, semDia.id]);
  });

  test("a lista lê o fuso uma vez, não uma por tarefa com lembrete", () => {
    const { tarefas, leituras } = montar();
    for (let i = 0; i < 50; i++) tarefas.criar({ titulo: `t${i}`, venceEm: "2026-10-19", hora: "10:00" });
    leituras.fuso = 0;
    const lista = tarefas.listar({ vista: "proximas" });
    expect(lista.every((t) => t.lembreteMinutosAntes === 15)).toBe(true);
    expect(leituras.fuso).toBeLessThanOrEqual(2);
  });

  test("às 23h de domingo em São Paulo (segunda em UTC) ainda é domingo", () => {
    const { tarefas } = montar("2026-10-19T02:00:00.000Z");
    const t = tarefas.criar({ titulo: "Fechar o dia", venceEm: "2026-10-18" });
    expect(tarefas.listar({ vista: "hoje" }).map((x) => x.id)).toEqual([t.id]);
    expect(tarefas.listar({ vista: "atrasadas" })).toEqual([]);
  });

  test("trazer para hoje é o adiar para hoje, com o lembrete andando junto", () => {
    const { db, tarefas, andar } = montar();
    const a = tarefas.criar({ titulo: "Mandar documentos", venceEm: "2026-10-16", hora: "14:00" });
    const b = tarefas.criar({ titulo: "Devolver o livro", venceEm: "2026-10-17" });
    andar();
    const trazidas = tarefas.adiar({ ids: [b.id, a.id], para: "hoje" });
    confere("tarefas.adiar", trazidas);
    expect(trazidas.map((t) => [t.id, t.venceEm, t.hora])).toEqual([
      [b.id, "2026-10-18", null],
      [a.id, "2026-10-18", "14:00"],
    ]);
    expect(vivos(db, a.id)[0]).toMatchObject({ quando: "2026-10-18T16:45:00.000Z", estado: "agendado" });
    expect(tarefas.listar({ vista: "atrasadas" })).toEqual([]);
    andar();
    expect(tarefas.adiar({ ids: [a.id], para: "amanha", hora: null })[0]).toMatchObject({
      venceEm: "2026-10-19",
      hora: null,
      lembreteMinutosAntes: null,
    });
    expect(vivos(db, a.id)).toEqual([]);
    expect(() => tarefas.adiar({ ids: [a.id, a.id], para: "hoje" })).toThrow(MENSAGEM_IDS_REPETIDOS);
  });

  test("as subtarefas das que entram vêm junto, em todos os estados; filtro por lista e etiqueta", () => {
    const { tarefas, andar } = montar();
    const mae = tarefas.criar({
      titulo: "Relatório",
      listaId: "trabalho",
      venceEm: "2026-10-18",
      etiquetas: ["pr-123"],
    });
    const f1 = tarefas.criar({ titulo: "Dados", tarefaPaiId: mae.id });
    const f2 = tarefas.criar({ titulo: "Gráficos", tarefaPaiId: mae.id });
    tarefas.criar({ titulo: "Outra", listaId: "pessoal", venceEm: "2026-10-18" });
    andar();
    tarefas.concluir({ id: f1.id });
    expect(tarefas.listar({ vista: "hoje", listaId: "trabalho" }).map((t) => t.id)).toEqual([
      mae.id,
      f1.id,
      f2.id,
    ]);
    const etiqueta = tarefas.etiquetas().find((e) => e.nome === "pr-123")!;
    expect(tarefas.listar({ etiquetaId: etiqueta.id }).map((t) => t.id)).toEqual([mae.id, f1.id, f2.id]);
  });
});

describe("subtarefas e mover", () => {
  test("um nível só, mãe aberta e na lista da mãe", () => {
    const { tarefas } = montar();
    const mae = tarefas.criar({ titulo: "Mãe", listaId: "trabalho" });
    const filha = tarefas.criar({ titulo: "Filha", tarefaPaiId: mae.id });
    expect(filha).toMatchObject({ tarefaPaiId: mae.id, listaId: "trabalho" });
    expect(() => tarefas.criar({ titulo: "Neta", tarefaPaiId: filha.id })).toThrow(MENSAGEM_UM_NIVEL);
    expect(() => tarefas.criar({ titulo: "x", tarefaPaiId: mae.id, listaId: "pessoal" })).toThrow(
      MENSAGEM_LISTA_DA_MAE,
    );
    expect(() => tarefas.criar({ titulo: "x", tarefaPaiId: "nao-existe" })).toThrow(
      MENSAGEM_TAREFA_NAO_ENCONTRADA,
    );
    tarefas.concluir({ id: mae.id });
    expect(() => tarefas.criar({ titulo: "x", tarefaPaiId: mae.id })).toThrow(MENSAGEM_MAE_FECHADA);
  });

  test("a mãe que muda de lista leva as filhas; tarefa com filhas não vira subtarefa", () => {
    const { tarefas, eventos, limpar } = montar();
    const mae = tarefas.criar({ titulo: "Mudança" });
    const filha = tarefas.criar({ titulo: "Caixas", tarefaPaiId: mae.id });
    const outra = tarefas.criar({ titulo: "Outra" });
    limpar();
    const movida = tarefas.mover({ id: mae.id, listaId: "pessoal" });
    confere("tarefas.mover", movida);
    expect(movida.listaId).toBe("pessoal");
    expect(tarefas.obter({ id: filha.id })).toMatchObject({ listaId: "pessoal", tarefaPaiId: mae.id });
    expect(eventos.tarefas[0]?.tarefas.map((t) => t.id).sort()).toEqual([mae.id, filha.id].sort());
    expect(() => tarefas.mover({ id: mae.id, tarefaPaiId: outra.id })).toThrow(MENSAGEM_UM_NIVEL);
    expect(() => tarefas.mover({ id: outra.id, tarefaPaiId: outra.id })).toThrow(MENSAGEM_ELA_MESMA);
    expect(() => tarefas.mover({ id: outra.id, tarefaPaiId: filha.id })).toThrow(MENSAGEM_UM_NIVEL);
  });

  test("virar subtarefa leva para a lista da mãe; a subtarefa que vai para outra lista volta a ser tarefa", () => {
    const { tarefas } = montar();
    const mae = tarefas.criar({ titulo: "Mãe", listaId: "trabalho" });
    const solta = tarefas.criar({ titulo: "Solta" });
    expect(tarefas.mover({ id: solta.id, tarefaPaiId: mae.id })).toMatchObject({
      tarefaPaiId: mae.id,
      listaId: "trabalho",
    });
    expect(tarefas.mover({ id: solta.id, listaId: "pessoal" })).toMatchObject({
      tarefaPaiId: null,
      listaId: "pessoal",
    });
    expect(() => tarefas.mover({ id: solta.id, tarefaPaiId: mae.id, listaId: "pessoal" })).toThrow(
      MENSAGEM_LISTA_DA_MAE,
    );
    expect(tarefas.mover({ id: solta.id, tarefaPaiId: null })).toMatchObject({ tarefaPaiId: null });
  });
});

describe("ordenar e apagar", () => {
  test("ordena na ordem dos ids; repetido e pedido grande demais são recusados sem gravar", () => {
    const { tarefas } = montar();
    const [a, b, c] = ["a", "b", "c"].map((titulo) => tarefas.criar({ titulo }));
    const ordem = tarefas.ordenar({ ids: [c!.id, a!.id, b!.id] });
    confere("tarefas.ordenar", ordem);
    expect(ordem.map((t) => [t.titulo, t.ordem])).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
    expect(tarefas.listar({}).map((t) => t.titulo)).toEqual(["c", "a", "b"]);
    expect(() => tarefas.ordenar({ ids: [a!.id, a!.id] })).toThrow(MENSAGEM_IDS_REPETIDOS);
    const muitos = Array.from({ length: LIMITE_IDS + 1 }, (_, i) => `id-${i}`);
    expect(() => tarefas.ordenar({ ids: muitos })).toThrow(MENSAGEM_IDS_DEMAIS);
    expect(() => tarefas.ordenar({ ids: [a!.id, "sumiu"] })).toThrow(MENSAGEM_TAREFA_NAO_ENCONTRADA);
    expect(tarefas.obter({ id: a!.id }).ordem).toBe(1);
  });

  test("apagar manda à lixeira com as subtarefas e os lembretes, e avisa", () => {
    const { db, tarefas, eventos, limpar } = montar();
    const mae = tarefas.criar({ titulo: "Viagem", venceEm: "2026-10-20", hora: "07:00" });
    const filha = tarefas.criar({
      titulo: "Passaporte",
      tarefaPaiId: mae.id,
      venceEm: "2026-10-19",
      hora: "10:00",
    });
    const lembretes = [...lembretesDe(db, mae.id), ...lembretesDe(db, filha.id)].map((l) => l.id);
    limpar();
    const r = tarefas.apagar({ id: mae.id });
    confere("tarefas.apagar", r);
    expect(r.ids).toEqual([mae.id, filha.id]);
    for (const id of lembretes) expect(apagadoEm(db, "lembretes", id)).not.toBeNull();
    expect(eventos.tarefas).toEqual([{ tarefas: [], apagadas: [mae.id, filha.id] }]);
    expect(eventos.lembretes[0]?.removidos.sort()).toEqual(lembretes.sort());
    expect(() => tarefas.obter({ id: mae.id })).toThrow(MENSAGEM_TAREFA_NAO_ENCONTRADA);
  });
});

describe("etiquetas", () => {
  test("o nome se repete sem diferença de caixa nem de acento composto; a chave vai gravada", () => {
    const { db, tarefas } = montar();
    const a = tarefas.criar({ titulo: "a", etiquetas: ["Ônibus", "ônibus", "Ônibus "] });
    expect(a.etiquetas.map((e) => e.nome)).toEqual(["Ônibus"]);
    const b = tarefas.criar({ titulo: "b", etiquetas: ["ÔNIBUS", "casa"] });
    expect(b.etiquetas.map((e) => e.id)).toContain(a.etiquetas[0]!.id);
    const chaves = db.prepare("SELECT nome, nome_chave FROM etiquetas ORDER BY nome_chave").all();
    expect(chaves).toEqual([
      { nome: "casa", nome_chave: "casa" },
      { nome: "Ônibus", nome_chave: "ônibus" },
    ]);
    confere("tarefas.etiquetas", tarefas.etiquetas());
  });

  test("definir troca as etiquetas da tarefa", () => {
    const { tarefas } = montar();
    const t = tarefas.criar({ titulo: "x", etiquetas: ["casa", "urgente"] });
    expect(tarefas.definir({ id: t.id, etiquetas: ["trabalho"] }).etiquetas.map((e) => e.nome)).toEqual([
      "trabalho",
    ]);
    expect(tarefas.definir({ id: t.id, etiquetas: [] }).etiquetas).toEqual([]);
  });

  test("renomear grava a chave nova e avisa as tarefas; nome de outra é recusado; apagar some das tarefas", () => {
    const { db, tarefas, eventos, limpar } = montar();
    const t = tarefas.criar({ titulo: "x", etiquetas: ["casa", "pr-1"] });
    const casa = t.etiquetas.find((e) => e.nome === "casa")!;
    const pr = t.etiquetas.find((e) => e.nome === "pr-1")!;
    limpar();
    expect(tarefas.renomearEtiqueta({ id: casa.id, nome: " Écran " })).toEqual({
      id: casa.id,
      nome: "Écran",
    });
    expect(db.prepare("SELECT nome_chave FROM etiquetas WHERE id = ?").get(casa.id)).toEqual({
      nome_chave: "écran",
    });
    expect(eventos.tarefas[0]?.tarefas.map((x) => x.id)).toEqual([t.id]);
    expect(() => tarefas.renomearEtiqueta({ id: pr.id, nome: "ÉCRAN" })).toThrow(MENSAGEM_ETIQUETA_REPETIDA);
    // A mesma etiqueta pode mudar só a caixa.
    expect(tarefas.renomearEtiqueta({ id: casa.id, nome: "écran" }).nome).toBe("écran");
    tarefas.apagarEtiqueta({ id: pr.id });
    expect(tarefas.obter({ id: t.id }).etiquetas.map((e) => e.nome)).toEqual(["écran"]);
    // Na lixeira, o nome fica livre de novo.
    expect(tarefas.criar({ titulo: "y", etiquetas: ["pr-1"] }).etiquetas[0]?.id).not.toBe(pr.id);
  });
});

describe("contrato", () => {
  test("toda tarefa que sai passa no schema, com lembrete, subtarefa, feita e cancelada", () => {
    const { tarefas, andar } = montar();
    const t = tarefas.criar({ titulo: "Com tudo", venceEm: "2026-10-18", hora: "18:00", notas: "texto" });
    tarefas.criar({ titulo: "Filha", tarefaPaiId: t.id });
    andar();
    tarefas.concluir({ id: t.id });
    const todas: Tarefa[] = tarefas.listar({ todas: true });
    confere("tarefas.listar", todas);
    expect(todas).toHaveLength(2);
    confere("tarefas.obter", tarefas.obter({ id: t.id }));
    confere("tarefas.definir", tarefas.definir({ id: t.id, prioridade: 3 }));
  });

  test("um dia que não existe vindo de outro PC não derruba a lista", () => {
    const { db, tarefas } = montar();
    db.prepare(
      "INSERT INTO tarefas (id, lista_id, titulo, vence_em, hora) VALUES ('torta', 'entrada', 'Torta', '2026-02-30', '10:00')",
    ).run();
    db.prepare(
      "INSERT INTO lembretes (id, texto, quando, tarefa_id) VALUES ('l1', 'Torta', '2026-03-02T12:45:00.000Z', 'torta')",
    ).run();
    const lista = tarefas.listar({});
    confere("tarefas.listar", lista);
    expect(lista.map((t) => [t.id, t.venceEm, t.hora, t.lembreteMinutosAntes])).toEqual([
      ["torta", null, null, null],
    ]);
    // A recorrente com esse dia conta de hoje.
    db.prepare("UPDATE tarefas SET recorrencia = 'FREQ=DAILY' WHERE id = 'torta'").run();
    const r = tarefas.concluir({ id: "torta" });
    confere("tarefas.concluir", r);
    expect(r.proxima).toMatchObject({ venceEm: "2026-10-19" });
  });
});

describe("volta 1 da revisão", () => {
  test("concluir, reabrir e concluir de novo não gera uma segunda próxima", () => {
    const { tarefas, andar } = montar();
    const t = tarefas.criar({ titulo: "Água", venceEm: "2026-10-18", recorrencia: "FREQ=DAILY" });
    andar();
    const primeira = tarefas.concluir({ id: t.id }).proxima!;
    andar();
    tarefas.reabrir({ id: t.id });
    // A próxima intocada vai para a lixeira com o reabrir.
    expect(() => tarefas.obter({ id: primeira.id })).toThrow(MENSAGEM_TAREFA_NAO_ENCONTRADA);
    andar();
    const segunda = tarefas.concluir({ id: t.id }).proxima!;
    expect(segunda.venceEm).toBe("2026-10-19");
    expect(tarefas.listar({ vista: "proximas" }).map((x) => x.id)).toEqual([segunda.id]);
  });

  test("COUNT=3: cancelar, reabrir e cancelar de novo deixa uma próxima só, com COUNT=2", () => {
    const { tarefas, andar } = montar();
    const t = tarefas.criar({ titulo: "Dose", venceEm: "2026-10-18", recorrencia: "FREQ=DAILY;COUNT=3" });
    andar();
    tarefas.cancelar({ id: t.id });
    andar();
    tarefas.reabrir({ id: t.id });
    andar();
    tarefas.cancelar({ id: t.id });
    expect(tarefas.listar({ vista: "proximas" }).map((x) => [x.venceEm, x.recorrencia])).toEqual([
      ["2026-10-19", "FREQ=DAILY;COUNT=2"],
    ]);
  });

  test("a próxima que alguém mexeu fica no reabrir, e fechar de novo não gera outra", () => {
    const { tarefas, andar } = montar();
    const t = tarefas.criar({ titulo: "Água", venceEm: "2026-10-18", recorrencia: "FREQ=DAILY" });
    andar();
    const proxima = tarefas.concluir({ id: t.id }).proxima!;
    andar();
    tarefas.definir({ id: proxima.id, prioridade: 2 });
    andar();
    tarefas.reabrir({ id: t.id });
    expect(tarefas.obter({ id: proxima.id }).prioridade).toBe(2);
    andar();
    expect(tarefas.concluir({ id: t.id }).proxima).toBeNull();
    expect(tarefas.listar({ vista: "proximas" }).map((x) => x.id)).toEqual([proxima.id]);
  });

  test("tarefa com filha na lixeira não vira subtarefa, com o erro da regra", () => {
    const { tarefas } = montar();
    const m1 = tarefas.criar({ titulo: "M1" });
    const f1 = tarefas.criar({ titulo: "F1", tarefaPaiId: m1.id });
    const m2 = tarefas.criar({ titulo: "M2" });
    tarefas.apagar({ id: f1.id });
    expect(() => tarefas.mover({ id: m1.id, tarefaPaiId: m2.id })).toThrow(MENSAGEM_UM_NIVEL);
  });

  test("o lembrete volta pela marca do fechamento, mesmo com outra área escrevendo na tarefa", () => {
    const { db, tarefas, andar } = montar();
    const t = tarefas.criar({ titulo: "Remédio", venceEm: "2026-10-19", hora: "20:00" });
    const id = lembretesDe(db, t.id)[0]!.id;
    andar();
    tarefas.concluir({ id: t.id });
    andar();
    // Como a agenda ao ligar o encaixe (tarefas-do-dia.ts): grava atualizado_em sem passar por aqui.
    db.prepare("UPDATE tarefas SET atualizado_em = ? WHERE id = ?").run("2026-10-18T12:00:05.000Z", t.id);
    expect(tarefas.obter({ id: t.id }).lembreteMinutosAntes).toBe(15);
    andar();
    expect(tarefas.reabrir({ id: t.id }).lembreteMinutosAntes).toBe(15);
    expect(vivos(db, t.id).map((l) => l.id)).toEqual([id]);
  });

  test("no mesmo milissegundo: o lembrete tirado da fechada não volta, e a sem hora não ganha lembrete", () => {
    // O relógio não anda entre as operações.
    const { db, tarefas } = montar();
    const a = tarefas.criar({ titulo: "a", venceEm: "2026-10-19", hora: "20:00" });
    tarefas.cancelar({ id: a.id });
    expect(tarefas.definir({ id: a.id, lembreteMinutosAntes: null }).lembreteMinutosAntes).toBeNull();
    expect(tarefas.reabrir({ id: a.id }).lembreteMinutosAntes).toBeNull();
    expect(vivos(db, a.id)).toEqual([]);

    const b = tarefas.criar({ titulo: "b", venceEm: "2026-10-19", hora: "20:00" });
    tarefas.definir({ id: b.id, hora: null });
    tarefas.concluir({ id: b.id });
    tarefas.reabrir({ id: b.id });
    expect(vivos(db, b.id)).toEqual([]);
  });

  test("UNTIL com hora em UTC vale pelo instante no fuso", () => {
    const sp = { hora: "22:00", fuso: "America/Sao_Paulo" };
    // 02:00 UTC do dia 19 é 23:00 do dia 18 em São Paulo: a das 22:00 do dia 19 já passou.
    expect(proximaOcorrencia("FREQ=DAILY;UNTIL=20261019T020000Z", "2026-10-18", "2026-10-18", sp)).toBeNull();
    // Até 02:00 UTC do dia 20 (23:00 do dia 19): a das 22:00 do dia 19 ainda vale.
    expect(proximaOcorrencia("FREQ=DAILY;UNTIL=20261020T020000Z", "2026-10-18", "2026-10-18", sp)?.dia).toBe(
      "2026-10-19",
    );
    // Sem Z, no relógio do fuso: 21:00 do dia 19 vem antes das 22:00.
    expect(proximaOcorrencia("FREQ=DAILY;UNTIL=20261019T210000", "2026-10-18", "2026-10-18", sp)).toBeNull();
    // Tarefa sem hora: vale o dia do UNTIL no fuso.
    expect(
      proximaOcorrencia("FREQ=DAILY;UNTIL=20261019T020000Z", "2026-10-18", "2026-10-18", {
        hora: null,
        fuso: "America/Sao_Paulo",
      }),
    ).toBeNull();
  });

  test("etiqueta só de espaço é recusada pela regra", () => {
    const { tarefas } = montar();
    expect(() => tarefas.criar({ titulo: "x", etiquetas: ["   "] })).toThrow(MENSAGEM_ETIQUETA_NOME);
  });

  test("ordenar e adiar o máximo de ids cabem no prazo", () => {
    const { db, tarefas, andar } = montar();
    const ids = Array.from({ length: LIMITE_IDS }, (_, i) => `t${String(i).padStart(5, "0")}`);
    const inserir = db.prepare(
      "INSERT INTO tarefas (id, lista_id, titulo, ordem) VALUES (?, 'entrada', ?, ?)",
    );
    ids.forEach((id, i) => inserir.run(id, id, i));
    andar();
    let inicio = performance.now();
    tarefas.ordenar({ ids: [...ids].reverse() });
    const ordenar = performance.now() - inicio;
    inicio = performance.now();
    tarefas.adiar({ ids, para: "amanha", hora: "10:00" });
    const adiar = performance.now() - inicio;
    console.info(`ordenar ${LIMITE_IDS}: ${ordenar.toFixed(0)} ms; adiar: ${adiar.toFixed(0)} ms`);
    expect(ordenar).toBeLessThan(PRAZO_LOTE_MS);
    expect(adiar).toBeLessThan(PRAZO_LOTE_MS);
  });
});
