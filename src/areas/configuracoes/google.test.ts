import type { Calendario, Conexao } from "@moductus/contrato";
import { describe, expect, it } from "vitest";
import {
  avisoDeAprovacao,
  calendariosLidos,
  esperandoNaFila,
  filaGoogle,
  leituraGoogle,
  prazoRestante,
  resumoConectado,
  sobreCalendario,
} from "./google.ts";

const calendario = (nome: string, mudar: Partial<Calendario> = {}): Calendario => ({
  id: `01K7${nome.toUpperCase().padEnd(22, "0").slice(0, 22)}`,
  nome,
  fonte: "google",
  cor: null,
  espelho: false,
  podeEscrever: true,
  ler: false,
  sincronizadoEm: null,
  ...mudar,
});

const MODUCTUS = calendario("Moductus", { espelho: true, ler: true });
const PESSOAL = calendario("Pessoal", { ler: true });
const TRABALHO = calendario("Trabalho", { ler: true, podeEscrever: false });
const FERIADOS = calendario("Feriados no Brasil", { podeEscrever: false });

const conectada: Conexao = {
  tipo: "google-agenda",
  estado: "ligada",
  conta: "voce@gmail.com",
  ultimoErro: null,
  conectadaEm: "2026-10-18T14:31:00.000Z",
};

describe("o cartão do Google Agenda", () => {
  it("lê os marcados, fora o Moductus, que a Alba escreve", () => {
    expect(calendariosLidos([MODUCTUS, PESSOAL, TRABALHO, FERIADOS])).toEqual([PESSOAL, TRABALHO]);
  });

  it("resume a conta, quantos lê e se escreve no Moductus", () => {
    expect(resumoConectado(conectada, [MODUCTUS, PESSOAL, TRABALHO, FERIADOS])).toBe(
      'voce@gmail.com · lê 2 calendários e escreve no "Moductus".',
    );
    expect(resumoConectado({ ...conectada, conta: null }, [PESSOAL])).toBe(
      "Conta do Google · lê 1 calendário.",
    );
  });

  it("diz quando leu e de quanto em quanto tempo", () => {
    const agora = new Date("2026-10-18T14:34:00.000Z");
    expect(leituraGoogle("2026-10-18T14:31:00.000Z", agora)).toBe("há 3 min · a cada 10 min");
    expect(leituraGoogle(null, agora)).toBe("ainda não lido · a cada 10 min");
  });

  it("conta a fila para o Moductus", () => {
    expect(filaGoogle(0)).toBe("vazia");
    expect(filaGoogle(1)).toBe("1 item");
    expect(filaGoogle(3)).toBe("3 itens");
    expect(esperandoNaFila(0)).toBeNull();
    expect(esperandoNaFila(1)).toBe('1 item espera na fila para o "Moductus".');
    expect(esperandoNaFila(3)).toBe('3 itens esperam na fila para o "Moductus".');
  });

  it("o prazo da autorização em minutos e segundos, sem passar de zero", () => {
    const agora = new Date("2026-10-18T14:00:00.000Z");
    expect(prazoRestante("2026-10-18T14:04:12.000Z", agora)).toBe("4:12");
    expect(prazoRestante("2026-10-18T14:00:05.400Z", agora)).toBe("0:06");
    expect(prazoRestante("2026-10-18T13:59:00.000Z", agora)).toBe("0:00");
  });

  it("diz o que cada calendário é", () => {
    expect(sobreCalendario(MODUCTUS)).toBe("do Moductus · a Alba escreve aqui sem pedir");
    expect(sobreCalendario(PESSOAL)).toBe("você pode editar");
    expect(sobreCalendario(FERIADOS)).toBe("só leitura");
  });

  it("a aprovação vale para os que a Alba lê, pelo nome; sem nenhum, para os outros", () => {
    expect(avisoDeAprovacao([MODUCTUS, PESSOAL, TRABALHO])).toBe(
      "Criar ou mudar evento em Pessoal ou Trabalho sempre pede sua aprovação antes.",
    );
    expect(avisoDeAprovacao([MODUCTUS, PESSOAL, TRABALHO, { ...FERIADOS, ler: true }])).toBe(
      "Criar ou mudar evento em Pessoal, Trabalho ou Feriados no Brasil sempre pede sua aprovação antes.",
    );
    expect(avisoDeAprovacao([MODUCTUS])).toBe(
      "Criar ou mudar evento nos outros calendários sempre pede sua aprovação antes.",
    );
  });
});
