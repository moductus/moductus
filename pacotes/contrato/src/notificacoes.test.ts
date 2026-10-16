import { describe, expect, test } from "vitest";
import { CONFIG_PADRAO, Config, Silencio } from "./config.ts";
import {
  MudancaPreferencia,
  Notificacao,
  PedidoMarcarVistas,
  PREFERENCIA_PADRAO,
  preferenciaPadrao,
  PreferenciaNotificacao,
  TIPOS_QUE_PRECISAM,
  TipoNotificacao,
} from "./notificacoes.ts";

const aviso = {
  id: "01K79Z6N7Q4W3J5XG2B8C1D0EK",
  agenteId: "nuno",
  tipo: "aprovacao",
  titulo: "Nuno pede sua aprovação",
  corpo: "O Claude Code quer rodar pnpm test em moductus.",
  referencia: "aprovacao:01K79Z6N7Q4W3J5XG2B8C1D0EM",
  canal: "ambos",
  criadoEm: "2026-10-09T12:00:00.000Z",
  vistaEm: null,
};

describe("notificações", () => {
  test("os tipos e o padrão são os do DATA.md §7 e do PRODUCT.md §5", () => {
    expect(TipoNotificacao.options).toEqual(["aprovacao", "lembrete", "erro", "aviso", "rotina"]);
    expect(TIPOS_QUE_PRECISAM).toEqual(["aprovacao", "lembrete", "erro"]);
    expect(PREFERENCIA_PADRAO).toEqual({ nivel: "so_o_que_precisa", canal: "ambos" });
    // O Nuno avisa tudo de fábrica (AreaNotificacoes.dc.html); os outros, só o que precisa.
    expect(preferenciaPadrao("nuno")).toEqual({ nivel: "tudo", canal: "ambos" });
    expect(preferenciaPadrao("alba")).toEqual(PREFERENCIA_PADRAO);
    expect(preferenciaPadrao(null)).toEqual(PREFERENCIA_PADRAO);
  });

  test("aviso válido passa; sem título ou com canal desconhecido é recusado", () => {
    expect(Notificacao.parse(aviso)).toEqual(aviso);
    expect(Notificacao.safeParse({ ...aviso, titulo: "" }).success).toBe(false);
    expect(Notificacao.safeParse({ ...aviso, canal: "email" }).success).toBe(false);
  });

  test("preferência por agente e tipo; mudança sem tipo vale para todos os tipos", () => {
    expect(
      PreferenciaNotificacao.parse({
        agenteId: "alba",
        tipo: "lembrete",
        nivel: "tudo",
        canal: "dock",
        definida: true,
      }).nivel,
    ).toBe("tudo");
    expect(MudancaPreferencia.parse({ agenteId: null, nivel: "nada", canal: "ambos" })).toEqual({
      agenteId: null,
      nivel: "nada",
      canal: "ambos",
    });
    expect(MudancaPreferencia.safeParse({ agenteId: "alba", nivel: "pouco", canal: "ambos" }).success).toBe(
      false,
    );
  });

  test("marcar vistas aceita ids, um agente ou nada", () => {
    expect(PedidoMarcarVistas.parse({})).toEqual({});
    expect(PedidoMarcarVistas.parse({ agenteId: "nuno" })).toEqual({ agenteId: "nuno" });
    expect(PedidoMarcarVistas.safeParse({ ids: [""] }).success).toBe(false);
  });
});

describe("silêncio", () => {
  test("o padrão silencia tela cheia e foco, e o horário começa desligado", () => {
    expect(Config.parse(CONFIG_PADRAO).silencio).toEqual({
      horario: { ligado: false, inicio: "22:00", fim: "07:30" },
      telaCheia: true,
      foco: true,
    });
  });

  test("hora fora de HH:MM é recusada", () => {
    const valido = CONFIG_PADRAO.silencio;
    expect(Silencio.safeParse({ ...valido, horario: { ...valido.horario, inicio: "23:59" } }).success).toBe(
      true,
    );
    for (const hora of ["24:00", "7:30", "07:60", "22h"]) {
      expect(Silencio.safeParse({ ...valido, horario: { ...valido.horario, fim: hora } }).success).toBe(
        false,
      );
    }
  });
});
