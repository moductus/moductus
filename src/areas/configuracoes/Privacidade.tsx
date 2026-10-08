import { EstadoVazio } from "../Pagina.tsx";
import { Secao } from "./Secao.tsx";

/** Privacidade: só a estrutura por enquanto; as opções entram aqui. */
export function SecaoPrivacidade() {
  return (
    <Secao titulo="Privacidade">
      <EstadoVazio
        nivel={3}
        titulo="O que sai do seu PC"
        texto="Ver o que cada agente manda para o modelo e ligar o modo privacidade, que mascara valores na tela."
        quando="Fase 2"
      />
    </Secao>
  );
}
