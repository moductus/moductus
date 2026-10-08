import { EstadoVazio } from "../Pagina.tsx";
import { Secao } from "./Secao.tsx";

/** Levar para outro PC: só a estrutura por enquanto; as opções entram aqui. */
export function SecaoOutroPc() {
  return (
    <Secao titulo="Levar para outro PC">
      <EstadoVazio
        nivel={3}
        titulo="Exportar e importar"
        texto="Gerar um arquivo com as configurações, com ou sem os dados, e abrir no outro PC."
        quando="Fase 1"
      />
    </Secao>
  );
}
