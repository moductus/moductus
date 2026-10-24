import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { METODOS, NOTA_BLOCO_RAPIDO, type MudancaNotas } from "@moductus/contrato";
import { afterEach, describe, expect, test } from "vitest";
import { abrirBanco } from "../../banco/conexao.ts";
import {
  MENSAGEM_BLOCO_FIXO,
  MENSAGEM_NAO_ENCONTRADA,
  MENSAGEM_NOTA_DA_TAREFA,
  RepositorioNotas,
  ServicoNotas,
} from "./notas.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** Banco migrado de verdade, com o bloco rápido semeado, e um relógio que só anda quando o teste manda. */
function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-notas-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta, { duravel: false });
  bancos.push(db);
  const relogio = { agora: new Date("2026-10-18T12:00:00.000Z") };
  const andar = (ms = 1000) => {
    relogio.agora = new Date(relogio.agora.getTime() + ms);
  };
  const eventos: MudancaNotas[] = [];
  const notas = new ServicoNotas(
    new RepositorioNotas(db),
    { mudou: (m) => eventos.push(m) },
    {
      agora: () => relogio.agora,
    },
  );
  return { db, notas, eventos, andar, relogio };
}

/** O único item da lista; outro tamanho falha o teste. */
function unica<T>(lista: readonly T[]): T {
  expect(lista).toHaveLength(1);
  return lista[0] as T;
}

/** A resposta passa pelo schema de saída do contrato, como no canal. */
const confere = <M extends keyof typeof METODOS>(metodo: M, saida: unknown) => {
  const r = METODOS[metodo].saida.safeParse(saida);
  expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
};

describe("criar e listar", () => {
  test("a nota nasce vazia e do usuário, e a lista põe o bloco rápido no topo", () => {
    const { notas, eventos, andar } = montar();
    const a = notas.criar({ titulo: "Mercado", conteudo: "- arroz\n- feijão" });
    andar();
    const b = notas.criar({});
    andar();
    const fixa = notas.criar({ titulo: "Senhas não", fixada: true });
    confere("notas.criar", b);
    expect(b).toMatchObject({ titulo: "", conteudo: "", fixada: false, pasta: null, origem: "usuario" });
    expect(eventos.map((e) => e.notas.map((n) => n.id))).toEqual([[a.id], [b.id], [fixa.id]]);

    const lista = notas.listar({});
    confere("notas.listar", lista);
    expect(lista.map((n) => n.id)).toEqual([NOTA_BLOCO_RAPIDO, fixa.id, b.id, a.id]);
    expect(lista.find((n) => n.id === a.id)?.trecho).toBe("arroz · feijão");
    expect(lista[0]).not.toHaveProperty("conteudo");
  });

  test("a nota da ferramenta leva o carimbo do agente; salvar pela janela volta a ser do usuário", () => {
    const { notas } = montar();
    const carimbo = { origem: "agente" as const, agenteId: "alba", execucaoId: "e1" };
    const nota = notas.criar({ titulo: "Do dia" }, carimbo);
    expect(nota).toMatchObject({ origem: "agente", agenteId: "alba", execucaoId: "e1" });
    const r = notas.salvar({ id: nota.id, versao: nota.atualizadoEm, conteudo: "editei" });
    expect(r.salvou && r.nota).toMatchObject({ origem: "usuario", agenteId: null, execucaoId: null });
  });

  test("nota que não existe não se obtém", () => {
    const { notas } = montar();
    expect(() => notas.obter({ id: "nao-existe" })).toThrow(MENSAGEM_NAO_ENCONTRADA);
  });
});

