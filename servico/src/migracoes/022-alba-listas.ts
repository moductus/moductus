import { sqlDeFabrica } from "../agentes/de-fabrica.ts";
import type { Migracao } from "../banco/migracoes.ts";

/**
 * A Alba de fábrica passa a ver as listas de tarefas (F3-26): `listas.listar`, para pôr a tarefa na
 * lista certa. Só muda quem ainda tem a lista de ferramentas como veio de fábrica (a da 003); a
 * Alba que você personalizou fica como está, e "restaurar padrão" a leva à de agora.
 */
export const m022: Migracao = {
  versao: 22,
  nome: "alba-listas",
  sql: sqlDeFabrica("alba", {
    ferramentas: ["agenda.*", "tarefas.*", "lembretes.*", "foco.*", "notas.*", "memoria.*"],
  }),
};
