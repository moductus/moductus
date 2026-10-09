import type { ReactNode } from "react";
import { Icone } from "../../componentes/Icone.tsx";

interface PropsOpcao {
  titulo: string;
  descricao?: ReactNode;
  /** O controle, com o próprio nome acessível (aria-label ou rótulo do grupo). */
  children: ReactNode;
}

/** Uma opção: título e descrição à esquerda, o controle à direita. */
export function Opcao({ titulo, descricao, children }: PropsOpcao) {
  return (
    <div className="config-opcao">
      <div className="config-opcao-textos">
        <span className="config-opcao-titulo">{titulo}</span>
        {descricao != null && <span className="config-opcao-descricao">{descricao}</span>}
      </div>
      <div className="config-opcao-controle">{children}</div>
    </div>
  );
}

/** Grupo de opções com título (h3), dentro da seção. */
export function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="config-grupo" aria-label={titulo}>
      <h3 className="config-grupo-titulo">{titulo}</h3>
      {children}
    </section>
  );
}

/** Recusa do serviço ou da casca, com o motivo como veio. O leitor de tela anuncia. */
export function Aviso({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="config-aviso">
      <Icone nome="alerta" tamanho={16} />
      <span>{children}</span>
    </p>
  );
}

/** Antes do serviço responder: uma linha, nunca a seção em branco. */
export function Carregando() {
  return <p className="config-carregando">Lendo a configuração no serviço do Moductus…</p>;
}
