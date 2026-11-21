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
  const db = abrirBanco(pasta, { duravel: false });
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
      atalhos: { sistema: "Ctrl+Shift+M", dock: "Ctrl+Alt+J", captura: "Ctrl+Alt+K", foco: "Ctrl+Alt+F" },
      autostart: true,
      silencio: { horario: { ligado: true, inicio: "23:00", fim: "06:45" }, telaCheia: false, foco: true },
      dia: {
        fuso: "Europe/Lisbon",
        expediente: { inicio: "08:30", fim: "17:00" },
        foco: { focoMin: 50, pausaMin: 10, pausaLongaMin: 30, ciclosAtePausaLonga: 3 },
      },
      // A cotação digitada do teto diário fica na configuração, com o dia (ADR-0040).
      cambio: { cotacoes: { BRL: { milionesimos: 5_430_000, data: "2026-10-18", fonte: "digitada" } } },
      inicio: {
        ordem: ["briefing", "foco", "tarefas", "dev", "sessoes", "financas"],
        escondidos: ["financas"],
      },
    };
    // Uma chave por vez, como a interface manda.
    for (const [chave, valor] of Object.entries(escolhida))
      await primeiro.servico.definir({ [chave]: valor });
    primeiro.db.close();
    const depois = montar(aceita(), primeiro.pasta);
    expect(depois.servico.obter().config).toEqual(escolhida);
  });

  test("blocos escondidos do Início continuam escondidos depois de reiniciar, sem passar pela casca", async () => {
    const aplicados: Aplicacao[] = [];
    const primeiro = montar(aceita(aplicados));
    await primeiro.servico.definir({
      inicio: { ordem: [...CONFIG_PADRAO.inicio.ordem], escondidos: ["financas", "dev"] },
    });
    expect(aplicados).toEqual([]);
    primeiro.db.close();
    const depois = montar(aceita(), primeiro.pasta);
    expect(depois.servico.obter().config.inicio.escondidos).toEqual(["financas", "dev"]);
    await expect(
      depois.servico.definir({ inicio: { ordem: ["foco", "foco"], escondidos: [] } }),
    ).rejects.toThrow();
    expect(depois.servico.obter().config.inicio.escondidos).toEqual(["financas", "dev"]);
  });

  test("config da 0.6.0, sem o atalho do foco e sem o dia, sobe com o padrão e fica com o resto", () => {
    const { db, servico } = montar(aceita());
    const antigos = { sistema: "Ctrl+Shift+M", dock: "Ctrl+Alt+J", captura: "Ctrl+Alt+K" };
    db.prepare("INSERT INTO config (chave, valor) VALUES (?, ?)").run("atalhos", JSON.stringify(antigos));
    const { config } = servico.obter();
    expect(config.atalhos).toEqual({ ...antigos, foco: "Ctrl+Alt+P" });
    expect(config.dia).toEqual(CONFIG_PADRAO.dia);
    expect(config.dia.expediente).toEqual({ inicio: "09:00", fim: "18:00" });
    expect(config.dia.foco).toEqual({ focoMin: 25, pausaMin: 5, pausaLongaMin: 15, ciclosAtePausaLonga: 4 });
  });

  test("o Ctrl+Alt+P do padrão que colide com um atalho já salvo deixa o foco sem atalho, com o motivo", async () => {
    const aplicados: Aplicacao[] = [];
    const { db, servico } = montar(aceita(aplicados));
    const antigos = { sistema: "alt+ctrl+p", dock: "Ctrl+Alt+D", captura: "Ctrl+Alt+Space" };
    db.prepare("INSERT INTO config (chave, valor) VALUES (?, ?)").run("atalhos", JSON.stringify(antigos));
    const estado = servico.obter();
    // O atalho escolhido pelo usuário vale; o do foco fica vazio e não vai ser registrado.
    expect(estado.config.atalhos).toEqual({ ...antigos, foco: "" });
    expect(estado.falhasAtalhos).toEqual({
      foco: "Ctrl+Alt+P já é o atalho para abrir o Sistema, então o foco ficou sem atalho. Escolha outro em Configurações.",
    });
    await servico.aplicarAoSubir();
    expect(aplicados[0]?.config.atalhos.foco).toBe("");

    // Escolhido um atalho para o foco, o motivo some.
    const depois = await servico.definir({ atalhos: { ...estado.config.atalhos, foco: "Ctrl+Alt+F" } });
    expect(depois.config.atalhos.foco).toBe("Ctrl+Alt+F");
    expect(depois.falhasAtalhos).toEqual({});
  });

  test("sem colisão, o atalho do foco gravado pelo usuário e o do padrão ficam como estão", () => {
    const { db, servico } = montar(aceita());
    const salvos = {
      sistema: "Ctrl+Alt+P",
      dock: "Ctrl+Alt+D",
      captura: "Ctrl+Alt+Space",
      foco: "Ctrl+Alt+F",
    };
    db.prepare("INSERT INTO config (chave, valor) VALUES (?, ?)").run("atalhos", JSON.stringify(salvos));
    expect(servico.obter()).toMatchObject({ config: { atalhos: salvos }, falhasAtalhos: {} });
  });

  test("dia gravado pela metade completa com o padrão campo a campo", () => {
    const { db, servico } = montar(aceita());
    db.prepare("INSERT INTO config (chave, valor) VALUES (?, ?)").run(
      "dia",
      JSON.stringify({ fuso: "Europe/Lisbon", foco: { focoMin: 50 } }),
    );
    expect(servico.obter().config.dia).toEqual({
      fuso: "Europe/Lisbon",
      expediente: CONFIG_PADRAO.dia.expediente,
      foco: { ...CONFIG_PADRAO.dia.foco, focoMin: 50 },
    });
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
