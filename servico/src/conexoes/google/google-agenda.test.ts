import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Conexao } from "@moductus/contrato";
import { afterEach, describe, expect, test, vi } from "vitest";
import { abrirBanco } from "../../banco/conexao.ts";
import { RepositorioConexoes } from "../conexoes.ts";
import { ESCOPOS_AO_CONECTAR, type ClienteOAuth } from "./cliente.ts";
import { abrirGoogleFalso, credenciaisNaMemoria, type GoogleFalso } from "./fixtures/google-falso.ts";
import {
  AVISO_ESCOPOS,
  AVISO_NEGADO,
  AVISO_PRAZO,
  AVISO_RECONECTAR,
  AVISO_REVOGACAO,
  AVISO_SEM_CLIENTE,
  AVISO_STATE,
  AVISO_TROCAR_CLIENTE,
  avisoNavegador,
  CREDENCIAL_CLIENTE_GOOGLE,
  CREDENCIAL_GOOGLE,
  ServicoGoogleAgenda,
} from "./google-agenda.ts";
import { PRAZO_AUTORIZACAO_MS } from "./oauth.ts";

const pastas: string[] = [];
const bancos: DatabaseSync[] = [];
const googles: GoogleFalso[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const g of googles.splice(0)) await g.fechar();
  for (const db of bancos.splice(0)) if (db.isOpen) db.close();
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** Client id de teste: o do autor só entra no código na F3-21. */
const CLIENTE_DE_TESTE: ClienteOAuth = {
  id: "teste.apps.googleusercontent.com",
  segredo: "segredo-de-teste",
};
const AGORA = new Date("2026-10-18T12:00:00.000Z");

/**
 * Banco migrado de verdade, o Google falso em 127.0.0.1 e as credenciais num mapa. O log de erro
 * fica mudo e guardado: nenhum teste aceita token nele.
 */
async function montar(
  opcoes: { clienteDoAutor?: ClienteOAuth | null; clienteDoGoogle?: ClienteOAuth; prazoMs?: number } = {},
) {
  const pasta = mkdtempSync(join(tmpdir(), "moductus-google-"));
  pastas.push(pasta);
  const db = abrirBanco(pasta);
  bancos.push(db);
  const google = await abrirGoogleFalso(opcoes.clienteDoGoogle ?? CLIENTE_DE_TESTE);
  googles.push(google);
  const credenciais = credenciaisNaMemoria();
  const avisos: Conexao[] = [];
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  let agora = AGORA;
  const servico = new ServicoGoogleAgenda({
    conexoes: new RepositorioConexoes(db),
    credenciais,
    abrir: { endereco: (url) => google.abrir.endereco(url) },
    avisar: (c) => avisos.push(c),
    clienteDoAutor: opcoes.clienteDoAutor === undefined ? CLIENTE_DE_TESTE : opcoes.clienteDoAutor,
    enderecos: google.enderecos,
    agora: () => agora,
    prazoMs: opcoes.prazoMs,
  });
  const linha = () =>
    db.prepare("SELECT * FROM conexoes WHERE tipo = 'google-agenda' AND apagado_em IS NULL").get() as
      Record<string, unknown> | undefined;
  /** Tudo o que está no banco, para conferir que token e segredo não foram parar lá. */
  const despejo = () =>
    JSON.stringify(db.prepare("SELECT * FROM conexoes").all()) +
    JSON.stringify(db.prepare("SELECT * FROM config").all());
  const avancar = (ms: number) => (agora = new Date(agora.getTime() + ms));
  return { db, google, credenciais, avisos, servico, linha, despejo, log, avancar };
}

/** O receptor fechou: ninguém mais escuta no `redirect_uri` da última autorização. */
async function receptorFechado(google: GoogleFalso): Promise<boolean> {
  const volta = google.autorizacoes.at(-1)?.searchParams.get("redirect_uri") ?? "";
  return fetch(volta).then(
    () => false,
    () => true,
  );
}

