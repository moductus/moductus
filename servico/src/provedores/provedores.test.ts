import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Provedor, ResultadoTesteProvedor, type ProvedorDetectado } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { ProvedorFalso } from "./falso.ts";
import {
  credencialDoProvedor,
  INSTRUCOES_TESTE,
  RepositorioProvedores,
  ServicoProvedores,
} from "./provedores.ts";
import { RegistroProvedores } from "./registro.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const CHAVE = "sk-segredo-de-teste-123";
const CLAUDE: ProvedorDetectado = {
  tipo: "claude-cli",
  caminho: "C:\\bin\\claude.exe",
  versao: "2.1.287",
  logado: true,
  impedimento: null,
  versaoMinima: null,
};

/**
 * Banco migrado de verdade (com os quatro agentes de fábrica, sem modelo), cofre em memória e o
 * provedor falso no lugar dos adaptadores: nenhum teste chama modelo, rede ou CLI.
 */
function montar(
  opcoes: {
    detectados?: ProvedorDetectado[];
    detectar?: () => Promise<ProvedorDetectado[]>;
    prazoTesteMs?: number;
    prazoDeteccaoMs?: number;
  } = {},
) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-provedores-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  const cofre = new Map<string, string>();
  const falso = new ProvedorFalso("falso");
  const registro = new RegistroProvedores()
    .registrar("openai-compativel", () => falso)
    .registrar("openai", () => falso)
    .registrar("claude-cli", () => falso);
  const avisos = { provedores: [] as Provedor[][], agentes: [] as string[][], voltou: [] as string[][] };
  let deteccoes = 0;
  const tempos = [1000, 3100];
  const servico = new ServicoProvedores(
    new RepositorioProvedores(db),
    {
      credenciais: {
        guardar: (nome, valor) => {
          cofre.set(nome, valor);
          return Promise.resolve();
        },
        apagar: (nome) => {
          cofre.delete(nome);
          return Promise.resolve();
        },
      },
      registro,
      detectar: () => {
        deteccoes++;
        return opcoes.detectar ? opcoes.detectar() : Promise.resolve(opcoes.detectados ?? [CLAUDE]);
      },
      agora: () => new Date("2026-10-10T12:00:00.000Z"),
      cronometro: () => tempos.shift() ?? 0,
      ...(opcoes.prazoTesteMs ? { prazoTesteMs: opcoes.prazoTesteMs } : {}),
      ...(opcoes.prazoDeteccaoMs ? { prazoDeteccaoMs: opcoes.prazoDeteccaoMs } : {}),
    },
    {
      provedores: (lista) => avisos.provedores.push(lista),
      agentesMudaram: (ids) => avisos.agentes.push(ids),
      provedorVoltou: (ids) => avisos.voltou.push(ids),
    },
  );
  const agente = (id: string) =>
    db.prepare("SELECT provedor_id, provedor_reserva_id, origem FROM agentes WHERE id = ?").get(id) as {
      provedor_id: string | null;
      provedor_reserva_id: string | null;
      origem: string;
    };
  const linha = (id: string) =>
    db.prepare("SELECT * FROM provedores WHERE id = ?").get(id) as Record<string, unknown>;
  return { db, servico, cofre, falso, avisos, agente, linha, deteccoes: () => deteccoes };
}

const ollama = { tipo: "openai-compativel", nome: "Ollama", modelo: "qwen3:8b" } as const;

