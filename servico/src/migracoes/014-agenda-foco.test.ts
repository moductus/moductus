import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { limparLixeira } from "../banco/lixeira.ts";
import { migrar, versaoAtual } from "../banco/migracoes.ts";
import { MIGRACOES } from "./index.ts";

// Pela posição do nome, para o teste não mudar se a migração for renumerada.
const posicao = MIGRACOES.findIndex((m) => m.nome === "agenda-foco");
/** O banco da 0.6.0: as migrações até a 012. */
const DA_060 = MIGRACOES.findIndex((m) => m.nome === "execucoes-falha-do-provedor") + 1;

const TABELAS = ["agenda_saida", "calendarios", "eventos", "rotinas", "rotinas_registro", "sessoes_foco"];
const AGORA = new Date("2026-10-16T12:00:00.000Z");
const INSTANTE = AGORA.toISOString();
const DEPOIS = "2026-10-16T13:00:00.000Z";
const diasAtras = (dias: number) => new Date(AGORA.getTime() - dias * 24 * 60 * 60 * 1000).toISOString();

const tabelas = (db: DatabaseSync) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  )
    .map((t) => t.name)
    .filter((t) => TABELAS.includes(t));

const ids = (db: DatabaseSync, tabela: string) =>
  (db.prepare(`SELECT id FROM ${tabela} ORDER BY id`).all() as { id: string }[]).map((l) => l.id);

const padroes = (db: DatabaseSync) => ({
  calendarios: db
    .prepare("SELECT id, nome, fonte, espelho, pode_escrever, ler FROM calendarios ORDER BY id")
    .all(),
  rotinas: db.prepare("SELECT id, tipo, hora, dias_semana, ativa FROM rotinas ORDER BY id").all(),
});

const PADROES = {
  calendarios: [{ id: "local", nome: "Local", fonte: "local", espelho: 0, pode_escrever: 1, ler: 1 }],
  rotinas: [
    { id: "briefing", tipo: "briefing", hora: null, dias_semana: "[1,2,3,4,5,6,7]", ativa: 1 },
    { id: "fechamento", tipo: "fechamento", hora: "18:00", dias_semana: "[1,2,3,4,5,6,7]", ativa: 1 },
  ],
};

function bancoNovo(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrar(db, MIGRACOES);
  return db;
}

const inserir = (
  db: DatabaseSync,
  tabela: string,
  id: string,
  campos: Record<string, string | number | null>,
) => {
  const colunas = Object.keys(campos);
  db.prepare(
    `INSERT INTO ${tabela} (id, ${colunas.join(", ")}) VALUES (?, ${colunas.map(() => "?").join(", ")})`,
  ).run(id, ...Object.values(campos));
};

const calendario = (db: DatabaseSync, id: string, campos: Record<string, string | number | null> = {}) =>
  inserir(db, "calendarios", id, { nome: id, fonte: "google", id_externo: `${id}@google`, ...campos });

const evento = (db: DatabaseSync, id: string, campos: Record<string, string | number | null> = {}) =>
  inserir(db, "eventos", id, {
    calendario_id: "local",
    titulo: id,
    inicio: INSTANTE,
    fim: DEPOIS,
    ...campos,
  });

const foco = (db: DatabaseSync, id: string, campos: Record<string, string | number | null> = {}) =>
  inserir(db, "sessoes_foco", id, {
    tipo: "foco",
    inicio: INSTANTE,
    fim: DEPOIS,
    duracao_planejada_min: 25,
    duracao_real_min: 25,
    ...campos,
  });

