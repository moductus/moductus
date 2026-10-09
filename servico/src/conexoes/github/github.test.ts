import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Conexao, SituacaoGithub } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { abrirBanco } from "../../banco/conexao.ts";
import { RepositorioConexoes } from "../conexoes.ts";
import { GhAusente, type ExecutorGh, type SaidaGh } from "./gh.ts";
import {
  AVISO_DESLIGADA,
  AVISO_SEM_GH,
  AVISO_SEM_LOGIN,
  avisoFalhou,
  INTERVALO_GITHUB_MS,
  motivoDoItem,
  RepositorioGithub,
  ServicoGithub,
} from "./github.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const RESPOSTA = readFileSync(new URL("./fixtures/resposta-graphql.json", import.meta.url), "utf8");

type Busca = { nodes: Record<string, unknown>[] };
type Resposta = { data: { viewer: { login: string }; revisar: Busca; meus: Busca; atribuidas: Busca } };
const resposta = (): Resposta => JSON.parse(RESPOSTA) as Resposta;

const OK = (corpo: unknown = resposta()): SaidaGh => ({ codigo: 0, saida: JSON.stringify(corpo), erro: "" });
const SEM_LOGIN: SaidaGh = {
  codigo: 4,
  saida: "",
  erro: "To get started with GitHub CLI, please run:  gh auth login",
};
const SEM_REDE: SaidaGh = { codigo: 1, saida: "", erro: "error connecting to api.github.com" };

/**
 * Banco migrado de verdade e um `gh` falso que responde o roteiro em ordem (o último se repete):
 * nenhum teste chama o GitHub.
 */
function montar(roteiro: (SaidaGh | Error)[] = [OK()]) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-github-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  let relogio = new Date("2026-10-09T12:00:00.000Z");
  const chamadas: (readonly string[])[] = [];
  const gh: ExecutorGh = (args) => {
    chamadas.push(args);
    const proxima = roteiro.length > 1 ? roteiro.shift() : roteiro[0];
    if (!proxima) throw new Error("roteiro vazio");
    return proxima instanceof Error ? Promise.reject(proxima) : Promise.resolve(proxima);
  };
  const avisos = { github: [] as SituacaoGithub[], conexao: [] as Conexao[] };
  const servico = new ServicoGithub(
    new RepositorioGithub(db),
    new RepositorioConexoes(db),
    gh,
    { github: (s) => avisos.github.push(s), conexao: (c) => avisos.conexao.push(c) },
    { agora: () => relogio },
  );
  const passar = (ms: number) => {
    relogio = new Date(relogio.getTime() + ms);
  };
  return { db, servico, chamadas, avisos, roteiro, passar };
}

