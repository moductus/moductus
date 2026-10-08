import { EstadoVazio, Pagina } from "../Pagina.tsx";

export function Financas() {
  return (
    <Pagina titulo="Finanças">
      <EstadoVazio
        agentes={["tula"]}
        titulo="0 lançamentos"
        texto="A Tula lança gastos por texto ou comprovante, importa extrato OFX e CSV e acompanha orçamento, dívidas e planos."
        quando="Fase 4"
      />
    </Pagina>
  );
}
