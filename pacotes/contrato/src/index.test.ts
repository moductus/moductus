import { expect, test } from "vitest";
import { EVENTOS, METODOS, VERSAO_PROTOCOLO } from "./index.ts";

test("protocolo na versão 3: a fase 3 mudou a forma do canal", () => {
  expect(VERSAO_PROTOCOLO).toBe(3);
});

test("nomes de método e evento seguem dominio.acao", () => {
  for (const nome of [...Object.keys(METODOS), ...Object.keys(EVENTOS)]) {
    expect(nome).toMatch(/^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/);
  }
});

test("o dia chega ao canal: métodos e eventos de cada área da fase 3", () => {
  const grupos = (nomes: string[]) => new Set(nomes.map((n) => n.split(".")[0]));
  const metodos = grupos(Object.keys(METODOS));
  for (const grupo of [
    "listas",
    "tarefas",
    "lembretes",
    "agenda",
    "foco",
    "notas",
    "rotinas",
    "captura",
    "areas",
  ]) {
    expect(metodos, grupo).toContain(grupo);
  }
  const eventos = grupos(Object.keys(EVENTOS));
  for (const grupo of ["listas", "tarefas", "lembretes", "agenda", "foco", "notas", "rotinas", "areas"]) {
    expect(eventos, grupo).toContain(grupo);
  }
});