describe("conexão com o GitHub", () => {
  test("nunca ligada: desligada, cache vazio e nenhuma chamada ao gh", async () => {
    const { servico, chamadas } = montar();
    expect(servico.conexao()).toEqual({
      tipo: "github",
      estado: "desligada",
      conta: null,
      ultimoErro: null,
      conectadaEm: null,
    });
    expect(await servico.atualizar()).toEqual({ itens: [], atualizadoEm: null });
    expect(chamadas).toHaveLength(0);
  });

  test("sem gh, a Conexão diz para instalar; sem login, para rodar gh auth login; depois liga sozinha", async () => {
    const { servico, avisos, roteiro } = montar([new GhAusente()]);
    const semGh = await servico.ligar();
    expect(Conexao.parse(semGh)).toEqual(semGh);
    expect(semGh).toEqual({
      tipo: "github",
      estado: "erro",
      conta: null,
      ultimoErro: AVISO_SEM_GH,
      conectadaEm: null,
    });

    roteiro.splice(0, roteiro.length, SEM_LOGIN);
    expect(await servico.ligar()).toMatchObject({ estado: "erro", ultimoErro: AVISO_SEM_LOGIN });

    // O usuário rodou gh auth login: a próxima leitura do vigia liga a conexão.
    roteiro.splice(0, roteiro.length, OK());
    await servico.atualizar();
    expect(servico.conexao()).toEqual({
      tipo: "github",
      estado: "ligada",
      conta: "voce",
      ultimoErro: null,
      conectadaEm: "2026-10-09T12:00:00.000Z",
    });
    expect(avisos.conexao.map((c) => c.ultimoErro ?? c.estado)).toEqual([
      AVISO_SEM_GH,
      AVISO_SEM_LOGIN,
      "ligada",
    ]);
    expect(AVISO_SEM_GH).toMatch(/Instale/);
    expect(AVISO_SEM_LOGIN).toMatch(/gh auth login/);
  });

  test("com login, o cache bate com o GitHub: o que precisa de você primeiro, sem credencial guardada", async () => {
    const { servico, db, avisos } = montar();
    expect(await servico.ligar()).toMatchObject({ estado: "ligada", conta: "voce" });
    const situacao = servico.obter();
    expect(SituacaoGithub.parse(situacao)).toEqual(situacao);
    expect(situacao.atualizadoEm).toBe("2026-10-09T12:00:00.000Z");
    expect(situacao.itens.map((i) => [`${i.repositorio}#${i.numero}`, i.precisaDeMim])).toEqual([
      ["loja/api-pedidos#409", true],
      ["loja/api-pedidos#412", true],
      ["voce/site#57", true],
      ["voce/moductus#31", true],
      ["voce/moductus#12", false],
      // Review pedido só ao time: na lista, sem precisar de você.
      ["loja/relatorios#388", false],
    ]);
    expect(avisos.github).toEqual([situacao]);
    expect(db.prepare("SELECT tipo, conta, credencial, estado FROM conexoes").all()).toEqual([
      { tipo: "github", conta: "voce", credencial: null, estado: "ligada" },
    ]);
    expect(db.prepare("SELECT DISTINCT origem FROM github_itens").all()).toEqual([{ origem: "conexao" }]);
  });

  test("a leitura seguinte troca o cache: quem saiu das buscas sai, quem ficou guarda o id", async () => {
    const depois = resposta();
    // O #12 foi mesclado (sai de "meus"); o #409 teve o CI concluído com falha.
    depois.data.meus.nodes = depois.data.meus.nodes.filter((n) => n.number !== 12);
    const pr409 = depois.data.meus.nodes.find((n) => n.number === 409);
    if (pr409) pr409.commits = { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] };
    const { servico, passar, avisos } = montar([OK(), OK(depois)]);
    await servico.ligar();
    const antes = servico.obter();
    passar(INTERVALO_GITHUB_MS);
    const agora = await servico.atualizar();
    expect(agora.atualizadoEm).toBe("2026-10-09T12:15:00.000Z");
    expect(agora.itens.find((i) => i.numero === 12)).toBeUndefined();
    const id409 = (s: SituacaoGithub) => s.itens.find((i) => i.numero === 409);
    expect(id409(agora)?.id).toBe(id409(antes)?.id);
    expect(id409(agora)?.ciEstado).toBe("falhou");
    expect(agora.itens).toHaveLength(5);
    // Leitura que deu certo de novo não repete o aviso da conexão.
    expect(avisos.conexao).toHaveLength(1);
    expect(avisos.github).toHaveLength(2);
  });

  test("leitura sem item nenhum ainda é uma leitura: o cache esvazia e a data é a de agora", async () => {
    const vazia = resposta();
    vazia.data.revisar.nodes = [];
    vazia.data.meus.nodes = [];
    vazia.data.atribuidas.nodes = [];
    const { servico, passar } = montar([OK(), OK(vazia)]);
    await servico.ligar();
    passar(INTERVALO_GITHUB_MS);
    expect(await servico.atualizar()).toEqual({ itens: [], atualizadoEm: "2026-10-09T12:15:00.000Z" });
    expect(servico.obter().atualizadoEm).toBe("2026-10-09T12:15:00.000Z");
  });

  test("a origem da linha da conexão diz quem mexeu: usuário ao ligar e desligar, a conexão no vigia", async () => {
    vi.useFakeTimers();
    const { servico, db, roteiro } = montar([OK()]);
    const origem = () => db.prepare("SELECT origem FROM conexoes WHERE tipo = 'github'").get();
    await servico.ligar();
    expect(origem()).toEqual({ origem: "usuario" });
    const parar = servico.vigiar();
    await vi.advanceTimersByTimeAsync(0);
    expect(origem()).toEqual({ origem: "conexao" });
    // Erro achado pelo vigia também é da conexão.
    roteiro.splice(0, roteiro.length, SEM_REDE);
    await vi.advanceTimersByTimeAsync(INTERVALO_GITHUB_MS);
    expect(origem()).toEqual({ origem: "conexao" });
    parar();
    await servico.desligar();
    expect(origem()).toEqual({ origem: "usuario" });
  });

  test("sem rede numa leitura: o cache fica como estava e a Conexão diz que tenta de novo", async () => {
    const { servico, passar } = montar([OK(), SEM_REDE, OK()]);
    await servico.ligar();
    const antes = servico.obter();
    passar(INTERVALO_GITHUB_MS);
    expect(await servico.atualizar()).toEqual(antes);
    expect(servico.conexao()).toEqual({
      tipo: "github",
      estado: "erro",
      conta: "voce",
      ultimoErro: avisoFalhou("error connecting to api.github.com"),
      conectadaEm: "2026-10-09T12:00:00.000Z",
    });
    passar(INTERVALO_GITHUB_MS);
    await servico.atualizar();
    expect(servico.conexao()).toMatchObject({ estado: "ligada", conectadaEm: "2026-10-09T12:00:00.000Z" });
  });

  test("desligar para de ler e apaga o cache; leitura que estava no meio não grava", async () => {
    const { servico, chamadas, roteiro, avisos } = montar([OK()]);
    await servico.ligar();
    let soltar: (s: SaidaGh) => void = () => undefined;
    const lenta = new Promise<SaidaGh>((r) => (soltar = r));
    // O gh falso adota a promessa do roteiro como resposta: fica pendurada até soltar.
    roteiro.splice(0, roteiro.length, lenta as unknown as SaidaGh);
    const noMeio = servico.atualizar();
    const desligada = await servico.desligar();
    expect(desligada).toMatchObject({ estado: "desligada", conta: null });
    soltar(OK());
    await noMeio;
    expect(servico.conexao().estado).toBe("desligada");
    expect(servico.obter()).toEqual({ itens: [], atualizadoEm: null });
    expect(avisos.github.at(-1)).toEqual({ itens: [], atualizadoEm: null });
    const antes = chamadas.length;
    await servico.atualizar();
    expect(chamadas).toHaveLength(antes);
  });

  test("duas atualizações juntas fazem uma leitura só", async () => {
    const { servico, chamadas } = montar();
    await servico.ligar();
    chamadas.length = 0;
    const [a, b] = await Promise.all([servico.atualizar(), servico.atualizar()]);
    expect(a).toEqual(b);
    expect(chamadas).toHaveLength(1);
  });

  test("o vigia lê na subida e a cada 15 minutos, e só com a conexão ligada", async () => {
    vi.useFakeTimers();
    const { servico, chamadas } = montar();
    const parar = servico.vigiar();
    await vi.advanceTimersByTimeAsync(INTERVALO_GITHUB_MS);
    expect(chamadas).toHaveLength(0);

    await servico.ligar();
    chamadas.length = 0;
    await vi.advanceTimersByTimeAsync(INTERVALO_GITHUB_MS - 1);
    expect(chamadas).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(chamadas).toHaveLength(1);
    parar();
    await vi.advanceTimersByTimeAsync(INTERVALO_GITHUB_MS * 2);
    expect(chamadas).toHaveLength(1);

    // Ligada antes de subir: a primeira leitura é na hora.
    const parar2 = servico.vigiar();
    await vi.advanceTimersByTimeAsync(0);
    expect(chamadas).toHaveLength(2);
    parar2();
  });
});

