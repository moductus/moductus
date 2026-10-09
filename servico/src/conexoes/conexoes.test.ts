import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Conexao, PreviaConexao } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import type { AmbienteDoUsuario } from "../casca/ambiente.ts";
import { LigacaoClaudeCode, VARIAVEL_TOKEN } from "../sessoes/ligacao.ts";
import { CREDENCIAL_HOOKS } from "../sessoes/token.ts";
import { AVISO_DESATUALIZADA, AVISO_SAIU, RepositorioConexoes, ServicoConexoes } from "./conexoes.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const TOKEN = "token-de-teste-dos-hooks";
const ORIGINAL = `${JSON.stringify({ model: "opus", hooks: { Stop: [{ hooks: [{ type: "command", command: "echo" }] }] } }, null, 2)}\n`;

/**
 * Banco migrado de verdade, `settings.json` numa pasta temporária e o ambiente do usuário num
 * mapa: nenhum teste toca no arquivo nem nas variáveis desta máquina.
 */
function montar(conteudo: string | null = ORIGINAL, falhas: { ambiente?: string } = {}) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-conexoes-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  mkdirSync(join(pasta, "claude"));
  const caminho = join(pasta, "claude", "settings.json");
  const variaveis = new Map<string, string>();
  const ambiente: AmbienteDoUsuario = {
    definir: (nome, valor) => {
      if (falhas.ambiente) return Promise.reject(new Error(falhas.ambiente));
      variaveis.set(nome, valor);
      return Promise.resolve();
    },
    apagar: (nome) => {
      variaveis.delete(nome);
      return Promise.resolve();
    },
  };
  const avisos: Conexao[] = [];
  const ligacao = new LigacaoClaudeCode({ caminho, porta: 47821 });
  const servico = new ServicoConexoes(
    new RepositorioConexoes(db),
    {
      ligacao,
      ambiente,
      token: () => Promise.resolve(TOKEN),
      agora: () => new Date("2026-10-09T12:00:00.000Z"),
    },
    (c) => avisos.push(c),
  );
  const escrever = (texto: string) => writeFileSync(caminho, texto, "utf8");
  if (conteudo !== null) escrever(conteudo);
  const ler = () => readFileSync(caminho, "utf8");
  return { db, servico, variaveis, avisos, ler, escrever, caminho };
}

const CLAUDE = { tipo: "hooks-claude-code" } as const;

describe("conexão com o Claude Code", () => {
  test("ligar publica a variável, grava os hooks e registra; desligar desfaz tudo e o arquivo volta igual", async () => {
    const { servico, variaveis, avisos, ler, db } = montar();
    expect(servico.listar()).toEqual([
      { tipo: "hooks-claude-code", estado: "desligada", conta: null, ultimoErro: null, conectadaEm: null },
    ]);

    for (let volta = 0; volta < 2; volta++) {
      const ligada = await servico.ligar(CLAUDE);
      expect(Conexao.parse(ligada)).toEqual(ligada);
      expect(ligada).toMatchObject({
        estado: "ligada",
        ultimoErro: null,
        conectadaEm: "2026-10-09T12:00:00.000Z",
      });
      expect(variaveis.get(VARIAVEL_TOKEN)).toBe(TOKEN);
      // O token só chega ao ambiente: o arquivo leva o nome da variável, nunca o valor.
      expect(ler()).not.toContain(TOKEN);
      expect(ler()).toContain(`$${VARIAVEL_TOKEN}`);
      expect(servico.listar()[0]?.estado).toBe("ligada");

      const desligada = await servico.desligar(CLAUDE);
      expect(desligada).toMatchObject({ estado: "desligada", ultimoErro: null, conectadaEm: null });
      expect(variaveis.has(VARIAVEL_TOKEN)).toBe(false);
      expect(ler()).toBe(ORIGINAL);
    }
    expect(avisos.map((a) => a.estado)).toEqual(["ligada", "desligada", "ligada", "desligada"]);
    // Uma linha só por tipo, e sem segredo: só o nome da credencial enquanto ligada.
    expect(db.prepare("SELECT count(*) AS n FROM conexoes").get()).toEqual({ n: 1 });
    await servico.ligar(CLAUDE);
    expect(db.prepare("SELECT tipo, credencial, estado FROM conexoes").get()).toEqual({
      tipo: "hooks-claude-code",
      credencial: CREDENCIAL_HOOKS,
      estado: "ligada",
    });
  });

  test("a prévia mostra o que muda e não grava nem publica nada", () => {
    const { servico, variaveis, ler } = montar();
    const previa = servico.previa(CLAUDE);
    expect(PreviaConexao.parse(previa)).toEqual(previa);
    expect(previa.arquivos).toHaveLength(1);
    expect(previa.arquivos[0]?.trecho).toBe("hooks");
    expect(ler()).toBe(ORIGINAL);
    expect(variaveis.size).toBe(0);
  });

  test("settings.json inválido: ligar não publica a variável, não toca no arquivo e diz o motivo", async () => {
    const quebrado = "{ isto não é json";
    const { servico, variaveis, ler } = montar(quebrado);
    const conexao = await servico.ligar(CLAUDE);
    expect(conexao.estado).toBe("erro");
    expect(conexao.ultimoErro).toMatch(/não é um JSON válido/);
    expect(variaveis.size).toBe(0);
    expect(ler()).toBe(quebrado);
  });

  test("a casca não grava a variável: o arquivo fica como estava e o erro aparece", async () => {
    const { servico, ler } = montar(ORIGINAL, { ambiente: "acesso negado ao registro" });
    const conexao = await servico.ligar(CLAUDE);
    expect(conexao).toMatchObject({ estado: "erro", ultimoErro: "acesso negado ao registro" });
    expect(ler()).toBe(ORIGINAL);
  });

  test("hooks tirados à mão ou de outra porta aparecem como erro com o que fazer", async () => {
    const { servico, escrever, caminho } = montar();
    await servico.ligar(CLAUDE);
    escrever(ORIGINAL);
    expect(servico.listar()[0]).toMatchObject({ estado: "erro", ultimoErro: AVISO_SAIU });

    await servico.ligar(CLAUDE);
    const outraPorta = new LigacaoClaudeCode({ caminho, porta: 50000 });
    outraPorta.ligar();
    expect(servico.listar()[0]).toMatchObject({ estado: "erro", ultimoErro: AVISO_DESATUALIZADA });
    expect((await servico.ligar(CLAUDE)).estado).toBe("ligada");
  });

  test("GitHub ainda não é desta tarefa", async () => {
    const { servico } = montar();
    expect(() => servico.previa({ tipo: "github" })).toThrow(/ainda não está disponível/);
    await expect(servico.ligar({ tipo: "github" })).rejects.toThrow(/ainda não está disponível/);
  });
});
