import { describe, expect, test } from "vitest";
import {
  CHAVES_DESTE_PC,
  CONFIG_PADRAO,
  Config,
  ConfigDia,
  ConfigInicio,
  Expediente,
  FUSO_RESERVA,
  Fuso,
  fusoDoSistema,
  MudancaConfig,
  Privacidade,
} from "./config.ts";

describe("config do dia", () => {
  test("padrão: expediente 09:00 às 18:00, foco 25/5 quatro vezes e pausa longa de 15, Ctrl+Alt+P", () => {
    expect(Config.parse(CONFIG_PADRAO)).toEqual(CONFIG_PADRAO);
    expect(CONFIG_PADRAO.dia.expediente).toEqual({ inicio: "09:00", fim: "18:00" });
    expect(CONFIG_PADRAO.dia.foco).toEqual({
      focoMin: 25,
      pausaMin: 5,
      pausaLongaMin: 15,
      ciclosAtePausaLonga: 4,
    });
    expect(CONFIG_PADRAO.atalhos.foco).toBe("Ctrl+Alt+P");
  });

  test("o fuso padrão é o do sistema; sem um que se reconheça, São Paulo", () => {
    expect(CONFIG_PADRAO.dia.fuso).toBe(fusoDoSistema());
    expect(fusoDoSistema(() => "Europe/Lisbon")).toBe("Europe/Lisbon");
    expect(fusoDoSistema(() => undefined)).toBe(FUSO_RESERVA);
    expect(fusoDoSistema(() => "Lua/Mar_da_Tranquilidade")).toBe(FUSO_RESERVA);
    expect(FUSO_RESERVA).toBe("America/Sao_Paulo");
  });

  test("fuso desconhecido, expediente ao contrário e ciclo fora da faixa são recusados", () => {
    expect(Fuso.safeParse("America/Manaus").success).toBe(true);
    expect(Fuso.safeParse("Brasil").success).toBe(false);
    expect(Expediente.safeParse({ inicio: "18:00", fim: "09:00" }).success).toBe(false);
    expect(Expediente.safeParse({ inicio: "09:00", fim: "09:00" }).success).toBe(false);
    const dia = CONFIG_PADRAO.dia;
    expect(ConfigDia.safeParse({ ...dia, foco: { ...dia.foco, focoMin: 0 } }).success).toBe(false);
    expect(ConfigDia.safeParse({ ...dia, foco: { ...dia.foco, ciclosAtePausaLonga: 2.5 } }).success).toBe(
      false,
    );
  });

  test("atalho do foco é obrigatório na configuração inteira", () => {
    const { foco: _foco, ...antigos } = CONFIG_PADRAO.atalhos;
    expect(Config.safeParse({ ...CONFIG_PADRAO, atalhos: antigos }).success).toBe(false);
  });

  test("o Início nasce com os seis blocos na ordem do quadro e nenhum escondido", () => {
    expect(CONFIG_PADRAO.inicio).toEqual({
      ordem: ["briefing", "tarefas", "foco", "financas", "dev", "sessoes"],
      escondidos: [],
    });
  });

  test("bloco repetido ou desconhecido no Início é recusado", () => {
    expect(ConfigInicio.safeParse({ ordem: ["foco", "dev"], escondidos: ["dev"] }).success).toBe(true);
    expect(ConfigInicio.safeParse({ ordem: ["foco", "foco"], escondidos: [] }).success).toBe(false);
    expect(ConfigInicio.safeParse({ ordem: ["foco"], escondidos: ["dev", "dev"] }).success).toBe(false);
    expect(ConfigInicio.safeParse({ ordem: ["clima"], escondidos: [] }).success).toBe(false);
  });

  test("o modo privacidade nasce desligado e é estado deste PC", () => {
    expect(CONFIG_PADRAO.privacidade).toEqual({ ativo: false });
    expect(Privacidade.safeParse({ ativo: true }).success).toBe(true);
    expect(Privacidade.safeParse({ ativo: "sim" }).success).toBe(false);
    expect(MudancaConfig.parse({ privacidade: { ativo: true } })).toEqual({ privacidade: { ativo: true } });
    expect(CHAVES_DESTE_PC).toEqual(["privacidade"]);
  });

  test("o modo privacidade tem atalho Ctrl+Alt+H, obrigatório na configuração e que pode ficar vazio", () => {
    expect(CONFIG_PADRAO.atalhos.privacidade).toBe("Ctrl+Alt+H");
    const { privacidade: _privacidade, ...antigos } = CONFIG_PADRAO.atalhos;
    expect(Config.safeParse({ ...CONFIG_PADRAO, atalhos: antigos }).success).toBe(false);
    const semAtalho = { ...CONFIG_PADRAO.atalhos, privacidade: "" };
    expect(Config.safeParse({ ...CONFIG_PADRAO, atalhos: semAtalho }).success).toBe(true);
  });

  test("o foco pode ficar sem atalho (vazio); os outros, não", () => {
    const atalhos = CONFIG_PADRAO.atalhos;
    expect(Config.safeParse({ ...CONFIG_PADRAO, atalhos: { ...atalhos, foco: "" } }).success).toBe(true);
    expect(Config.safeParse({ ...CONFIG_PADRAO, atalhos: { ...atalhos, sistema: "" } }).success).toBe(false);
  });
});
