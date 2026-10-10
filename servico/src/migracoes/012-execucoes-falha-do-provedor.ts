import type { Migracao } from "../banco/migracoes.ts";

/**
 * Por que a execução falhou, quando foi o provedor (o mesmo classificador que põe o agente para
 * dormir, F2-16): a conversa e o histórico dizem a falha do jeito da janela ("O Claude Code estava
 * sem login."), não com o texto cru do provedor. Erro de outra causa (ferramenta, prazo, cancelado)
 * fica vazio e mostra o erro real. Só existe em execução com erro.
 */
export const m012: Migracao = {
  versao: 12,
  nome: "execucoes-falha-do-provedor",
  sql: `ALTER TABLE execucoes ADD COLUMN falha_do_provedor TEXT
    CHECK (falha_do_provedor IS NULL OR falha_do_provedor IN ('limite', 'fora_do_ar', 'credencial', 'ausente'))
    CHECK (falha_do_provedor IS NULL OR estado = 'erro');`,
};
