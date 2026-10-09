import type { ConfigDock, Tema } from "@moductus/contrato";
import { Seletor, type OpcaoSeletor } from "../../componentes/Seletor.tsx";
import { Aviso, Carregando, Grupo, Opcao } from "./Partes.tsx";
import { Secao } from "./Secao.tsx";
import { useConfig } from "./useConfig.ts";

const TEMAS: readonly (OpcaoSeletor<Tema> & { descricao: string })[] = [
  {
    valor: "automatico",
    rotulo: "Automático",
    descricao: "Grafite no escuro, Papel no claro, seguindo o Windows.",
  },
  { valor: "grafite", rotulo: "Grafite", descricao: "Escuro e denso." },
  { valor: "papel", rotulo: "Papel", descricao: "Claro, papel e tinta." },
  { valor: "vidro", rotulo: "Vidro", descricao: "Translúcido, como o Windows 11." },
];

const LADOS: readonly OpcaoSeletor<ConfigDock["lado"]>[] = [
  { valor: "esquerda", rotulo: "Esquerda" },
  { valor: "direita", rotulo: "Direita" },
];

const MODOS: readonly (OpcaoSeletor<ConfigDock["modo"]> & { descricao: string })[] = [
  { valor: "fixo", rotulo: "Fixo", descricao: "Sempre visível; as janelas abrem ao lado dele." },
  { valor: "esconder", rotulo: "Esconder", descricao: "Some na borda e volta quando o mouse encosta nela." },
  {
    valor: "inteligente",
    rotulo: "Inteligente",
    descricao: "Fixo, e some sozinho quando um programa ocupa a tela.",
  },
];

const FORMAS: readonly OpcaoSeletor<ConfigDock["forma"]>[] = [
  { valor: "colada", rotulo: "Colado" },
  { valor: "flutuante", rotulo: "Flutuante" },
];

const descricaoDe = <T extends string>(lista: readonly { valor: T; descricao: string }[], valor: T) =>
  lista.find((o) => o.valor === valor)?.descricao;

const desativadas = <T extends string>(opcoes: readonly OpcaoSeletor<T>[], desativar: boolean) =>
  desativar ? opcoes.map((o) => ({ ...o, desativada: true })) : opcoes;

/**
 * Tema e dock: o tema vai pelo mesmo caminho do seletor da barra lateral; o dock o serviço
 * pede à casca, que reposiciona na hora. Recusa da casca aparece aqui, com o motivo.
 */
export function SecaoTemaDock() {
  const { estado, conectado, erro, definir } = useConfig();
  if (!estado) {
    return (
      <Secao titulo="Tema e dock">
        <Carregando />
      </Secao>
    );
  }
  const { tema, dock } = estado.config;
  const mudarDock = (parte: Partial<ConfigDock>) => void definir({ dock: { ...dock, ...parte } });
  return (
    <Secao titulo="Tema e dock">
      <Grupo titulo="Tema">
        <Opcao titulo="Atmosfera" descricao={descricaoDe(TEMAS, tema)}>
          <Seletor
            rotulo="Tema"
            opcoes={desativadas(TEMAS, !conectado)}
            valor={tema}
            aoMudar={(novo) => void definir({ tema: novo })}
          />
        </Opcao>
      </Grupo>
      <Grupo titulo="Dock">
        <Opcao titulo="Lado do dock">
          <Seletor
            rotulo="Lado do dock"
            opcoes={desativadas(LADOS, !conectado)}
            valor={dock.lado}
            aoMudar={(lado) => mudarDock({ lado })}
          />
        </Opcao>
        <Opcao titulo="Comportamento" descricao={descricaoDe(MODOS, dock.modo)}>
          <Seletor
            rotulo="Comportamento do dock"
            opcoes={desativadas(MODOS, !conectado)}
            valor={dock.modo}
            aoMudar={(modo) => mudarDock({ modo })}
          />
        </Opcao>
        <Opcao titulo="Forma">
          <Seletor
            rotulo="Forma do dock"
            opcoes={desativadas(FORMAS, !conectado)}
            valor={dock.forma}
            aoMudar={(forma) => mudarDock({ forma })}
          />
        </Opcao>
      </Grupo>
      {erro && <Aviso>{erro}</Aviso>}
    </Secao>
  );
}
