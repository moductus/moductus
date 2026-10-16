import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { EventoAgente } from "../provedor.ts";
import { LeitorStreamJson } from "./leitor.ts";

const fixture = (nome: string) =>
  readFileSync(new URL(`./fixtures/2.1.287/${nome}`, import.meta.url), "utf8").split(/\r?\n/);

const agora = new Date("2026-10-09T20:07:00Z");
const novoLeitor = () =>
  new LeitorStreamJson({
    nomeDaFerramenta: (nome) => nome.replace("mcp__moductus__", "").replace("_", "."),
    agora: () => agora,
  });

function lerTudo(linhas: readonly string[], leitor = novoLeitor()): EventoAgente[] {
  return linhas.flatMap((linha) => leitor.ler(linha));
}

const linha = (mensagem: Record<string, unknown>) =>
  JSON.stringify({ parent_tool_use_id: null, ...mensagem });
const resultado = (campos: Record<string, unknown>) =>
  linha({ type: "result", subtype: "success", is_error: false, session_id: "s1", ...campos });

describe("leitura do stream-json gravado (Claude Code 2.1.287)", () => {
  test("sessão real com ferramenta: chamada, resultado, texto em pedaços, uso e fim", () => {
    const eventos = lerTudo(fixture("sessao-com-ferramenta.jsonl"));
    expect(eventos.map((e) => e.tipo)).toEqual([
      "ferramenta",
      "resultado",
      ...Array<string>(10).fill("texto"),
      "uso",
      "fim",
    ]);
    expect(eventos[0]).toEqual({
      tipo: "ferramenta",
      chamada: {
        id: "toolu_01N6gwQaTSkzQRRptwy6srjm",
        nome: "sessoes.listar",
        entrada: { projeto: "moductus" },
      },
    });
    expect(eventos[1]).toEqual({
      tipo: "resultado",
      chamadaId: "toolu_01N6gwQaTSkzQRRptwy6srjm",
      resultado: {
        ok: true,
        valor:
          '[{"projeto":"moductus","estado":"esperando você","ferramenta":"Bash"},' +
          '{"projeto":"portfolio","estado":"trabalhando","ferramenta":"Edit"}]',
      },
    });
    // Os pedaços formam a resposta inteira, sem repetir o texto da mensagem completa.
    const fala = eventos.flatMap((e) => (e.tipo === "texto" ? [e.texto] : [])).join("");
    expect(fala).toBe(
      "Tem duas sessões abertas: uma no Moductus esperando você com Bash, e outra no Portfolio trabalhando com Edit.",
    );
    // 17 + 10669 de cache criado + 10083 de cache lido; o pensamento conta na saída.
    expect(eventos.at(-2)).toEqual({ tipo: "uso", tokensEntrada: 20769, tokensSaida: 579 });
    expect(eventos.at(-1)).toEqual({ tipo: "fim", continuacao: "78e523d4-fecc-4ec2-9fd7-87a2c33372d6" });
  });

  test("limite estourado vira erro `limite` com a hora do rate_limit_event recusado", () => {
    expect(lerTudo(fixture("limite-montada.jsonl"))).toEqual([
      {
        tipo: "erro",
        falha: {
          motivo: "limite",
          mensagem:
            "O limite de uso do Claude Code acabou: You've hit your limit · resets 5:40pm (America/Sao_Paulo)",
          voltaEm: "2026-10-09T20:40:00.000Z",
        },
      },
    ]);
  });

  test("sem o rate_limit_event, a hora sai do texto; sem hora no texto, fica sem hora", () => {
    const comHora = fixture("limite-montada.jsonl").filter((l) => !l.includes('"rate_limit_event"'));
    const [erro] = lerTudo(comHora);
    expect(erro).toMatchObject({
      tipo: "erro",
      falha: { motivo: "limite", voltaEm: "2026-10-09T20:40:00.000Z" },
    });

    const semHora = lerTudo([resultado({ is_error: true, result: "Claude AI usage limit reached" })]);
    expect(semHora).toEqual([
      {
        tipo: "erro",
        falha: {
          motivo: "limite",
          mensagem: "O limite de uso do Claude Code acabou: Claude AI usage limit reached",
          voltaEm: null,
        },
      },
    ]);
  });
});

