import type { Migracao } from "../banco/migracoes.ts";

/**
 * `execucoes.cobranca` (DATA.md §6, F2-09): como o uso daquela execução é pago, gravado com ela.
 * `assinatura` é o CLI com a conta do usuário, sem custo por token: o custo fica vazio e a
 * interface diz "assinatura". `por_token` é API: o custo é a estimativa da tabela de preços, vazio
 * quando o modelo não está nela. Gravado, e não deduzido do provedor na leitura, porque o provedor
 * vai para a lixeira e some em 30 dias, e o histórico continua. Execução anterior a esta migração
 * e execução sem provedor (agente sem modelo) ficam vazias.
 */
export const m009: Migracao = {
  versao: 9,
  nome: "execucoes-cobranca",
  sql: `ALTER TABLE execucoes ADD COLUMN cobranca TEXT
    CHECK (cobranca IS NULL OR cobranca IN ('assinatura', 'por_token'))
    CHECK (cobranca IS NOT 'assinatura' OR custo_estimado_microdolares IS NULL);`,
};
