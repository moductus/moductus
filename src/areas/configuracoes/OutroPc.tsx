import type { ModoImportar, PreviaImportar, ResultadoExportar } from "@moductus/contrato";
import { useState } from "react";
import { textoDoAtalho } from "../../componentes/CampoAtalho.tsx";
import { Botao } from "../../componentes/Botao.tsx";
import { Cartao } from "../../componentes/Cartao.tsx";
import { Icone } from "../../componentes/Icone.tsx";
import { Seletor, type OpcaoSeletor } from "../../componentes/Seletor.tsx";
import { escolherArquivo, escolherOndeSalvar } from "../../nativo/arquivos.ts";
import { servico } from "../../servico/conexao.ts";
import { Aviso, Grupo } from "./Partes.tsx";
import { Secao } from "./Secao.tsx";
import { useConfig } from "./useConfig.ts";

const MODOS: readonly (OpcaoSeletor<ModoImportar> & { descricao: string; acao: string })[] = [
  {
    valor: "juntar",
    rotulo: "Juntar",
    descricao: "Troca só o que o arquivo traz; o resto fica como está.",
    acao: "Juntar com este PC",
  },
  {
    valor: "substituir",
    rotulo: "Substituir",
    descricao: "Fica só o do arquivo; o que ele não traz volta ao padrão.",
    acao: "Substituir neste PC",
  },
];

const NOMES: Record<string, string> = {
  tema: "Tema",
  dock: "Dock",
  atalhos: "Atalhos",
  autostart: "Iniciar com o Windows",
};

const PALAVRAS: Record<string, string> = {
  automatico: "Automático",
  grafite: "Grafite",
  papel: "Papel",
  vidro: "Vidro",
  esquerda: "Esquerda",
  direita: "Direita",
  fixo: "Fixo",
  esconder: "Esconder",
  inteligente: "Inteligente",
  colada: "Colado",
  flutuante: "Flutuante",
};

/** Valor de configuração em uma linha legível; o que não se conhece vai como veio. */
function legivel(chave: string, valor: unknown): string {
  if (typeof valor === "boolean") return valor ? "Ligado" : "Desligado";
  if (typeof valor === "string") return PALAVRAS[valor] ?? valor;
  if (chave === "atalhos" && valor && typeof valor === "object") {
    return Object.values(valor as Record<string, string>)
      .map(textoDoAtalho)
      .join(" · ");
  }
  if (valor && typeof valor === "object") {
    return Object.values(valor)
      .map((v) => legivel("", v))
      .join(" · ");
  }
  return JSON.stringify(valor);
}

const nomeDoArquivo = (caminho: string) => caminho.split(/[\\/]/).pop() ?? caminho;
const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));
const DATA = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Levar para outro PC, só configurações: gerar o .moductus aqui e importar lá. */
export function SecaoOutroPc() {
  const { conectado } = useConfig();
  return (
    <Secao titulo="Levar para outro PC">
      <p className="config-intro">
        Um arquivo .moductus leva o seu Moductus para outro computador. Gere aqui e abra lá.
      </p>
      <Exportar conectado={conectado} />
      <Importar conectado={conectado} />
    </Secao>
  );
}

