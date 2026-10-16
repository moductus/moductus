import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { MudancaSessao, UsoIa } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { ambienteDoCli } from "../provedores/claude-cli/claude-cli.ts";
import { diaLocal, janelaDaTabela, textoDoAviso, type AvisoContexto } from "./contexto.ts";
import type { EventoHook } from "./hooks.ts";
import { hookDoMoductus, VARIAVEL_TOKEN } from "./ligacao.ts";
import { abrirReceptorHooks } from "./receptor.ts";
import { GUARDA_RESPOSTAS_MS, RepositorioSessoes, ServicoSessoes } from "./sessoes.ts";
import { lerTranscriptDoDisco, type LerTranscript } from "./transcript.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/2.1.287/transcript.jsonl", import.meta.url));
const MIL_K = 1_000_000;
const DUZENTOS_K = 200_000;

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
  /** A pasta `projects` do Claude Code deste teste. */
  projetos: string;
  /** O transcript da sessão `sessao-a`, dentro de `projetos`. */
  transcript: string;
  /** Um serviço novo no mesmo banco: o reinício do Moductus. */
  reiniciar(): ServicoSessoes;
  andar(ms: number): void;
}

function montar(opcoes: { ler?: LerTranscript } = {}): Montagem {
  const db = abrirBanco(pasta());
  bancos.push(db);
  const mudancas: MudancaSessao[] = [];
  const avisos: AvisoContexto[] = [];
  const projetos = join(pasta(), "projects");
  mkdirSync(join(projetos, "V--moductus"), { recursive: true });
  let agora = new Date("2026-10-09T18:00:00.000Z");
  const criar = () =>
    new ServicoSessoes(new RepositorioSessoes(db), (m) => mudancas.push(m), {
      agora: () => agora,
      raizDoProjeto: (cwd) => cwd,
      transcripts: { ler: opcoes.ler ?? lerTranscriptDoDisco, pastaProjetos: () => projetos },
      aoAvisarContexto: (a) => avisos.push(a),
    });
  const transcript = join(projetos, "V--moductus", "sessao-a.jsonl");
  writeFileSync(transcript, "");
  return {
    db,
    servico: criar(),
    mudancas,
    avisos,
    projetos,
    transcript,
    reiniciar: criar,
    andar: (ms) => (agora = new Date(agora.getTime() + ms)),
  };
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
    requestId: `req_${id}`,
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
async function evento(
  servico: ServicoSessoes,
  transcript: string | null,
  tipo = "Stop",
  idSessao = "sessao-a",
) {
  const m = servico.registrar("claude-code", hook(tipo, { transcript, idSessao }));
  await servico.leiturasOciosas();
  return m;
}

const sessao = (servico: ServicoSessoes, id = "sessao-a") =>
  servico.listar().sessoes.find((s) => s.idExterno === id);
const avisosNoBanco = (db: DatabaseSync) =>
  db.prepare("SELECT do_agente_id, tipo, titulo, corpo, referencia, canal FROM notificacoes").all();
const usoDoDia = (servico: ServicoSessoes) => servico.uso({ de: "2026-10-09", ate: "2026-10-09" });

describe("janela pela tabela de modelos", () => {
  test("ids atuais e legados, com data, com prefixo e versão do Bedrock e com @ do Google Cloud", () => {
    expect(janelaDaTabela("claude-opus-5-5")).toBe(MIL_K);
    expect(janelaDaTabela("claude-fable-5-1")).toBe(MIL_K);
    expect(janelaDaTabela("claude-sonnet-4-6")).toBe(MIL_K);
    expect(janelaDaTabela("anthropic.claude-opus-5-5")).toBe(MIL_K);
    expect(janelaDaTabela("claude-haiku-4-5-20251001")).toBe(DUZENTOS_K);
    expect(janelaDaTabela("us.anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe(DUZENTOS_K);
    expect(janelaDaTabela("claude-opus-4-5@20251101")).toBe(DUZENTOS_K);
    expect(janelaDaTabela("claude-opus-4-20250514")).toBe(DUZENTOS_K);
    expect(janelaDaTabela("claude-3-haiku-20240307")).toBe(DUZENTOS_K);
  });

  test("o [1m] pede a janela de 1 milhão a um modelo conhecido; desconhecido continua sem janela", () => {
    expect(janelaDaTabela("claude-sonnet-4-5-20250929[1m]")).toBe(MIL_K);
    expect(janelaDaTabela("claude-opus-5-5[1M]")).toBe(MIL_K);
    expect(janelaDaTabela("claude-opus-9-9[1m]")).toBeNull();
  });

  test("modelo fora da tabela, que não é Claude ou nenhum: não sei", () => {
    expect(janelaDaTabela("claude-opus-9-9")).toBeNull();
    expect(janelaDaTabela("glm-4.6")).toBeNull();
    expect(janelaDaTabela("constructor")).toBeNull();
    expect(janelaDaTabela(null)).toBeNull();
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
    // Depois da compactação, a última resposta (Opus 5.5, 1M pela tabela) leu 81.378 tokens.
    expect(s?.contexto).toEqual({ usadoTokens: 81_378, janelaTokens: MIL_K });
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
    expect(sessao(depois)?.contexto).toEqual({ usadoTokens: 30_000, janelaTokens: DUZENTOS_K });
    expect(usoDoDia(depois)).toEqual([
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
        janelaTokens: DUZENTOS_K,
      },
    ]);
    // Quem registra e entrega o aviso é a área de notificações (main.ts), pela preferência do Nuno.
    expect(avisosNoBanco(db)).toEqual([]);

    escrever(transcript, compactacao(12_000));
    await evento(depois, transcript, "SessionStart");
    expect(sessao(depois)?.contexto).toEqual({ usadoTokens: 12_000, janelaTokens: DUZENTOS_K });
    escrever(transcript, resposta("msg_5", 165_000));
    await evento(depois, transcript);
    expect(avisos).toHaveLength(2);
  });

  test("Opus 5.5 tem a janela de 1 milhão da tabela: 170 mil é 17%, sem aviso", async () => {
    const { servico, transcript, avisos } = montar();
    escrever(transcript, resposta("msg_1", 170_000, { modelo: "claude-opus-5-5" }));
    await evento(servico, transcript);
    expect(sessao(servico)?.contexto).toEqual({ usadoTokens: 170_000, janelaTokens: MIL_K });
    expect(avisos).toEqual([]);
  });

  test("modelo desconhecido: a área não sabe, e nenhum aviso sai, nem com contexto enorme", async () => {
    const { servico, transcript, avisos, db } = montar();
    escrever(transcript, resposta("msg_1", 900_000, { modelo: "glm-4.6" }));
    await evento(servico, transcript);
    expect(sessao(servico)?.contexto).toBeNull();
    expect(sessao(servico)?.modelo).toBe("glm-4.6");
    expect(avisos).toEqual([]);
    expect(avisosNoBanco(db)).toEqual([]);
    // O uso conta mesmo sem janela: os tokens vieram da ferramenta.
    expect(usoDoDia(servico)).toEqual([expect.objectContaining({ modelo: "glm-4.6", tokensSaida: 100 })]);
  });

  test("janela informada pela ferramenta vale mais que a tabela, inclusive para modelo fora dela", async () => {
    const { servico, transcript, avisos } = montar();
    const custo = (modelo: string, janela: number) =>
      JSON.stringify({
        type: "cost-state",
        modelUsage: { [modelo]: { inputTokens: 1, contextWindow: janela } },
      });
    escrever(transcript, resposta("msg_1", 110_000, { modelo: "glm-4.6" }), custo("glm-4.6", 128_000));
    await evento(servico, transcript);
    expect(sessao(servico)?.contexto).toEqual({ usadoTokens: 110_000, janelaTokens: 128_000 });
    expect(avisos.map((a) => a.titulo)).toEqual(["Contexto em 85%"]);

    escrever(transcript, resposta("msg_2", 150_000), custo("claude-haiku-4-5-20251001", MIL_K));
    await evento(servico, transcript);
    expect(sessao(servico)?.contexto).toEqual({ usadoTokens: 150_000, janelaTokens: MIL_K });
  });

  test("subagente gasta mas não ocupa o contexto; compactação sem tamanho deixa o contexto sem número", async () => {
    const { servico, transcript } = montar();
    escrever(transcript, resposta("msg_1", 40_000), resposta("msg_sub", 90_000, { lateral: true, saida: 5 }));
    await evento(servico, transcript);
    expect(sessao(servico)?.contexto?.usadoTokens).toBe(40_000);
    expect(usoDoDia(servico)[0]).toMatchObject({ tokensSaida: 105 });

    escrever(transcript, JSON.stringify({ type: "system", subtype: "compact_boundary" }));
    await evento(servico, transcript);
    expect(sessao(servico)?.contexto).toBeNull();
  });

  test("sem transcript, inexistente, que não é JSONL, fora da pasta projects ou de rede: a área não sabe", async () => {
    const { servico, transcript } = montar();
    escrever(transcript, resposta("msg_1", 40_000));
    await evento(servico, null, "SessionStart");
    expect(sessao(servico)?.contexto).toBeNull();

    const fora = join(pasta(), "sessao-a.jsonl");
    writeFileSync(fora, `${resposta("msg_1", 40_000)}\n`);
    const recusados = [
      join(tmpdir(), "nao-existe-moductus.jsonl"),
      transcript.replace(/\.jsonl$/, ".txt"),
      fora,
      "\\\\servidor\\c$\\sessao-a.jsonl",
      `\\\\?\\${transcript}`,
    ];
    for (const caminho of recusados) {
      await evento(servico, caminho);
      expect(sessao(servico)?.contexto, caminho).toBeNull();
    }
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
    expect(usoDoDia(servico)[0]).toMatchObject({ tokensSaida: 200 });
  });

  test("arquivo trocado por um menor: o contexto é relido e só a resposta nova conta", async () => {
    const { servico, transcript } = montar();
    escrever(transcript, resposta("msg_1", 50_000), resposta("msg_2", 60_000));
    await evento(servico, transcript);
    // Menor que o anterior: a mesma primeira resposta e uma nova, mais curta.
    writeFileSync(transcript, `${resposta("msg_1", 50_000)}\n${resposta("msg_9", 1_000)}\n`);
    await evento(servico, transcript);
    expect(sessao(servico)?.contexto?.usadoTokens).toBe(1_000);
    expect(usoDoDia(servico)[0]).toMatchObject({ tokensSaida: 300 });
  });

  test("fork: outra sessão com as mesmas respostas copiadas não conta o uso de novo", async () => {
    const { servico, transcript, projetos } = montar();
    const historico = [resposta("msg_1", 20_000), resposta("msg_2", 30_000)];
    escrever(transcript, ...historico);
    await evento(servico, transcript);
    const fork = join(projetos, "V--moductus", "sessao-b.jsonl");
    writeFileSync(fork, "");
    escrever(fork, ...historico, resposta("msg_3", 35_000, { saida: 7 }));
    await evento(servico, fork, "Stop", "sessao-b");

    expect(sessao(servico, "sessao-b")?.contexto?.usadoTokens).toBe(35_000);
    expect(usoDoDia(servico)).toEqual([expect.objectContaining({ tokensEntrada: 30, tokensSaida: 207 })]);
  });

  test("respostas contadas são esquecidas depois de 90 dias", async () => {
    const { servico, transcript, andar, db } = montar();
    escrever(transcript, resposta("msg_1", 20_000), resposta("msg_2", 30_000));
    await evento(servico, transcript);
    expect(servico.podarRespostasContadas()).toBe(0);
    andar(GUARDA_RESPOSTAS_MS + 1);
    expect(servico.podarRespostasContadas()).toBe(2);
    expect(db.prepare("SELECT count(*) AS n FROM uso_ia_mensagens").get()).toEqual({ n: 0 });
  });

  test("a sessão passa para outro arquivo: o novo é lido do início", async () => {
    const { servico, transcript } = montar();
    escrever(transcript, resposta("msg_1", 50_000), resposta("msg_2", 60_000));
    await evento(servico, transcript);
    const outro = transcript.replace(/\.jsonl$/, "-2.jsonl");
    writeFileSync(outro, `${resposta("msg_3", 70_000)}\n${resposta("msg_4", 80_000)}\n`);
    await evento(servico, outro);
    expect(sessao(servico)?.contexto?.usadoTokens).toBe(80_000);
    expect(usoDoDia(servico)[0]).toMatchObject({ tokensSaida: 400 });
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
    expect(usoDoDia(servico)[0]).toMatchObject({ tokensSaida: 300 });
  });

  test("outra ferramenta não tem o transcript lido: formato desconhecido", async () => {
    const { servico, transcript } = montar();
    escrever(transcript, resposta("msg_1", 40_000));
    servico.registrar("codex", hook("Stop", { transcript }));
    await servico.leiturasOciosas();
    expect(servico.listar().sessoes[0]?.contexto).toBeNull();
  });
});

describe("execução dos próprios agentes", () => {
  test("o claude -p do adaptador não leva MODUCTUS_HOOKS_TOKEN: o hook dele leva 401 e nada entra em uso_ia", async () => {
    const { servico, transcript } = montar();
    escrever(transcript, resposta("msg_1", 40_000));
    const token = "token-dos-hooks-de-teste";
    const receptor = await abrirReceptorHooks(
      token,
      (ferramenta, ev) => {
        servico.registrar(ferramenta, ev);
        return undefined;
      },
      0,
    );
    try {
      // O ambiente do usuário tem o token publicado (F2-22); o do CLI do agente, não.
      const doAgente = ambienteDoCli({ PATH: "C:\\bin", [VARIAVEL_TOKEN]: token }, "acesso-mcp");
      expect(doAgente[VARIAVEL_TOKEN]).toBeUndefined();

      // O Claude Code expande o cabeçalho do hook com as variáveis de `allowedEnvVars` do processo dele.
      const gancho = hookDoMoductus(receptor.porta, "Stop") as { headers: Record<string, string> };
      const expandir = (env: NodeJS.ProcessEnv) =>
        gancho.headers.Authorization!.replace(`$${VARIAVEL_TOKEN}`, env[VARIAVEL_TOKEN] ?? "");
      const corpo = JSON.stringify({
        hook_event_name: "Stop",
        session_id: "do-agente",
        transcript_path: transcript,
      });
      const enviar = (autorizacao: string) =>
        fetch(`http://127.0.0.1:${receptor.porta}/hooks/claude-code`, {
          method: "POST",
          headers: { authorization: autorizacao, "content-type": "application/json" },
          body: corpo,
        });

      const doCliDoAgente = await enviar(expandir(doAgente));
      expect(doCliDoAgente.status).toBe(401);
      await servico.leiturasOciosas();
      expect(servico.listar().sessoes).toEqual([]);
      expect(servico.uso({ de: "2026-10-01", ate: "2026-10-31" })).toEqual([]);

      // Contraprova: o mesmo evento com o token do usuário entra.
      expect((await enviar(expandir({ [VARIAVEL_TOKEN]: token }))).status).toBe(200);
      await servico.leiturasOciosas();
      expect(servico.listar().sessoes).toHaveLength(1);
    } finally {
      await receptor.fechar();
    }
  });
});