describe("conectar o Google Agenda", () => {
  test("sucesso: PKCE S256, state, receptor em 127.0.0.1 e o refresh token só no Gerenciador", async () => {
    const { google, credenciais, avisos, servico, linha, despejo, log } = await montar();
    expect(servico.conexao()).toEqual({
      tipo: "google-agenda",
      estado: "desligada",
      conta: null,
      ultimoErro: null,
      conectadaEm: null,
    });

    const ligada = await servico.ligar();
    expect(Conexao.parse(ligada)).toEqual(ligada);
    expect(ligada).toEqual({
      tipo: "google-agenda",
      estado: "ligada",
      conta: "voce@gmail.com",
      ultimoErro: null,
      conectadaEm: AGORA.toISOString(),
    });
    expect(avisos).toEqual([ligada]);

    // A URL que a casca abriu: o pedido de app instalado do Google, com os três escopos.
    const url = google.autorizacoes[0]!;
    const p = url.searchParams;
    expect(p.get("client_id")).toBe(CLIENTE_DE_TESTE.id);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(p.get("state")).toMatch(/^[\w-]{43}$/);
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("scope")?.split(" ")).toEqual([...ESCOPOS_AO_CONECTAR]);
    expect(p.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(p.get("redirect_uri")).not.toBe("http://127.0.0.1:0/");
    // O navegador recebeu a página de pronto, e o receptor fechou depois.
    const volta = await google.redirecionamentos[0]!;
    expect(volta).toBeInstanceOf(Response);
    expect(await (volta as Response).text()).toContain("Pode fechar esta aba");
    expect(await receptorFechado(google)).toBe(true);

    // A troca levou o verificador (o Google falso confere com o desafio) e o mesmo redirect_uri.
    const troca = google.pedidos.find((x) => x.campos.grant_type === "authorization_code")!;
    expect(troca.campos.redirect_uri).toBe(p.get("redirect_uri"));
    expect(troca.campos.code_verifier).toMatch(/^[\w-]{43}$/);
    expect(troca.campos.client_secret).toBe(CLIENTE_DE_TESTE.segredo);

    // No Gerenciador: refresh token, escopos e conta. No banco: só o nome dele e os escopos.
    const guardada = JSON.parse(credenciais.valores.get(CREDENCIAL_GOOGLE)!) as Record<string, unknown>;
    expect(guardada).toEqual({
      tokenDeRenovacao: expect.stringMatching(/^renovacao-/),
      escopos: [...ESCOPOS_AO_CONECTAR],
      conta: "voce@gmail.com",
    });
    expect(linha()).toMatchObject({
      estado: "ligada",
      credencial: CREDENCIAL_GOOGLE,
      conta: "voce@gmail.com",
      escopos: JSON.stringify(ESCOPOS_AO_CONECTAR),
      origem: "usuario",
    });
    expect(despejo()).not.toMatch(/renovacao-|acesso-|segredo-de-teste|codigo-/);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/renovacao-|acesso-|segredo-de-teste/);

    // O token de acesso da troca vale sem ir ao Google de novo.
    const antes = google.pedidos.length;
    expect(await servico.tokenDeAcesso()).toMatch(/^acesso-/);
    expect(google.pedidos.length).toBe(antes);
  });

  test("dois cliques em conectar abrem o navegador uma vez só", async () => {
    const { google, servico } = await montar();
    const [a, b] = await Promise.all([servico.ligar(), servico.ligar()]);
    expect(a).toEqual(b);
    expect(google.autorizacoes).toHaveLength(1);
  });

  test("state errado: a resposta é recusada, o código não é trocado e nada é guardado", async () => {
    const { google, credenciais, avisos, servico } = await montar();
    google.navegacao = "state-errado";
    const conexao = await servico.ligar();
    expect(conexao).toMatchObject({ estado: "erro", ultimoErro: AVISO_STATE, conta: null });
    expect(avisos.map((a) => a.estado)).toEqual(["erro"]);
    expect(google.pedidos.filter((x) => x.rota === "/token")).toEqual([]);
    expect(credenciais.valores.has(CREDENCIAL_GOOGLE)).toBe(false);
    const volta = (await google.redirecionamentos[0]!) as Response;
    expect(volta.status).toBe(400);
    expect(await receptorFechado(google)).toBe(true);
  });

  test("prazo de 5 minutos: sem resposta do navegador, o receptor fecha e a conexão diz o que houve", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { google, credenciais, servico } = await montar();
    google.navegacao = "nada";
    let terminou = false;
    const fluxo = servico.ligar().then((c) => {
      terminou = true;
      return c;
    });
    // Sem `vi.waitFor`: com o relógio falso, ele adianta o relógio a cada conferência.
    while (google.autorizacoes.length === 0) await new Promise((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(PRAZO_AUTORIZACAO_MS - 1);
    expect(terminou).toBe(false);
    expect(await receptorFechado(google)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await fluxo).toMatchObject({ estado: "erro", ultimoErro: AVISO_PRAZO });
    expect(PRAZO_AUTORIZACAO_MS).toBe(5 * 60_000);
    expect(credenciais.valores.has(CREDENCIAL_GOOGLE)).toBe(false);
    await vi.waitFor(async () => expect(await receptorFechado(google)).toBe(true));
  });

  test("negar no Google e permissão desmarcada não deixam conexão nem token valendo", async () => {
    const { google, credenciais, servico } = await montar();
    google.navegacao = "negar";
    expect(await servico.ligar()).toMatchObject({ estado: "erro", ultimoErro: AVISO_NEGADO });

    google.navegacao = "autorizar";
    google.escoposConcedidos = [ESCOPOS_AO_CONECTAR[1], ESCOPOS_AO_CONECTAR[2]];
    expect(await servico.ligar()).toMatchObject({ estado: "erro", ultimoErro: AVISO_ESCOPOS });
    // O token que veio pela metade foi revogado no Google.
    expect(google.revogados).toEqual([expect.stringMatching(/^renovacao-/)]);
    expect(credenciais.valores.has(CREDENCIAL_GOOGLE)).toBe(false);
  });

  test("a casca que não abre o navegador vira erro com o motivo, e o receptor fecha", async () => {
    const { google, servico } = await montar();
    google.abrir.endereco = (url) => {
      google.autorizacoes.push(new URL(url));
      return Promise.reject(new Error("só endereço https:// abre no navegador"));
    };
    expect(await servico.ligar()).toMatchObject({
      estado: "erro",
      ultimoErro: avisoNavegador("só endereço https:// abre no navegador"),
    });
    await vi.waitFor(async () => expect(await receptorFechado(google)).toBe(true));
  });

  test("sem o cliente do Moductus e sem cliente próprio, não abre navegador nenhum", async () => {
    const { google, servico } = await montar({ clienteDoAutor: null });
    expect(await servico.ligar()).toMatchObject({ estado: "erro", ultimoErro: AVISO_SEM_CLIENTE });
    expect(google.autorizacoes).toEqual([]);
  });

  test("o Gerenciador que não guarda: o refresh token novo é revogado no Google", async () => {
    const { google, credenciais, servico } = await montar();
    credenciais.guardar = () => Promise.reject(new Error("Gerenciador de Credenciais indisponível"));
    expect(await servico.ligar()).toMatchObject({ estado: "erro" });
    expect(google.revogados).toEqual([expect.stringMatching(/^renovacao-/)]);
    expect(credenciais.valores.has(CREDENCIAL_GOOGLE)).toBe(false);
  });

  test("desconectar no meio da autorização cancela o fluxo", async () => {
    const { google, credenciais, servico } = await montar();
    google.navegacao = "nada";
    const fluxo = servico.ligar();
    await vi.waitFor(() => expect(google.autorizacoes).toHaveLength(1));
    expect((await servico.desligar()).estado).toBe("desligada");
    expect((await fluxo).estado).toBe("desligada");
    expect(credenciais.valores.has(CREDENCIAL_GOOGLE)).toBe(false);
    await vi.waitFor(async () => expect(await receptorFechado(google)).toBe(true));
  });
});

