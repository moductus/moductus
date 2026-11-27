import { Icone } from "../../componentes/Icone.tsx";
import { AlvoDeArquivo } from "../../areas/financas/AlvoDeArquivo.tsx";
import { DADOS_AREAS } from "../areas.ts";
import { CabecalhoPainel } from "./Cabecalho.tsx";

/**
 * O painel Finanças (PainelFinancas.dc.html). Por enquanto, o vazio e o alvo de soltar: o extrato
 * ou comprovante solto aqui, ou escolhido no diálogo, vira a autorização de uso único (ADR-0044).
 * Cada abertura do painel começa limpa: o arquivo recebido da vez anterior não fica na tela.
 */
export function PainelFinancas({ abertura }: { abertura: number }) {
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
        <AlvoDeArquivo key={abertura} compacto />
      </div>
    </>
  );
}
