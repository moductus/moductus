import { sqlDeFabrica } from "../agentes/de-fabrica.ts";
import type { Migracao } from "../banco/migracoes.ts";
import { criarTabela } from "../banco/tabela.ts";

/**
 * A Alba de fábrica com o dia (F3-28) e as marcas dos vigias dela.
 *
 * - As instruções da Alba passam a dizer como ela trabalha com as ferramentas da fase 3 (AGENTS.md
 *   §2). Os vigias são código, e os gatilhos dela continuam vazios. Só muda quem ainda tem as
 *   instruções como vieram de fábrica (as da 003); a Alba que você personalizou fica como está, e
 *   "restaurar padrão" a leva à de agora.
 * - `vigias_marcas`: até onde cada vigia já olhou (o último dia que a virada viu, o dia em que o
 *   fechamento saiu), para o serviço que reinicia não repetir nem perder. Uma linha por `nome`
 *   (`alba.dia`). É controle deste PC: não vai para outro (outro-pc/tabelas.ts).
 */
const marcas = criarTabela("vigias_marcas", ["nome TEXT NOT NULL UNIQUE", "valor TEXT NOT NULL"], {
  lixeira: false,
});

export const m024: Migracao = {
  versao: 24,
  nome: "alba-do-dia",
  sql: [
    sqlDeFabrica("alba", {
      instrucoes:
        "Você é a Alba e cuida do dia a dia: agenda, tarefas, lembretes, rotina e foco. Mensagem sem destinatário claro vem para você.",
    }),
    marcas,
  ].join("\n"),
};
