import type { DatabaseSync } from "node:sqlite";
import type { Aprovacao, ContagensAreas, ItemGithub } from "@moductus/contrato";

/**
 * As contagens das áreas (PRODUCT.md §4; contrato `areas.contagens`): o número da barra lateral
 * do Sistema e dos badges do dock. Uma conta só, aqui, para as duas janelas mostrarem o mesmo; a
 * janela não soma nada. Cada área diz o seu número (a regra de "hoje" é das Tarefas, a de "precisa
 * de você" é do GitHub); este serviço junta os quatro e avisa quando algum muda.
 *
 * Quem muda o que é contado (tarefa, lembrete, pedido de aprovação, leitura do GitHub, fuso) chama
 * {@link ServicoContagens.recontar}. A virada do dia não tem quem avise: {@link ServicoContagens.vigiar}
 * reconta de minuto em minuto, e a volta da suspensão reconta também.
 */

/** De quanto em quanto a contagem é refeita sem aviso de ninguém (a virada do dia no fuso). */
export const INTERVALO_CONTAGENS_MS = 60_000;

const CAMPOS = ["tarefasPendentes", "lembretesAtrasados", "sessoesEsperando", "devPrecisando"] as const;

/** De onde vem cada número; cada um é lido a cada contagem. */
export type FontesContagens = Readonly<Record<keyof ContagensAreas, () => number>>;

/**
 * Sessões do terminal com pedido esperando você (um pedido sem sessão conta sozinho). É o que o
 * Nuno mostra no dock: a sessão que só terminou o turno não pede nada.
 */
export function sessoesEsperando(pedidos: readonly Aprovacao[]): number {
  const doTerminal = pedidos.filter((p) => p.estado === "pendente" && p.fonte !== "moductus");
  return new Set(doTerminal.map((p) => p.sessaoId ?? `pedido:${p.id}`)).size;
}

/** PRs, issues e CI abertos que pedem você, pelo `precisaDeMim` da leitura do GitHub. */
export function devPrecisando(itens: readonly ItemGithub[]): number {
  return itens.filter((i) => i.estado === "aberto" && i.precisaDeMim).length;
}

/**
 * Os lembretes atrasados pela tabela `lembretes` (migração 013): os `perdido`, que venceram com o
 * serviço parado ou o PC suspenso. Fica aqui até a área Lembretes (F3-17) ter a leitura dela.
 */
export class RepositorioContagens {
  constructor(private readonly db: DatabaseSync) {}

  lembretesAtrasados(): number {
    const r = this.db
      .prepare("SELECT count(*) AS n FROM lembretes WHERE estado = 'perdido' AND apagado_em IS NULL")
      .get() as { n: number };
    return r.n;
  }
}

const iguais = (a: ContagensAreas, b: ContagensAreas) => CAMPOS.every((c) => a[c] === b[c]);

export class ServicoContagens {
  /** A última contagem avisada: o aviso só sai quando algum número muda. */
  private ultima: ContagensAreas | null = null;

  constructor(
    private readonly fontes: FontesContagens,
    private readonly avisar: (contagens: ContagensAreas) => void,
  ) {}

  /** A contagem de agora (`areas.contagens`); se mudou desde o último aviso, as janelas sabem. */
  obter(): ContagensAreas {
    return this.recontar();
  }

  /**
   * Conta de novo e avisa se mudou. Não lança: quem chama é o aviso de outra área, depois de ela já
   * ter gravado. A fonte que falha fica com o último número que deu, e o erro vai ao log.
   */
  recontar(): ContagensAreas {
    const nova = {} as ContagensAreas;
    for (const campo of CAMPOS) nova[campo] = this.ler(campo);
    const mudou = this.ultima === null || !iguais(this.ultima, nova);
    this.ultima = nova;
    if (mudou) {
      try {
        this.avisar(nova);
      } catch (erro) {
        console.error(`contagens: aviso falhou: ${String(erro)}`);
      }
    }
    return nova;
  }

  private ler(campo: keyof ContagensAreas): number {
    try {
      const n = this.fontes[campo]();
      if (Number.isSafeInteger(n) && n >= 0) return n;
      console.error(`contagens: ${campo} veio fora do formato (${String(n)})`);
    } catch (erro) {
      console.error(`contagens: ${campo} falhou: ${String(erro)}`);
    }
    return this.ultima?.[campo] ?? 0;
  }

  /** Reconta a cada {@link INTERVALO_CONTAGENS_MS}. Não segura o processo; devolve como parar. */
  vigiar(intervaloMs = INTERVALO_CONTAGENS_MS): () => void {
    const relogio = setInterval(() => this.recontar(), intervaloMs);
    relogio.unref();
    return () => clearInterval(relogio);
  }
}
