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
  AVISO_SEM_GH,
  AVISO_SEM_LOGIN,
  avisoFalhou,
  INTERVALO_GITHUB_MS,
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
