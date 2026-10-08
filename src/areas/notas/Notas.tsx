import { EstadoVazio, Pagina } from "../Pagina.tsx";

export function Notas() {
  return (
    <Pagina titulo="Notas">
      <EstadoVazio
        agentes={["alba"]}
        titulo="0 notas"
        texto="Notas em Markdown que salvam sozinhas, com o bloco rápido fixo no topo."
        quando="Fase 3"
      />
    </Pagina>
  );
}