describe("renovar o acesso", () => {
  test("vencido, renova pelo refresh token; invalid_grant põe em erro com Reconectar", async () => {
    const { google, credenciais, avisos, servico, linha, avancar } = await montar();
    await servico.ligar();
    const primeiro = await servico.tokenDeAcesso();

    avancar(3600_000);
    const segundo = await servico.tokenDeAcesso();
    expect(segundo).not.toBe(primeiro);
    expect(google.pedidos.filter((x) => x.campos.grant_type === "refresh_token")).toHaveLength(1);

    // O usuário tirou o acesso no Google (ou a autorização venceu).
    google.revogarTudoNoGoogle();
    avancar(3600_000);
    await expect(servico.tokenDeAcesso()).rejects.toThrow(AVISO_RECONECTAR);
    expect(servico.conexao()).toMatchObject({
      estado: "erro",
      ultimoErro: AVISO_RECONECTAR,
      conta: "voce@gmail.com",
    });
    expect(avisos.at(-1)).toMatchObject({ estado: "erro", ultimoErro: AVISO_RECONECTAR });
    expect(linha()).toMatchObject({ credencial: null, origem: "conexao" });
    expect(credenciais.valores.has(CREDENCIAL_GOOGLE)).toBe(false);
    await expect(servico.tokenDeAcesso()).rejects.toThrow(AVISO_RECONECTAR);

    // Reconectar é conectar de novo.
    expect(await servico.ligar()).toMatchObject({ estado: "ligada", ultimoErro: null });
    expect(await servico.tokenDeAcesso()).toMatch(/^acesso-/);
  });

  test("desligada, não há token", async () => {
    const { servico } = await montar();
    await expect(servico.tokenDeAcesso()).rejects.toThrow("não está conectado");
  });

  test("o token da memória não sai com a linha fora de ligada", async () => {
    const { db, google, servico } = await montar();
    await servico.ligar();
    expect(await servico.tokenDeAcesso()).toMatch(/^acesso-/);
    // A linha muda por fora do serviço (a importação de outro PC, por exemplo).
    db.prepare("UPDATE conexoes SET estado = 'desligada' WHERE tipo = 'google-agenda'").run();
    await expect(servico.tokenDeAcesso()).rejects.toThrow("não está conectado");
    expect(google.pedidos.filter((x) => x.campos.grant_type === "refresh_token")).toEqual([]);
  });

  test("ligada sem a credencial no Gerenciador: erro com Reconectar e aviso às janelas", async () => {
    const { credenciais, avisos, servico, linha, avancar } = await montar();
    await servico.ligar();
    credenciais.valores.delete(CREDENCIAL_GOOGLE);
    avancar(3600_000);
    await expect(servico.tokenDeAcesso()).rejects.toThrow(AVISO_RECONECTAR);
    expect(servico.conexao()).toMatchObject({ estado: "erro", ultimoErro: AVISO_RECONECTAR });
    expect(avisos.at(-1)).toMatchObject({ estado: "erro", ultimoErro: AVISO_RECONECTAR });
    expect(linha()).toMatchObject({ credencial: null, origem: "conexao" });
    await expect(servico.tokenDeAcesso()).rejects.toThrow(AVISO_RECONECTAR);
  });

  test("o refresh token trocado guarda o novo; desconectar enquanto grava não o ressuscita", async () => {
    const { google, credenciais, servico, avancar } = await montar();
    google.trocarRenovacao = true;
    await servico.ligar();
    const original = (JSON.parse(credenciais.valores.get(CREDENCIAL_GOOGLE)!) as { tokenDeRenovacao: string })
      .tokenDeRenovacao;

    // Troca sem nada no meio: o novo substitui o guardado.
    avancar(3600_000);
    await servico.tokenDeAcesso();
    const trocado = (JSON.parse(credenciais.valores.get(CREDENCIAL_GOOGLE)!) as { tokenDeRenovacao: string })
      .tokenDeRenovacao;
    expect(trocado).not.toBe(original);

    // Agora o Gerenciador demora para gravar o próximo, e o usuário desconecta nesse meio.
    const guardar = credenciais.guardar;
    let soltar: () => void = () => undefined;
    let gravando = false;
    credenciais.guardar = async (nome, valor) => {
      gravando = true;
      await new Promise<void>((r) => (soltar = r));
      return guardar(nome, valor);
    };
    avancar(3600_000);
    const pedido = servico.tokenDeAcesso();
    await vi.waitFor(() => expect(gravando).toBe(true));
    expect((await servico.desligar()).estado).toBe("desligada");
    soltar();
    await expect(pedido).rejects.toThrow("não está conectado");
    expect(credenciais.valores.has(CREDENCIAL_GOOGLE)).toBe(false);
    // O que acabou de vir do Google também foi revogado, além do que desconectar revogou.
    expect(google.revogados).toHaveLength(2);
    expect(google.revogados[0]).toBe(trocado);
    expect(google.revogados[1]).toMatch(/^renovacao-/);
    expect(google.revogados[1]).not.toBe(trocado);
    expect(servico.conexao().estado).toBe("desligada");
  });
});