describe("o que precisa de você (pendências do Nuno)", () => {
  test("pelo cache, cada item com o motivo, sem ir ao gh", async () => {
    const { servico, chamadas } = montar();
    await servico.ligar();
    chamadas.length = 0;
    const pendencias = servico.pendencias();
    expect(pendencias).toMatchObject({ conexao: "ligada", aviso: null, lidoEm: "2026-10-09T12:00:00.000Z" });
    expect(pendencias.itens.map((i) => [`${i.repositorio}#${i.numero}`, i.motivo])).toEqual([
      ["loja/api-pedidos#409", "mudanças pedidas no seu PR"],
      ["loja/api-pedidos#412", "review pedido a você"],
      ["voce/site#57", "CI quebrado no seu PR"],
      ["voce/moductus#31", "issue atribuída a você"],
    ]);
    expect(chamadas).toHaveLength(0);
  });

  test("desligada, a lista vazia diz que não sabe; em erro, diz por que pode estar velha", async () => {
    const { servico, roteiro } = montar([OK(), SEM_REDE]);
    expect(servico.pendencias()).toEqual({
      conexao: "desligada",
      aviso: AVISO_DESLIGADA,
      lidoEm: null,
      itens: [],
    });
    await servico.ligar();
    await servico.atualizar();
    expect(roteiro).toEqual([SEM_REDE]);
    const pendencias = servico.pendencias();
    expect(pendencias.conexao).toBe("erro");
    expect(pendencias.aviso).toBe(avisoFalhou("error connecting to api.github.com"));
    expect(pendencias.itens).toHaveLength(4);
  });

  test("motivo: só o que precisa de você tem", () => {
    const base = {
      id: "x",
      repositorio: "a/b",
      numero: 1,
      tipo: "pr" as const,
      titulo: "t",
      autor: null,
      estado: "aberto" as const,
      meuPapel: "autor" as const,
      precisaDeMim: true,
      ciEstado: "falhou" as const,
      atualizadoNoGithub: null,
      url: "https://github.com/a/b/pull/1",
    };
    expect(motivoDoItem(base)).toBe("CI quebrado no seu PR");
    expect(motivoDoItem({ ...base, ciEstado: "passou" })).toBe("mudanças pedidas no seu PR");
    expect(motivoDoItem({ ...base, precisaDeMim: false })).toBeNull();
    expect(motivoDoItem({ ...base, meuPapel: "atribuido" })).toBe("PR atribuído a você");
  });
});

