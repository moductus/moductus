import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { lerLinhaTranscript, lerTranscriptDoDisco, type LinhaTranscript } from "./transcript.ts";

const FIXTURE = new URL("./fixtures/2.1.287/transcript.jsonl", import.meta.url);

const pastas: string[] = [];
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

function arquivo(conteudo: string | Buffer = ""): string {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-transcript-"));
  pastas.push(pasta);
  const caminho = join(pasta, "sessao.jsonl");
  writeFileSync(caminho, conteudo);
  return caminho;
}

async function lerTudo(caminho: string, desde = 0) {
  const linhas: string[] = [];
  const fim = await lerTranscriptDoDisco(caminho, desde, (l) => linhas.push(l));
  return { linhas, fim };
}

const resposta = (corpo: Record<string, unknown>) =>
  JSON.stringify({
    type: "assistant",
    isSidechain: false,
    timestamp: "2026-10-09T15:00:00.000Z",
    message: {
      model: "claude-haiku-4-5-20251001",
      id: "msg_1",
      usage: {
        input_tokens: 1,
        output_tokens: 2,
        cache_creation_input_tokens: 3,
        cache_read_input_tokens: 4,
      },
    },
    ...corpo,
  });

describe("linha do transcript", () => {
  test("fixture gravada do Claude Code 2.1.287/2.1.293: respostas com uso e a compactação, o resto fora", async () => {
    const { linhas } = await lerTudo(fileURLToPath(FIXTURE));
    const lidas = linhas.map(lerLinhaTranscript).filter((l): l is LinhaTranscript => l !== null);
    expect(lidas).toEqual([
      // A mesma resposta em duas linhas (pensamento e texto), com o mesmo uso.
      {
        tipo: "uso",
        mensagemId: "msg_011CfsJcC5GXHcFZaDCuVgVA",
        modelo: "claude-haiku-4-5-20251001",
        instante: "2026-10-09T20:36:01.636Z",
        lateral: false,
        entrada: 10,
        saida: 53,
        cacheCriado: 16619,
        cacheLido: 26314,
      },
      expect.objectContaining({ tipo: "uso", mensagemId: "msg_011CfsJcC5GXHcFZaDCuVgVA" }),
      expect.objectContaining({ tipo: "uso", modelo: "claude-opus-5-5", cacheLido: 515126 }),
      { tipo: "compactacao", tokensDepois: 14210 },
      expect.objectContaining({ tipo: "uso", cacheCriado: 36815, cacheLido: 44561 }),
    ]);
  });

  test("subagente é lateral; mensagem sintética, erro da API, sem uso e JSON quebrado ficam fora", () => {
    expect(lerLinhaTranscript(resposta({ isSidechain: true }))).toMatchObject({ lateral: true });
    expect(
      lerLinhaTranscript(
        resposta({ message: { model: "<synthetic>", id: "x", usage: { input_tokens: 0 } } }),
      ),
    ).toBeNull();
    expect(lerLinhaTranscript(resposta({ isApiErrorMessage: true }))).toBeNull();
    expect(lerLinhaTranscript(resposta({ message: { model: "claude-haiku-4-5", id: "x" } }))).toBeNull();
    expect(lerLinhaTranscript('{"type":"assistant",')).toBeNull();
    expect(
      lerLinhaTranscript(
        JSON.stringify({ type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "auto" } }),
      ),
    ).toEqual({ tipo: "compactacao", tokensDepois: null });
  });

  test("texto do usuário que fala de assistant não vira resposta; número estranho vira 0", () => {
    const fala = JSON.stringify({ type: "user", message: { content: '{"type":"assistant","usage":{}}' } });
    expect(lerLinhaTranscript(fala)).toBeNull();
    const estranho = resposta({
      message: {
        model: "claude-x",
        id: null,
        usage: { input_tokens: -5, output_tokens: "9", cache_read_input_tokens: 1.7 },
      },
    });
    expect(lerLinhaTranscript(estranho)).toMatchObject({
      mensagemId: null,
      entrada: 0,
      saida: 0,
      cacheCriado: 0,
      cacheLido: 1,
    });
  });
});

describe("leitura incremental do disco", () => {
  test("lê só as linhas inteiras; a metade fica para a próxima, que parte de onde parou", async () => {
    const a = resposta({});
    const b = resposta({ message: { model: "m", id: "msg_2", usage: {} } });
    const caminho = arquivo(`${a}\n${b}\n{"type":"assis`);
    const primeira = await lerTudo(caminho);
    expect(primeira.linhas).toEqual([a, b]);
    expect(primeira.fim).toEqual({ lidoAte: Buffer.byteLength(`${a}\n${b}\n`), recomecou: false });

    appendFileSync(caminho, 'tant"}\n\n');
    const segunda = await lerTudo(caminho, primeira.fim?.lidoAte);
    expect(segunda.linhas).toEqual(['{"type":"assistant"}']);
    expect(segunda.fim?.lidoAte).toBe(readFileSync(caminho).length);

    const nada = await lerTudo(caminho, segunda.fim?.lidoAte);
    expect(nada).toEqual({ linhas: [], fim: { lidoAte: segunda.fim?.lidoAte, recomecou: false } });
  });

  test("caractere de dois bytes partido entre dois pedaços de 1 MiB chega inteiro", async () => {
    const PEDACO = 1024 * 1024;
    const longa = `{"a":"${"x".repeat(PEDACO - 7)}ção"}`;
    expect(
      Buffer.from(longa)
        .subarray(PEDACO - 1, PEDACO + 1)
        .toString("utf8"),
    ).toBe("ç");
    const caminho = arquivo(`${longa}\n{"b":1}\n`);
    expect((await lerTudo(caminho)).linhas).toEqual([longa, '{"b":1}']);
  });

  test("arquivo que encolheu foi trocado: recomeça do início e diz isso", async () => {
    const caminho = arquivo('{"a":1}\n');
    expect(await lerTudo(caminho, 500)).toEqual({
      linhas: ['{"a":1}'],
      fim: { lidoAte: 8, recomecou: true },
    });
  });

  test("sem arquivo, não há leitura", async () => {
    expect(await lerTranscriptDoDisco(join(tmpdir(), "nao-existe-moductus.jsonl"), 0, () => {})).toBeNull();
  });
});
