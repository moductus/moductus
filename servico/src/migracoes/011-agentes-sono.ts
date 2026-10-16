import type { Migracao } from "../banco/migracoes.ts";

/**
 * Por que o agente dorme e até quando está pausado (DATA.md §6, F2-16), guardados com o estado
 * para valer depois de reiniciar: o dock mostra o motivo (o teto pede uma decisão sua, o limite só
 * espera) e o serviço sabe quando acordar ou retomar. Cada um só existe no estado dele, como o
 * `dorme_ate`. "Sem modelo" não é guardado: vem da configuração (agente sem `provedor_id`).
 */
export const m011: Migracao = {
  versao: 11,
  nome: "agentes-sono",
  sql: `ALTER TABLE agentes ADD COLUMN motivo_sono TEXT
    CHECK (motivo_sono IS NULL OR motivo_sono IN ('limite', 'fora_do_ar', 'credencial', 'ausente', 'teto'))
    CHECK (motivo_sono IS NULL OR estado = 'dormindo');
  ALTER TABLE agentes ADD COLUMN pausado_ate TEXT CHECK (pausado_ate IS NULL OR estado = 'pausado');`,
};
