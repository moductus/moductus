import type { Migracao } from "../banco/migracoes.ts";
import { criarTabela } from "../banco/tabela.ts";

/**
 * As respostas de modelo cujo uso já entrou em `uso_ia` (DATA.md §5, F2-24), pela chave
 * `message.id` + `requestId` do transcript. Valem para o PC inteiro: uma sessão aberta com
 * `--fork-session` (ou um `--resume` que copia o histórico) traz as mesmas respostas em outro
 * arquivo, e elas não contam de novo. Linhas com mais de 90 dias são podadas pelo vigia das
 * sessões. É controle deste PC: não vai para outro (outro-pc/tabelas.ts).
 */
const respostasContadas = criarTabela("uso_ia_mensagens", ["chave TEXT NOT NULL UNIQUE"], {
  lixeira: false,
});

export const m008: Migracao = {
  versao: 8,
  nome: "uso-respostas-contadas",
  sql: `${respostasContadas}
    CREATE INDEX uso_ia_mensagens_criado_em ON uso_ia_mensagens (criado_em);`,
};
