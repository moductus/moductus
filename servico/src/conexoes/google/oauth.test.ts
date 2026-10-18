import { describe, expect, test } from "vitest";
import { validarCliente } from "./cliente.ts";
import { abrirReceptorOAuth, FalhaAutorizacao, gerarPkce, urlDeAutorizacao } from "./oauth.ts";

describe("PKCE e URL de autorização", () => {
  test("o desafio é o S256 do verificador (vetor do apêndice B da RFC 7636)", () => {
    const verificador = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const bytes = Buffer.from(verificador, "base64url");
    expect(gerarPkce(() => bytes)).toEqual({
      verificador,
      desafio: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    });
  });

  test("a URL só tem caracteres que a casca aceita abrir e cabe no limite dela", () => {
    const url = urlDeAutorizacao(
      { autorizacao: "https://accounts.google.com/o/oauth2/v2/auth" },
      {
        cliente: { id: "123-abc.apps.googleusercontent.com", segredo: "s" },
        redirecionamento: "http://127.0.0.1:51234/",
        escopos: ["https://www.googleapis.com/auth/calendar.app.created", "x y"],
        desafio: "d".repeat(43),
        state: "e".repeat(43),
      },
    );
    expect(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
    // A mesma regra de `validar_endereco` em `src-tauri/src/abrir.rs`.
    expect(url).toMatch(/^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/);
    expect(url.length).toBeLessThanOrEqual(2048);
    expect(url).not.toContain("segredo");
    expect(new URL(url).searchParams.get("redirect_uri")).toBe("http://127.0.0.1:51234/");
  });
});

describe("receptor do redirecionamento", () => {
  test("ignora outro caminho e pedido sem state, e entrega o código do state certo", async () => {
    const receptor = await abrirReceptorOAuth("o-state");
    const base = receptor.redirecionamento;
    expect((await fetch(`${base}favicon.ico`)).status).toBe(404);
    expect((await fetch(base)).status).toBe(400);
    const resposta = await fetch(`${base}?state=o-state&code=c-1`);
    expect(resposta.status).toBe(200);
    await expect(receptor.codigo).resolves.toBe("c-1");
  });

  test("cancelar falha a espera com o motivo e fecha a porta", async () => {
    const receptor = await abrirReceptorOAuth("o-state");
    receptor.cancelar();
    await expect(receptor.codigo).rejects.toBeInstanceOf(FalhaAutorizacao);
    await expect(receptor.codigo).rejects.toMatchObject({ motivo: "cancelado" });
    await expect
      .poll(() =>
        fetch(receptor.redirecionamento).then(
          () => "aberto",
          () => "fechado",
        ),
      )
      .toBe("fechado");
  });
});

describe("cliente próprio", () => {
  test("tira espaço das pontas e aceita sem secret", () => {
    expect(validarCliente({ id: " a.apps.googleusercontent.com ", segredo: " s " })).toEqual({
      id: "a.apps.googleusercontent.com",
      segredo: "s",
    });
    expect(validarCliente({ id: "a", segredo: "" })).toEqual({ id: "a", segredo: null });
  });
});
