import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_PADRAO, type Config, type EstadoConfig } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { AUTOSTART_NO_PORTABLE, RepositorioConfig, ServicoConfig, type AplicadorNativo } from "./config.ts";

const pastas: string[] = [];
const bancos: { close(): void; isOpen: boolean }[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

function montar(
  nativo: AplicadorNativo,
  pasta = mkdtempSync(join(tmpdir(), "moductus-config-")),
  portable = false,
) {
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  const eventos: EstadoConfig[] = [];
  const servico = new ServicoConfig(new RepositorioConfig(db), nativo, (e) => eventos.push(e), portable);
  return { servico, eventos, db, pasta };
}

type Aplicacao = { config: Config; mudou: string[] };
const aceita = (registro: Aplicacao[] = []): AplicadorNativo => ({
  aplicar: async (config, mudou) => {
    registro.push({ config, mudou });
    return { falhasAtalhos: {} };
  },
});

describe("configuração", () => {
  test("banco vazio devolve o padrão", () => {
    expect(montar(aceita()).servico.obter().config).toEqual(CONFIG_PADRAO);
  });

  test("mudança vale na hora: a casca aplica, o evento sai e o valor volta", async () => {
    const aplicados: Aplicacao[] = [];
    const { servico, eventos } = montar(aceita(aplicados));
    const estado = await servico.definir({ dock: { lado: "direita", modo: "esconder", forma: "flutuante" } });
    expect(estado.config.dock).toEqual({ lado: "direita", modo: "esconder", forma: "flutuante" });
    expect(aplicados).toEqual([{ config: estado.config, mudou: ["dock"] }]);
    expect(eventos.at(-1)?.config.dock.lado).toBe("direita");
  });

  test("tema não passa pela casca: é só da interface", async () => {
    const aplicados: Aplicacao[] = [];
    const { servico, eventos } = montar(aceita(aplicados));
    await servico.definir({ tema: "papel" });
    expect(aplicados).toEqual([]);
    expect(eventos.at(-1)?.config.tema).toBe("papel");
  });

  test("sobrevive a reinício", async () => {
    const primeiro = montar(aceita());
    await primeiro.servico.definir({ tema: "vidro", autostart: true });
    primeiro.db.close();
    const depois = montar(aceita(), primeiro.pasta);
    expect(depois.servico.obter().config).toMatchObject({ tema: "vidro", autostart: true });
  });

  test("a casca recusa um atalho: o motivo volta e nada é gravado", async () => {
    const recusa: AplicadorNativo = {
      aplicar: () => Promise.reject(new Error("Ctrl+Alt+K já está em uso por outro programa")),
    };
    const { servico, eventos } = montar(recusa);
    await expect(
      servico.definir({ atalhos: { ...CONFIG_PADRAO.atalhos, captura: "Ctrl+Alt+K" } }),
    ).rejects.toThrow("já está em uso");
    expect(servico.obter().config.atalhos.captura).toBe("Ctrl+Alt+Space");
    expect(eventos).toEqual([]);
  });

  test("entrada fora do contrato é recusada", async () => {
    const { servico } = montar(aceita());
    await expect(servico.definir({ tema: "neon" } as never)).rejects.toThrow();
  });

  test("cada opção do Sistema sobrevive a reabrir o banco", async () => {
    const primeiro = montar(aceita());
    const escolhida: Config = {
      tema: "papel",
      dock: { lado: "direita", modo: "inteligente", forma: "flutuante" },
      atalhos: { sistema: "Ctrl+Shift+M", dock: "Ctrl+Alt+J", captura: "Ctrl+Alt+K" },
      autostart: true,
    };
    // Uma chave por vez, como a interface manda.
    for (const [chave, valor] of Object.entries(escolhida))
      await primeiro.servico.definir({ [chave]: valor });
    primeiro.db.close();
    const depois = montar(aceita(), primeiro.pasta);
    expect(depois.servico.obter().config).toEqual(escolhida);
  });

  test("portable: autostart não liga, o resto continua editável", async () => {
    const aplicados: Aplicacao[] = [];
    const { servico } = montar(aceita(aplicados), undefined, true);
    await expect(servico.definir({ autostart: true })).rejects.toThrow(AUTOSTART_NO_PORTABLE);
    expect(servico.obter()).toMatchObject({ portable: true, config: { autostart: false } });
    expect(aplicados).toEqual([]);
    await servico.definir({ tema: "vidro", autostart: false });
    expect(servico.obter().config.tema).toBe("vidro");
  });
});
