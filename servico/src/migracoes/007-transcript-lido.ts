import type { Migracao } from "../banco/migracoes.ts";

/**
 * Leitura incremental do transcript das sessões de IA (DATA.md §5 sessoes_ia, F2-24): até onde o
 * arquivo já foi lido e quando o aviso de contexto alto saiu no trecho atual da sessão (vazio:
 * ainda não avisou desde a última compactação). Sem isso, um reinício do serviço leria o arquivo
 * de novo e repetiria o aviso. O byte lido é posição num arquivo deste PC e não vai para outro
 * (outro-pc/tabelas.ts).
 */
export const m007: Migracao = {
  versao: 7,
  nome: "transcript-lido",
  sql: `
    ALTER TABLE sessoes_ia ADD COLUMN transcript_lido_bytes INTEGER
      CHECK (transcript_lido_bytes IS NULL OR transcript_lido_bytes >= 0);
    ALTER TABLE sessoes_ia ADD COLUMN contexto_avisado_em TEXT;
  `,
};
