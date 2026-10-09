import { appendFileSync, copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { MudancaSessao, UsoIa } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import {
  diaLocal,
  JANELA_ESTENDIDA,
  JANELA_PADRAO,
  janelaDoContexto,
  modeloDoSettings,
  textoDoAviso,
  type AvisoContexto,
} from "./contexto.ts";
import type { EventoHook } from "./hooks.ts";
import { RepositorioSessoes, ServicoSessoes } from "./sessoes.ts";
import { lerTranscriptDoDisco, type LerTranscript } from "./transcript.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/2.1.287/transcript.jsonl", import.meta.url));

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

function pasta(): string {
  const p = mkdtempSync(join(tmpdir(), "moductus-contexto-"));
  pastas.push(p);
  return p;
}

interface Montagem {
  db: DatabaseSync;
  servico: ServicoSessoes;
  mudancas: MudancaSessao[];
  avisos: AvisoContexto[];
  transcript: string;
  /** Um serviço novo no mesmo banco: o reinício do Moductus. */
  reiniciar(): ServicoSessoes;
}

function montar(
  opcoes: { configurado?: string | null; ler?: LerTranscript } = {},
  dados = pasta(),
): Montagem {
  const db = abrirBanco(dados);
  bancos.push(db);
  const mudancas: MudancaSessao[] = [];
  const avisos: AvisoContexto[] = [];
  const criar = () =>
    new ServicoSessoes(new RepositorioSessoes(db), (m) => mudancas.push(m), {
      agora: () => new Date("2026-10-09T18:00:00.000Z"),
      raizDoProjeto: (cwd) => cwd,
      transcripts: {
        ler: opcoes.ler ?? lerTranscriptDoDisco,
        modeloConfigurado: () => opcoes.configurado ?? null,
      },
      aoAvisarContexto: (a) => avisos.push(a),
    });
  const transcript = join(pasta(), "sessao-a.jsonl");
  writeFileSync(transcript, "");
  return { db, servico: criar(), mudancas, avisos, transcript, reiniciar: criar };
}

const hook = (tipo: string, extra: Partial<EventoHook> = {}): EventoHook => ({
  tipo,
  idSessao: "sessao-a",
  cwd: "V:\\moductus",
  transcript: null,
  modelo: null,
  ferramenta: null,
  resumo: null,
  entrada: null,
  emSegundoPlano: 0,
  aviso: null,
  origem: null,
  ...extra,
});

/** Uma resposta do modelo como o Claude Code grava: tokens no contexto = entrada + cache. */
function resposta(
  id: string,
  contexto: number,
  {
    saida = 100,
    modelo = "claude-haiku-4-5-20251001",
    quando = "2026-10-09T15:00:00.000Z",
    lateral = false,
  } = {},
): string {
  return JSON.stringify({
    type: "assistant",
    isSidechain: lateral,
    timestamp: quando,
    message: {
      model: modelo,
      id,
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: contexto - 10,
        output_tokens: saida,
      },
    },
  });
}

const compactacao = (depois: number) =>
  JSON.stringify({ type: "system", subtype: "compact_boundary", compactMetadata: { postTokens: depois } });

const escrever = (caminho: string, ...linhas: string[]) => appendFileSync(caminho, `${linhas.join("\n")}\n`);

/** Um evento do hook com o transcript e a espera da leitura que ele dispara. */
async function evento(servico: ServicoSessoes, transcript: string | null, tipo = "Stop") {
  const m = servico.registrar("claude-code", hook(tipo, { transcript }));
  await servico.leiturasOciosas();
  return m;
}

const sessao = (servico: ServicoSessoes) => servico.listar().sessoes.find((s) => s.idExterno === "sessao-a");
const avisosNoBanco = (db: DatabaseSync) =>
  db.prepare("SELECT do_agente_id, tipo, titulo, corpo, referencia, canal FROM notificacoes").all();

