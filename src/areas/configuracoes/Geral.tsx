import { EstadoVazio } from "../Pagina.tsx";
import { Secao } from "./Secao.tsx";

/** Geral: só a estrutura por enquanto; as opções entram aqui. */
export function SecaoGeral() {
  return (
    <Secao titulo="Geral">
      <EstadoVazio
        nivel={3}
        titulo="Iniciar com o Windows e modo portable"
        texto="Ligar a inicialização junto com o Windows e ver se esta cópia roda como portable."
        quando="Fase 1"
      />
    </Secao>
  );
}
