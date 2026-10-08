import { EstadoVazio } from "../Pagina.tsx";
import { Secao } from "./Secao.tsx";

/** Conexões: só a estrutura por enquanto; as opções entram aqui. */
export function SecaoConexoes() {
  return (
    <Secao titulo="Conexões">
      <EstadoVazio
        nivel={3}
        titulo="Nenhuma conexão ligada"
        texto="Google Agenda, GitHub, pastas autorizadas e hooks das sessões de IA, todas opcionais."
        quando="Fase 2"
      />
    </Secao>
  );
}