describe("desconectar", () => {
  test("revoga o refresh token no Google e apaga a credencial", async () => {
    const { google, credenciais, avisos, servico } = await montar();
    await servico.ligar();
    const guardada = JSON.parse(credenciais.valores.get(CREDENCIAL_GOOGLE)!) as { tokenDeRenovacao: string };
    const desligada = await servico.desligar();
    expect(desligada).toEqual({
      tipo: "google-agenda",
      estado: "desligada",
      conta: null,
      ultimoErro: null,
      conectadaEm: null,
    });
    expect(google.revogados).toEqual([guardada.tokenDeRenovacao]);
    expect(credenciais.valores.has(CREDENCIAL_GOOGLE)).toBe(false);
    expect(avisos.map((a) => a.estado)).toEqual(["ligada", "desligada"]);
    await expect(servico.tokenDeAcesso()).rejects.toThrow("não está conectado");
  });

  test("revoke que falha: a credencial sai mesmo assim, e a conexão diz onde tirar o acesso", async () => {
    const { google, credenciais, servico, linha } = await montar();
    await servico.ligar();
    google.falharRevogacao = true;
    const desligada = await servico.desligar();
    expect(desligada).toMatchObject({ estado: "desligada", ultimoErro: AVISO_REVOGACAO, conta: null });
    expect(credenciais.valores.has(CREDENCIAL_GOOGLE)).toBe(false);
    expect(linha()).toMatchObject({ estado: "desligada", credencial: null, escopos: "[]", conta: null });
    // Conectar de novo limpa o aviso.
    google.falharRevogacao = false;
    expect(await servico.ligar()).toMatchObject({ estado: "ligada", ultimoErro: null });
  });

  test("token que o Google já revogou (invalid_token): desliga sem mandar tirar o acesso à mão", async () => {
    const { google, credenciais, servico } = await montar();
    await servico.ligar();
    google.revogarTudoNoGoogle();
    const desligada = await servico.desligar();
    expect(desligada).toMatchObject({ estado: "desligada", ultimoErro: null });
    expect(google.pedidos.filter((x) => x.rota === "/revoke")).toHaveLength(1);
    expect(credenciais.valores.has(CREDENCIAL_GOOGLE)).toBe(false);
  });
});

