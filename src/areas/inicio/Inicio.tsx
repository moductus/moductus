import { EstadoVazio, Pagina } from "../Pagina.tsx";

export function Inicio() {
  return (
    <Pagina titulo="Início">
      <EstadoVazio
        agentes={["alba"]}
        titulo="O dia ainda não tem blocos"
        texto="Tarefas, foco, finanças, PRs e o briefing da Alba entram aqui como blocos que você escolhe."
        quando="Fase 3"
      />
    </Pagina>
  );
}
