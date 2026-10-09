import { EstadoVazio } from "../Pagina.tsx";
import { Secao } from "./Secao.tsx";

/** Agentes: só a estrutura por enquanto; as opções entram aqui. */
export function SecaoAgentes() {
  return (
    <Secao titulo="Agentes">
      <EstadoVazio
        nivel={3}
        titulo="Os 4 agentes de fábrica"
        texto="Renomear, ajustar instruções, ferramentas e gatilhos, ou desligar a Alba, a Tula, a Faina e o Nuno."
        quando="Fase 2"
      />
    </Secao>
  );
}