describe("salvar com a versão conhecida (ADR-0036)", () => {
  test("com a versão que está no banco, grava e devolve a versão nova", () => {
    const { notas, eventos, andar } = montar();
    const nota = notas.criar({ titulo: "Ideias" });
    andar();
    const r = notas.salvar({ id: nota.id, versao: nota.atualizadoEm, conteudo: "três dias na serra" });
    confere("notas.salvar", r);
    if (!r.salvou) throw new Error("devia ter salvado");
    expect(r.nota.conteudo).toBe("três dias na serra");
    expect(r.nota.titulo).toBe("Ideias");
    expect(r.nota.atualizadoEm > nota.atualizadoEm).toBe(true);
    expect(notas.obter({ id: nota.id })).toEqual(r.nota);
    expect(eventos.at(-1)).toEqual({ notas: [r.nota], apagadas: [] });
  });

  test("com versão velha, nada é gravado e voltam a do banco e a recusada", () => {
    const { notas, eventos, andar } = montar();
    const nota = notas.criar({ titulo: "Ideias", conteudo: "início" });
    andar();
    // Outra janela salvou antes.
    const outra = notas.salvar({ id: nota.id, versao: nota.atualizadoEm, conteudo: "da outra janela" });
    if (!outra.salvou) throw new Error("a outra janela devia ter salvado");
    const antes = eventos.length;
    andar();

    const r = notas.salvar({ id: nota.id, versao: nota.atualizadoEm, conteudo: "desta janela" });
    confere("notas.salvar", r);
    expect(r).toEqual({
      salvou: false,
      atual: outra.nota,
      recusada: { titulo: "Ideias", conteudo: "desta janela" },
    });
    expect(notas.obter({ id: nota.id })).toEqual(outra.nota);
    expect(eventos).toHaveLength(antes);

    // Com a versão de agora, a escolha da janela grava.
    const escolhida = notas.salvar({
      id: nota.id,
      versao: outra.nota.atualizadoEm,
      conteudo: "desta janela",
    });
    expect(escolhida.salvou).toBe(true);
  });

  test("dois salvamentos no mesmo milissegundo têm versões diferentes: a velha continua recusada", () => {
    const { notas } = montar();
    const nota = notas.criar({});
    // O relógio não anda: a versão nova não pode repetir a anterior.
    const primeira = notas.salvar({ id: nota.id, versao: nota.atualizadoEm, conteudo: "um" });
    if (!primeira.salvou) throw new Error("devia ter salvado");
    expect(primeira.nota.atualizadoEm).not.toBe(nota.atualizadoEm);
    const atrasada = notas.salvar({ id: nota.id, versao: nota.atualizadoEm, conteudo: "dois" });
    expect(atrasada.salvou).toBe(false);
  });

  test("com o relógio voltando, a versão ainda cresce", () => {
    const { notas, relogio } = montar();
    const nota = notas.criar({});
    relogio.agora = new Date("2026-10-01T00:00:00.000Z");
    const r = notas.salvar({ id: nota.id, versao: nota.atualizadoEm, titulo: "depois" });
    if (!r.salvou) throw new Error("devia ter salvado");
    expect(r.nota.atualizadoEm > nota.atualizadoEm).toBe(true);
  });

  test("o mesmo texto que já está no banco não é conflito e não muda a versão", () => {
    const { notas, eventos, andar } = montar();
    const nota = notas.criar({ conteudo: "a" });
    andar();
    const nova = notas.salvar({ id: nota.id, versao: nota.atualizadoEm, conteudo: "b" });
    if (!nova.salvou) throw new Error("devia ter salvado");
    const antes = eventos.length;
    andar();
    // A janela atrasada manda o que o banco já tem.
    expect(notas.salvar({ id: nota.id, versao: nota.atualizadoEm, conteudo: "b" })).toEqual({
      salvou: true,
      nota: nova.nota,
    });
    expect(eventos).toHaveLength(antes);
  });

  test("fixar e mudar de pasta não mudam a versão nem recusam o salvar da janela", () => {
    const { notas, andar } = montar();
    const nota = notas.criar({ conteudo: "rascunho" });
    andar();
    const fixada = notas.definir({ id: nota.id, fixada: true, pasta: "Pessoal" });
    confere("notas.definir", fixada);
    expect(fixada).toMatchObject({ fixada: true, pasta: "Pessoal", atualizadoEm: nota.atualizadoEm });
    andar();
    const r = notas.salvar({ id: nota.id, versao: nota.atualizadoEm, conteudo: "rascunho revisto" });
    expect(r.salvou).toBe(true);
  });

  test("nota na lixeira não se salva", () => {
    const { notas } = montar();
    const nota = notas.criar({});
    notas.apagar({ id: nota.id });
    expect(() => notas.salvar({ id: nota.id, versao: nota.atualizadoEm, conteudo: "x" })).toThrow(
      MENSAGEM_NAO_ENCONTRADA,
    );
  });
});

