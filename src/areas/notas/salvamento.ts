import type { Nota, PedidoSalvarNota, ResultadoSalvarNota } from "@moductus/contrato";
import { RecusaDoServico } from "@moductus/contrato/cliente";

/**
 * O texto de uma nota aberta numa janela, que salva sozinho (ADR-0036): 800 ms depois da última
 * tecla, e na hora quando o campo, a janela ou a área deixam de estar à vista. Manda sempre a
 * versão que conhece (`atualizadoEm`); o serviço recusa gravar sobre uma mais nova e devolve as
 * duas, e aí nada se perde: o texto daqui fica na tela até você escolher qual vale.
 *
 * Não depende de React: a área e o painel leem o estado e mandam as mudanças.
 */

/** Espera depois da última tecla (ADR-0036). */
export const ESPERA_SALVAR_MS = 800;
/** Depois de uma falha do canal, tenta de novo sozinho nesse intervalo. */
export const ESPERA_APOS_FALHA_MS = 5000;

/** A mensagem do serviço quando a nota não existe mais (servico/src/areas/notas/notas.ts). */
export const NOTA_SUMIU = "nota não encontrada";

/**
 * - `salvo`: o texto da tela é o que está no banco;
 * - `esperando`: há texto novo e o salvar vem em instantes;
 * - `salvando`: o pedido foi;
 * - `falhou`: não salvou, o texto continua aqui (o canal tenta de novo; a recusa diz o motivo);
 * - `conflito`: a nota mudou em outra janela, e você escolhe entre as duas;
 * - `apagada`: a nota foi para a Lixeira em outra janela.
 */
export type SituacaoRascunho = "salvo" | "esperando" | "salvando" | "falhou" | "conflito" | "apagada";

export interface EstadoRascunho {
  /** A última versão do banco que esta janela conhece. */
  nota: Nota;
  /** O que está na tela. */
  titulo: string;
  conteudo: string;
  situacao: SituacaoRascunho;
  /** No conflito, a versão que está no banco. */
  outra: Nota | null;
  /** Por que não salvou, quando o serviço recusou. */
  erro: string | null;
}

export interface TextoNota {
  titulo: string;
  conteudo: string;
}

/** Agenda uma função e devolve como cancelar. Os testes passam um relógio próprio. */
export type Agendar = (fn: () => void, ms: number) => () => void;

const agendarPadrao: Agendar = (fn, ms) => {
  const relogio = setTimeout(fn, ms);
  return () => clearTimeout(relogio);
};

export interface OpcoesRascunho {
  salvar: (pedido: PedidoSalvarNota) => Promise<ResultadoSalvarNota>;
  agendar?: Agendar;
}

const mesmoTexto = (a: TextoNota, b: TextoNota) => a.titulo === b.titulo && a.conteudo === b.conteudo;

export class RascunhoNota {
  private estado: EstadoRascunho;
  private readonly agendar: Agendar;
  private readonly ouvintes = new Set<(estado: EstadoRascunho) => void>();
  private cancelarRelogio: (() => void) | null = null;
  private emVoo = false;
  /** O texto mudou e o relógio venceu enquanto um pedido estava fora: manda de novo na volta. */
  private deNovo = false;
  /**
   * O último texto que saiu sem resposta (o canal caiu depois do envio): o serviço pode ter
   * gravado. Se a versão do banco tem esse texto, ela é desta janela, não de outra.
   */
  private incerto: TextoNota | null = null;
  /** O texto foi largado com um salvar fora: a resposta só atualiza a versão. */
  private descartado = false;

  constructor(
    nota: Nota,
    private readonly opcoes: OpcoesRascunho,
  ) {
    this.agendar = opcoes.agendar ?? agendarPadrao;
    this.estado = {
      nota,
      titulo: nota.titulo,
      conteudo: nota.conteudo,
      situacao: "salvo",
      outra: null,
      erro: null,
    };
  }

  get atual(): EstadoRascunho {
    return this.estado;
  }

