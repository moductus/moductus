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
import { RepositorioAgentes, ServicoAgentes } from "./agentes.ts";
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
    }),
    estados,
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

  test("o provedor vem com a configuração para o registro; o da lixeira não", () => {
    const { db, repo } = montar();
    db.exec(`INSERT INTO provedores (id, tipo, nome, modelo, credencial) VALUES
               ('p1', 'claude-cli', 'Claude', 'haiku', NULL),
               ('p2', 'openai-compativel', 'Ollama', 'llama', 'moductus/ollama');
             UPDATE provedores SET apagado_em = '2026-10-01T00:00:00.000Z' WHERE id = 'p2';`);
    expect(repo.provedor("p1")).toEqual({
      id: "p1",
      tipo: "claude-cli",
      modelo: "haiku",
      baseUrl: null,
      credencial: null,
    });
    expect(repo.provedor("p2")).toBeNull();
  });
});
