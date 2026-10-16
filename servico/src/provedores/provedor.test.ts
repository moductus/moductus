import { describe, expect, test } from "vitest";
import { sonoDaFalha } from "./provedor.ts";

const VOLTA = "2026-10-09T18:00:00.000Z";

describe("sono por falha do provedor", () => {
  test("limite dorme até a hora informada, ou sem hora quando o provedor não diz", () => {
    expect(sonoDaFalha({ motivo: "limite", mensagem: "limite de 5 h", voltaEm: VOLTA })).toEqual({
      motivo: "limite",
      ate: VOLTA,
    });
    expect(sonoDaFalha({ motivo: "limite", mensagem: "limite", voltaEm: null })).toEqual({
      motivo: "limite",
      ate: null,
    });
  });

  test("fora do ar dorme até a volta informada", () => {
    expect(sonoDaFalha({ motivo: "fora_do_ar", mensagem: "503", voltaEm: VOLTA })).toEqual({
      motivo: "fora_do_ar",
      ate: VOLTA,
    });
  });

  test("credencial e CLI ausente dormem até o usuário resolver, sem hora", () => {
    expect(sonoDaFalha({ motivo: "credencial", mensagem: "401", voltaEm: VOLTA })).toEqual({
      motivo: "credencial",
      ate: null,
    });
    expect(sonoDaFalha({ motivo: "ausente", mensagem: "claude não está no PATH", voltaEm: null })).toEqual({
      motivo: "ausente",
      ate: null,
    });
  });
});
