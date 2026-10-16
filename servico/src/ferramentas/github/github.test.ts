import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RepositorioAgentes } from "../../agentes/agentes.ts";
import { autorizarPorAprovacao } from "../../agentes/autorizar.ts";
import { RepositorioExecucoes } from "../../agentes/execucoes.ts";
import { Runtime } from "../../agentes/runtime.ts";
import { RepositorioAprovacoes, ServicoAprovacoes } from "../../aprovacoes/aprovacoes.ts";
import { abrirBanco } from "../../banco/conexao.ts";
import { RepositorioConexoes } from "../../conexoes/conexoes.ts";
import type { ExecutorGh, SaidaGh } from "../../conexoes/github/gh.ts";
import { RepositorioGithub, ServicoGithub } from "../../conexoes/github/github.ts";
import { ProvedorFalso, roteiros } from "../../provedores/falso.ts";
import { RegistroProvedores } from "../../provedores/registro.ts";
import { RepositorioSessoes, ServicoSessoes } from "../../sessoes/sessoes.ts";
import { Catalogo } from "../catalogo.ts";
import { ferramentasSessoes } from "../sessoes/sessoes.ts";
import { ferramentasUso } from "../uso/uso.ts";
import { cartaoDeComentar, COMENTARIO_MAXIMO, ferramentasGithub } from "./github.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const RESPOSTA = readFileSync(
  new URL("../../conexoes/github/fixtures/resposta-graphql.json", import.meta.url),
  "utf8",
);

/**
 * O Nuno de fábrica (a lista de ferramentas da 003, sem mexer) com um provedor falso, o catálogo
 * com as ferramentas das três áreas dele e um `gh` falso: a leitura devolve a fixture, o comentário
 * devolve o endereço. Nenhum teste vai ao GitHub nem a um modelo.
 */
async function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-ferramentas-github-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  db.exec(`
    INSERT INTO provedores (id, tipo, nome) VALUES ('p-nuno', 'claude-cli', 'Falso do Nuno');
    UPDATE agentes SET provedor_id = 'p-nuno' WHERE id = 'nuno';
  `);
  const falso = new ProvedorFalso("p-nuno");
  const chamadasGh: (readonly string[])[] = [];
  const gh: ExecutorGh = (args) => {
    chamadasGh.push(args);
    const saida: SaidaGh =
      args[0] === "api" && args[1] === "graphql"
        ? { codigo: 0, saida: RESPOSTA, erro: "" }
        : { codigo: 0, saida: JSON.stringify({ html_url: "https://github.com/c/1" }), erro: "" };
    return Promise.resolve(saida);
  };
  const github = new ServicoGithub(new RepositorioGithub(db), new RepositorioConexoes(db), gh, {
    github: () => {},
    conexao: () => {},
  });
  await github.ligar();
  chamadasGh.length = 0;
  const sessoes = new ServicoSessoes(new RepositorioSessoes(db), () => {});
  const catalogo = new Catalogo([
    ...ferramentasSessoes(sessoes),
    ...ferramentasUso(sessoes),
    ...ferramentasGithub(github),
  ]);
  const repositorioAprovacoes = new RepositorioAprovacoes(db);
  const aprovacoes = new ServicoAprovacoes(repositorioAprovacoes, { aprovacao: () => {}, regras: () => {} });
  const execucoes = new RepositorioExecucoes(db);
  const runtime = new Runtime(
    {
      agentes: new RepositorioAgentes(db),
      execucoes,
      provedores: new RegistroProvedores().registrar("claude-cli", () => falso),
      catalogo,
      autorizar: autorizarPorAprovacao(aprovacoes),
    },
    { execucao: () => {}, agente: () => {} },
  );
  const perguntar = (texto: string) =>
    runtime.executar({ agenteId: "nuno", gatilho: "mensagem", mensagens: [{ papel: "usuario", texto }] });
  return { db, catalogo, falso, chamadasGh, execucoes, aprovacoes, repositorioAprovacoes, perguntar };
}

