import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Agente, type SituacaoAgente } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { abrirBanco } from "../banco/conexao.ts";
import { Catalogo } from "../ferramentas/catalogo.ts";
import { ferramenta } from "../ferramentas/ferramenta.ts";
import {
  MENSAGEM_PROVEDOR_SAIU,
  MENSAGEM_RESERVA_IGUAL,
  MENSAGEM_RESERVA_SEM_PRINCIPAL,
  MENSAGEM_SO_DE_FABRICA,
  MENSAGEM_SO_MODELO,
  RepositorioAgentes,
  ServicoAgentes,
} from "./agentes.ts";
import { DE_FABRICA } from "./de-fabrica.ts";
import { EstadosAgentes } from "./estado.ts";
import { RepositorioExecucoes } from "./execucoes.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const ociosa: SituacaoAgente = {
  estado: "ativo",
  atividade: "ocioso",
  motivoSono: null,
  dormeAte: null,
  pausadoAte: null,
  fila: 0,
};

const leitura = (nome: string) =>
  ferramenta({
    nome,
    descricao: `Faz ${nome}`,
    entrada: z.object({}),
    efeito: "leitura",
    executar: () => null,
  });

function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-agentes-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  const repo = new RepositorioAgentes(db);
  const catalogo = new Catalogo([leitura("agenda.ver"), leitura("tarefas.criar"), leitura("financas.saldo")]);
  const estados = new EstadosAgentes(
    { agentes: repo, execucoes: new RepositorioExecucoes(db) },
    { agora: () => new Date("2026-10-09T12:00:00.000Z"), programar: () => () => {} },
  );
  const servico = new ServicoAgentes(
    repo,
    catalogo,
    (a) => ({
      ...ociosa,
      estado: a.estado,
      pausadoAte: a.pausadoAte,
      fila: a.id === "nuno" ? 2 : 0,
      motivoSono: a.motivoSono,
      dormeAte: a.dormeAte,
    }),
    estados,
    () => new Date("2026-10-09T12:00:00.000Z"),
  );
  return { db, repo, servico };
}