describe("configurar provedores", () => {
  test("a chave vai ao Gerenciador e o banco guarda só o nome; a saída nunca a traz", async () => {
    const { servico, cofre, linha, avisos } = montar();
    const criado = await servico.criar({ ...ollama, baseUrl: "http://localhost:11434/v1", chave: CHAVE });

    expect(Provedor.parse(criado)).toEqual(criado);
    expect(criado).toMatchObject({ temChave: true, testadoEm: null, baseUrl: "http://localhost:11434/v1" });
    expect(cofre.get(credencialDoProvedor(criado.id))).toBe(CHAVE);
    const guardada = linha(criado.id);
    expect(guardada.credencial).toBe(credencialDoProvedor(criado.id));
    expect(JSON.stringify(guardada)).not.toContain(CHAVE);
    expect(JSON.stringify(servico.listar())).not.toContain(CHAVE);
    expect(avisos.provedores.at(-1)).toEqual([criado]);
  });

  test("cada tipo aceita só o que usa; endereço com senha é recusado sem repetir o endereço", async () => {
    const { servico, cofre } = montar();
    await expect(servico.criar({ tipo: "claude-cli", nome: "Claude Code", chave: CHAVE })).rejects.toThrow(
      "login do próprio CLI",
    );
    await expect(
      servico.criar({ tipo: "openai", nome: "OpenAI", baseUrl: "https://outro.exemplo/v1", chave: CHAVE }),
    ).rejects.toThrow("endereço fixo");
    await expect(servico.criar(ollama)).rejects.toThrow("Falta o endereço");
    const comSenha = servico.criar({ ...ollama, baseUrl: "http://eu:senha123@localhost:11434/v1" });
    await expect(comSenha).rejects.toThrow("usuário ou senha embutidos");
    await expect(comSenha).rejects.not.toThrow("senha123");
    expect(servico.listar()).toEqual([]);
    expect(cofre.size).toBe(0);
  });

  test("trocar o endereço de quem tem chave pede a chave de novo", async () => {
    const { servico, cofre } = montar();
    const criado = await servico.criar({ ...ollama, baseUrl: "http://localhost:11434/v1", chave: CHAVE });

    await expect(servico.definir({ id: criado.id, baseUrl: "https://outro.exemplo/v1" })).rejects.toThrow(
      "pede a chave de novo",
    );
    expect(servico.listar()[0]?.baseUrl).toBe("http://localhost:11434/v1");

    const trocado = await servico.definir({
      id: criado.id,
      baseUrl: "https://outro.exemplo/v1",
      chave: "sk-2",
    });
    expect(trocado).toMatchObject({ baseUrl: "https://outro.exemplo/v1", temChave: true });
    expect(cofre.get(credencialDoProvedor(criado.id))).toBe("sk-2");

    const semChave = await servico.definir({ id: criado.id, chave: null });
    expect(semChave.temChave).toBe(false);
    expect(cofre.size).toBe(0);
    // Sem chave guardada, trocar o endereço não pede nada.
    await expect(
      servico.definir({ id: criado.id, baseUrl: "http://localhost:1234/v1" }),
    ).resolves.toMatchObject({ baseUrl: "http://localhost:1234/v1" });
  });

  test("modelo novo apaga o último teste; nome novo não", async () => {
    const { servico, falso } = montar();
    const criado = await servico.criar({ ...ollama, baseUrl: "http://localhost:11434/v1" });
    falso.roteirizar([{ tipo: "fim" }]);
    await servico.testar({ id: criado.id });

    expect((await servico.definir({ id: criado.id, nome: "Ollama de casa" })).testadoEm).toBe(
      "2026-10-10T12:00:00.000Z",
    );
    expect((await servico.definir({ id: criado.id, modelo: "llama3.2" })).testadoEm).toBeNull();
  });

  test("remover manda para a lixeira, apaga a chave e tira o provedor dos agentes", async () => {
    const { db, servico, cofre, falso, agente, linha, avisos } = montar();
    const criado = await servico.criar({ ...ollama, baseUrl: "http://localhost:11434/v1", chave: CHAVE });
    falso.roteirizar([{ tipo: "fim" }]);
    await servico.testar({ id: criado.id });
    db.prepare("UPDATE agentes SET provedor_id = NULL, provedor_reserva_id = ? WHERE id = 'nuno'").run(
      criado.id,
    );

    await expect(servico.remover({ id: criado.id })).resolves.toEqual([]);

    expect(linha(criado.id)).toMatchObject({ apagado_em: "2026-10-10T12:00:00.000Z", credencial: null });
    expect(cofre.size).toBe(0);
    for (const id of ["alba", "tula", "faina", "nuno"]) {
      expect(agente(id)).toMatchObject({ provedor_id: null, provedor_reserva_id: null });
    }
    expect(avisos.agentes.at(-1)).toEqual(["alba", "faina", "nuno", "tula"]);
    await expect(servico.testar({ id: criado.id })).rejects.toThrow("provedor não encontrado");
  });
});

