import { EstadoVazio, Pagina } from "../Pagina.tsx";

export function Arquivos() {
  return (
    <Pagina titulo="Arquivos">
      <EstadoVazio
        agentes={["faina"]}
        titulo="Caixa de entrada vazia"
        texto="A Faina resume, classifica e extrai o texto do que você soltar aqui, ou manda para Finanças."
        quando="Fase 5"
      />
    </Pagina>
  );
}
