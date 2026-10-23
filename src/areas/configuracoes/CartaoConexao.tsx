import { useId, type ReactNode } from "react";
import type { Agente } from "../../componentes/personagem/agentes.ts";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { Selo, type TomSelo } from "../../componentes/Selo.tsx";
import { comArtigo } from "../agentes/nomes.ts";

interface PropsCartao {
  nome: string;
  /** De quem é a conexão: a cabeça e o "para o Nuno". */
  agente?: Agente;
  /** O selo do estado: o texto diz, a cor acompanha. */
  estado: { texto: string; tom: TomSelo } | null;
  descricao: ReactNode;
  acoes?: ReactNode;
  emBreve?: boolean;
  /** A borda mais forte do cartão aberto (ConfigConexoesGoogle.dc.html). */
  destacado?: boolean;
  children?: ReactNode;
}

/**
 * Um cartão de conexão (ConfigConexoes*.dc.html): a cabeça de quem usa, o nome, para quem é, o
 * estado e as ações à direita; o corpo, quando há, abaixo de uma linha.
 */
export function CartaoConexao({
  nome,
  agente = "nuno",
  estado,
  descricao,
  acoes,
  emBreve,
  destacado,
  children,
}: PropsCartao) {
  const idNome = useId();
  return (
    <section className="config-conexao" data-destacado={destacado || undefined} aria-labelledby={idNome}>
      <div className="config-conexao-topo">
        <Personagem agente={agente} modo="cabeca" tamanho="dock" estado="ocioso" />
        <span className="config-conexao-textos">
          <span className="config-conexao-linha">
            <h3 id={idNome} className="config-conexao-nome">
              {nome}
            </h3>
            <span className="config-conexao-quem">para {comArtigo(agente)}</span>
            {estado && (
              <Selo forma="ponto" tom={estado.tom}>
                {estado.texto}
              </Selo>
            )}
            {emBreve && <Selo>em breve</Selo>}
          </span>
          <span className="config-conexao-descricao">{descricao}</span>
        </span>
        {acoes && <span className="config-conexao-acoes">{acoes}</span>}
      </div>
      {children && <div className="config-conexao-corpo">{children}</div>}
    </section>
  );
}

/** Uma coluna do resumo de uma conexão ligada: rótulo pequeno e o valor. */
export function Dado({ rotulo, children, mono }: { rotulo: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="config-conexao-dado">
      <dt>{rotulo}</dt>
      <dd data-mono={mono || undefined} title={typeof children === "string" ? children : undefined}>
        {children}
      </dd>
    </div>
  );
}
