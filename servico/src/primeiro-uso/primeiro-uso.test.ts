import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { EstadoPrimeiroUso } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { migrar } from "../banco/migracoes.ts";
import { MIGRACOES } from "../migracoes/index.ts";
import { RepositorioPrimeiroUso, ServicoPrimeiroUso } from "./primeiro-uso.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

function novaPasta() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-primeiro-uso-"));
  pastas.push(pasta);
  return pasta;
}

function montar(pasta = novaPasta()) {
  const db = abrirBanco(pasta);
  bancos.push(db);
  const eventos: EstadoPrimeiroUso[] = [];
  const servico = new ServicoPrimeiroUso(new RepositorioPrimeiroUso(db), (e) => eventos.push(e));
  return { servico, eventos, db, pasta };
}

describe("primeiro uso", () => {
  test("banco novo: configuração pendente, todos os passos e missões pendentes", () => {
    const estado = montar().servico.obter();
    expect(estado.concluido).toBe(false);
    expect(estado.concluidoEm).toBeNull();
    expect(Object.values(estado.passos)).toEqual(Array(5).fill("pendente"));
    expect(Object.values(estado.missoes)).toEqual(Array(5).fill("pendente"));
    expect(estado.tutorial).toBe("pendente");
  });

  test("concluir grava como cada passo terminou, avisa e sobrevive a reabrir o banco", () => {
    const primeiro = montar();
    const estado = primeiro.servico.concluir({
      passos: {
        "boas-vindas": "feito",
        "tema-dock": "feito",
        modelo: "pulado",
        time: "feito",
        conexoes: "feito",
      },
    });
    expect(estado.concluido).toBe(true);
    expect(estado.concluidoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(estado.passos.modelo).toBe("pulado");
    expect(primeiro.eventos.at(-1)).toEqual(estado);
    primeiro.db.close();

    const depois = montar(primeiro.pasta).servico.obter();
    expect(depois).toEqual(estado);
  });

  test("pular a configuração no meio: o que não foi visto conta como pulado, e conclui", () => {
    const { servico } = montar();
    const estado = servico.concluir({ passos: { "boas-vindas": "feito" } });
    expect(estado.concluido).toBe(true);
    expect(estado.passos).toEqual({
      "boas-vindas": "feito",
      "tema-dock": "pulado",
      modelo: "pulado",
      time: "pulado",
      conexoes: "pulado",
    });
  });

  test("passo fora do contrato é recusado e nada é gravado", () => {
    const { servico } = montar();
    expect(() => servico.concluir({ passos: { atalhos: "feito" } } as never)).toThrow();
    expect(() => servico.concluir({ passos: { modelo: "pendente" } } as never)).toThrow();
    expect(servico.obter().concluido).toBe(false);
  });

  test("tutorial: pular esconde, rever traz de volta; as cinco missões feitas o encerram", () => {
    const { servico } = montar();
    servico.concluir({ passos: {} });
    expect(servico.marcar({ alvo: "tutorial", estado: "pulado" }).tutorial).toBe("pulado");
    expect(servico.marcar({ alvo: "tutorial", estado: "pendente" }).tutorial).toBe("pendente");

    const missoes = ["alba-lembrete", "tula-extrato", "faina-aprovacao", "faina-downloads"] as const;
    for (const missao of missoes) servico.marcar({ alvo: "missao", missao, estado: "feito" });
    expect(servico.obter().tutorial).toBe("pendente");
    const fim = servico.marcar({ alvo: "missao", missao: "nuno-sessao", estado: "feito" });
    expect(fim.tutorial).toBe("feito");
    expect(Object.values(fim.missoes)).toEqual(Array(5).fill("feito"));
  });

  test("a primeira sessão do Claude Code faz a missão do Nuno; as seguintes não gravam nem avisam", () => {
    const { servico, eventos } = montar();
    servico.concluir({ passos: {} });
    const antes = eventos.length;
    servico.sessaoDoClaudeCode();
    expect(servico.obter().missoes["nuno-sessao"]).toBe("feito");
    expect(eventos).toHaveLength(antes + 1);
    expect(eventos.at(-1)!.missoes["nuno-sessao"]).toBe("feito");
    servico.sessaoDoClaudeCode();
    servico.sessaoDoClaudeCode();
    expect(eventos).toHaveLength(antes + 1);
    // Voltou a pendente: a próxima sessão faz a missão de novo.
    servico.marcar({ alvo: "missao", missao: "nuno-sessao", estado: "pendente" });
    servico.sessaoDoClaudeCode();
    expect(servico.obter().missoes["nuno-sessao"]).toBe("feito");
  });

  test("missão do Nuno já feita antes de reiniciar: a sessão não grava de novo", () => {
    const primeiro = montar();
    primeiro.servico.marcar({ alvo: "missao", missao: "nuno-sessao", estado: "feito" });
    primeiro.db.close();
    const depois = montar(primeiro.pasta);
    depois.servico.sessaoDoClaudeCode();
    expect(depois.eventos).toHaveLength(0);
    expect(depois.servico.obter().missoes["nuno-sessao"]).toBe("feito");
  });

  test("quem atualiza com preferências já gravadas não vê a configuração de novo", () => {
    const pasta = novaPasta();
    // Banco da versão anterior (só a migração 1), com uma preferência salva.
    const antigo = new DatabaseSync(join(pasta, "moductus.db"));
    migrar(antigo, MIGRACOES.slice(0, 1));
    antigo.prepare("INSERT INTO config (chave, valor) VALUES ('tema', '\"papel\"')").run();
    antigo.close();

    const estado = montar(pasta).servico.obter();
    expect(estado.concluido).toBe(true);
    expect(estado.tutorial).toBe("pendente");
  });

  test("banco da versão anterior sem preferências: primeiro uso aparece", () => {
    const pasta = novaPasta();
    const antigo = new DatabaseSync(join(pasta, "moductus.db"));
    migrar(antigo, MIGRACOES.slice(0, 1));
    antigo.close();
    expect(montar(pasta).servico.obter().concluido).toBe(false);
  });
});
