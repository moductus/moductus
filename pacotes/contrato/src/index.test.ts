import { expect, test } from "vitest";
import { EVENTOS, METODOS, VERSAO_PROTOCOLO } from "./index.ts";

test("protocolo na versão 4: a fase 4 mudou a forma do canal", () => {
  expect(VERSAO_PROTOCOLO).toBe(4);
});

test("nomes de método e evento seguem dominio.acao", () => {
  for (const nome of [...Object.keys(METODOS), ...Object.keys(EVENTOS)]) {
    expect(nome).toMatch(/^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/);
  }
});

const grupos = (nomes: string[]) => new Set(nomes.map((n) => n.split(".")[0]));

test("o dia chega ao canal: métodos e eventos de cada área da fase 3", () => {
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

test("o dinheiro chega ao canal: métodos de cada área e os eventos da fase 4", () => {
  const metodos = grupos(Object.keys(METODOS));
  for (const grupo of ["financas", "dividas", "planos", "importacao", "arquivos"]) {
    expect(metodos, grupo).toContain(grupo);
  }
  expect(Object.keys(EVENTOS)).toEqual(
    expect.arrayContaining(["financas.mudou", "importacao.progresso", "privacidade.mudou"]),
  );
});