describe("migração agenda e foco", () => {
  const pastas: string[] = [];
  afterEach(() => {
    for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
  });

  test("sobe do zero com o calendário local, o briefing e o fechamento, e as chaves conferidas", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    expect(migrar(db, MIGRACOES)).toEqual({ de: 0, para: MIGRACOES.length });
    expect(tabelas(db)).toEqual(TABELAS);
    expect(padroes(db)).toEqual(PADROES);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("sobe a partir do banco da 0.6.0 sem mexer no que já estava", () => {
    expect(DA_060).toBeLessThan(posicao);
    const pasta = mkdtempSync(join(tmpdir(), "moductus-agenda-"));
    pastas.push(pasta);
    const antigo = new DatabaseSync(join(pasta, "moductus.db"));
    migrar(antigo, MIGRACOES.slice(0, DA_060));
    expect(versaoAtual(antigo)).toBe(DA_060);
    antigo.prepare("UPDATE agentes SET nome = 'Albinha' WHERE id = 'alba'").run();
    antigo.close();

    const db = abrirBanco(pasta);
    expect(versaoAtual(db)).toBe(MIGRACOES.length);
    expect(tabelas(db)).toEqual(TABELAS);
    expect(padroes(db)).toEqual(PADROES);
    expect(db.prepare("SELECT nome FROM agentes WHERE id = 'alba'").get()).toEqual({ nome: "Albinha" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  test("só o evento aponta para o calendário, sem apagar nem mudar linha viva", () => {
    const db = bancoNovo();
    const chaves = TABELAS.flatMap((t) =>
      (
        db
          .prepare('SELECT "from" AS coluna, "table" AS alvo, on_delete FROM pragma_foreign_key_list(?)')
          .all(t) as { coluna: string; alvo: string; on_delete: string }[]
      ).map((fk) => `${t}.${fk.coluna} -> ${fk.alvo} (${fk.on_delete})`),
    );
    expect(chaves).toEqual(["eventos.calendario_id -> calendarios (NO ACTION)"]);
    expect(() => evento(db, "e1", { calendario_id: "nao-existe" })).toThrow(/FOREIGN KEY/);
  });

  test("calendário: só o de fora tem id de lá, leitura e espelho, e um espelho vivo por fonte", () => {
    const db = bancoNovo();
    calendario(db, "moductus", {
      espelho: 1,
      pode_escrever: 1,
      token_sincronizacao: "t",
      sincronizado_em: INSTANTE,
    });
    calendario(db, "trabalho", { ler: 0 });
    expect(() => calendario(db, "outro-espelho", { espelho: 1 })).toThrow(/UNIQUE/);
    expect(() => calendario(db, "mesmo-id", { id_externo: "trabalho@google" })).toThrow(/UNIQUE/);
    expect(() => calendario(db, "sem-id", { id_externo: null })).toThrow(/CHECK/);
    expect(() => calendario(db, "fonte", { fonte: "icloud" })).toThrow(/CHECK/);
    expect(() => calendario(db, "leitura", { sincronizado_em: "2026-10-16T12:00:00Z" })).toThrow(/CHECK/);
    const local = (campos: Record<string, string | number | null>) =>
      calendario(db, "outro-local", { fonte: "local", id_externo: null, ...campos });
    expect(() => local({ id_externo: "x" })).toThrow(/CHECK/);
    expect(() => local({ espelho: 1 })).toThrow(/CHECK/);
    expect(() => local({ token_sincronizacao: "t" })).toThrow(/CHECK/);

    // O espelho na lixeira libera a fonte para o novo.
    db.prepare("UPDATE calendarios SET apagado_em = ? WHERE id = 'moductus'").run(INSTANTE);
    calendario(db, "moductus-novo", { espelho: 1, id_externo: "moductus@google" });
  });

  test("evento: instante com hora, dia no dia inteiro com o fim depois, alertas em lista, um por id de lá", () => {
    const db = bancoNovo();
    evento(db, "com-hora", { alertas: "[10, 60]", recorrencia: "FREQ=WEEKLY;BYDAY=MO" });
    evento(db, "instantaneo", { fim: INSTANTE });
    evento(db, "dia-inteiro", { dia_inteiro: 1, inicio: "2026-10-16", fim: "2026-10-17" });
    expect(db.prepare("SELECT alertas FROM eventos WHERE id = 'dia-inteiro'").get()).toEqual({
      alertas: "[]",
    });
    expect(() => evento(db, "fim-antes", { fim: "2026-10-16T11:00:00.000Z" })).toThrow(/CHECK/);
    expect(() => evento(db, "sem-z", { inicio: "2026-10-16T12:00:00" })).toThrow(/CHECK/);
    expect(() => evento(db, "dia-com-hora", { inicio: "2026-10-16" })).toThrow(/CHECK/);
    expect(() =>
      evento(db, "dia-inteiro-com-hora", { dia_inteiro: 1, inicio: INSTANTE, fim: DEPOIS }),
    ).toThrow(/CHECK/);
    expect(() =>
      evento(db, "dia-inteiro-vazio", { dia_inteiro: 1, inicio: "2026-10-16", fim: "2026-10-16" }),
    ).toThrow(/CHECK/);
    expect(() => evento(db, "alertas", { alertas: "10" })).toThrow(/CHECK/);
    expect(() => evento(db, "etag-sem-id", { etag_externo: "e1" })).toThrow(/CHECK/);
    expect(() => evento(db, "agente-sem-id", { origem: "agente" })).toThrow(/CHECK/);

    calendario(db, "g1");
    evento(db, "do-google", { calendario_id: "g1", id_externo: "abc", etag_externo: "e1" });
    expect(() => evento(db, "repetido", { calendario_id: "g1", id_externo: "abc" })).toThrow(/UNIQUE/);
    evento(db, "mesmo-id-em-outro", { id_externo: "abc" });
  });

  test("fila de saída: uma linha por item, operação e tentativas conferidas, próxima tentativa já", () => {
    const db = bancoNovo();
    const sair = (id: string, campos: Record<string, string | number | null> = {}) =>
      inserir(db, "agenda_saida", id, { item_tipo: "tarefa", item_id: "t1", operacao: "criar", ...campos });
    sair("s1");
    expect(db.prepare("SELECT tentativas, proxima_tentativa_em FROM agenda_saida").get()).toEqual({
      tentativas: 0,
      proxima_tentativa_em: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/) as unknown,
    });
    expect(() => sair("s2", { operacao: "mudar" })).toThrow(/UNIQUE/);
    // A nova substitui a pendente.
    db.prepare(
      "INSERT OR REPLACE INTO agenda_saida (id, item_tipo, item_id, operacao) VALUES ('s3', 'tarefa', 't1', 'apagar')",
    ).run();
    expect(ids(db, "agenda_saida")).toEqual(["s3"]);
    sair("s4", { item_tipo: "lembrete" });
    expect(() => sair("s5", { item_tipo: "nota", item_id: "n1" })).toThrow(/CHECK/);
    expect(() => sair("s6", { item_id: "t2", operacao: "mover" })).toThrow(/CHECK/);
    expect(() => sair("s7", { item_id: "t3", tentativas: -1 })).toThrow(/CHECK/);
    expect(() => sair("s8", { item_id: "t4", proxima_tentativa_em: "amanhã" })).toThrow(/CHECK/);
  });

  test("foco: uma etapa em andamento por vez, a duração real ao terminar, interrompida só terminada", () => {
    const db = bancoNovo();
    foco(db, "feito", { tarefa_id: "t1" });
    foco(db, "pausa", { tipo: "pausa", duracao_planejada_min: 5, duracao_real_min: 5 });
    foco(db, "pausa-longa", {
      tipo: "pausa_longa",
      duracao_planejada_min: 15,
      duracao_real_min: 3,
      interrompida: 1,
    });
    foco(db, "rodando", { fim: null, duracao_real_min: null });
    expect(() => foco(db, "outro-rodando", { fim: null, duracao_real_min: null })).toThrow(/UNIQUE/);
    expect(() => foco(db, "tipo", { tipo: "almoco" })).toThrow(/CHECK/);
    expect(() => foco(db, "fim-antes", { fim: "2026-10-16T11:00:00.000Z" })).toThrow(/CHECK/);
    expect(() => foco(db, "sem-real", { duracao_real_min: null })).toThrow(/CHECK/);
    expect(() => foco(db, "planejada", { duracao_planejada_min: 0 })).toThrow(/CHECK/);
    expect(() => foco(db, "inicio", { inicio: "16/10/2026" })).toThrow(/CHECK/);

    // Terminar a que rodava libera a próxima; a interrompida em andamento não existe.
    db.prepare("UPDATE sessoes_foco SET fim = ?, duracao_real_min = 60 WHERE id = 'rodando'").run(DEPOIS);
    expect(() =>
      foco(db, "interrompida-aberta", { fim: null, duracao_real_min: null, interrompida: 1 }),
    ).toThrow(/CHECK/);
    foco(db, "proxima", { fim: null, duracao_real_min: null });
  });

  test("rotina: hora HH:MM, fechamento sempre com hora, dias em lista; registro um por dia, ação com a hora", () => {
    const db = bancoNovo();
    const rotina = (id: string, campos: Record<string, string | number | null>) =>
      inserir(db, "rotinas", id, { tipo: "briefing", ...campos });
    rotina("briefing-fixo", { hora: "08:30", dias_semana: "[1,2,3,4,5]" });
    expect(() => rotina("hora", { hora: "8:30" })).toThrow(/CHECK/);
    expect(() => rotina("hora-24", { hora: "24:00" })).toThrow(/CHECK/);
    expect(() => rotina("fechamento-sem-hora", { tipo: "fechamento", hora: null })).toThrow(/CHECK/);
    expect(() => rotina("tipo", { tipo: "almoco" })).toThrow(/CHECK/);
    expect(() => rotina("dias", { dias_semana: "seg,ter" })).toThrow(/CHECK/);

    const registrar = (id: string, campos: Record<string, string | number | null> = {}) =>
      inserir(db, "rotinas_registro", id, {
        rotina_id: "briefing",
        dia: "2026-10-16",
        conteudo: '{"linhas":[],"abertura":"Bom dia."}',
        ...campos,
      });
    registrar("r1");
    expect(() => registrar("r2")).toThrow(/UNIQUE/);
    registrar("r3", { rotina_id: "fechamento", acao: "ignorado", acao_em: DEPOIS });
    registrar("r4", { dia: "2026-10-17", da_execucao_id: "ex1" });
    expect(() => registrar("acao-sem-hora", { dia: "2026-10-18", acao: "comecar_o_dia" })).toThrow(/CHECK/);
    expect(() => registrar("hora-sem-acao", { dia: "2026-10-19", acao_em: DEPOIS })).toThrow(/CHECK/);
    expect(() => registrar("dia", { dia: "16/10/2026" })).toThrow(/CHECK/);
    expect(() => registrar("conteudo", { dia: "2026-10-20", conteudo: "[]" })).toThrow(/CHECK/);
  });

  test("a limpeza leva o calendário vencido com os eventos vencidos; o que tem evento vivo fica", () => {
    const db = bancoNovo();
    const vencida = diasAtras(31);
    calendario(db, "velho", { apagado_em: diasAtras(40) });
    evento(db, "ev-vencido", { calendario_id: "velho", apagado_em: vencida });
    calendario(db, "preso", { apagado_em: diasAtras(40) });
    evento(db, "ev-vivo", { calendario_id: "preso" });
    evento(db, "ev-local-vencido", { apagado_em: vencida });
    inserir(db, "rotinas", "rotina-vencida", { tipo: "briefing", apagado_em: vencida });

    limparLixeira(db, AGORA);
    expect(ids(db, "calendarios")).toEqual(["local", "preso"]);
    expect(ids(db, "eventos")).toEqual(["ev-vivo"]);
    expect(ids(db, "rotinas")).toEqual(["briefing", "fechamento"]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
