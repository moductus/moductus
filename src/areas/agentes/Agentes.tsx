import { AGENTES } from "../../componentes/personagem/agentes.ts";
import { EstadoVazio, Pagina } from "../Pagina.tsx";

export function Agentes() {
  return (
    <Pagina titulo="Agentes">
      <EstadoVazio
        agentes={AGENTES}
        titulo="Os 4 agentes ainda não trabalham"
        texto="Conversar com o time ou com cada um, por @alba, @tula, @faina e @nuno, e ver o que cada um fez sozinho."
        quando="Fase 2"
      />
    </Pagina>
  );
}
