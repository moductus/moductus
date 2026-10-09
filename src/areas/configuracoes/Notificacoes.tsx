import { EstadoVazio } from "../Pagina.tsx";
import { Secao } from "./Secao.tsx";

/** Notificações: só a estrutura por enquanto; as opções entram aqui. */
export function SecaoNotificacoes() {
  return (
    <Secao titulo="Notificações">
      <EstadoVazio
        nivel={3}
        titulo="Avisos por agente"
        texto="Escolher quais avisos de cada agente chegam ao dock e ao Windows, e o horário de silêncio."
        quando="Fase 2"
      />
    </Secao>
  );
}
