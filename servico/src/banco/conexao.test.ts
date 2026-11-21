import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { MIGRACOES } from "../migracoes/index.ts";
import { abrirBanco, pastaDeDados, portable } from "./conexao.ts";

test("usa a pasta que a casca entrega (portable ou %APPDATA%)", () => {
  expect(pastaDeDados({ MODUCTUS_PASTA: "D:/Moductus", APPDATA: "C:/X" })).toBe("D:/Moductus");
  expect(pastaDeDados({ APPDATA: "C:/X" })).toBe(join("C:/X", "Moductus"));
  expect(portable({ MODUCTUS_PORTABLE: "1" })).toBe(true);
  expect(portable({})).toBe(false);
});

test("abre o arquivo na pasta e aplica as migrações", () => {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-banco-"));
  const db = abrirBanco(pasta);
  expect(existsSync(join(pasta, "moductus.db"))).toBe(true);
  expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: MIGRACOES.length });
  db.close();
  rmSync(pasta, { recursive: true, force: true });
});

test("o serviço espera o disco a cada COMMIT; só o banco de teste dispensa", () => {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-banco-"));
  const servico = abrirBanco(pasta);
  expect(servico.prepare("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
  servico.close();
  const teste = abrirBanco(pasta, { duravel: false });
  expect(teste.prepare("PRAGMA synchronous").get()).toEqual({ synchronous: 0 });
  teste.close();
  rmSync(pasta, { recursive: true, force: true });
});
