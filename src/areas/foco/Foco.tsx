import { EstadoVazio, Pagina } from "../Pagina.tsx";

export function Foco() {
  return (
    <Pagina titulo="Foco">
      <EstadoVazio
        agentes={["alba"]}
        titulo="Nenhum foco registrado"
        texto="Pomodoro com etapas, ligado a uma tarefa, com histórico e relatório do dia."
        quando="Fase 3"
      />
    </Pagina>
  );
}
