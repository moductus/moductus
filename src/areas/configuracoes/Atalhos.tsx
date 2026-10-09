import type { Atalhos } from "@moductus/contrato";
import { CampoAtalho } from "../../componentes/CampoAtalho.tsx";
import { Aviso, Carregando, Grupo, Opcao } from "./Partes.tsx";
import { Secao } from "./Secao.tsx";
import { useConfig } from "./useConfig.ts";

const ACOES: readonly { acao: keyof Atalhos; nome: string; descricao: string }[] = [
  { acao: "sistema", nome: "Abrir o Sistema", descricao: "Abre e esconde esta janela de qualquer lugar." },
  {
    acao: "dock",
    nome: "Mostrar o dock",
    descricao: "Mostra o dock, passa o foco para ele e esconde de novo.",
  },
  { acao: "captura", nome: "Captura rápida", descricao: "Abre a barra para anotar uma tarefa ou ideia." },
];

/**
 * Atalhos globais: o campo grava a combinação e manda ao serviço, que pede à casca. Se o
 * Windows recusar, o motivo aparece e o atalho anterior continua valendo.
 */
export function SecaoAtalhos() {
  const { estado, conectado, erro, definir } = useConfig();
  if (!estado) {
    return (
      <Secao titulo="Atalhos">
        <Carregando />
      </Secao>
    );
  }
  const { atalhos } = estado.config;
  return (
    <Secao titulo="Atalhos">
      <Grupo titulo="Atalhos globais">
        {ACOES.map(({ acao, nome, descricao }) => {
          const falha = estado.falhasAtalhos[acao];
          return (
            <div key={acao} className="config-atalho">
              <Opcao titulo={nome} descricao={descricao}>
                <CampoAtalho
                  rotulo={nome}
                  valor={atalhos[acao]}
                  desativado={!conectado}
                  aoCapturar={(combinacao) => void definir({ atalhos: { ...atalhos, [acao]: combinacao } })}
                />
              </Opcao>
              {falha && <Aviso>{falha}</Aviso>}
            </div>
          );
        })}
      </Grupo>
      {erro && <Aviso>{`${erro.replace(/\.$/, "")}. O atalho anterior continua valendo.`}</Aviso>}
    </Secao>
  );
}
