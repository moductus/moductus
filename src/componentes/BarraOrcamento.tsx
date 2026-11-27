import type { LinhaOrcamento, SituacaoOrcamento } from "@moductus/contrato";
import { Progresso, type TomProgresso } from "./Progresso.tsx";
import { Valor } from "./Valor.tsx";
import "./BarraOrcamento.css";

const TOM: Record<SituacaoOrcamento, TomProgresso> = { ok: "sucesso", alerta: "aviso", estourado: "perigo" };

/** A situação em palavras, para não depender da cor da barra; dentro do previsto não precisa. */
const SITUACAO: Record<SituacaoOrcamento, string | null> = {
  ok: null,
  alerta: "perto do limite",
  estourado: "passou do limite",
};

interface PropsBarraOrcamento {
  /** A categoria ("Casa › Mercado"). */
  nome: string;
  /** A linha do mês como o serviço calcula (ADR-0046): a tela não refaz a conta. */
  linha: Pick<LinhaOrcamento, "gastoCentavos" | "limiteCentavos" | "percentual" | "situacao">;
  moeda?: string;
}

/**
 * Uma categoria contra o limite do mês (AreaFinancas): o nome, "R$ 512 de R$ 600", o percentual
 * em texto e a barra no tom da situação. Passou do limite, a barra fica cheia e o percentual
 * segue contando.
 */
export function BarraOrcamento({ nome, linha, moeda }: PropsBarraOrcamento) {
  const situacao = SITUACAO[linha.situacao];
  const percentual = `${linha.percentual}%`;
  const texto = situacao ? `${percentual}, ${situacao}` : percentual;
  return (
    <div className="barra-orcamento" data-situacao={linha.situacao}>
      <div className="barra-orcamento-cabeca">
        <span className="barra-orcamento-nome">{nome}</span>
        <span className="barra-orcamento-numeros">
          <Valor centavos={linha.gastoCentavos} moeda={moeda} semCentavos />
          <span>de</span>
          <Valor centavos={linha.limiteCentavos} moeda={moeda} semCentavos />
          <span aria-hidden="true">·</span>
          <span className="barra-orcamento-percentual">{texto}</span>
        </span>
      </div>
      <Progresso
        rotulo={`Orçamento de ${nome}`}
        valor={Math.min(linha.percentual, 100)}
        textoValor={texto}
        tom={TOM[linha.situacao]}
      />
    </div>
  );
}