describe("testar provedor", () => {
  test("chamada curta sem ferramentas, latência medida e testado_em gravado", async () => {
    const { servico, falso, linha } = montar();
    const criado = await servico.criar({ ...ollama, baseUrl: "http://localhost:11434/v1" });
    falso.roteirizar([{ tipo: "texto", texto: "ok" }, { tipo: "fim" }]);

    const resultado = await servico.testar({ id: criado.id });

    expect(ResultadoTesteProvedor.parse(resultado)).toEqual({
      ok: true,
      provedorId: criado.id,
      latenciaMs: 2100,
      testadoEm: "2026-10-10T12:00:00.000Z",
    });
    expect(linha(criado.id).testado_em).toBe("2026-10-10T12:00:00.000Z");
    const pedido = falso.pedidos[0]!;
    expect(pedido).toMatchObject({ instrucoes: INSTRUCOES_TESTE, ferramentas: [], continuarDe: null });
    expect(pedido.mensagens).toHaveLength(1);
    // Fila própria: o teste não espera nem segura a fila de um agente no adaptador de CLI.
    expect(pedido.fila).toBe(`teste-${criado.id}`);
  });

  test("o primeiro que passa vai para os quatro agentes sem modelo; o segundo não toma o lugar", async () => {
    const { servico, falso, agente, avisos } = montar();
    const primeiro = await servico.criar({ ...ollama, baseUrl: "http://localhost:11434/v1" });
    const segundo = await servico.criar({ tipo: "openai", nome: "OpenAI", modelo: "gpt-5", chave: CHAVE });
    falso.roteirizar([{ tipo: "fim" }], [{ tipo: "fim" }]);

    await servico.testar({ id: primeiro.id });
    for (const id of ["alba", "tula", "faina", "nuno"]) {
      expect(agente(id)).toMatchObject({ provedor_id: primeiro.id, origem: "usuario" });
    }
    expect(avisos.agentes).toEqual([["alba", "faina", "nuno", "tula"]]);
    // Ninguém dormia por ele: ninguém a acordar.
    expect(avisos.voltou).toEqual([]);

    await servico.testar({ id: segundo.id });
    expect(agente("alba").provedor_id).toBe(primeiro.id);
    expect(avisos.agentes).toHaveLength(1);
  });

  test("acorda quem dorme pelo provedor, não quem dorme pelo teto de gasto", async () => {
    const { db, servico, falso, avisos } = montar();
    const criado = await servico.criar({ ...ollama, baseUrl: "http://localhost:11434/v1" });
    db.prepare("UPDATE agentes SET provedor_id = ?").run(criado.id);
    db.prepare("UPDATE agentes SET estado = 'dormindo', motivo_sono = 'limite' WHERE id = 'alba'").run();
    db.prepare("UPDATE agentes SET estado = 'dormindo', motivo_sono = 'credencial' WHERE id = 'nuno'").run();
    db.prepare("UPDATE agentes SET estado = 'dormindo', motivo_sono = 'teto' WHERE id = 'tula'").run();
    falso.roteirizar([{ tipo: "fim" }]);

    await servico.testar({ id: criado.id });
    expect(avisos.voltou).toEqual([["alba", "nuno"]]);
  });

  test("substituir: passou, os agentes do antigo vão para o novo e o antigo sai com a chave", async () => {
    const { db, servico, falso, agente, linha, cofre, avisos } = montar();
    const antigo = await servico.criar({ ...ollama, baseUrl: "http://localhost:11434/v1", chave: CHAVE });
    falso.roteirizar([{ tipo: "fim" }], [{ tipo: "fim" }]);
    await servico.testar({ id: antigo.id });
    const novo = await servico.criar({ tipo: "openai", nome: "OpenAI", modelo: "gpt-5", chave: "sk-2" });
    // A reserva da Tula é o novo: virar principal deixa a reserva vazia.
    db.prepare("UPDATE agentes SET provedor_reserva_id = ? WHERE id = 'tula'").run(novo.id);
    avisos.agentes.length = 0;

    const resultado = await servico.testar({ id: novo.id, substitui: [antigo.id, "ja-saiu"] });

    expect(resultado.ok).toBe(true);
    for (const id of ["alba", "faina", "nuno"]) expect(agente(id)).toMatchObject({ provedor_id: novo.id });
    expect(agente("tula")).toMatchObject({ provedor_id: novo.id, provedor_reserva_id: null });
    expect(linha(antigo.id)).toMatchObject({ apagado_em: "2026-10-10T12:00:00.000Z", credencial: null });
    expect([...cofre.keys()]).toEqual([credencialDoProvedor(novo.id)]);
    expect(servico.listar().map((p) => p.id)).toEqual([novo.id]);
    expect(avisos.agentes).toEqual([["alba", "faina", "nuno", "tula"]]);
  });

  test("substituir: não passou, nada muda", async () => {
    const { servico, falso, agente, cofre } = montar();
    const antigo = await servico.criar({ ...ollama, baseUrl: "http://localhost:11434/v1", chave: CHAVE });
    falso.roteirizar([{ tipo: "fim" }]);
    await servico.testar({ id: antigo.id });
    const novo = await servico.criar({ tipo: "openai", nome: "OpenAI", modelo: "gpt-5", chave: "sk-2" });
    const recusa = { motivo: "credencial" as const, mensagem: "A OpenAI recusou a chave.", voltaEm: null };
    falso.roteirizar([{ tipo: "erro", falha: recusa }]);

    await expect(servico.testar({ id: novo.id, substitui: [antigo.id] })).resolves.toMatchObject({
      ok: false,
    });
    expect(agente("alba").provedor_id).toBe(antigo.id);
    expect(servico.listar().map((p) => p.id)).toEqual([antigo.id, novo.id]);
    expect(cofre.size).toBe(2);
  });

  test("provedor que mudou ou saiu enquanto o teste rodava não grava nem toma lugar", async () => {
    const { servico, falso, agente, linha } = montar();
    const mudou = await servico.criar({ ...ollama, baseUrl: "http://localhost:11434/v1" });
    const saiu = await servico.criar({ ...ollama, baseUrl: "http://localhost:1234/v1" });
    falso.roteirizar(
      [{ tipo: "pausa", ms: 30 }, { tipo: "fim" }],
      [{ tipo: "pausa", ms: 30 }, { tipo: "fim" }],
    );

    const testeDoQueMudou = servico.testar({ id: mudou.id });
    await servico.definir({ id: mudou.id, modelo: "llama3.2" });
    await expect(testeDoQueMudou).resolves.toMatchObject({ ok: true });
    expect(linha(mudou.id).testado_em).toBeNull();

    const testeDoQueSaiu = servico.testar({ id: saiu.id, substitui: [mudou.id] });
    await servico.remover({ id: saiu.id });
    await expect(testeDoQueSaiu).resolves.toMatchObject({ ok: true });
    expect(servico.listar().map((p) => p.id)).toEqual([mudou.id]);
    expect(agente("alba").provedor_id).toBeNull();
  });

  test("agente cujo provedor foi para a lixeira recebe o próximo que passa", async () => {
    const { db, servico, falso, agente } = montar();
    const velho = await servico.criar({ ...ollama, baseUrl: "http://localhost:11434/v1" });
    db.prepare("UPDATE agentes SET provedor_id = ? WHERE id = 'tula'").run(velho.id);
    db.prepare("UPDATE provedores SET apagado_em = '2026-10-01T00:00:00.000Z' WHERE id = ?").run(velho.id);
    const novo = await servico.criar({ tipo: "openai", nome: "OpenAI", modelo: "gpt-5", chave: CHAVE });
    falso.roteirizar([{ tipo: "fim" }]);

    await servico.testar({ id: novo.id });
    expect(agente("tula").provedor_id).toBe(novo.id);
  });

  test("falha do provedor volta tipada e não grava teste nem dá o provedor a ninguém", async () => {
    const { servico, falso, linha, agente, avisos } = montar();
    const criado = await servico.criar({ ...ollama, baseUrl: "http://localhost:11434/v1", chave: CHAVE });
    const recusa = { motivo: "credencial" as const, mensagem: "O provedor recusou a chave.", voltaEm: null };
    falso.roteirizar([{ tipo: "erro", falha: recusa }]);

    const resultado = await servico.testar({ id: criado.id });

    expect(resultado).toEqual({
      ok: false,
      provedorId: criado.id,
      falha: recusa,
      testadoEm: "2026-10-10T12:00:00.000Z",
    });
    expect(linha(criado.id).testado_em).toBeNull();
    expect(agente("alba").provedor_id).toBeNull();
    expect(avisos.agentes).toEqual([]);
    expect(avisos.voltou).toEqual([]);
  });

  test("sem resposta no prazo é fora do ar", async () => {
    const { servico, falso } = montar({ prazoTesteMs: 20 });
    const criado = await servico.criar({ ...ollama, baseUrl: "http://localhost:11434/v1" });
    falso.roteirizar([{ tipo: "pausa", ms: 5000 }, { tipo: "fim" }]);

    const resultado = await servico.testar({ id: criado.id });
    expect(resultado).toMatchObject({
      ok: false,
      falha: { motivo: "fora_do_ar", mensagem: "Ollama não respondeu em 1 s." },
    });
  });

  test("adaptador que quebra vira falha com o motivo, sem derrubar o canal", async () => {
    const { servico, falso } = montar();
    const criado = await servico.criar({ ...ollama, baseUrl: "http://localhost:11434/v1" });
    falso.roteirizar([{ tipo: "excecao", erro: new Error("O Claude Code saiu sem resposta (código 1)") }]);

    await expect(servico.testar({ id: criado.id })).resolves.toMatchObject({
      ok: false,
      falha: { motivo: "fora_do_ar", mensagem: "O Claude Code saiu sem resposta (código 1)" },
    });
  });

  test("CLI ausente, velho ou sem login não chega a ser chamado", async () => {
    const casos: [ProvedorDetectado[], string, string][] = [
      [[], "ausente", "Claude Code não está no PATH deste PC. Instale e teste de novo."],
      [
        [{ ...CLAUDE, versao: "2.1.100", versaoMinima: "2.1.257" }],
        "ausente",
        "Claude Code 2.1.100 é mais velho do que o Moductus pede (2.1.257 ou mais novo). Atualize e teste de novo.",
      ],
      [
        [{ ...CLAUDE, logado: false }],
        "credencial",
        "Claude Code está sem login. Abra um terminal, entre com a sua conta e teste de novo.",
      ],
      [
        [{ ...CLAUDE, caminho: "C:\\npm\\claude.cmd", impedimento: "instalado_pelo_npm" }],
        "ausente",
        "Claude Code foi instalado pelo npm, e o Moductus usa o do instalador nativo. Instale por ele e teste de novo.",
      ],
    ];
    for (const [detectados, motivo, mensagem] of casos) {
      const { servico, falso, linha } = montar({ detectados });
      const criado = await servico.criar({ tipo: "claude-cli", nome: "Claude Code" });
      await expect(servico.testar({ id: criado.id })).resolves.toMatchObject({
        ok: false,
        falha: { motivo, mensagem, voltaEm: null },
      });
      expect(falso.pedidos).toEqual([]);
      expect(linha(criado.id).testado_em).toBeNull();
    }
  });

  test("detecção que não volta no prazo vira fora do ar, sem chamar o CLI", async () => {
    const { servico, falso } = montar({
      detectar: () => new Promise(() => undefined),
      prazoDeteccaoMs: 20,
    });
    const criado = await servico.criar({ tipo: "claude-cli", nome: "Claude Code" });
    await expect(servico.testar({ id: criado.id })).resolves.toMatchObject({
      ok: false,
      falha: { motivo: "fora_do_ar", mensagem: "Claude Code não respondeu à versão nem ao login em 1 s." },
    });
    expect(falso.pedidos).toEqual([]);
  });

  test("CLI pronto faz a chamada; API não passa pela detecção", async () => {
    const { servico, falso, deteccoes } = montar();
    const claude = await servico.criar({ tipo: "claude-cli", nome: "Claude Code" });
    const api = await servico.criar({ ...ollama, baseUrl: "http://localhost:11434/v1" });
    falso.roteirizar([{ tipo: "fim" }], [{ tipo: "fim" }]);

    await expect(servico.testar({ id: claude.id })).resolves.toMatchObject({ ok: true });
    expect(deteccoes()).toBe(1);
    await expect(servico.testar({ id: api.id })).resolves.toMatchObject({ ok: true });
    expect(deteccoes()).toBe(1);
  });
});