  /** O texto da tela ainda não está no banco. */
  get pendente(): boolean {
    return !mesmoTexto(this.estado, this.estado.nota);
  }

  /** Nada a mandar nem esperando resposta: a janela pode esquecer este rascunho. */
  get quieto(): boolean {
    return !this.pendente && !this.emVoo;
  }

  ouvir(fn: (estado: EstadoRascunho) => void): () => void {
    this.ouvintes.add(fn);
    return () => this.ouvintes.delete(fn);
  }

  get ouvindo(): number {
    return this.ouvintes.size;
  }

  /** Uma tecla: o texto muda na hora e o salvar espera a próxima pausa. */
  editar(campos: Partial<TextoNota>): void {
    const { situacao } = this.estado;
    this.mudar({ ...campos });
    // No conflito e na nota apagada, nada sai sozinho: o texto fica até a escolha.
    if (situacao === "conflito" || situacao === "apagada") return;
    if (!this.pendente) {
      this.pararRelogio();
      if (!this.emVoo) this.mudar({ situacao: "salvo", erro: null });
      return;
    }
    if (!this.emVoo) this.mudar({ situacao: "esperando" });
    this.pararRelogio();
    this.cancelarRelogio = this.agendar(() => this.enviar(), ESPERA_SALVAR_MS);
  }

  /** Salva já o que estiver pendente: saiu do campo, a janela fechou ou a área trocou. */
  descarregar(): void {
    this.enviar();
  }

  /**
   * A nota como o serviço avisou (`notas.mudou`, ou lida de novo). Versão mais nova: sem nada
   * pendente aqui, vale a de lá; com texto pendente diferente, é conflito na hora, sem esperar o
   * salvar ser recusado. Mesma versão só atualiza fixar e pasta, que não mudam a versão.
   */
  chegou(nota: Nota): void {
    const atual = this.estado.nota;
    if (nota.id !== atual.id) return;
    if (nota.atualizadoEm === atual.atualizadoEm) {
      if (nota.fixada !== atual.fixada || nota.pasta !== atual.pasta) {
        this.mudar({ nota: { ...atual, fixada: nota.fixada, pasta: nota.pasta } });
      }
      return;
    }
    if (nota.atualizadoEm < atual.atualizadoEm) return;
    if (this.estado.situacao === "conflito") {
      this.mudar({ outra: nota });
      return;
    }
    if (this.estado.situacao === "apagada") return;
    // O eco do próprio salvar chega antes da resposta: a resposta resolve.
    if (this.emVoo) return;
    if (!this.pendente) {
      this.pararRelogio();
      this.mudar({ nota, titulo: nota.titulo, conteudo: nota.conteudo, situacao: "salvo", erro: null });
      return;
    }
    if (mesmoTexto(nota, this.estado) || (this.incerto && mesmoTexto(nota, this.incerto))) {
      // O banco já tem este texto (ou o que saiu sem resposta): vale a versão, nada se perde.
      this.incerto = null;
      this.mudar({ nota });
      if (this.pendente) this.enviar();
      else this.mudar({ situacao: "salvo", erro: null });
      return;
    }
    this.pararRelogio();
    this.mudar({ situacao: "conflito", outra: nota });
  }

  /** A nota foi para a Lixeira em outra janela: o texto daqui fica na tela. */
  apagou(): void {
    this.pararRelogio();
    this.mudar({ situacao: "apagada", outra: null });
  }

  /** No conflito: o texto daqui vale e é gravado sobre a versão de lá. */
  ficarComAMinha(): void {
    const { outra } = this.estado;
    if (this.estado.situacao !== "conflito" || !outra) return;
    this.mudar({ nota: outra, outra: null, situacao: this.pendente ? "esperando" : "salvo", erro: null });
    this.enviar();
  }

