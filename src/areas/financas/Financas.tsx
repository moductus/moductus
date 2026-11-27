import { EstadoVazio, Pagina } from "../Pagina.tsx";
import { AlvoDeArquivo } from "./AlvoDeArquivo.tsx";

/**
 * Finanças no Sistema. Enquanto as telas do dinheiro não chegam, o vazio e o alvo de soltar: um
 * extrato ou comprovante solto na janela, ou escolhido no diálogo, vira a autorização de uso único.
 */
export function Financas() {
  return (
    <Pagina titulo="Finanças">
      <EstadoVazio
        agentes={["tula"]}
        titulo="0 lançamentos"
        texto="A Tula lança gastos por texto ou comprovante, importa extrato OFX e CSV e acompanha orçamento, dívidas e planos."
        quando="Fase 4"
      />
      <AlvoDeArquivo />
    </Pagina>
  );
}
