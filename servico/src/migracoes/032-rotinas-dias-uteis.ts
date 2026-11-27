import type { Migracao } from "../banco/migracoes.ts";

/**
 * Os dias de trabalho nascem de segunda a sexta, como em Configurações › O dia (ConfigDia.dc.html);
 * a 014 semeou as duas rotinas com os sete dias. Muda só quem nunca salvou: as duas rotinas ainda
 * com os sete dias e sem nenhuma gravação desde a semente (`atualizado_em` igual ao `criado_em`).
 * Quem já mexeu em O dia, ou recebeu a configuração de outro PC, fica como está.
 */
export const m032: Migracao = {
  versao: 32,
  nome: "rotinas-dias-uteis",
  sql: `
  UPDATE rotinas SET dias_semana = '[1,2,3,4,5]'
    WHERE NOT EXISTS (
      SELECT 1 FROM rotinas
        WHERE dias_semana <> '[1,2,3,4,5,6,7]' OR atualizado_em <> criado_em OR apagado_em IS NOT NULL
    );`,
};
