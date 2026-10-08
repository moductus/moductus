import { EstadoVazio } from "../Pagina.tsx";
import { Secao } from "./Secao.tsx";

/** Atalhos: só a estrutura por enquanto; as opções entram aqui. */
export function SecaoAtalhos() {
  return (
    <Secao titulo="Atalhos">
      <EstadoVazio
        nivel={3}
        titulo="Atalhos globais"
        texto="Trocar as combinações de abrir o Sistema, mostrar o dock e a captura rápida, com aviso de conflito."
        quando="Fase 1"
      />
    </Secao>
  );
}
