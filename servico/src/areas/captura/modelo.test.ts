import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { RepositorioAgentes } from "../../agentes/agentes.ts";
import { RepositorioExecucoes } from "../../agentes/execucoes.ts";
import { MENSAGEM_CANCELADA, Runtime } from "../../agentes/runtime.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import { Catalogo } from "../../ferramentas/catalogo.ts";
import { ProvedorFalso, roteiros } from "../../provedores/falso.ts";
import { RegistroProvedores } from "../../provedores/registro.ts";
import { interpretePeloRuntime, lerInterpretacao, promptDoInterprete } from "./modelo.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** Banco migrado de verdade, o runtime de verdade e a Alba num provedor falso: nenhum modelo, nenhuma rede. */
function montar(prazoMs = 2_000) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-captura-modelo-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  db.exec(`
    INSERT INTO provedores (id, tipo, nome) VALUES ('p-alba', 'claude-cli', 'Falso');
    UPDATE agentes SET provedor_id = 'p-alba' WHERE id = 'alba';
  `);
  const alba = new ProvedorFalso("p-alba");
  const provedores = new RegistroProvedores().registrar("claude-cli", () => alba);
  const agentes = new RepositorioAgentes(db);
  const execucoes = new RepositorioExecucoes(db);
  const runtime = new Runtime(
    { agentes, execucoes, provedores, catalogo: new Catalogo([]) },
    { execucao: () => {}, agente: () => {} },
  );
  const interpretar = interpretePeloRuntime(runtime, agentes, { prazoMs });
  const pedir = (texto: string, sinal = new AbortController().signal) =>
    interpretar({ texto, hoje: "2026-10-18", agora: "09:00", sinal });
  return { db, alba, execucoes, pedir };
}

describe("ler a resposta do modelo", () => {
  test("tolera texto em volta e confere campo a campo", () => {
    const lida = lerInterpretacao(
      'Claro: {"tipo":"lembrete","titulo":" regar as plantas ","dia":"2026-10-19","hora":"18:00",' +
        '"duracaoMin":null,"recorrencia":"FREQ=WEEKLY;BYDAY=MO","lembreteMinutosAntes":10} pronto',
    );
    expect(lida).toEqual({
      tipo: "lembrete",
      titulo: "regar as plantas",
      dia: "2026-10-19",
      hora: "18:00",
      duracaoMin: null,
      recorrencia: "FREQ=WEEKLY;BYDAY=MO",
      lembreteMinutosAntes: 10,
      valorCentavos: null,
    });
  });

  test("o que não passa fica vazio; o que não é objeto é 'não sei'", () => {
    expect(
      lerInterpretacao(
        '{"tipo":"compromisso","titulo":"","dia":"2026-02-31","hora":"25:00","duracaoMin":-5,' +
          '"recorrencia":"FREQ=HOURLY","lembreteMinutosAntes":"15","valorCentavos":45.5}',
      ),
    ).toEqual({
      tipo: null,
      titulo: null,
      dia: null,
      hora: null,
      duracaoMin: null,
      recorrencia: null,
      lembreteMinutosAntes: null,
      valorCentavos: null,
    });
    expect(lerInterpretacao("não sei")).toBeNull();
    expect(lerInterpretacao("[1, 2]")).toBeNull();
    expect(lerInterpretacao("{ quebrado")).toBeNull();
    // Resposta enorme não é lida inteira: o objeto que começa depois do limite não conta.
    expect(lerInterpretacao(`${" ".repeat(10_000)}{"tipo":"nota"}`)).toBeNull();
  });

  test("o prompt diz o dia da semana, a data e a hora", () => {
    const prompt = promptDoInterprete("2026-10-18", "09:00");
    expect(prompt).toContain("Hoje é domingo, 2026-10-18, e agora são 09:00.");
    expect(prompt).toContain("Responda só com um JSON");
  });
});

describe("pelo modelo da Alba", () => {
  test("roda como execução dela, sem ferramentas, com o prompt curto", async () => {
    const { alba, execucoes, pedir } = montar();
    alba.roteirizar(roteiros.resposta('{"tipo":"nota","titulo":"ideia de presente"}'));
    expect(await pedir("ideia de presente pra mãe")).toMatchObject({
      tipo: "nota",
      titulo: "ideia de presente",
    });
    const [pedido] = alba.pedidos;
    expect(pedido!.ferramentas).toEqual([]);
    expect(pedido!.instrucoes).toContain("captura rápida");
    expect(execucoes.pagina({ agenteId: "alba" }).itens.map((e) => e.estado)).toEqual(["ok"]);
  });

  test("sem modelo ou fora de ativo, não pergunta", async () => {
    const { db, alba, pedir } = montar();
    db.exec("UPDATE agentes SET estado = 'pausado' WHERE id = 'alba'");
    expect(await pedir("qualquer coisa")).toBeNull();
    db.exec("UPDATE agentes SET estado = 'ativo', provedor_id = NULL WHERE id = 'alba'");
    expect(await pedir("qualquer coisa")).toBeNull();
    expect(alba.pedidos).toHaveLength(0);
  });

  test("passou do prazo: cancela e volta 'não sei' na hora", async () => {
    const { alba, execucoes, pedir } = montar(50);
    alba.roteirizar([{ tipo: "pausa", ms: 5_000 }, ...roteiros.resposta('{"tipo":"nota"}')]);
    const inicio = Date.now();
    expect(await pedir("algo demorado")).toBeNull();
    expect(Date.now() - inicio).toBeLessThan(1_000);
    await new Promise((r) => setTimeout(r, 20));
    expect(execucoes.pagina({ agenteId: "alba" }).itens.map((e) => [e.estado, e.erro])).toEqual([
      ["erro", MENSAGEM_CANCELADA],
    ]);
  });

  test("a frase seguinte cancela a pergunta em curso", async () => {
    const { alba, pedir } = montar();
    alba.roteirizar([{ tipo: "pausa", ms: 5_000 }, ...roteiros.resposta('{"tipo":"nota"}')]);
    const controle = new AbortController();
    const pergunta = pedir("algo", controle.signal);
    controle.abort();
    expect(await pergunta).toBeNull();
    const cancelado = new AbortController();
    cancelado.abort();
    expect(await pedir("outra", cancelado.signal)).toBeNull();
    expect(alba.pedidos.length).toBeLessThanOrEqual(1);
  });
});
