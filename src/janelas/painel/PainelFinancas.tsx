import { Icone } from "../../componentes/Icone.tsx";
import { AlvoDeArquivo } from "../../areas/financas/AlvoDeArquivo.tsx";
import { DADOS_AREAS } from "../areas.ts";
import { CabecalhoPainel } from "./Cabecalho.tsx";

/**
 * O painel Finanças (PainelFinancas.dc.html). Por enquanto, o vazio e o alvo de soltar: o extrato
 * ou comprovante solto aqui, ou escolhido no diálogo, vira a autorização de uso único (ADR-0044).
 */
export function PainelFinancas() {
  const { nome, icone, vazio } = DADOS_AREAS.financas;
  return (
    <>
      <CabecalhoPainel titulo={nome} icone={icone} sistema="financas" />
      <div className="painel-corpo">
        <div className="painel-vazio">
          <span className="painel-vazio-icone">
            <Icone nome={icone} tamanho={24} />
          </span>
          <h2 className="painel-vazio-titulo">{vazio.titulo}</h2>
          <p className="painel-vazio-texto">{vazio.texto}</p>
        </div>
        <AlvoDeArquivo compacto />
      </div>
    </>
  );
}
