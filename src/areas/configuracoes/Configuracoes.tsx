import { ListaNavegacao } from "../ListaNavegacao.tsx";
import { Pagina } from "../Pagina.tsx";
import { eIdSecao, SECAO_INICIAL, SECOES, type IdSecao } from "./secoes.ts";
import "./Configuracoes.css";

interface PropsConfiguracoes {
  /** Seção pedida ("modelos"); desconhecida ou ausente abre a Geral. */
  secao?: string;
  aoEscolherSecao: (secao: IdSecao) => void;
}

/** Configurações: sub-navegação de 220 com as 9 seções e a seção escolhida ao lado. */
export function Configuracoes({ secao, aoEscolherSecao }: PropsConfiguracoes) {
  const ativa: IdSecao = eIdSecao(secao) ? secao : SECAO_INICIAL;
  const { Componente } = SECOES.find((s) => s.id === ativa)!;
  return (
    <Pagina titulo="Configurações">
      <div className="config">
        <ListaNavegacao
          rotulo="Seções"
          className="config-navegacao"
          itens={SECOES}
          ativo={ativa}
          aoEscolher={aoEscolherSecao}
        />
        <div className="config-conteudo">
          <Componente />
        </div>
      </div>
    </Pagina>
  );
}
