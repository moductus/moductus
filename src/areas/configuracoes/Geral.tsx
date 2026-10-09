import { Interruptor } from "../../componentes/Interruptor.tsx";
import { Selo } from "../../componentes/Selo.tsx";
import { ReverTutorial } from "../inicio/PrimeirosPassos.tsx";
import { Aviso, Carregando, Grupo, Opcao } from "./Partes.tsx";
import { Secao } from "./Secao.tsx";
import { useConfig } from "./useConfig.ts";

/** Geral: iniciar com o Windows e, só para ler, se esta cópia roda como portable. */
export function SecaoGeral() {
  const { estado, conectado, erro, definir } = useConfig();
  if (!estado) {
    return (
      <Secao titulo="Geral">
        <Carregando />
        <ReverTutorial />
      </Secao>
    );
  }
  const { config, portable } = estado;
  return (
    <Secao titulo="Geral">
      <Grupo titulo="Inicialização">
        <Opcao
          titulo="Iniciar o Moductus junto com o Windows"
          descricao={
            portable
              ? "Indisponível no modo portable: esta cópia não se registra no Windows."
              : "O dock aparece logo depois do login, sem abrir o Sistema."
          }
        >
          <Interruptor
            aria-label="Iniciar o Moductus junto com o Windows"
            ligado={config.autostart}
            desativado={portable || !conectado}
            aoMudar={(ligado) => void definir({ autostart: ligado })}
          />
        </Opcao>
        {erro && <Aviso>{erro}</Aviso>}
      </Grupo>
      <Grupo titulo="Instalação">
        <Opcao
          titulo="Modo portable"
          descricao={
            portable
              ? "Os dados ficam na pasta do programa, ao lado do moductus.exe. Para sair do modo, apague o portable.txt dessa pasta."
              : "Os dados ficam em %APPDATA%\\Moductus. Uma cópia com portable.txt ao lado do executável guarda tudo na própria pasta."
          }
        >
          <Selo>{portable ? "Ligado" : "Desligado"}</Selo>
        </Opcao>
      </Grupo>
      <ReverTutorial />
    </Secao>
  );
}