describe("o bloco rápido, a nota fixa do topo", () => {
  test("nasce fixo e não se desafixa", () => {
    const { notas } = montar();
    expect(notas.obter({ id: NOTA_BLOCO_RAPIDO })).toMatchObject({ titulo: "Bloco rápido", fixada: true });
    expect(() => notas.definir({ id: NOTA_BLOCO_RAPIDO, fixada: false })).toThrow(MENSAGEM_BLOCO_FIXO);
    expect(notas.definir({ id: NOTA_BLOCO_RAPIDO, fixada: true }).fixada).toBe(true);
  });

  test("apagar esvazia o texto e o bloco continua lá, fora da lixeira", () => {
    const { db, notas, eventos, andar } = montar();
    const bloco = notas.obter({ id: NOTA_BLOCO_RAPIDO });
    andar();
    const salvo = notas.salvar({
      id: bloco.id,
      versao: bloco.atualizadoEm,
      conteudo: "código do portão 4471",
    });
    if (!salvo.salvou) throw new Error("devia ter salvado");
    andar();

    const r = notas.apagar({ id: NOTA_BLOCO_RAPIDO });
    confere("notas.apagar", r);
    expect(r).toEqual({ ids: [] });
    const esvaziado = notas.obter({ id: NOTA_BLOCO_RAPIDO });
    expect(esvaziado).toMatchObject({ titulo: "Bloco rápido", conteudo: "", fixada: true });
    expect(esvaziado.atualizadoEm > salvo.nota.atualizadoEm).toBe(true);
    expect(eventos.at(-1)).toEqual({ notas: [esvaziado], apagadas: [] });
    expect(notas.listar({})[0]).toMatchObject({ id: NOTA_BLOCO_RAPIDO, trecho: "" });
    const linha = db.prepare("SELECT apagado_em FROM notas WHERE id = ?").get(NOTA_BLOCO_RAPIDO);
    expect(linha).toEqual({ apagado_em: null });
    // A janela que tinha o texto antigo é avisada da mudança, não grava por cima.
    expect(notas.salvar({ id: bloco.id, versao: salvo.nota.atualizadoEm, conteudo: "outra" }).salvou).toBe(
      false,
    );
  });

  test("salvar vazio também esvazia; apagar o que já está vazio não muda nada", () => {
    const { notas, eventos, andar } = montar();
    const bloco = notas.obter({ id: NOTA_BLOCO_RAPIDO });
    andar();
    const cheio = notas.salvar({ id: bloco.id, versao: bloco.atualizadoEm, conteudo: "ver frete" });
    if (!cheio.salvou) throw new Error("devia ter salvado");
    andar();
    const vazio = notas.salvar({ id: bloco.id, versao: cheio.nota.atualizadoEm, conteudo: "" });
    if (!vazio.salvou) throw new Error("devia ter salvado");
    expect(vazio.nota).toMatchObject({ conteudo: "", fixada: true });
    const antes = eventos.length;
    andar();
    expect(notas.apagar({ id: NOTA_BLOCO_RAPIDO })).toEqual({ ids: [] });
    expect(notas.obter({ id: NOTA_BLOCO_RAPIDO })).toEqual(vazio.nota);
    expect(eventos).toHaveLength(antes);
  });
});

