import { TAMANHO_MAXIMO_ARQUIVO, type AutorizacaoArquivo } from "@moductus/contrato";
import { useCallback, useState } from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { Icone } from "../../componentes/Icone.tsx";
import { escolherArquivoDoUsuario, finalidadeDoCaminho } from "../../nativo/arquivos.ts";
import { useSoltarArquivo } from "../../nativo/soltar.ts";
import { servico } from "../../servico/conexao.ts";
import "./AlvoDeArquivo.css";

type Estado =
  | { fase: "parado" }
  | { fase: "conferindo" }
  | { fase: "pronto"; autorizacao: AutorizacaoArquivo }
  | { fase: "erro"; mensagem: string };

const MB = 1024 * 1024;

/** "23 KB", "1,4 MB": o tamanho que a pessoa reconhece no Explorer. */
export function tamanhoLegivel(bytes: number): string {
  if (bytes < MB) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(Math.ceil((bytes / MB) * 10) / 10).toLocaleString("pt-BR")} MB`;
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * Escolher ou soltar o extrato ou o comprovante (ADR-0044): o caminho vai uma vez ao
 * `arquivos.autorizar` e o que volta é a autorização de uso único, que a importação e o
 * comprovante consomem. Soltar vale em qualquer ponto da janela enquanto a área está aberta.
 */
export function useArquivoDoUsuario(aoAutorizar?: (autorizacao: AutorizacaoArquivo) => void) {
  const [estado, setEstado] = useState<Estado>({ fase: "parado" });

  const autorizar = useCallback(
    async (caminho: string) => {
      const finalidade = finalidadeDoCaminho(caminho);
      if (!finalidade) {
        setEstado({
          fase: "erro",
          mensagem:
            "Este arquivo não é um extrato nem um comprovante: use OFX, CSV, XML, TXT ou uma imagem PNG, JPEG, BMP, GIF ou TIFF.",
        });
        return;
      }
      setEstado({ fase: "conferindo" });
      try {
        const autorizacao = await servico.pedir("arquivos.autorizar", { caminho, finalidade });
        setEstado({ fase: "pronto", autorizacao });
        aoAutorizar?.(autorizacao);
      } catch (erro) {
        setEstado({ fase: "erro", mensagem: mensagem(erro) });
      }
    },
    [aoAutorizar],
  );

  const sobre = useSoltarArquivo((caminho) => void autorizar(caminho));

  const escolher = useCallback(async () => {
    try {
      const caminho = await escolherArquivoDoUsuario("extrato");
      if (caminho) await autorizar(caminho);
    } catch (erro) {
      setEstado({ fase: "erro", mensagem: mensagem(erro) });
    }
  }, [autorizar]);

  return { estado, sobre, escolher };
}

interface PropsAlvo {
  /** No painel, a caixa é mais baixa e o texto, mais curto. */
  compacto?: boolean;
  aoAutorizar?: (autorizacao: AutorizacaoArquivo) => void;
}

/**
 * O alvo de soltar da área e do painel Finanças (`AreaFinancas`, `PainelFinancas`; caixa tracejada
 * do `Comprovante`): o texto, o "Escolher arquivo" e, depois, o arquivo recebido ou o motivo da recusa.
 */
export function AlvoDeArquivo({ compacto = false, aoAutorizar }: PropsAlvo) {
  const { estado, sobre, escolher } = useArquivoDoUsuario(aoAutorizar);
  const limiteExtrato = tamanhoLegivel(TAMANHO_MAXIMO_ARQUIVO.extrato);
  const limiteImagem = tamanhoLegivel(TAMANHO_MAXIMO_ARQUIVO.comprovante);

  return (
    <section
      className="alvo-arquivo"
      aria-label="Extrato ou comprovante"
      data-sobre={sobre || undefined}
      data-compacto={compacto || undefined}
    >
      <span className="alvo-arquivo-icone" aria-hidden="true">
        <Icone nome="arquivos" tamanho={20} />
      </span>
      <p className="alvo-arquivo-titulo">
        {sobre ? "Solte para conferir o arquivo" : "Solte aqui o extrato ou o comprovante"}
      </p>
      {!compacto && (
        <p className="alvo-arquivo-dica">
          Extrato em OFX, CSV, XML ou TXT, até {limiteExtrato}; comprovante em PNG, JPEG, BMP, GIF ou TIFF,
          até {limiteImagem}. O arquivo não é copiado para o Moductus.
        </p>
      )}
      <Botao
        tamanho={compacto ? "pequeno" : "normal"}
        onClick={() => void escolher()}
        disabled={estado.fase === "conferindo"}
      >
        Escolher arquivo
      </Botao>
      {estado.fase === "conferindo" && (
        <p className="alvo-arquivo-estado" role="status">
          Conferindo o arquivo…
        </p>
      )}
      {estado.fase === "pronto" && (
        <p className="alvo-arquivo-estado" role="status" data-autorizacao={estado.autorizacao.id}>
          {estado.autorizacao.nome} recebido, {tamanhoLegivel(estado.autorizacao.bytes)}.
        </p>
      )}
      {estado.fase === "erro" && (
        <p className="alvo-arquivo-estado alvo-arquivo-erro" role="alert">
          {estado.mensagem}
        </p>
      )}
    </section>
  );
}