function Exportar({ conectado }: { conectado: boolean }) {
  const [ocupado, setOcupado] = useState(false);
  const [gerado, setGerado] = useState<ResultadoExportar | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const gerar = async () => {
    setErro(null);
    setGerado(null);
    const caminho = await escolherOndeSalvar().catch((e: unknown) => {
      setErro(mensagem(e));
      return null;
    });
    if (!caminho) return;
    setOcupado(true);
    try {
      setGerado(await servico.pedir("config.exportar", { caminho }));
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Grupo titulo="Exportar">
      <Cartao className="config-cartao">
        <span className="config-opcao-titulo">Só configurações</span>
        <span className="config-opcao-descricao">
          Tema, dock, atalhos e início com o Windows. Agentes, modelos e regras entram aqui quando existirem;
          levar também os dados vem numa fase seguinte.
        </span>
        <p className="config-nota">
          <Icone nome="escudo" tamanho={14} />
          <span>
            Nunca vão no arquivo: chaves de API, login do Google e do GitHub, tokens. Você conecta de novo no
            outro PC.
          </span>
        </p>
        <div className="config-rodape">
          <Botao variante="primario" disabled={!conectado || ocupado} onClick={() => void gerar()}>
            Gerar arquivo
          </Botao>
        </div>
      </Cartao>
      {gerado && (
        <p role="status" className="config-feito">
          {`Arquivo gerado em ${gerado.caminho} (${gerado.bytes} bytes).`}
        </p>
      )}
      {erro && <Aviso>{erro}</Aviso>}
    </Grupo>
  );
}

function Importar({ conectado }: { conectado: boolean }) {
  const [caminho, setCaminho] = useState<string | null>(null);
  const [modo, setModo] = useState<ModoImportar>("juntar");
  const [previa, setPrevia] = useState<PreviaImportar | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [feito, setFeito] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // O serviço lê o arquivo e diz o que mudaria; nada é gravado até a confirmação.
  const verPrevia = async (arquivo: string, novoModo: ModoImportar) => {
    setErro(null);
    setPrevia(null);
    try {
      setPrevia(await servico.pedir("config.previaImportar", { caminho: arquivo, modo: novoModo }));
    } catch (e) {
      // Arquivo recusado não fica escolhido: só o motivo aparece.
      setCaminho(null);
      setErro(mensagem(e));
    }
  };

  const escolher = async () => {
    setFeito(null);
    const arquivo = await escolherArquivo().catch((e: unknown) => {
      setErro(mensagem(e));
      return null;
    });
    if (!arquivo) return;
    setCaminho(arquivo);
    await verPrevia(arquivo, modo);
  };

  const trocarModo = (novo: ModoImportar) => {
    setModo(novo);
    if (caminho) void verPrevia(caminho, novo);
  };

  const confirmar = async () => {
    if (!caminho || !previa) return;
    setOcupado(true);
    setErro(null);
    try {
      await servico.pedir("config.importar", { caminho, modo });
      const n = previa.mudancas.length;
      setFeito(`Pronto: ${n} ${n === 1 ? "configuração trocada" : "configurações trocadas"}.`);
      setCaminho(null);
      setPrevia(null);
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      setOcupado(false);
    }
  };

  const escolhido = MODOS.find((m) => m.valor === modo)!;
  return (
    <Grupo titulo="Importar">
      <div className="config-rodape">
        <Botao disabled={!conectado || ocupado} onClick={() => void escolher()}>
          {caminho ? "Escolher outro arquivo" : "Escolher arquivo"}
        </Botao>
      </div>
      {caminho && (
        <Cartao variante="elevado" className="config-cartao" aria-label="Arquivo escolhido">
          <span className="config-opcao-titulo">{nomeDoArquivo(caminho)}</span>
          {previa && (
            <span className="config-opcao-descricao">
              {`Só configurações · gerado em ${DATA.format(new Date(previa.criado_em))} no PC ${previa.pc_origem}`}
            </span>
          )}
          <Seletor rotulo="O que fazer com este PC" opcoes={MODOS} valor={modo} aoMudar={trocarModo} />
          <span className="config-opcao-descricao">{escolhido.descricao}</span>
          {previa &&
            (previa.mudancas.length === 0 ? (
              <p className="config-opcao-descricao">Nada muda: este PC já tem essas configurações.</p>
            ) : (
              <>
                <span className="config-opcao-titulo">O que vai mudar</span>
                <ul className="config-mudancas" aria-label="O que vai mudar">
                  {previa.mudancas.map((m) => (
                    <li key={m.chave} className="config-mudanca">
                      <span className="config-mudanca-chave">{NOMES[m.chave] ?? m.chave}</span>
                      <span className="config-mudanca-de">{legivel(m.chave, m.atual)}</span>
                      <span aria-hidden="true">→</span>
                      <span className="so-leitor">passa a</span>
                      <span className="config-mudanca-para">{legivel(m.chave, m.novo)}</span>
                    </li>
                  ))}
                </ul>
                <div className="config-rodape">
                  <Botao
                    variante="fantasma"
                    disabled={ocupado}
                    onClick={() => {
                      setCaminho(null);
                      setPrevia(null);
                    }}
                  >
                    Cancelar
                  </Botao>
                  <Botao variante="primario" disabled={ocupado} onClick={() => void confirmar()}>
                    {escolhido.acao}
                  </Botao>
                </div>
              </>
            ))}
        </Cartao>
      )}
      {feito && (
        <p role="status" className="config-feito">
          {feito}
        </p>
      )}
      {erro && <Aviso>{erro}</Aviso>}
    </Grupo>
  );
}
