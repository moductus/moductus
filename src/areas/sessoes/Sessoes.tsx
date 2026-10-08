import { EstadoVazio, Pagina } from "../Pagina.tsx";

export function Sessoes() {
  return (
    <Pagina titulo="Sessões de IA">
      <EstadoVazio
        agentes={["nuno"]}
        titulo="Nenhuma sessão de IA acompanhada"
        texto="O Nuno mostra cada sessão do Claude Code, Codex e Antigravity: projeto, estado, pedidos pendentes e consumo."
        quando="Fase 2"
      />
    </Pagina>
  );
}
