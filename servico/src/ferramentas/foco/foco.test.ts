import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CONFIG_PADRAO, EstadoFoco, HistoricoFoco } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { RepositorioAgentes } from "../../agentes/agentes.ts";
import { TempoDoDia } from "../../areas/dia/tempo.ts";
import { RepositorioFoco, ServicoFoco } from "../../areas/foco/foco.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import { RepositorioNotificacoes, ServicoNotificacoes } from "../../notificacoes/notificacoes.ts";
import { Catalogo } from "../catalogo.ts";
import { DIAS_DO_HISTORICO, MENSAGEM_INTERVALO, ferramentasFoco } from "./foco.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const FUSO = "America/Sao_Paulo";

/** Banco migrado de verdade, o Foco de verdade e as ferramentas pelo escopo da Alba. */
function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-ferramentas-foco-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  const relogio = { ms: Date.parse("2026-10-09T10:00:00.000-03:00") };
  const agora = () => new Date(relogio.ms);
  const agentes = new RepositorioAgentes(db);
  const notificacoes = new ServicoNotificacoes(
    new RepositorioNotificacoes(db),
    {
      agentes: () => agentes.agentes().map((a) => ({ id: a.id, nome: a.nome })),
      silencio: () => CONFIG_PADRAO.silencio,
      windows: {
        mostrar: () => Promise.resolve(),
        retirar: () => Promise.resolve(),
        telaCheia: () => Promise.resolve(false),
      },
    },
    { estado: () => {}, nova: () => {}, naoVistas: () => {} },
  );
  const foco = new ServicoFoco(
    new RepositorioFoco(db),
    { lerDia: () => ({ fuso: FUSO, foco: CONFIG_PADRAO.dia.foco }), notificacoes },
    { mudou: () => {} },
    { agora },
  );
  const escopo = new Catalogo(ferramentasFoco(foco, new TempoDoDia(() => FUSO, agora))).doAgente(["foco.*"]);
  const executar = escopo.executor({
    agenteId: "alba",
    execucaoId: null,
    sinal: new AbortController().signal,
  });
  return { foco, relogio, escopo, executar };
}

describe("foco.* da Alba", () => {
  test("só leitura: o tempo que correu não se desfaz pelo histórico", () => {
    const { escopo } = montar();
    expect(escopo.ferramentas.map((f) => [f.nome, f.efeito])).toEqual([
      ["foco.estado", "leitura"],
      ["foco.historico", "leitura"],
    ]);
  });

  test("o foco agora e o de hoje, como o painel mostra", async () => {
    const m = montar();
    m.foco.iniciar({ minutos: 25 });
    m.relogio.ms += 25 * 60_000;
    m.foco.terminar();

    const estado = await m.executar({ id: "1", nome: "foco__estado", entrada: {} });
    expect(estado.ok && EstadoFoco.parse(estado.valor).focoHojeMin).toBe(25);
    const historico = await m.executar({
      id: "2",
      nome: "foco__historico",
      entrada: { de: "hoje", ate: "hoje" },
    });
    expect(historico.ok && HistoricoFoco.parse(historico.valor).porDia).toEqual([
      { dia: "2026-10-09", minutos: 25, ciclos: 1 },
    ]);
  });

  test(`o histórico vai de 1 a ${DIAS_DO_HISTORICO} dias`, async () => {
    const m = montar();
    const longo = await m.executar({
      id: "1",
      nome: "foco__historico",
      entrada: { de: "2026-01-01", ate: "2026-10-09" },
    });
    expect(longo).toEqual({ ok: false, erro: `foco.historico falhou: ${MENSAGEM_INTERVALO}` });
    const invertido = await m.executar({
      id: "2",
      nome: "foco__historico",
      entrada: { de: "amanha", ate: "hoje" },
    });
    expect(invertido.ok).toBe(false);
  });
});
