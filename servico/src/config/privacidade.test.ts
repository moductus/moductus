import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Privacidade } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { abrirBanco } from "../banco/conexao.ts";
import { CLIQUE_NA_BANDEJA, ligarBandeja, type MenuBandeja } from "../bandeja/bandeja.ts";
import { CanalCasca } from "../casca/canal.ts";
import { RepositorioConfig, ServicoConfig } from "./config.ts";
import {
  alternarPrivacidade,
  ATALHO_DA_PRIVACIDADE,
  ouvirAtalhoDaPrivacidade,
  vigiarPrivacidade,
} from "./privacidade.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/**
 * O serviço ligado como no main.ts: configuração num banco migrado de verdade, a casca de mentira
 * pelo canal de verdade (o atalho e o clique na bandeja chegam como linhas dela) e a bandeja sem
 * agentes, só com o item do modo.
 */
function montar(pasta = mkdtempSync(join(tmpdir(), "moductus-privacidade-"))) {
  pastas.push(pasta);
  const db = abrirBanco(pasta, { duravel: false });
  bancos.push(db);
  const repo = new RepositorioConfig(db);
  const eventos: Privacidade[] = [];
  let atualizarBandeja = () => {};
  const privacidadeMudou = vigiarPrivacidade(repo.ler().privacidade, (p) => {
    eventos.push(p);
    atualizarBandeja();
  });
  const config = new ServicoConfig(
    repo,
    { aplicar: async () => ({ falhasAtalhos: {} }) },
    (estado) => privacidadeMudou(estado.config.privacidade),
    false,
  );
  const linhas: string[] = [];
  const canal = new CanalCasca({ write: (linha) => linhas.push(linha) });
  const bandeja = ligarBandeja({
    agentes: { listar: () => [], pausar: () => undefined, retomar: () => undefined },
    canal,
    privacidade: {
      ativo: () => config.obter().config.privacidade.ativo,
      alternar: () => alternarPrivacidade(config),
    },
  });
  atualizarBandeja = () => bandeja.atualizar();
  bandeja.atualizar();
  ouvirAtalhoDaPrivacidade(canal, config);
  const marcado = () => {
    const menu = JSON.parse(linhas.at(-1)!) as MenuBandeja;
    const item = menu.itens.find((i) => "id" in i && i.id === "privacidade");
    return item && "marcado" in item ? item.marcado : undefined;
  };
  return {
    db,
    pasta,
    config,
    eventos,
    marcado,
    apertarAtalho: () => canal.receber(JSON.stringify({ tipo: ATALHO_DA_PRIVACIDADE })),
    clicarNaBandeja: () => canal.receber(JSON.stringify({ tipo: CLIQUE_NA_BANDEJA, item: "privacidade" })),
    ativo: () => config.obter().config.privacidade.ativo,
  };
}

describe("modo privacidade", () => {
  test("o atalho liga e desliga: grava, avisa as janelas uma vez por mudança e marca a bandeja", async () => {
    const s = montar();
    expect(s.marcado()).toBe(false);

    s.apertarAtalho();
    await vi.waitFor(() => expect(s.ativo()).toBe(true));
    expect(s.eventos).toEqual([{ ativo: true }]);
    expect(s.marcado()).toBe(true);

    s.apertarAtalho();
    await vi.waitFor(() => expect(s.ativo()).toBe(false));
    expect(s.eventos).toEqual([{ ativo: true }, { ativo: false }]);
    expect(s.marcado()).toBe(false);
  });

  test("o item da bandeja e Configurações fazem o mesmo; mudar outra chave não avisa", async () => {
    const s = montar();
    s.clicarNaBandeja();
    await vi.waitFor(() => expect(s.ativo()).toBe(true));
    expect(s.marcado()).toBe(true);

    await s.config.definir({ tema: "papel" });
    await s.config.definir({ privacidade: { ativo: true } });
    expect(s.eventos).toEqual([{ ativo: true }]);

    await s.config.definir({ privacidade: { ativo: false } });
    expect(s.eventos).toEqual([{ ativo: true }, { ativo: false }]);
    expect(s.marcado()).toBe(false);
  });

  test("ligado, continua ligado depois de reiniciar", async () => {
    const antes = montar();
    antes.apertarAtalho();
    await vi.waitFor(() => expect(antes.ativo()).toBe(true));
    antes.db.close();

    const depois = montar(antes.pasta);
    expect(depois.ativo()).toBe(true);
    expect(depois.marcado()).toBe(true);
    // Subir com o modo ligado não é mudança: nenhum aviso repetido às janelas.
    await depois.config.aplicarAoSubir();
    expect(depois.eventos).toEqual([]);
  });

  test("o atalho que falha ao gravar vai ao log e não derruba o canal", async () => {
    const s = montar();
    s.db.close();
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => s.apertarAtalho()).not.toThrow();
    await vi.waitFor(() =>
      expect(erros).toHaveBeenCalledWith(expect.stringContaining("privacidade: atalho falhou")),
    );
    erros.mockRestore();
  });
});