describe("ler um item e comentar pelo gh", () => {
  const PR = { number: 412, title: "Cancelar pedido", body: "corpo", state: "OPEN", url: "https://x" };

  test("detalhe usa o tipo do cache e o gh com a conta do usuário", async () => {
    const { servico, chamadas, roteiro } = montar([OK(), OK(PR)]);
    await servico.ligar();
    expect(roteiro).toHaveLength(1);
    chamadas.length = 0;
    const detalhe = await servico.detalhe({ repositorio: "loja/api-pedidos", numero: 412 });
    expect(detalhe).toMatchObject({ tipo: "pr", numero: 412, titulo: "Cancelar pedido", estado: "aberto" });
    expect(chamadas[0]?.slice(0, 5)).toEqual(["pr", "view", "412", "--repo", "loja/api-pedidos"]);

    await servico.detalhe({ repositorio: "Voce/Moductus", numero: 31 });
    expect(chamadas[1]?.slice(0, 2)).toEqual(["issue", "view"]);
  });

  test("comentar manda o texto cru pela API de issues e devolve o endereço", async () => {
    const { servico, chamadas } = montar([
      OK(),
      OK({ html_url: "https://github.com/loja/api-pedidos/pull/412#c1" }),
    ]);
    await servico.ligar();
    chamadas.length = 0;
    const texto = "@colega -F body=@segredo.txt; rm -rf .";
    expect(await servico.comentar({ repositorio: "loja/api-pedidos", numero: 412, texto })).toEqual({
      url: "https://github.com/loja/api-pedidos/pull/412#c1",
    });
    expect(chamadas).toEqual([
      ["api", "--method", "POST", "repos/loja/api-pedidos/issues/412/comments", "-f", `body=${texto}`],
    ]);
  });

  test("desligada não vai ao gh; sem gh e sem login dizem o que fazer; repositório estranho nem sai", async () => {
    const { servico, chamadas } = montar([
      OK(),
      new GhAusente(),
      SEM_LOGIN,
      { codigo: 1, saida: "", erro: "GraphQL: Could not resolve to a PullRequest" },
    ]);
    await expect(servico.comentar({ repositorio: "a/b", numero: 1, texto: "oi" })).rejects.toThrow(
      AVISO_DESLIGADA,
    );
    await expect(servico.detalhe({ repositorio: "a/b", numero: 1 })).rejects.toThrow(AVISO_DESLIGADA);
    expect(chamadas).toHaveLength(0);

    await servico.ligar();
    await expect(servico.detalhe({ repositorio: "a/b", numero: 1 })).rejects.toThrow(AVISO_SEM_GH);
    await expect(servico.comentar({ repositorio: "a/b", numero: 1, texto: "oi" })).rejects.toThrow(
      AVISO_SEM_LOGIN,
    );
    await expect(servico.detalhe({ repositorio: "a/b", numero: 1 })).rejects.toThrow(
      "GraphQL: Could not resolve to a PullRequest",
    );

    chamadas.length = 0;
    await expect(servico.comentar({ repositorio: "../a/b", numero: 1, texto: "oi" })).rejects.toThrow(
      "não é um repositório dono/nome",
    );
    expect(chamadas).toHaveLength(0);
  });
});
