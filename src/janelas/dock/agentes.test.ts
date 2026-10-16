import { describe, expect, it } from "vitest";
import { lerSituacao } from "../../componentes/personagem/situacao.ts";
import { pontoDoAgente, rotuloDoAgente } from "./agentes.ts";

const ATIVO = {
  estado: "ativo",
  atividade: "ocioso",
  motivoSono: null,
  dormeAte: null,
  pausadoAte: null,
  fila: 0,
} as const;

describe("cabeça do dock", () => {
  it("o rótulo junta status, dica, sessões esperando e avisos", () => {
    const ocioso = lerSituacao(ATIVO);
    expect(rotuloDoAgente("Nuno", ocioso, 0, 0)).toBe("Nuno, ocioso");
    expect(rotuloDoAgente("Nuno", ocioso, 2, 1)).toBe(
      "Nuno, ocioso. 1 sessão esperando você. 2 avisos novos",
    );
    const teto = lerSituacao({ ...ATIVO, estado: "dormindo", motivoSono: "teto" });
    expect(rotuloDoAgente("Nuno", teto, 0, 3)).toBe(
      "Nuno, parado. Chegou ao teto de hoje. 3 sessões esperando você",
    );
  });

  it("o ponto: vermelho no erro ganha; amarelo no teto, em sessão esperando ou aviso", () => {
    const erro = lerSituacao({ ...ATIVO, estado: "dormindo", motivoSono: "fora_do_ar" });
    expect(pontoDoAgente(erro, 3, 1)).toBe("perigo");
    expect(pontoDoAgente(lerSituacao({ ...ATIVO, atividade: "erro" }), 0, 0)).toBe("perigo");
    expect(pontoDoAgente(lerSituacao({ ...ATIVO, estado: "dormindo", motivoSono: "teto" }), 0, 0)).toBe(
      "aviso",
    );
    expect(pontoDoAgente(lerSituacao(ATIVO), 0, 1)).toBe("aviso");
    expect(pontoDoAgente(lerSituacao(ATIVO), 1, 0)).toBe("aviso");
    expect(
      pontoDoAgente(lerSituacao({ ...ATIVO, estado: "dormindo", motivoSono: "limite" }), 0, 0),
    ).toBeNull();
    expect(pontoDoAgente(lerSituacao({ ...ATIVO, estado: "pausado" }), 0, 0)).toBeNull();
  });
});
