import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { EventoAgenda, type ChamadaFerramenta, type MudancaAgenda } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { RepositorioAgentes } from "../../agentes/agentes.ts";
import { DE_FABRICA } from "../../agentes/de-fabrica.ts";
import { MENSAGENS_DESFAZER, RepositorioExecucoes, ServicoExecucoes } from "../../agentes/execucoes.ts";
import { Runtime } from "../../agentes/runtime.ts";
import {
  MENSAGEM_DESFAZER_MUDOU,
  MENSAGEM_DESFAZER_SAIU,
  RepositorioAgenda,
  ServicoAgenda,
} from "../../areas/agenda/agenda.ts";
import { RepositorioTarefasDoDia } from "../../areas/agenda/tarefas-do-dia.ts";
import { TempoDoDia } from "../../areas/dia/tempo.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import { ProvedorFalso, roteiros, type PassoRoteiro } from "../../provedores/falso.ts";
import { RegistroProvedores } from "../../provedores/registro.ts";
import { Catalogo } from "../catalogo.ts";
import { DURACAO_PADRAO_MIN, MENSAGEM_SO_LOCAL_E_MODUCTUS, ferramentasAgenda } from "./agenda.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** São Paulo, UTC−3 o ano todo: segunda, 19/10/2026, 08:00. */
const FUSO = "America/Sao_Paulo";
const HOJE = "2026-10-19";
const sp = (dia: string, hora: string) => new Date(`${dia}T${hora}:00.000-03:00`).toISOString();

/**
 * Banco migrado de verdade (com o calendário local), o "Moductus" e um calendário de fora do Google,
 * a Agenda de verdade, as ferramentas no catálogo e o runtime com um provedor falso na Alba.
 */
function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-ferramentas-agenda-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  db.exec(`
    INSERT OR IGNORE INTO provedores (id, tipo, nome) VALUES ('p-alba', 'claude-cli', 'Falso');
    UPDATE agentes SET provedor_id = 'p-alba' WHERE id = 'alba';
    INSERT INTO calendarios (id, nome, fonte, id_externo, espelho, pode_escrever)
      VALUES ('moductus', 'Moductus', 'google', 'ext-moductus', 1, 1);
    INSERT INTO calendarios (id, nome, fonte, id_externo, ler) VALUES ('trabalho', 'Trabalho', 'google', 'ext-trabalho', 1);
  `);
  const relogio = { ms: Date.parse(sp(HOJE, "08:00")) };
  const agora = () => new Date(relogio.ms);
  const avisos: MudancaAgenda[] = [];
  const execucoes = new RepositorioExecucoes(db);
  const agenda = new ServicoAgenda(
    {
      repo: new RepositorioAgenda(db),
      tarefas: new RepositorioTarefasDoDia(db),
      chamadas: execucoes,
      lerDia: () => ({ fuso: FUSO, expediente: { inicio: "09:00", fim: "18:00" } }),
    },
    { mudou: (mudanca) => avisos.push(mudanca), calendarios: () => {} },
    { agora },
  );
  const catalogo = new Catalogo(ferramentasAgenda(agenda, new TempoDoDia(() => FUSO, agora)));
  const falso = new ProvedorFalso("p-alba");
  const runtime = new Runtime(
    {
      agentes: new RepositorioAgentes(db),
      execucoes,
      provedores: new RegistroProvedores().registrar("claude-cli", () => falso),
      catalogo,
    },
    { execucao: () => {}, agente: () => {} },
    { agora },
  );
  const historico = new ServicoExecucoes(execucoes, catalogo, { agora, fuso: FUSO });
  const alba = async (...passos: PassoRoteiro[]): Promise<ChamadaFerramenta[]> => {
    falso.roteirizar([...passos, ...roteiros.resposta("Feito.")]);
    const r = await runtime.executar({
      agenteId: "alba",
      gatilho: "mensagem",
      mensagens: [{ papel: "usuario", texto: "pode marcar" }],
    });
    expect(r.execucao.estado).toBe("ok");
    relogio.ms += 1000;
    return historico.obter({ id: r.execucao.id }).chamadas;
  };
  const fila = () =>
    db
      .prepare("SELECT item_id, operacao FROM agenda_saida WHERE item_tipo = 'evento' ORDER BY item_id")
      .all();
  return { db, relogio, agenda, catalogo, historico, avisos, alba, fila };
}

const chamar = (nome: string, entrada: unknown): PassoRoteiro => ({ tipo: "ferramenta", nome, entrada });

function valor<T>(chamada: ChamadaFerramenta | undefined, schema: z.ZodType<T>): T {
  const resultado = chamada?.resultado as { ok: boolean; valor?: unknown; erro?: string } | undefined;
  expect(resultado?.ok, resultado?.erro).toBe(true);
  return schema.parse(resultado?.valor);
}