describe("lixeira", () => {
  test("apagar manda à lixeira: some da lista, da busca e do obter", () => {
    const { db, notas, eventos } = montar();
    const nota = notas.criar({ titulo: "Ligar amanhã" });
    const r = notas.apagar({ id: nota.id });
    confere("notas.apagar", r);
    expect(r).toEqual({ ids: [nota.id] });
    expect(eventos.at(-1)).toEqual({ notas: [], apagadas: [nota.id] });
    expect(notas.listar({}).map((n) => n.id)).not.toContain(nota.id);
    expect(notas.buscar({ texto: "amanha" })).toEqual([]);
    expect(() => notas.obter({ id: nota.id })).toThrow(MENSAGEM_NAO_ENCONTRADA);
    expect(() => notas.apagar({ id: nota.id })).toThrow(MENSAGEM_NAO_ENCONTRADA);
    const linha = db.prepare("SELECT apagado_em FROM notas WHERE id = ?").get(nota.id) as {
      apagado_em: string | null;
    };
    expect(linha.apagado_em).not.toBeNull();
  });

  test("a nota fixada que não é o bloco vai à lixeira normalmente", () => {
    const { notas } = montar();
    const nota = notas.criar({ fixada: true });
    expect(notas.apagar({ id: nota.id })).toEqual({ ids: [nota.id] });
  });
});

describe("pastas", () => {
  test("com pasta, a lista traz só as dela; a grafia em uso vale para quem escreve diferente", () => {
    const { notas, andar } = montar();
    const viagem = notas.criar({ titulo: "Viagem", pasta: "Pessoal · Viagem" });
    andar();
    const outra = notas.criar({ titulo: "Roteiro", pasta: "  pessoal · viagem " });
    andar();
    notas.criar({ titulo: "Solta" });
    expect(outra.pasta).toBe("Pessoal · Viagem");
    expect(notas.listar({ pasta: "PESSOAL · VIAGEM" }).map((n) => n.id)).toEqual([outra.id, viagem.id]);
    expect(notas.listar({ pasta: "Trabalho" })).toEqual([]);
  });

  test("tirar da pasta é `null`; sem o campo, a pasta fica", () => {
    const { notas } = montar();
    const nota = notas.criar({ pasta: "Casa" });
    expect(notas.definir({ id: nota.id, fixada: true }).pasta).toBe("Casa");
    expect(notas.definir({ id: nota.id, pasta: null }).pasta).toBeNull();
  });
});

