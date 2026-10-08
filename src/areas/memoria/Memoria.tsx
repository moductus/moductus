import { EstadoVazio, Pagina } from "../Pagina.tsx";

export function Memoria() {
  return (
    <Pagina titulo="Memória">
      <EstadoVazio
        icone="memoria"
        titulo="Nada guardado ainda"
        texto="Fatos, decisões, pessoas e referências que os agentes guardam ou você pede para guardar, com busca e edição."
        quando="Fase 5"
      />
    </Pagina>
  );
}
