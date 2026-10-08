import { EstadoVazio, Pagina } from "../Pagina.tsx";

export function Tarefas() {
  return (
    <Pagina titulo="Tarefas">
      <EstadoVazio
        agentes={["alba"]}
        titulo="0 tarefas"
        texto="A Alba transforma frase solta em tarefa com data, prioridade e lembrete: “ligar pro banco amanhã 15h”."
        quando="Fase 3"
      />
    </Pagina>
  );
}
