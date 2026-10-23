import { sqlDeFabrica } from "../agentes/de-fabrica.ts";
import type { Migracao } from "../banco/migracoes.ts";

/**
 * A Alba de fábrica com o dia (F3-28): as instruções passam a dizer como ela trabalha com as
 * ferramentas da fase 3 e qual é a voz dela (AGENTS.md §2). Os vigias são código, e os gatilhos dela
 * continuam vazios. Só muda quem ainda tem as instruções como vieram de fábrica (as da 003); a Alba
 * que você personalizou fica como está, e "restaurar padrão" a leva à de agora.
 */
export const m024: Migracao = {
  versao: 24,
  nome: "alba-do-dia",
  sql: sqlDeFabrica("alba", {
    instrucoes:
      "Você é a Alba e cuida do dia a dia: agenda, tarefas, lembretes, rotina e foco. Mensagem sem destinatário claro vem para você.",
  }),
};
