import { EstadoVazio, Pagina } from "../Pagina.tsx";

export function Dev() {
  return (
    <Pagina titulo="Dev">
      <EstadoVazio
        agentes={["nuno"]}
        titulo="Nenhum repositório conectado"
        texto="O Nuno junta os PRs que esperam seu review, os seus com review a atender, issues e CI quebrado, por repositório."
        quando="Fase 2"
      />
    </Pagina>
  );
}
