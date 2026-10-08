import { EstadoVazio } from "../Pagina.tsx";
import { Secao } from "./Secao.tsx";

/** Tema e dock: só a estrutura por enquanto; as opções entram aqui. */
export function SecaoTemaDock() {
  return (
    <Secao titulo="Tema e dock">
      <EstadoVazio
        nivel={3}
        titulo="Tema e forma do dock"
        texto="Grafite, Papel, Vidro ou automático pelo Windows; lado, modo e forma do dock, aplicados na hora."
        quando="Fase 1"
      />
    </Secao>
  );
}