describe("leitura tolerante", () => {
  test("sem os pedaços parciais, o texto vem da mensagem inteira", () => {
    const eventos = lerTudo([
      linha({ type: "system", subtype: "init", session_id: "s1" }),
      linha({
        type: "assistant",
        message: { id: "m1", content: [{ type: "text", text: "Nada pendente." }] },
      }),
      resultado({ usage: { input_tokens: 5, output_tokens: 2 } }),
    ]);
    expect(eventos).toEqual([
      { tipo: "texto", texto: "Nada pendente." },
      { tipo: "uso", tokensEntrada: 5, tokensSaida: 2 },
      { tipo: "fim", continuacao: "s1" },
    ]);
  });

  test("linha quebrada, tipo novo e mensagem de subagente são ignorados", () => {
    const eventos = lerTudo([
      "isto não é JSON",
      "",
      linha({ type: "tipo_que_ainda_nao_existe", algo: 1 }),
      JSON.stringify({
        type: "assistant",
        parent_tool_use_id: "toolu_pai",
        message: { id: "m2", content: [{ type: "text", text: "fala do subagente" }] },
      }),
      resultado({}),
    ]);
    expect(eventos).toEqual([{ tipo: "fim", continuacao: "s1" }]);
  });

  test("resultado de ferramenta com erro volta como erro legível", () => {
    const eventos = lerTudo([
      linha({
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "t1", is_error: true, content: "projeto não existe" },
          ],
        },
      }),
    ]);
    expect(eventos).toEqual([
      { tipo: "resultado", chamadaId: "t1", resultado: { ok: false, erro: "projeto não existe" } },
    ]);
  });

  test("nada depois do result é lido", () => {
    const leitor = novoLeitor();
    lerTudo([resultado({})], leitor);
    expect(leitor.terminou).toBe(true);
    expect(
      leitor.ler(linha({ type: "assistant", message: { content: [{ type: "text", text: "x" }] } })),
    ).toEqual([]);
  });
});

describe("falhas do provedor", () => {
  const falha = (linhas: string[]) => {
    const eventos = lerTudo(linhas);
    const ultimo = eventos.at(-1);
    return ultimo?.tipo === "erro" ? ultimo.falha : null;
  };
  const doAssistente = (erro: string, texto: string) =>
    linha({
      type: "assistant",
      error: erro,
      message: { id: "e1", content: [{ type: "text", text: texto }] },
    });

  test("login recusado vira `credencial`, sem hora de volta", () => {
    const texto = "Invalid API key · Please run /login";
    expect(
      falha([doAssistente("authentication_failed", texto), resultado({ is_error: true, result: texto })]),
    ).toEqual({ motivo: "credencial", mensagem: `O Claude Code recusou o login: ${texto}`, voltaEm: null });
    expect(falha([resultado({ is_error: true, result: "Not logged in · Please run /login" })])?.motivo).toBe(
      "credencial",
    );
  });

  test("API fora do ar ou sem rede vira `fora_do_ar`", () => {
    expect(falha([resultado({ is_error: true, result: "API Error: 529 Overloaded" })])?.motivo).toBe(
      "fora_do_ar",
    );
    expect(falha([resultado({ is_error: true, result: "API Error: Connection error." })])?.motivo).toBe(
      "fora_do_ar",
    );
    expect(falha([resultado({ is_error: true, result: "?", api_error_status: 503 })])?.motivo).toBe(
      "fora_do_ar",
    );
  });

  test("a mensagem de erro da API não aparece como fala do agente", () => {
    const eventos = lerTudo([
      doAssistente("rate_limit", "5-hour limit reached ∙ resets 3am"),
      resultado({ is_error: true, result: "5-hour limit reached ∙ resets 3am" }),
    ]);
    expect(eventos.some((e) => e.tipo === "texto")).toBe(false);
  });

  test("erro que não é do provedor falha a execução sem pôr o agente para dormir", () => {
    expect(() =>
      lerTudo([resultado({ subtype: "error_max_turns", is_error: true, result: "Reached max turns (10)" })]),
    ).toThrow(/error_max_turns/);
  });
});