describe("busca", () => {
  test("sem acento e sem caixa: 'amanha' e 'AMANHÃ' acham 'amanhã', também pelo começo da palavra", () => {
    const { notas } = montar();
    const nota = notas.criar({ titulo: "Banco", conteudo: "# Ligar\n\n- ligar pro banco amanhã às 15h" });
    notas.criar({ titulo: "Outra", conteudo: "nada a ver" });
    for (const texto of ["amanha", "AMANHÃ", "amanh", "banco amanha"]) {
      const achadas = notas.buscar({ texto });
      confere("notas.buscar", achadas);
      expect(
        achadas.map((n) => n.id),
        texto,
      ).toEqual([nota.id]);
    }
  });

  test("o trecho é do conteúdo, numa linha, com as posições do que bateu", () => {
    const { notas } = montar();
    notas.criar({ titulo: "Banco", conteudo: "# Ligar\n\n- ligar pro banco amanhã às 15h" });
    const achada = unica(notas.buscar({ texto: "amanha" }));
    expect(achada.trecho).toBe("Ligar · ligar pro banco amanhã às 15h");
    expect(achada.destaques.map((d) => achada.trecho.slice(d.inicio, d.fim))).toEqual(["amanhã"]);
    expect(achada).not.toHaveProperty("conteudo");
  });

  test("quando só o título bateu, o trecho é o começo do conteúdo, sem destaque", () => {
    const { notas } = montar();
    notas.criar({ titulo: "Receita do pão", conteudo: "500 g de farinha" });
    const achada = unica(notas.buscar({ texto: "pao" }));
    expect(achada).toMatchObject({ titulo: "Receita do pão", trecho: "500 g de farinha", destaques: [] });
  });

  test("o título pesa mais que o conteúdo na ordem", () => {
    const { notas, andar } = montar();
    const noConteudo = notas.criar({ titulo: "Mercado", conteudo: "comprar filtro" });
    andar();
    const noTitulo = notas.criar({ titulo: "Filtro da água", conteudo: "trocar em novembro" });
    andar();
    notas.salvar({ id: noConteudo.id, versao: noConteudo.atualizadoEm, conteudo: "comprar filtro já" });
    expect(notas.buscar({ texto: "filtro" }).map((n) => n.id)).toEqual([noTitulo.id, noConteudo.id]);
  });

  test("o que seria sintaxe do FTS5 é texto; sem letra nem número, nada volta", () => {
    const { notas } = montar();
    notas.criar({ conteudo: "a OR b" });
    expect(() => notas.buscar({ texto: 'OR "NEAR( * -' })).not.toThrow();
    expect(notas.buscar({ texto: "- * :" })).toEqual([]);
  });

  test("NUL e outros controles na busca separam palavras, sem erro do SQLite", () => {
    const { notas } = montar();
    const nota = notas.criar({ conteudo: "ligar pro banco" });
    expect(notas.buscar({ texto: "ligar\u0000banco" }).map((n) => n.id)).toEqual([nota.id]);
    expect(notas.buscar({ texto: "\u0000\u0001" })).toEqual([]);
  });

  test('a aspa no meio da palavra é escapada, não apagada: a"b não vira ab', () => {
    const { notas } = montar();
    const separado = notas.criar({ conteudo: "a b" });
    notas.criar({ conteudo: "ab" });
    expect(notas.buscar({ texto: 'a"b' }).map((n) => n.id)).toEqual([separado.id]);
  });

  test("uma palavra de 300 mil letras não derruba a busca, e o trecho fica curto com o destaque", () => {
    const { notas } = montar();
    const nota = notas.criar({ conteudo: `ver ${"x".repeat(300_000)} amanhã ${"-".repeat(300_000)} fim` });
    const achada = unica(notas.buscar({ texto: "amanha" }));
    confere("notas.buscar", [achada]);
    expect(achada.id).toBe(nota.id);
    expect(achada.trecho.length).toBeLessThan(400);
    expect(achada.destaques.map((d) => achada.trecho.slice(d.inicio, d.fim))).toEqual(["amanhã"]);
    expect(unica(notas.buscar({ texto: "xxx" })).destaques).toHaveLength(1);
  });

  test("o limite corta os resultados", () => {
    const { notas } = montar();
    for (let i = 0; i < 5; i++) notas.criar({ titulo: `Nota ${i} do dia` });
    expect(notas.buscar({ texto: "dia", limite: 3 })).toHaveLength(3);
  });

  test("o texto salvo entra na busca e o antigo sai", () => {
    const { notas, andar } = montar();
    const nota = notas.criar({ conteudo: "reunião segunda" });
    andar();
    notas.salvar({ id: nota.id, versao: nota.atualizadoEm, conteudo: "reunião terça" });
    expect(notas.buscar({ texto: "segunda" })).toEqual([]);
    expect(notas.buscar({ texto: "terca" }).map((n) => n.id)).toEqual([nota.id]);
  });
});

describe("tarefas criadas a partir de uma nota", () => {
  test("levam o id de uma nota viva; sem nota, nada; nota na lixeira, recusa", () => {
    const { notas } = montar();
    const nota = notas.criar({ titulo: "Viagem" });
    expect(notas.notaParaTarefa(nota.id)).toBe(nota.id);
    expect(notas.notaParaTarefa(undefined)).toBeNull();
    expect(notas.notaParaTarefa(null)).toBeNull();
    notas.apagar({ id: nota.id });
    expect(() => notas.notaParaTarefa(nota.id)).toThrow(MENSAGEM_NOTA_DA_TAREFA);
    expect(() => notas.notaParaTarefa("nao-existe")).toThrow(MENSAGEM_NOTA_DA_TAREFA);
  });
});
