import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  leitorDoDisco,
  lerLinhaTranscript,
  lerTranscriptDoDisco,
  pastaDosProjetosClaude,
  transcriptPermitido,
  type LinhaTranscript,
} from "./transcript.ts";

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
        mensagemId: "msg_fixture01",
        requisicaoId: "req_fixture01",
        modelo: "claude-haiku-4-5-20251001",
        instante: "2026-10-09T20:36:01.636Z",
        lateral: false,
        entrada: 10,
        saida: 53,
        cacheCriado: 16619,
        cacheLido: 26314,
      },
      expect.objectContaining({ tipo: "uso", mensagemId: "msg_fixture01" }),
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

  test("linha acima do teto é descartada até a próxima quebra; as vizinhas chegam", async () => {
    const ler = leitorDoDisco(64);
    const curta = '{"a":1}';
    const longa = `{"b":"${"y".repeat(200)}"}`;
    const caminho = arquivo(`${curta}\n${longa}\n${curta}\n`);
    const linhas: string[] = [];
    const fim = await ler(caminho, 0, (l) => linhas.push(l));
    expect(linhas).toEqual([curta, curta]);
    expect(fim?.lidoAte).toBe(readFileSync(caminho).length);
  });

  test("linha acima do teto ainda sendo escrita: o descartado não é relido, o resto não vira resposta", async () => {
    const ler = leitorDoDisco(64);
    const inicio = JSON.stringify({ type: "assistant", message: { content: "z".repeat(300) } });
    const caminho = arquivo(`{"a":1}\n${inicio.slice(0, 200)}`);
    const linhas: string[] = [];
    const primeira = await ler(caminho, 0, (l) => linhas.push(l));
    expect(linhas).toEqual(['{"a":1}']);
    expect(primeira?.lidoAte).toBe(readFileSync(caminho).length);

    appendFileSync(caminho, `${inicio.slice(200)}\n{"c":3}\n`);
    await ler(caminho, primeira?.lidoAte ?? 0, (l) => linhas.push(l));
    expect(linhas.at(-1)).toBe('{"c":3}');
    expect(linhas.map(lerLinhaTranscript).filter((l) => l !== null)).toEqual([]);
  });
});

describe("janela informada pela ferramenta", () => {
  test("cost-state com contextWindow por modelo vira janela; sem o campo, nada", () => {
    const comJanela = JSON.stringify({
      type: "cost-state",
      modelUsage: { "glm-4.6": { inputTokens: 5, contextWindow: 128_000 }, outro: { contextWindow: -1 } },
    });
    expect(lerLinhaTranscript(comJanela)).toEqual({ tipo: "janela", janelas: { "glm-4.6": 128_000 } });
    const semJanela = JSON.stringify({
      type: "cost-state",
      modelUsage: { "claude-opus-5-5": { inputTokens: 5 } },
    });
    expect(lerLinhaTranscript(semJanela)).toBeNull();
  });
});

describe("transcript permitido", () => {
  function projetos() {
    const raiz = mkdtempSync(join(tmpdir(), "moductus-claude-"));
    pastas.push(raiz);
    const pasta = join(raiz, "projects");
    mkdirSync(join(pasta, "V--moductus"), { recursive: true });
    const dentro = join(pasta, "V--moductus", "sessao.jsonl");
    writeFileSync(dentro, "");
    writeFileSync(join(raiz, "fora.jsonl"), "");
    writeFileSync(join(pasta, "V--moductus", "notas.txt"), "");
    return { raiz, pasta, dentro };
  }

  test("só .jsonl dentro da pasta projects do Claude Code, pelo caminho resolvido", () => {
    const { raiz, pasta, dentro } = projetos();
    expect(transcriptPermitido(dentro, pasta)?.toLowerCase()).toBe(realpathSync(dentro).toLowerCase());
    expect(transcriptPermitido(join(raiz, "fora.jsonl"), pasta)).toBeNull();
    expect(transcriptPermitido(join(pasta, "V--moductus", "..", "..", "fora.jsonl"), pasta)).toBeNull();
    expect(transcriptPermitido(join(pasta, "V--moductus", "notas.txt"), pasta)).toBeNull();
    expect(transcriptPermitido(join(pasta, "V--moductus", "nao-existe.jsonl"), pasta)).toBeNull();
    expect(transcriptPermitido("V--moductus\\sessao.jsonl", pasta)).toBeNull();
    expect(transcriptPermitido(dentro, join(raiz, "nao-existe"))).toBeNull();
  });

  test("caminho de rede e de dispositivo são recusados sem tocar no disco", () => {
    const { pasta } = projetos();
    expect(transcriptPermitido("\\\\servidor\\c$\\sessao.jsonl", pasta)).toBeNull();
    expect(transcriptPermitido("//servidor/c$/sessao.jsonl", pasta)).toBeNull();
    expect(transcriptPermitido(`\\\\?\\${join(pasta, "V--moductus", "sessao.jsonl")}`, pasta)).toBeNull();
    expect(transcriptPermitido(`\\\\.\\${join(pasta, "V--moductus", "sessao.jsonl")}`, pasta)).toBeNull();
  });

  test("a pasta projects segue o CLAUDE_CONFIG_DIR, como o settings.json", () => {
    expect(pastaDosProjetosClaude({}, "C:\\Users\\voce")).toBe(
      join("C:\\Users\\voce", ".claude", "projects"),
    );
    expect(pastaDosProjetosClaude({ CLAUDE_CONFIG_DIR: "D:\\claude" }, "C:\\Users\\voce")).toBe(
      join("D:\\claude", "projects"),
    );
  });
});
