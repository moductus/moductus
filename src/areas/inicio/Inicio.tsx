import type { ReactNode } from "react";
import { EstadoVazio, Pagina } from "../Pagina.tsx";

/** `antes`: o que vem acima dos blocos do dia (os Primeiros passos, enquanto pendentes). */
export function Inicio({ antes }: { antes?: ReactNode }) {
  return (
    <Pagina titulo="Início">
      {antes}
      <EstadoVazio
        agentes={["alba"]}
        titulo="O dia ainda não tem blocos"
        texto="Tarefas, foco, finanças, PRs e o briefing da Alba entram aqui como blocos que você escolhe."
        quando="Fase 3"
      />
    </Pagina>
  );
}