describe("usar meu próprio cliente", () => {
  const MEU: ClienteOAuth = { id: "meu.apps.googleusercontent.com", segredo: "meu-segredo" };

  test("o cliente do usuário vai ao Gerenciador e vence o do Moductus", async () => {
    const { google, credenciais, servico, despejo } = await montar({
      clienteDoAutor: null,
      clienteDoGoogle: MEU,
    });
    expect(await servico.usaClienteProprio()).toBe(false);
    await servico.definirCliente({ id: `  ${MEU.id} `, segredo: MEU.segredo });
    expect(await servico.usaClienteProprio()).toBe(true);
    expect(JSON.parse(credenciais.valores.get(CREDENCIAL_CLIENTE_GOOGLE)!)).toEqual(MEU);

    expect(await servico.ligar()).toMatchObject({ estado: "ligada" });
    expect(google.autorizacoes[0]?.searchParams.get("client_id")).toBe(MEU.id);
    expect(despejo()).not.toContain("meu-segredo");

    // Com a conexão feita, o refresh token é deste cliente: trocar pede desconectar antes.
    await expect(servico.definirCliente(null)).rejects.toThrow(AVISO_TROCAR_CLIENTE);
    await servico.desligar();
    await servico.definirCliente(null);
    expect(credenciais.valores.has(CREDENCIAL_CLIENTE_GOOGLE)).toBe(false);
    expect(await servico.ligar()).toMatchObject({ estado: "erro", ultimoErro: AVISO_SEM_CLIENTE });
  });

  test("client ID vazio ou com espaço é recusado sem guardar nada", async () => {
    const { credenciais, servico } = await montar();
    await expect(servico.definirCliente({ id: "  " })).rejects.toThrow("client ID");
    await expect(servico.definirCliente({ id: "a b", segredo: "x" })).rejects.toThrow("client ID");
    expect(credenciais.valores.size).toBe(0);
  });
});