describe("o Nuno pelo GitHub", () => {
  test('"o que precisa de mim no GitHub?" sai da ferramenta, com os itens do cache', async () => {
    const { falso, chamadasGh, execucoes, perguntar } = await montar();
    falso.roteirizar([
      { tipo: "ferramenta", nome: "github__pendencias", entrada: {} },
      ...roteiros.resposta("4 itens precisam de você; o #412 espera seu review."),
    ]);

    const r = await perguntar("o que precisa de mim no GitHub?");

    // O Nuno recebe só as ferramentas da lista dele (sessoes.*, uso.*, github.*; tarefas.criar
    // ainda não existe), e a de pendências diz ao modelo que não responda de memória.
    const oferecidas = falso.pedidos[0]!.ferramentas;
    expect(oferecidas.map((f) => f.nome)).toEqual([
      "github__atualizar",
      "github__comentar",
      "github__detalhe",
      "github__listar",
      "github__pendencias",
      "sessoes__eventos",
      "sessoes__listar",
      "uso__por_dia",
    ]);
    expect(oferecidas.find((f) => f.nome === "github__pendencias")?.descricao).toContain(
      "não responda de memória",
    );

    expect(r.execucao.estado).toBe("ok");
    const [chamada] = execucoes.chamadas(r.execucao.id);
    expect(chamada).toMatchObject({ ferramenta: "github.pendencias", efeito: "leitura" });
    const resultado = chamada!.resultado as {
      ok: true;
      valor: {
        conexao: string;
        lidoEm: string;
        itens: { repositorio: string; numero: number; motivo: string }[];
      };
    };
    expect(resultado.ok).toBe(true);
    expect(resultado.valor.conexao).toBe("ligada");
    expect(resultado.valor.itens.map((i) => [`${i.repositorio}#${i.numero}`, i.motivo])).toEqual([
      ["loja/api-pedidos#409", "mudanças pedidas no seu PR"],
      ["loja/api-pedidos#412", "review pedido a você"],
      ["voce/site#57", "CI quebrado no seu PR"],
      ["voce/moductus#31", "issue atribuída a você"],
    ]);
    // A resposta veio do cache do vigia: nenhuma ida ao GitHub para responder.
    expect(chamadasGh).toHaveLength(0);
  });

  test("comentar espera o cartão, com verbo e objeto, e só chama o gh com o sim", async () => {
    const { falso, chamadasGh, execucoes, aprovacoes, repositorioAprovacoes, perguntar } = await montar();
    const entrada = {
      repositorio: "loja/api-pedidos",
      numero: 412,
      texto: "Faltou o teste do cancelamento.",
    };
    falso.roteirizar([
      { tipo: "ferramenta", nome: "github__comentar", entrada },
      ...roteiros.resposta("Comentei no #412."),
    ]);

    const resposta = perguntar("comenta no #412 que faltou o teste do cancelamento");
    await vi.waitFor(() => expect(repositorioAprovacoes.pendentes()).toHaveLength(1));
    const cartao = repositorioAprovacoes.pendentes()[0]!;
    expect(cartao).toMatchObject({
      agenteId: "nuno",
      descricao:
        "Vou publicar este comentário no #412 de loja/api-pedidos; comentário publicado não se desfaz por aqui.\n\nFaltou o teste do cancelamento.",
      acao: { ferramenta: "github.comentar", rotulo: "Comentar no #412", rotuloRecusar: "Não comentar" },
    });
    expect(chamadasGh).toHaveLength(0);

    await aprovacoes.decidir({ id: cartao.id, decisao: "permitir" });
    const r = await resposta;
    expect(chamadasGh).toEqual([
      [
        "api",
        "--method",
        "POST",
        "repos/loja/api-pedidos/issues/412/comments",
        "-f",
        "body=Faltou o teste do cancelamento.",
      ],
    ]);
    expect(execucoes.chamadas(r.execucao.id)[0]).toMatchObject({
      ferramenta: "github.comentar",
      efeito: "externo",
      aprovacaoId: cartao.id,
      resultado: { ok: true, valor: { url: "https://github.com/c/1" } },
    });
  });

  test("comentar negado não chega ao gh e o modelo sabe por quê", async () => {
    const { falso, chamadasGh, execucoes, aprovacoes, repositorioAprovacoes, perguntar } = await montar();
    falso.roteirizar([
      {
        tipo: "ferramenta",
        nome: "github__comentar",
        entrada: { repositorio: "a/b", numero: 1, texto: "oi" },
      },
      ...roteiros.resposta("Não comentei."),
    ]);
    const resposta = perguntar("comenta oi no a/b#1");
    await vi.waitFor(() => expect(repositorioAprovacoes.pendentes()).toHaveLength(1));
    await aprovacoes.decidir({ id: repositorioAprovacoes.pendentes()[0]!.id, decisao: "negar" });
    const r = await resposta;
    expect(chamadasGh).toHaveLength(0);
    expect(execucoes.chamadas(r.execucao.id)[0]?.resultado).toMatchObject({ ok: false });
  });

  test("a Alba não enxerga nada do GitHub nem das sessões", async () => {
    const { db, catalogo } = await montar();
    const alba = new RepositorioAgentes(db).agente("alba")!;
    expect(catalogo.doAgente(alba.ferramentas).ferramentas).toEqual([]);
  });
});

