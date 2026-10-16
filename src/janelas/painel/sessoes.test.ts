import type { Aprovacao, ItemGithub, ListaSessoes, SessaoIa } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  itensDasSessoes,
  metaDoPr,
  projetosNaTela,
  prsDoPainel,
  resumoDoDev,
  seloDoPr,
  sessoesAbertas,
  tempoDaSessao,
} from "./sessoes.ts";

const AGORA = new Date("2026-10-09T15:00:00.000Z");
const ha = (min: number) => new Date(AGORA.getTime() - min * 60_000).toISOString();

const sessao = (id: string, extra: Partial<SessaoIa> = {}): SessaoIa => ({
  id,
  projetoId: "p1",
  ferramenta: "claude-code",
  idExterno: id,
  modelo: null,
  estado: "terminou",
  iniciadaEm: ha(30),
  ultimoEventoEm: ha(8),
  encerradaEm: null,
  contexto: null,
  ultimoEvento: null,
  ...extra,
});

const pedido = (id: string, sessaoId: string | null, extra: Partial<Aprovacao> = {}): Aprovacao => ({
  id,
  fonte: "claude-code",
  agenteId: null,
  execucaoId: null,
  sessaoId,
  descricao: "Quer rodar o comando abaixo.",
  acao: {
    ferramenta: "Bash",
    entrada: { command: "npm test" },
    rotulo: null,
    rotuloRecusar: null,
    desfazivel: false,
  },
  estado: "pendente",
  criadoEm: AGORA.toISOString(),
  decididaEm: null,
  regraCriadaId: null,
  admiteSempre: true,
  ...extra,
});

const LISTA: ListaSessoes = {
  projetos: [
    { id: "p1", nome: "api-pedidos", caminho: "V:\\api-pedidos", repositorio: null, arquivado: false },
    { id: "p2", nome: "site", caminho: "V:\\site", repositorio: null, arquivado: false },
  ],
  sessoes: [
    sessao("velha", { ultimoEventoEm: ha(60) }),
    sessao("fechada", { encerradaEm: ha(5) }),
    sessao("nova", { projetoId: "p2", ultimoEventoEm: ha(2) }),
    sessao("trabalha", { estado: "trabalhando" }),
    sessao("espera", { estado: "esperando" }),
  ],
};

describe("sessões no painel", () => {
  it("abertas, da que espera à que parou, a mais recente primeiro dentro do estado", () => {
    expect(sessoesAbertas(LISTA).map((s) => s.id)).toEqual(["espera", "trabalha", "nova", "velha"]);
  });

  it("pedidos primeiro; sessão com pedido na tela não se repete; o resto conta como fora", () => {
    const { itens, fora } = itensDasSessoes(
      LISTA,
      { aprovacoes: [pedido("a1", "espera")], projetos: { espera: "api-pedidos" } },
      3,
    );
    expect(itens.map((i) => (i.tipo === "pedido" ? `pedido:${i.aprovacao.id}` : i.sessao.id))).toEqual([
      "pedido:a1",
      "trabalha",
      "nova",
    ]);
    expect(fora).toBe(1);
    expect(projetosNaTela(itens)).toBe(2);
  });

  it("sem lista, só os pedidos", () => {
    const { itens, fora } = itensDasSessoes(null, { aprovacoes: [pedido("a1", null)], projetos: {} });
    expect(itens).toHaveLength(1);
    expect(fora).toBe(0);
    expect(projetosNaTela(itens)).toBe(0);
  });

  it("tempo: há quanto trabalha, ou desde o último evento", () => {
    expect(tempoDaSessao(sessao("x", { estado: "trabalhando", iniciadaEm: ha(12) }), AGORA)).toBe("12 min");
    expect(tempoDaSessao(sessao("x"), AGORA)).toBe("há 8 min");
    expect(tempoDaSessao(sessao("x", { ultimoEventoEm: null }), AGORA)).toBeNull();
  });
});

describe("PRs no painel Dev", () => {
  const pr = (numero: number, extra: Partial<ItemGithub> = {}): ItemGithub => ({
    id: `g${numero}`,
    repositorio: "dono/api-pedidos",
    numero,
    tipo: "pr",
    titulo: "t",
    autor: "ana",
    estado: "aberto",
    meuPapel: "revisor",
    precisaDeMim: false,
    ciEstado: null,
    atualizadoNoGithub: null,
    url: "https://github.com/dono/api-pedidos/pull/1",
    ...extra,
  });

  it("o selo diz o que faz o PR estar ali, curto", () => {
    expect(seloDoPr(pr(1, { precisaDeMim: true }))).toEqual({ texto: "review", tom: "aviso" });
    expect(seloDoPr(pr(1, { meuPapel: "autor", precisaDeMim: true }))).toEqual({
      texto: "mudanças",
      tom: "aviso",
    });
    expect(seloDoPr(pr(1, { ciEstado: "falhou", precisaDeMim: true }))).toEqual({
      texto: "CI falhou",
      tom: "perigo",
    });
    expect(seloDoPr(pr(1, { ciEstado: "passou" }))).toEqual({ texto: "CI passou", tom: "sucesso" });
    expect(seloDoPr(pr(1, { ciEstado: "rodando" }))).toEqual({ texto: "CI rodando", tom: "neutro" });
    expect(seloDoPr(pr(1))).toEqual({ texto: "aberto", tom: "apagado" });
  });

  it("a linha de baixo: referência e quando mudou, ou seu", () => {
    expect(metaDoPr(pr(412, { atualizadoNoGithub: ha(26 * 60) }), AGORA)).toBe("api-pedidos #412 · há 26 h");
    expect(metaDoPr(pr(57, { meuPapel: "autor" }), AGORA)).toBe("api-pedidos #57 · seu");
  });

  it("só PRs abertos, os que precisam de você primeiro", () => {
    const lista = [
      pr(1),
      pr(2, { precisaDeMim: true }),
      pr(3, { estado: "mesclado" }),
      pr(4, { tipo: "issue", precisaDeMim: true }),
    ];
    expect(prsDoPainel(lista).map((p) => p.numero)).toEqual([2, 1]);
  });

  it("o alto do painel Dev", () => {
    expect(resumoDoDev(3, 2)).toBe("Nuno · 3 sessões, 2 PRs esperando você");
    expect(resumoDoDev(1, 0)).toBe("Nuno · 1 sessão, nenhum PR esperando você");
  });
});
