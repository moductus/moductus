import { EstadoVazio, Pagina } from "../Pagina.tsx";

export function Ferramentas() {
  return (
    <Pagina titulo="Ferramentas">
      <EstadoVazio
        icone="ferramentas"
        titulo="Nenhuma ferramenta ainda"
        texto="Os 4 utilitários do v0 mudam para cá: Freeze com OCR, Portas, Links e Kill."
        quando="Depois da fase 1"
      />
    </Pagina>
  );
}
