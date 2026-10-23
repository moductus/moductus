import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { SituacaoGoogle } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { abrirBanco } from "../../banco/conexao.ts";
import { RepositorioConexoes } from "../conexoes.ts";
import type { ClienteOAuth } from "./cliente.ts";
import { abrirGoogleFalso, credenciaisNaMemoria, type GoogleFalso } from "./fixtures/google-falso.ts";
import {
  AVISO_RECONECTAR,
  AVISO_TROCAR_CLIENTE,
  CREDENCIAL_CLIENTE_GOOGLE,
  ServicoGoogleAgenda,
} from "./google-agenda.ts";
import { PRAZO_AUTORIZACAO_MS } from "./oauth.ts";
import { SituacaoGoogleAgenda } from "./situacao.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
const googles: GoogleFalso[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const g of googles.splice(0)) await g.fechar();
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

const CLIENTE_DE_TESTE: ClienteOAuth = {
  id: "teste.apps.googleusercontent.com",
  segredo: "segredo-de-teste",
};
const AGORA = new Date("2026-10-18T12:00:00.000Z");

/** O serviço do Google de verdade, contra o Google falso em 127.0.0.1, e a situação do cartão. */
async function montar() {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-situacao-google-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  const google = await abrirGoogleFalso(CLIENTE_DE_TESTE);
  googles.push(google);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const credenciais = credenciaisNaMemoria();
  const conexoes = new RepositorioConexoes(db);
  let mudancas = 0;
  let fila = 0;
  const leituras: string[] = [];
  const servico = new ServicoGoogleAgenda({
    conexoes,
    credenciais,
    abrir: { endereco: (url) => google.abrir.endereco(url) },
    avisar: () => undefined,
    situacaoMudou: () => mudancas++,
    clienteDoAutor: CLIENTE_DE_TESTE,
    enderecos: google.enderecos,
    agora: () => AGORA,
  });
  const situacao = new SituacaoGoogleAgenda({
    google: servico,
    conexoes,
    fila: () => fila,
    ler: () => {
      leituras.push("ler");
      servico.marcarLeitura({ ok: true });
      return Promise.resolve("lida");
    },
  });
  return {
    google,
    credenciais,
    servico,
    situacao,
    mudancas: () => mudancas,
    leituras,
    porNaFila: (n: number) => (fila = n),
  };
}

describe("a situação do Google Agenda no cartão", () => {
  test("desligada: nada lido, nada esperando, cliente do Moductus e sem problema", async () => {
    const { situacao } = await montar();
    const lida = await situacao.obter();
    expect(SituacaoGoogle.parse(lida)).toEqual(lida);
    expect(lida).toEqual({ autorizacao: null, lidaEm: null, fila: 0, clienteProprio: false, problema: null });
  });

  test("conectando: a autorização fica aberta até o navegador voltar, e cancelar a fecha", async () => {
    const { google, servico, mudancas } = await montar();
    google.navegacao = "nada";
    const fluxo = servico.ligar();
    await vi.waitFor(() => expect(google.autorizacoes).toHaveLength(1));
    // O endereço é o mesmo que a casca abriu, e o prazo é o do receptor.
    expect(servico.autorizacaoAberta()).toEqual({
      endereco: google.autorizacoes[0]!.href,
      venceEm: new Date(AGORA.getTime() + PRAZO_AUTORIZACAO_MS).toISOString(),
    });
    const antes = mudancas();
    expect(antes).toBeGreaterThan(0);

    await servico.desligar();
    expect((await fluxo).estado).toBe("desligada");
    expect(servico.autorizacaoAberta()).toBeNull();
    expect(mudancas()).toBeGreaterThan(antes);
  });

  test("conectado: a autorização fecha e o problema some; a leitura que falhou vira problema de leitura", async () => {
    const { servico, situacao } = await montar();
    await servico.ligar();
    expect(servico.autorizacaoAberta()).toBeNull();
    expect((await situacao.obter()).problema).toBeNull();

    servico.marcarLeitura({ ok: false });
    expect((await situacao.obter()).problema).toBe("leitura");
    servico.marcarLeitura({ ok: true });
    expect((await situacao.obter()).problema).toBeNull();
  });

  test("o Google não aceita mais a autorização: o problema é reconectar", async () => {
    const { google, servico, situacao } = await montar();
    await servico.ligar();
    google.revogarTudoNoGoogle();
    servico.acessoRecusado(await servico.tokenDeAcesso());
    await expect(servico.tokenDeAcesso()).rejects.toThrow(AVISO_RECONECTAR);
    expect((await situacao.obter()).problema).toBe("reconectar");
  });

  test("conectar que não terminou é problema de conectar", async () => {
    const { google, servico, situacao } = await montar();
    google.navegacao = "negar";
    expect((await servico.ligar()).estado).toBe("erro");
    expect((await situacao.obter()).problema).toBe("conectar");
  });

  test("Ler agora lê e devolve a data da leitura e a fila de agora", async () => {
    const { servico, situacao, leituras, porNaFila } = await montar();
    await servico.ligar();
    porNaFila(3);
    const depois = await situacao.atualizar();
    expect(leituras).toEqual(["ler"]);
    expect(depois).toMatchObject({ lidaEm: AGORA.toISOString(), fila: 3 });

    // Desconectado, a data da leitura não vale mais.
    await servico.desligar();
    expect((await situacao.obter()).lidaEm).toBeNull();
  });

  test("o cliente próprio vai ao Gerenciador e volta só como sim ou não; null volta ao do Moductus", async () => {
    const { credenciais, situacao, mudancas } = await montar();
    const antes = mudancas();
    const proprio = await situacao.definirCliente({
      cliente: { id: "meu.apps.googleusercontent.com", segredo: "x" },
    });
    expect(proprio.clienteProprio).toBe(true);
    expect(JSON.stringify(proprio)).not.toContain("meu.apps");
    expect(JSON.parse(credenciais.valores.get(CREDENCIAL_CLIENTE_GOOGLE)!)).toEqual({
      id: "meu.apps.googleusercontent.com",
      segredo: "x",
    });
    expect(mudancas()).toBeGreaterThan(antes);

    expect((await situacao.definirCliente({ cliente: null })).clienteProprio).toBe(false);
    expect(credenciais.valores.has(CREDENCIAL_CLIENTE_GOOGLE)).toBe(false);
  });

  test("trocar o cliente com a conexão feita é recusado", async () => {
    const { servico, situacao } = await montar();
    await servico.ligar();
    await expect(situacao.definirCliente({ cliente: { id: "outro" } })).rejects.toThrow(AVISO_TROCAR_CLIENTE);
  });

  test("autorização em endereço que não é https não chega ao cartão: a casca não abriria", async () => {
    const autorizacao = { endereco: "http://127.0.0.1:1/auth", venceEm: AGORA.toISOString() };
    const google = {
      conexao: () => ({
        tipo: "google-agenda" as const,
        estado: "desligada" as const,
        conta: null,
        ultimoErro: null,
        conectadaEm: null,
      }),
      autorizacaoAberta: () => autorizacao,
      problema: () => null,
      usaClienteProprio: () => Promise.resolve(false),
      definirCliente: () => Promise.resolve(),
    };
    const situacao = new SituacaoGoogleAgenda({
      google,
      conexoes: { obter: () => null },
      fila: () => 0,
      ler: () => Promise.resolve(),
    });
    expect((await situacao.obter()).autorizacao).toBeNull();
    autorizacao.endereco = "https://accounts.google.com/o/oauth2/v2/auth?state=x";
    expect((await situacao.obter()).autorizacao).toEqual(autorizacao);
  });
});