describe("agentes", () => {
  test("lista os quatro de fábrica na ordem do time, no formato do contrato, com a situação do runtime", () => {
    const { servico } = montar();
    const agentes = servico.listar();
    expect(agentes.map((a) => a.id)).toEqual(["alba", "tula", "faina", "nuno"]);
    for (const a of agentes) expect(Agente.safeParse(a).success, a.id).toBe(true);
    expect(agentes[3]).toMatchObject({
      nome: "Nuno",
      deFabrica: true,
      ferramentas: ["sessoes.*", "uso.*", "github.*", "tarefas.criar"],
      personagem: { silhueta: "capsula", traco: "fones", tom: "ardosia" },
      situacao: { estado: "ativo", fila: 2 },
    });
  });

  test("agente na lixeira não aparece; o que não existe é erro", () => {
    const { db, servico } = montar();
    db.exec(`INSERT INTO agentes (id, nome, funcao, personagem, apagado_em)
             VALUES ('velho', 'Velho', 'Já foi', '{"silhueta":"ovo","traco":"raios","tom":"ambar"}', '2026-10-01T00:00:00.000Z')`);
    expect(servico.listar().map((a) => a.id)).not.toContain("velho");
    expect(servico.procurar("velho")).toBeNull();
    expect(() => servico.obter({ id: "velho" })).toThrow("agente não encontrado");
  });

  test("capacidades são só as ferramentas do catálogo que a lista do agente cobre", () => {
    const { servico } = montar();
    // A Alba tem `agenda.*` e `tarefas.*`; `financas.*` é da Tula.
    expect(servico.capacidades({ id: "alba" }).map((c) => c.nome)).toEqual(["agenda.ver", "tarefas.criar"]);
    expect(servico.capacidades({ id: "nuno" })).toEqual([
      { nome: "tarefas.criar", descricao: "Faz tarefas.criar", efeito: "leitura" },
    ]);
    expect(servico.capacidades({ id: "tula" }).map((c) => c.nome)).toEqual(["financas.saldo"]);
  });

  test("pausar e retomar devolvem quem mudou, no formato do contrato; desligado fica de fora", () => {
    const { servico } = montar();
    servico.ligar({ id: "faina", ligado: false });

    const pausados = servico.pausar({ ate: "2026-10-09T13:00:00.000Z" });
    expect(pausados.map((a) => a.id)).toEqual(["alba", "tula", "nuno"]);
    for (const a of pausados) expect(Agente.safeParse(a).success, a.id).toBe(true);
    expect(pausados[0]!.situacao).toMatchObject({
      estado: "pausado",
      pausadoAte: "2026-10-09T13:00:00.000Z",
    });
    expect(() => servico.pausar({ agenteId: "faina", ate: null })).toThrow("Faina está desligado");
    expect(() => servico.pausar({ agenteId: "alba", ate: "2026-10-09T11:00:00.000Z" })).toThrow(
      "O fim da pausa já passou.",
    );

    expect(servico.retomar({ agenteId: "tula" }).map((a) => a.id)).toEqual(["tula"]);
    expect(servico.retomar({}).map((a) => a.id)).toEqual(["alba", "nuno"]);
    expect(servico.retomar({})).toEqual([]);
    expect(servico.ligar({ id: "faina", ligado: true }).situacao.estado).toBe("ativo");
  });

  test("acordar devolve o agente do contrato; só quem dorme por falha do provedor acorda", () => {
    const { db, servico } = montar();
    db.exec(`
      UPDATE agentes SET estado = 'dormindo', motivo_sono = 'fora_do_ar', dorme_ate = '2026-10-09T12:04:00.000Z'
       WHERE id = 'alba';
      UPDATE agentes SET estado = 'dormindo', motivo_sono = 'limite', dorme_ate = '2026-10-09T18:00:00.000Z'
       WHERE id = 'tula';
    `);
    const alba = servico.acordar({ id: "alba" });
    expect(Agente.safeParse(alba).success).toBe(true);
    expect(alba.situacao).toMatchObject({ estado: "ativo", motivoSono: null, dormeAte: null });
    expect(db.prepare("SELECT origem FROM agentes WHERE id = 'alba'").get()).toEqual({ origem: "usuario" });

    expect(() => servico.acordar({ id: "tula" })).toThrow("Tula espera o limite de uso renovar");
    expect(servico.obter({ id: "tula" }).situacao).toMatchObject({
      estado: "dormindo",
      motivoSono: "limite",
    });
  });

  test("definir troca principal e reserva, com o usuário como origem, e devolve o agente do contrato", () => {
    const { db, servico } = montar();
    db.exec(
      `INSERT INTO provedores (id, tipo, nome) VALUES ('p1', 'claude-cli', 'Claude'), ('p2', 'openai', 'OpenAI')`,
    );
    const alba = servico.definir({ id: "alba", provedorId: "p1", provedorReservaId: "p2" });
    expect(Agente.safeParse(alba).success).toBe(true);
    expect(alba).toMatchObject({ provedorId: "p1", provedorReservaId: "p2", tetoDiarioCentavos: null });
    expect(db.prepare("SELECT origem, atualizado_em FROM agentes WHERE id = 'alba'").get()).toEqual({
      origem: "usuario",
      atualizado_em: "2026-10-09T12:00:00.000Z",
    });
    // Parcial: só a reserva sai; o principal fica.
    expect(servico.definir({ id: "alba", provedorReservaId: null })).toMatchObject({
      provedorId: "p1",
      provedorReservaId: null,
    });
  });

  test("definir recusa provedor que não existe, reserva igual ou sem principal e outro campo", () => {
    const { db, servico } = montar();
    db.exec(`INSERT INTO provedores (id, tipo, nome) VALUES ('p1', 'claude-cli', 'Claude'), ('p2', 'openai', 'OpenAI');
             UPDATE provedores SET apagado_em = '2026-10-01T00:00:00.000Z' WHERE id = 'p2';`);
    expect(() => servico.definir({ id: "alba", provedorId: "p2" })).toThrow(MENSAGEM_PROVEDOR_SAIU);
    expect(() => servico.definir({ id: "alba", provedorId: "p1", provedorReservaId: "p1" })).toThrow(
      MENSAGEM_RESERVA_IGUAL,
    );
    expect(() => servico.definir({ id: "alba", provedorId: null, provedorReservaId: "p1" })).toThrow(
      MENSAGEM_RESERVA_SEM_PRINCIPAL,
    );
    expect(() => servico.definir({ id: "alba", nome: "Alva" })).toThrow(MENSAGEM_SO_MODELO);
    expect(() => servico.definir({ id: "zeca", provedorId: "p1" })).toThrow("agente não encontrado");
    // Nada do que foi recusado ficou gravado.
    expect(servico.obter({ id: "alba" })).toMatchObject({
      nome: "Alba",
      provedorId: null,
      provedorReservaId: null,
    });
  });

  test("trocar o modelo acorda quem dormia pelo provedor; quem dorme pelo teto continua dormindo", () => {
    const { db, servico } = montar();
    db.exec(`INSERT INTO provedores (id, tipo, nome) VALUES ('p1', 'claude-cli', 'Claude'), ('p2', 'openai', 'OpenAI');
             UPDATE agentes SET provedor_id = 'p1', estado = 'dormindo', motivo_sono = 'credencial',
               dorme_ate = '2026-10-09T13:00:00.000Z' WHERE id = 'tula';
             UPDATE agentes SET provedor_id = 'p1', estado = 'dormindo', motivo_sono = 'teto',
               dorme_ate = '2026-10-10T03:00:00.000Z' WHERE id = 'nuno';`);
    expect(servico.definir({ id: "tula", provedorId: "p2" }).situacao).toMatchObject({
      estado: "ativo",
      dormeAte: null,
    });
    expect(servico.definir({ id: "nuno", provedorId: "p2" }).situacao).toMatchObject({
      estado: "dormindo",
      dormeAte: "2026-10-10T03:00:00.000Z",
    });
  });

  test("definir grava o teto na moeda escolhida; em real sem cotação o teto não vale e a tela pede a cotação", () => {
    const { db, servico } = montar();
    const alba = servico.definir({ id: "alba", tetoDiarioCentavos: 500, tetoMoeda: "USD" });
    expect(Agente.safeParse(alba).success).toBe(true);
    expect(alba).toMatchObject({ tetoDiarioCentavos: 500, tetoMoeda: "USD" });
    // Em dólar não há conversão: o gasto já vem na moeda do teto, sem data de cotação.
    expect(alba.gastoDeHoje).toEqual({
      microdolares: 0,
      centavos: 0,
      cotacaoDe: null,
      limiteCentavos: 500,
      liberarCentavos: 100,
      pedeCotacao: false,
    });
    // O real é o padrão; sem cotação gravada, nada de número.
    const tula = servico.definir({ id: "tula", tetoDiarioCentavos: 1000 });
    expect(tula).toMatchObject({ tetoMoeda: "BRL", gastoDeHoje: { centavos: null, pedeCotacao: true } });
    expect(
      db.prepare("SELECT teto_moeda, teto_diario_centavos FROM agentes WHERE id = 'alba'").get(),
    ).toEqual({
      teto_moeda: "USD",
      teto_diario_centavos: 500,
    });
    // Sem teto, nada a pedir.
    expect(servico.definir({ id: "tula", tetoDiarioCentavos: null }).gastoDeHoje).toMatchObject({
      limiteCentavos: null,
      liberarCentavos: null,
      pedeCotacao: false,
    });
  });

  test("mudar o teto esquece o que foi liberado e acorda quem dormia pelo teto e já não está nele", () => {
    const { db, servico } = montar();
    db.exec(`UPDATE agentes SET teto_moeda = 'USD', teto_diario_centavos = 1000, teto_liberado_centavos = 200,
               teto_liberado_ate = '2026-10-10T03:00:00.000Z', estado = 'dormindo', motivo_sono = 'teto',
               dorme_ate = '2026-10-10T03:00:00.000Z' WHERE id = 'nuno'`);
    expect(servico.obter({ id: "nuno" }).gastoDeHoje.limiteCentavos).toBe(1200);
    const nuno = servico.definir({ id: "nuno", tetoDiarioCentavos: 1500 });
    expect(nuno.situacao).toMatchObject({ estado: "ativo", motivoSono: null });
    expect(nuno.gastoDeHoje.limiteCentavos).toBe(1500);
    expect(
      db.prepare("SELECT teto_liberado_centavos, teto_liberado_ate FROM agentes WHERE id = 'nuno'").get(),
    ).toEqual({ teto_liberado_centavos: null, teto_liberado_ate: null });
  });

  test("restaurar padrão volta o personalizado ao de fábrica e mantém modelo, reserva, teto e estado", () => {
    const { db, servico } = montar();
    db.exec(`INSERT INTO provedores (id, tipo, nome) VALUES ('p1', 'claude-cli', 'Claude'), ('p2', 'openai', 'OpenAI');
             UPDATE agentes SET nome = 'Tulinha', funcao = 'Contas', instrucoes = 'Fale em versos.',
               personagem = '{"silhueta":"ovo","traco":"raios","tom":"ambar"}', ferramentas = '["agenda.*"]',
               gatilhos = '[{"tipo":"horario","hora":"08:30"}]', escopos_memoria = '["geral"]',
               provedor_id = 'p1', provedor_reserva_id = 'p2', estado = 'pausado',
               pausado_ate = '2026-10-09T13:00:00.000Z', origem = 'agente', agente_id = 'tula'
             WHERE id = 'tula';`);
    expect(servico.obter({ id: "tula" }).nome).toBe("Tulinha");

    const tula = servico.restaurarPadrao({ id: "tula" });
    expect(Agente.safeParse(tula).success).toBe(true);
    expect(tula).toMatchObject({ ...DE_FABRICA.tula, provedorId: "p1", provedorReservaId: "p2" });
    expect(tula.situacao).toMatchObject({ estado: "pausado", pausadoAte: "2026-10-09T13:00:00.000Z" });
    expect(
      db
        .prepare(
          "SELECT origem, agente_id, atualizado_em, teto_diario_centavos FROM agentes WHERE id = 'tula'",
        )
        .get(),
    ).toEqual({
      origem: "usuario",
      agente_id: null,
      atualizado_em: "2026-10-09T12:00:00.000Z",
      teto_diario_centavos: null,
    });
    // Só a Tula voltou: os outros seguem como estavam.
    expect(servico.obter({ id: "alba" })).toMatchObject(DE_FABRICA.alba);
  });

  test("o agente diz quais campos saíram do de fábrica; modelo e estado não contam", () => {
    const { db, servico } = montar();
    for (const a of servico.listar()) expect(a.camposPersonalizados, a.id).toEqual([]);

    // O personagem com as chaves em outra ordem é o mesmo; o nome e as ferramentas mudaram.
    db.exec(`INSERT INTO provedores (id, tipo, nome) VALUES ('p1', 'claude-cli', 'Claude');
             UPDATE agentes SET nome = 'Tulinha', ferramentas = '["financas.*"]',
               personagem = '{"tom":"musgo","traco":"coque","silhueta":"pera"}',
               provedor_id = 'p1', estado = 'pausado'
             WHERE id = 'tula';
             INSERT INTO agentes (id, nome, funcao, personagem)
             VALUES ('meu', 'Meu', 'Ajuda', '{"silhueta":"ovo","traco":"raios","tom":"ambar"}');`);
    const tula = servico.obter({ id: "tula" });
    expect(Agente.safeParse(tula).success).toBe(true);
    expect(tula.camposPersonalizados).toEqual(["nome", "ferramentas"]);
    // Criado por você não tem de fábrica para comparar.
    expect(servico.obter({ id: "meu" }).camposPersonalizados).toEqual([]);

    expect(servico.restaurarPadrao({ id: "tula" }).camposPersonalizados).toEqual([]);
  });

  test("restaurar padrão só vale para agente de fábrica que existe", () => {
    const { db, servico } = montar();
    db.exec(`INSERT INTO agentes (id, nome, funcao, personagem)
             VALUES ('meu', 'Meu', 'Ajuda', '{"silhueta":"ovo","traco":"raios","tom":"ambar"}')`);
    expect(() => servico.restaurarPadrao({ id: "meu" })).toThrow(MENSAGEM_SO_DE_FABRICA);
    expect(servico.obter({ id: "meu" }).nome).toBe("Meu");
    expect(() => servico.restaurarPadrao({ id: "zeca" })).toThrow("agente não encontrado");
  });

  test("o provedor vem com a configuração para o registro; o da lixeira não", () => {
    const { db, repo } = montar();
    db.exec(`INSERT INTO provedores (id, tipo, nome, modelo, credencial, caminho) VALUES
               ('p1', 'claude-cli', 'Claude', 'haiku', NULL, 'C:\\npm\\claude.cmd'),
               ('p2', 'openai-compativel', 'Ollama', 'llama', 'moductus/ollama', NULL);
             UPDATE provedores SET apagado_em = '2026-10-01T00:00:00.000Z' WHERE id = 'p2';`);
    // O caminho que a detecção guardou vai ao adaptador, que o roda em vez do `claude` do PATH.
    expect(repo.provedor("p1")).toEqual({
      id: "p1",
      tipo: "claude-cli",
      modelo: "haiku",
      baseUrl: null,
      credencial: null,
      caminho: "C:\\npm\\claude.cmd",
    });
    expect(repo.provedor("p2")).toBeNull();
  });
});