  /** No conflito: vale a versão de lá, e o texto daqui sai da tela. */
  usarAOutra(): void {
    const { outra } = this.estado;
    if (this.estado.situacao !== "conflito" || !outra) return;
    this.mudar({
      nota: outra,
      titulo: outra.titulo,
      conteudo: outra.conteudo,
      outra: null,
      situacao: "salvo",
      erro: null,
    });
  }

  /**
   * Larga o texto pendente e volta ao que está no banco (antes de apagar ou esvaziar a nota). Um
   * salvar que já saiu, quando volta, só diz a versão: não faz o texto largado voltar.
   */
  descartar(): void {
    this.pararRelogio();
    this.deNovo = false;
    this.incerto = null;
    this.descartado = this.emVoo;
    const { nota } = this.estado;
    this.mudar({ titulo: nota.titulo, conteudo: nota.conteudo, outra: null, situacao: "salvo", erro: null });
  }

  /** Para os relógios; o pedido que já saiu termina sozinho. */
  encerrar(): void {
    this.pararRelogio();
  }

  private enviar(): void {
    this.pararRelogio();
    const { situacao } = this.estado;
    if (situacao === "conflito" || situacao === "apagada") return;
    if (this.emVoo) {
      if (this.pendente) this.deNovo = true;
      return;
    }
    if (!this.pendente) {
      if (situacao !== "salvo") this.mudar({ situacao: "salvo", erro: null });
      return;
    }
    const texto: TextoNota = { titulo: this.estado.titulo, conteudo: this.estado.conteudo };
    const { nota } = this.estado;
    this.emVoo = true;
    this.mudar({ situacao: "salvando" });
    this.opcoes
      .salvar({ id: nota.id, versao: nota.atualizadoEm, ...texto })
      .then((r) => this.voltou(r))
      .catch((erro: unknown) => this.falhou(texto, erro));
  }

  private voltou(r: ResultadoSalvarNota): void {
    this.emVoo = false;
    const deNovo = this.deNovo;
    this.deNovo = false;
    if (this.descartado) {
      this.descartado = false;
      const nota = r.salvou ? r.nota : r.atual;
      this.mudar({ nota, titulo: nota.titulo, conteudo: nota.conteudo, situacao: "salvo", erro: null });
      return;
    }
    if (r.salvou) {
      this.incerto = null;
      this.mudar({ nota: r.nota, erro: null });
    } else if (this.incerto && mesmoTexto(r.atual, this.incerto)) {
      // O que saiu sem resposta foi gravado: a versão de lá é desta janela.
      this.incerto = null;
      this.mudar({ nota: r.atual });
      this.enviar();
      return;
    } else {
      this.pararRelogio();
      this.mudar({ situacao: "conflito", outra: r.atual, erro: null });
      return;
    }
    if (!this.pendente) this.mudar({ situacao: "salvo" });
    else if (deNovo || !this.cancelarRelogio) this.enviar();
    else this.mudar({ situacao: "esperando" });
  }

  private falhou(enviado: TextoNota, erro: unknown): void {
    this.emVoo = false;
    this.deNovo = false;
    if (this.descartado) {
      this.descartado = false;
      return;
    }
    if (erro instanceof RecusaDoServico) {
      // O serviço disse não: tentar de novo daria o mesmo. O motivo vai para a tela.
      if (erro.message === NOTA_SUMIU) this.apagou();
      else this.mudar({ situacao: "falhou", erro: erro.message });
      return;
    }
    // O canal: o pedido pode nem ter saído, ou saiu e a resposta se perdeu.
    this.incerto = enviado;
    this.mudar({ situacao: "falhou", erro: null });
    this.pararRelogio();
    this.cancelarRelogio = this.agendar(() => this.enviar(), ESPERA_APOS_FALHA_MS);
  }

  private pararRelogio(): void {
    this.cancelarRelogio?.();
    this.cancelarRelogio = null;
  }

  private mudar(parte: Partial<EstadoRascunho>): void {
    this.estado = { ...this.estado, ...parte };
    for (const fn of this.ouvintes) fn(this.estado);
  }
}
