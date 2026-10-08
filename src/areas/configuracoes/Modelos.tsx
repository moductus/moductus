import { EstadoVazio } from "../Pagina.tsx";
import { Secao } from "./Secao.tsx";

/** Modelos: só a estrutura por enquanto; as opções entram aqui. */
export function SecaoModelos() {
  return (
    <Secao titulo="Modelos">
      <EstadoVazio
        nivel={3}
        titulo="Nenhum modelo conectado"
        texto="Escolher o provedor e o modelo de cada agente, com reserva e teto de gasto por dia."
        quando="Fase 2"
      />
    </Secao>
  );
}