describe("janela de contexto", () => {
  const sem = () => null;
  test("Claude na janela padrão; [1m] no id, contexto acima da padrão ou já estendida dão a de 1 milhão", () => {
    expect(janelaDoContexto("claude-haiku-4-5-20251001", 1000, sem, null)).toBe(JANELA_PADRAO);
    expect(janelaDoContexto("claude-sonnet-4-5[1m]", 1000, sem, null)).toBe(JANELA_ESTENDIDA);
    expect(janelaDoContexto("claude-opus-5-5", 200_001, sem, null)).toBe(JANELA_ESTENDIDA);
    expect(janelaDoContexto("claude-opus-5-5", 14_000, sem, JANELA_ESTENDIDA)).toBe(JANELA_ESTENDIDA);
  });

  test("o [1m] do settings.json vale só para a mesma família", () => {
    const opus1m = () => "opus[1m]";
    expect(janelaDoContexto("claude-opus-5-5", 1000, opus1m, null)).toBe(JANELA_ESTENDIDA);
    expect(janelaDoContexto("claude-haiku-4-5-20251001", 1000, opus1m, null)).toBe(JANELA_PADRAO);
    expect(janelaDoContexto("claude-opus-5-5", 1000, () => "opus", null)).toBe(JANELA_PADRAO);
    expect(janelaDoContexto("claude-sonnet-4-5", 1000, () => "claude-sonnet-4-5-20250929[1m]", null)).toBe(
      JANELA_ESTENDIDA,
    );
  });

  test("modelo que não é Claude, ou nenhum ainda, não tem janela conhecida", () => {
    expect(janelaDoContexto("glm-4.6", 1000, sem, null)).toBeNull();
    expect(janelaDoContexto(null, null, sem, null)).toBeNull();
  });

  test("model do settings.json: lido quando há, vazio sem arquivo ou com JSON quebrado", () => {
    const p = pasta();
    const caminho = join(p, "settings.json");
    expect(modeloDoSettings(caminho)).toBeNull();
    writeFileSync(caminho, '\uFEFF{"model": "opus[1m]", "hooks": {}}');
    expect(modeloDoSettings(caminho)).toBe("opus[1m]");
    writeFileSync(caminho, "{quebrado");
    expect(modeloDoSettings(caminho)).toBeNull();
  });

  test("aviso na voz do Nuno: porcentagem para baixo, projeto quando há; dia local", () => {
    expect(textoDoAviso("claude-code", "moductus", 163_999, 200_000)).toEqual({
      titulo: "Contexto em 81%",
      corpo:
        "A sessão do Claude Code em moductus chegou a 81% do contexto. Vale compactar com /compact ou encerrar.",
    });
    expect(textoDoAviso("codex", null, 160_000, 200_000).corpo).toBe(
      "A sessão do Codex chegou a 80% do contexto. Vale compactar com /compact ou encerrar.",
    );
    expect(diaLocal(new Date(2026, 9, 9, 23, 59))).toBe("2026-10-09");
    expect(diaLocal(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });
});

describe("contexto e uso pelo transcript", () => {
  test("sessão real gravada (fixture): % da janela, modelo, uso por dia contado uma vez e a sessão de volta às janelas", async () => {
    const { servico, mudancas, transcript, db } = montar();
    copyFileSync(FIXTURE, transcript);
    await evento(servico, transcript);

    const s = sessao(servico);
    // Depois da compactação, a última resposta leu 81.378 tokens; o modelo já passou de 200 mil antes.
    expect(s?.contexto).toEqual({ usadoTokens: 81_378, janelaTokens: JANELA_ESTENDIDA });
    expect(s?.modelo).toBe("claude-opus-5-5");
    expect(MudancaSessao.parse(mudancas.at(-1))).toEqual({ sessao: s, projeto: expect.anything() });

    const uso = servico.uso({ de: "2026-10-01", ate: "2026-10-31" });
    expect(uso.map((u) => UsoIa.parse(u))).toEqual(uso);
    expect(uso).toEqual([
      expect.objectContaining({
        dia: diaLocal(new Date("2026-10-08T14:51:28.453Z")),
        modelo: "claude-opus-5-5",
        tokensEntrada: 4,
        tokensSaida: 139 + 307,
        tokensCache: 512 + 515_126 + 36_815 + 44_561,
        custoEstimadoMicrodolares: null,
        fonte: "ferramenta",
      }),
      // As duas linhas da mesma resposta (pensamento e texto) contam uma vez.
      expect.objectContaining({
        dia: diaLocal(new Date("2026-10-09T20:36:01.636Z")),
        ferramenta: "claude-code",
        modelo: "claude-haiku-4-5-20251001",
        projetoId: s?.projetoId,
        tokensEntrada: 10,
        tokensSaida: 53,
        tokensCache: 16_619 + 26_314,
        fonte: "ferramenta",
      }),
    ]);
    // Abaixo de 80% da janela de 1 milhão: nenhum aviso.
    expect(avisosNoBanco(db)).toEqual([]);
  });

  test("lê só o que o arquivo ganhou; evento sem linha nova e reinício do serviço não contam de novo", async () => {
    const { servico, transcript, reiniciar } = montar();
    escrever(transcript, resposta("msg_1", 20_000, { saida: 50 }));
    await evento(servico, transcript, "SessionStart");
    await evento(servico, transcript);
    escrever(transcript, resposta("msg_1", 20_000, { saida: 50 }), resposta("msg_2", 30_000, { saida: 70 }));
    await evento(servico, transcript);

    const depois = reiniciar();
    await evento(depois, transcript);
    expect(sessao(depois)?.contexto).toEqual({ usadoTokens: 30_000, janelaTokens: JANELA_PADRAO });
    expect(depois.uso({ de: "2026-10-09", ate: "2026-10-09" })).toEqual([
      expect.objectContaining({ tokensEntrada: 20, tokensSaida: 120, tokensCache: 49_980 }),
    ]);
  });

  test("aviso aos 80% sai uma vez, sobrevive ao reinício e volta a valer depois da compactação", async () => {
    const { servico, transcript, avisos, db, reiniciar } = montar();
    escrever(transcript, resposta("msg_1", 159_999));
    await evento(servico, transcript);
    expect(avisos).toEqual([]);

    escrever(transcript, resposta("msg_2", 160_000));
    await evento(servico, transcript);
    escrever(transcript, resposta("msg_3", 170_000));
    await evento(servico, transcript);
    const depois = reiniciar();
    escrever(transcript, resposta("msg_4", 180_000));
    await evento(depois, transcript);

    const id = sessao(depois)?.id;
    expect(avisos).toEqual([
      {
        sessaoId: id,
        titulo: "Contexto em 80%",
        corpo:
          "A sessão do Claude Code em moductus chegou a 80% do contexto. Vale compactar com /compact ou encerrar.",
        usadoTokens: 160_000,
        janelaTokens: JANELA_PADRAO,
      },
    ]);
    expect(avisosNoBanco(db)).toEqual([
      {
        do_agente_id: "nuno",
        tipo: "aviso",
        titulo: "Contexto em 80%",
        corpo: avisos[0]?.corpo,
        referencia: `sessao:${id}`,
        canal: "dock",
      },
    ]);

    escrever(transcript, compactacao(12_000));
    await evento(depois, transcript, "SessionStart");
    expect(sessao(depois)?.contexto).toEqual({ usadoTokens: 12_000, janelaTokens: JANELA_PADRAO });
    escrever(transcript, resposta("msg_5", 165_000));
    await evento(depois, transcript);
    expect(avisosNoBanco(db)).toHaveLength(2);
  });

  test("[1m] no settings.json: 170 mil numa sessão Opus é 17%, sem aviso", async () => {
    const { servico, transcript, avisos } = montar({ configurado: "opus[1m]" });
    escrever(transcript, resposta("msg_1", 170_000, { modelo: "claude-opus-5-5" }));
    await evento(servico, transcript);
    expect(sessao(servico)?.contexto).toEqual({ usadoTokens: 170_000, janelaTokens: JANELA_ESTENDIDA });
    expect(avisos).toEqual([]);
  });

  test("subagente gasta mas não ocupa o contexto; compactação sem tamanho deixa o contexto sem número", async () => {
    const { servico, transcript } = montar();
    escrever(transcript, resposta("msg_1", 40_000), resposta("msg_sub", 90_000, { lateral: true, saida: 5 }));
    await evento(servico, transcript);
    expect(sessao(servico)?.contexto?.usadoTokens).toBe(40_000);
    expect(servico.uso({ de: "2026-10-09", ate: "2026-10-09" })[0]).toMatchObject({ tokensSaida: 105 });

    escrever(transcript, JSON.stringify({ type: "system", subtype: "compact_boundary" }));
    await evento(servico, transcript);
    expect(sessao(servico)?.contexto).toBeNull();
  });

  test("sem transcript, transcript que não existe ou que não é JSONL: a área não sabe", async () => {
    const { servico, transcript } = montar();
    escrever(transcript, resposta("msg_1", 40_000));
    await evento(servico, null, "SessionStart");
    expect(sessao(servico)?.contexto).toBeNull();
    await evento(servico, join(tmpdir(), "nao-existe-moductus.jsonl"));
    expect(sessao(servico)?.contexto).toBeNull();
    await evento(servico, transcript.replace(/\.jsonl$/, ".txt"));
    expect(sessao(servico)?.contexto).toBeNull();
    expect(servico.uso({ de: "2026-10-01", ate: "2026-10-31" })).toEqual([]);
  });

  test("eventos em rajada: uma leitura por vez, a última pega o que chegou durante a anterior", async () => {
    let lendo = 0;
    let maximo = 0;
    const ler: LerTranscript = async (caminho, desde, aCadaLinha) => {
      maximo = Math.max(maximo, ++lendo);
      await new Promise((pronto) => setTimeout(pronto, 5));
      try {
        return await lerTranscriptDoDisco(caminho, desde, aCadaLinha);
      } finally {
        lendo--;
      }
    };
    const { servico, transcript } = montar({ ler });
    escrever(transcript, resposta("msg_1", 10_000));
    servico.registrar("claude-code", hook("PreToolUse", { transcript }));
    servico.registrar("claude-code", hook("PostToolUse", { transcript }));
    escrever(transcript, resposta("msg_2", 11_000));
    servico.registrar("claude-code", hook("Stop", { transcript }));
    await servico.leiturasOciosas();
    expect(maximo).toBe(1);
    expect(sessao(servico)?.contexto?.usadoTokens).toBe(11_000);
    expect(servico.uso({ de: "2026-10-09", ate: "2026-10-09" })[0]).toMatchObject({ tokensSaida: 200 });
  });

  test("arquivo trocado por um menor: o contexto é relido, o uso não conta de novo", async () => {
    const { servico, transcript } = montar();
    escrever(transcript, resposta("msg_1", 50_000), resposta("msg_2", 60_000));
    await evento(servico, transcript);
    writeFileSync(transcript, `${resposta("msg_9", 5_000)}\n`);
    await evento(servico, transcript);
    expect(sessao(servico)?.contexto?.usadoTokens).toBe(5_000);
    expect(servico.uso({ de: "2026-10-09", ate: "2026-10-09" })[0]).toMatchObject({ tokensSaida: 200 });
  });

  test("a sessão passa para outro arquivo: o novo é lido do início", async () => {
    const { servico, transcript } = montar();
    escrever(transcript, resposta("msg_1", 50_000), resposta("msg_2", 60_000));
    await evento(servico, transcript);
    const outro = transcript.replace(/\.jsonl$/, "-2.jsonl");
    writeFileSync(outro, `${resposta("msg_3", 70_000)}\n${resposta("msg_4", 80_000)}\n`);
    await evento(servico, outro);
    expect(sessao(servico)?.contexto?.usadoTokens).toBe(80_000);
    expect(servico.uso({ de: "2026-10-09", ate: "2026-10-09" })[0]).toMatchObject({ tokensSaida: 400 });
  });

  test("troca de arquivo no meio de uma leitura: o ponto do arquivo velho não vale para o novo", async () => {
    let soltar = () => {};
    const segurar = new Promise<void>((pronto) => (soltar = pronto));
    let primeira = true;
    const ler: LerTranscript = async (caminho, desde, aCadaLinha) => {
      if (primeira) {
        primeira = false;
        await segurar;
      }
      return lerTranscriptDoDisco(caminho, desde, aCadaLinha);
    };
    const { servico, transcript } = montar({ ler });
    escrever(transcript, resposta("msg_1", 50_000), resposta("msg_2", 60_000));
    servico.registrar("claude-code", hook("Stop", { transcript }));
    const outro = transcript.replace(/\.jsonl$/, "-2.jsonl");
    writeFileSync(outro, `${resposta("msg_3", 70_000)}\n`);
    servico.registrar("claude-code", hook("Stop", { transcript: outro }));
    soltar();
    await servico.leiturasOciosas();
    expect(sessao(servico)?.contexto?.usadoTokens).toBe(70_000);
    // O uso lido do arquivo velho conta; o do novo também, do início.
    expect(servico.uso({ de: "2026-10-09", ate: "2026-10-09" })[0]).toMatchObject({ tokensSaida: 300 });
  });

  test("outra ferramenta não tem o transcript lido: formato desconhecido", async () => {
    const { servico, transcript } = montar();
    escrever(transcript, resposta("msg_1", 40_000));
    servico.registrar("codex", hook("Stop", { transcript }));
    await servico.leiturasOciosas();
    expect(servico.listar().sessoes[0]?.contexto).toBeNull();
  });
});
