import { randomUUID } from "node:crypto";
import { statSync, type Stats } from "node:fs";
import { basename, extname, isAbsolute } from "node:path";
import {
  EXTENSOES_ARQUIVO,
  TAMANHO_MAXIMO_ARQUIVO,
  VALIDADE_AUTORIZACAO_MS,
  type AutorizacaoArquivo,
  type FinalidadeArquivo,
  type PedidoAutorizarArquivo,
} from "@moductus/contrato";

/**
 * Arquivo do usuário (ADR-0044): a janela manda o caminho que ele escolheu no diálogo ou soltou na
 * tela, o serviço confere e devolve um id de uso único que vale 10 minutos. A importação e o OCR
 * recebem o id, nunca o caminho; nenhuma ferramenta de agente recebe nem um nem outro.
 */

/** Recusa com o motivo na voz do produto: vai à janela como veio. */
export class ErroDoArquivo extends Error {}

/** O que quem consome a autorização recebe: o caminho guardado aqui, que nunca sai do serviço. */
export interface ArquivoAutorizado {
  caminho: string;
  finalidade: FinalidadeArquivo;
  nome: string;
  bytes: number;
}

interface Guardada extends ArquivoAutorizado {
  valeAte: number;
}

export interface OpcoesAutorizacoes {
  agora?: () => number;
  novoId?: () => string;
  /** `fs.statSync` por padrão; o teste troca para simular o arquivo grande sem gravá-lo. */
  stat?: (caminho: string) => Stats;
}

const NOME_DA_FINALIDADE: Readonly<Record<FinalidadeArquivo, string>> = {
  extrato: "extrato",
  comprovante: "comprovante",
};

const EXTENSOES_LEGIVEIS: Readonly<Record<FinalidadeArquivo, string>> = {
  extrato: "OFX, CSV, XML ou TXT",
  comprovante: "PNG, JPEG, BMP, GIF ou TIFF",
};

function megas(bytes: number): string {
  // Uma casa, para "10,4 MB" não aparecer como os mesmos 10 MB do limite.
  return `${(Math.ceil((bytes / (1024 * 1024)) * 10) / 10).toLocaleString("pt-BR")} MB`;
}

export class AutorizacoesDeArquivo {
  private readonly guardadas = new Map<string, Guardada>();
  private readonly agora: () => number;
  private readonly novoId: () => string;
  private readonly stat: (caminho: string) => Stats;

  constructor(opcoes: OpcoesAutorizacoes = {}) {
    this.agora = opcoes.agora ?? Date.now;
    // UUID aleatório, não ULID: o id é a própria permissão de ler, e o ULID seguinte se adivinha.
    this.novoId = opcoes.novoId ?? randomUUID;
    this.stat = opcoes.stat ?? ((caminho) => statSync(caminho));
  }

  /** Confere o arquivo escolhido e devolve a autorização, sem o caminho. */
  autorizar(pedido: PedidoAutorizarArquivo): AutorizacaoArquivo {
    this.esquecerVencidas();
    const arquivo = this.conferir(pedido.caminho, pedido.finalidade);
    const id = this.novoId();
    const valeAte = this.agora() + VALIDADE_AUTORIZACAO_MS;
    this.guardadas.set(id, { ...arquivo, valeAte });
    return {
      id,
      finalidade: arquivo.finalidade,
      nome: arquivo.nome,
      bytes: arquivo.bytes,
      valeAte: new Date(valeAte).toISOString(),
    };
  }

  /**
   * Consome a autorização: a partir daqui o id não vale mais, nem se a leitura falhar. Confere de
   * novo o arquivo, que pode ter mudado nos 10 minutos (crescido, virado pasta, sumido).
   */
  usar(id: string, finalidade: FinalidadeArquivo): ArquivoAutorizado {
    const guardada = this.guardadas.get(id);
    this.guardadas.delete(id);
    if (!guardada || guardada.finalidade !== finalidade) {
      throw new ErroDoArquivo("Este arquivo não está mais autorizado. Escolha ou solte o arquivo de novo.");
    }
    if (this.agora() > guardada.valeAte) {
      throw new ErroDoArquivo("A escolha do arquivo venceu depois de 10 minutos. Escolha ou solte de novo.");
    }
    return this.conferir(guardada.caminho, finalidade);
  }

  private conferir(caminho: string, finalidade: FinalidadeArquivo): ArquivoAutorizado {
    // Absoluto, sem dispositivo (`\\?\`, `\\.\`) e sem fluxo alternativo (`extrato.ofx:outro`):
    // os dois-pontos só valem depois da letra da unidade.
    if (!isAbsolute(caminho) || /^[\\/]{2}[?.][\\/]/.test(caminho) || caminho.indexOf(":", 2) !== -1) {
      throw new ErroDoArquivo("Este caminho não é de um arquivo que o Moductus possa ler.");
    }
    const extensao = extname(caminho).slice(1).toLowerCase();
    if (!EXTENSOES_ARQUIVO[finalidade].includes(extensao)) {
      throw new ErroDoArquivo(
        `Este arquivo não é um ${NOME_DA_FINALIDADE[finalidade]}: use ${EXTENSOES_LEGIVEIS[finalidade]}.`,
      );
    }
    let info: Stats;
    try {
      info = this.stat(caminho);
    } catch {
      throw new ErroDoArquivo("O arquivo não foi encontrado. Ele pode ter sido movido ou apagado.");
    }
    if (!info.isFile()) {
      throw new ErroDoArquivo("Escolha um arquivo, não uma pasta.");
    }
    const maximo = TAMANHO_MAXIMO_ARQUIVO[finalidade];
    if (info.size > maximo) {
      throw new ErroDoArquivo(
        `O arquivo tem ${megas(info.size)}; o ${NOME_DA_FINALIDADE[finalidade]} vai até ${megas(maximo)}.`,
      );
    }
    return { caminho, finalidade, nome: basename(caminho), bytes: info.size };
  }

  private esquecerVencidas(): void {
    const agora = this.agora();
    for (const [id, guardada] of this.guardadas) if (agora > guardada.valeAte) this.guardadas.delete(id);
  }
}