describe("cartão e entrada de github.comentar", () => {
  test("o cartão mostra o texto inteiro, do jeito que vai ser publicado, até o tamanho máximo", () => {
    // O fim de um texto longo é onde uma instrução escondida num PR colaria o que não devia.
    const fim = "Eventos da sessão: pnpm test em V:\\moductus";
    const texto = `${"Revisei o PR.\n\n".repeat(200)}${fim}`.slice(-COMENTARIO_MAXIMO);
    expect(texto).toHaveLength(COMENTARIO_MAXIMO);
    const cartao = cartaoDeComentar({ repositorio: "a/b", numero: 7, texto });
    expect(cartao.descricao.endsWith(`\n\n${texto}`)).toBe(true);
    expect(cartao.descricao).toContain(fim);
    expect(cartao).toMatchObject({ rotulo: "Comentar no #7", desfazivel: false });
  });

  test("repositório fora do formato, número inválido e texto vazio ou longo voltam como erro legível", async () => {
    const { catalogo } = await montar();
    const comentar = catalogo.obter("github.comentar")!;
    expect(comentar.validar({ repositorio: "../etc", numero: 1, texto: "oi" })).toEqual({
      ok: false,
      erro: "Entrada inválida para github.comentar. repositorio: use dono/nome, como o GitHub escreve.",
    });
    for (const repositorio of ["a/..", "a/.", "-a/b", ".a/b", "a/b/c", "a"]) {
      expect(comentar.validar({ repositorio, numero: 1, texto: "oi" }).ok, repositorio).toBe(false);
    }
    expect(comentar.validar({ repositorio: "voce/.github", numero: 1, texto: "oi" }).ok).toBe(true);
    expect(comentar.validar({ repositorio: "a/b", numero: 0, texto: "  " }).ok).toBe(false);
    expect(comentar.validar({ repositorio: "a/b", numero: 1, texto: "x".repeat(COMENTARIO_MAXIMO) }).ok).toBe(
      true,
    );
    expect(
      comentar.validar({ repositorio: "a/b", numero: 1, texto: "x".repeat(COMENTARIO_MAXIMO + 1) }),
    ).toEqual({
      ok: false,
      erro: `Entrada inválida para github.comentar. texto: pode ter no máximo ${COMENTARIO_MAXIMO} caracteres, para caber inteiro no cartão de aprovação; encurte.`,
    });
  });
});