const recusa = (motivo: string) => MENSAGENS_DESFAZER.areaRecusou(motivo);
const depoisDaTransacao = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("agenda.criar_evento", () => {
  test("dia e hora no fuso do usuário, uma hora por padrão; sem hora, o dia inteiro; desfazer tira", async () => {
    const m = montar();
    const [reuniao, feriado] = await m.alba(
      chamar("agenda__criar_evento", { titulo: "Dentista", quando: { dia: "amanha", hora: "10:30" } }),
      chamar("agenda__criar_evento", { titulo: "Feriado", quando: { dia: "2026-11-02" } }),
    );
    const evento = valor(reuniao, EventoAgenda);
    expect(evento).toMatchObject({
      calendarioId: "local",
      inicio: sp("2026-10-20", "10:30"),
      fim: new Date(Date.parse(sp("2026-10-20", "10:30")) + DURACAO_PADRAO_MIN * 60_000).toISOString(),
      diaInteiro: false,
      origem: "agente",
      agenteId: "alba",
    });
    expect(valor(feriado, EventoAgenda)).toMatchObject({
      inicio: "2026-11-02",
      fim: "2026-11-03",
      diaInteiro: true,
    });

    m.historico.desfazer({ chamadaId: reuniao!.id });
    expect(() => m.agenda.obterEvento({ id: evento.id })).toThrow("evento não encontrado");
    await depoisDaTransacao();
    expect(m.avisos.at(-1)).toEqual({ eventos: [], apagados: [evento.id] });
  });

  test('no "Moductus" vai à fila do Google e o desfazer a esvazia; nos outros calendários, não escreve', async () => {
    const m = montar();
    const [espelho, deFora] = await m.alba(
      chamar("agenda__criar_evento", {
        titulo: "Consulta",
        quando: { dia: "hoje", hora: "15:00", duracaoMin: 30 },
        calendarioId: "moductus",
      }),
      chamar("agenda__criar_evento", {
        titulo: "Daily",
        quando: { dia: "hoje", hora: "09:30" },
        calendarioId: "trabalho",
      }),
    );
    const evento = valor(espelho, EventoAgenda);
    expect(m.fila()).toEqual([{ item_id: evento.id, operacao: "criar" }]);
    expect((deFora!.resultado as { erro: string }).erro).toBe(
      `agenda.criar_evento falhou: ${MENSAGEM_SO_LOCAL_E_MODUCTUS}`,
    );

    m.historico.desfazer({ chamadaId: espelho!.id });
    // Ainda não tinha chegado ao Google: sai da fila sem ir.
    expect(m.fila()).toEqual([]);
  });
});

describe("agenda.mudar_evento", () => {
  test("desfazer volta o horário e o título; mudado depois, ou já na lixeira, recusa", async () => {
    const m = montar();
    const original = m.agenda.criarEvento({
      titulo: "Almoço",
      inicio: sp(HOJE, "12:00"),
      fim: sp(HOJE, "13:00"),
      diaInteiro: false,
    });
    m.relogio.ms += 1000;
    const [mudar] = await m.alba(
      chamar("agenda__mudar_evento", {
        id: original.id,
        titulo: "Almoço com a Ana",
        quando: { dia: "hoje", hora: "12:30", duracaoMin: 90 },
      }),
    );
    const { evento } = valor(mudar, z.object({ evento: EventoAgenda }));
    expect(evento).toMatchObject({
      titulo: "Almoço com a Ana",
      inicio: sp(HOJE, "12:30"),
      fim: sp(HOJE, "14:00"),
    });

    m.historico.desfazer({ chamadaId: mudar!.id });
    expect(m.agenda.obterEvento({ id: original.id })).toMatchObject({
      titulo: "Almoço",
      inicio: original.inicio,
      fim: original.fim,
      origem: "usuario",
    });

    const [deNovo] = await m.alba(chamar("agenda__mudar_evento", { id: original.id, titulo: "Almoço!" }));
    m.agenda.definirEvento({ id: original.id, local: "Centro" });
    expect(() => m.historico.desfazer({ chamadaId: deNovo!.id })).toThrow(recusa(MENSAGEM_DESFAZER_MUDOU));
    m.agenda.apagarEvento({ id: original.id });
    expect(() => m.historico.desfazer({ chamadaId: deNovo!.id })).toThrow(recusa(MENSAGEM_DESFAZER_SAIU));
  });
});

describe("leitura", () => {
  test("agenda.consultar traz hoje, os dias e os livres; o encaixe aplicado fica fora do recorte da Alba", async () => {
    const m = montar();
    m.agenda.criarEvento({
      titulo: "Reunião",
      inicio: sp(HOJE, "10:00"),
      fim: sp(HOJE, "11:00"),
      diaInteiro: false,
    });
    const [consultar, calendarios] = await m.alba(
      chamar("agenda__consultar", { de: "hoje", ate: "amanha" }),
      chamar("agenda__calendarios", {}),
    );
    const lido = valor(
      consultar,
      z.object({
        hoje: z.string(),
        ocorrencias: z.array(z.object({ titulo: z.string() })),
        dias: z.array(z.object({ dia: z.string() })),
      }),
    );
    expect(lido.hoje).toBe(HOJE);
    expect(lido.dias.map((d) => d.dia)).toEqual([HOJE, "2026-10-20"]);
    expect(lido.ocorrencias.map((o) => o.titulo)).toEqual(["Reunião"]);
    expect(valor(calendarios, z.array(z.object({ id: z.string() }))).map((c) => c.id)).toContain("moductus");

    const daAlba = m.catalogo.doAgente(DE_FABRICA.alba.ferramentas).ferramentas.map((f) => f.nome);
    expect(daAlba).toEqual([
      "agenda.calendarios",
      "agenda.consultar",
      "agenda.criar_evento",
      "agenda.mudar_evento",
      "agenda.obter_evento",
    ]);
  });
});
