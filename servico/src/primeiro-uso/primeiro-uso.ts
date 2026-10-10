import type { DatabaseSync } from "node:sqlite";
import {
  MISSOES_TUTORIAL,
  PASSOS_PRIMEIRO_USO,
  PedidoConcluirPrimeiroUso,
  PedidoMarcarTutorial,
  type EstadoEtapa,
  type EstadoPrimeiroUso,
} from "@moductus/contrato";

/** Linhas da tabela onboarding que não são passos nem missões. */
const CONFIGURACAO = "configuracao";
const TUTORIAL = "tutorial";
const missao = (id: string) => `missao:${id}`;

/** Leitura e gravação da tabela onboarding: uma linha por passo; linha ausente é pendente. */
export class RepositorioPrimeiroUso {
  constructor(private readonly db: DatabaseSync) {}

  ler(): Map<string, { estado: EstadoEtapa; concluidoEm: string | null }> {
    const linhas = this.db.prepare("SELECT passo, estado, concluido_em FROM onboarding").all() as {
      passo: string;
      estado: EstadoEtapa;
      concluido_em: string | null;
    }[];
    return new Map(linhas.map((l) => [l.passo, { estado: l.estado, concluidoEm: l.concluido_em }]));
  }

  /** Grava tudo numa transação: concluir é um passo só, nunca pela metade. */
  gravar(mudancas: [passo: string, estado: EstadoEtapa][]): void {
    const upsert = this.db.prepare(
      `INSERT INTO onboarding (passo, estado, concluido_em)
       VALUES (?1, ?2, CASE WHEN ?2 = 'pendente' THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now') END)
       ON CONFLICT (passo) DO UPDATE SET estado = excluded.estado, concluido_em = excluded.concluido_em`,
    );
    this.db.exec("BEGIN");
    try {
      for (const [passo, estado] of mudancas) upsert.run(passo, estado);
      this.db.exec("COMMIT");
    } catch (erro) {
      this.db.exec("ROLLBACK");
      throw erro;
    }
  }
}

/**
 * A regra do primeiro uso: concluir a configuração (feita ou pulada) faz o Sistema abrir direto
 * nas áreas dali em diante; o tutorial aparece depois dela e some quando as cinco missões ficam
 * feitas ou quando é pulado, e volta se pedido.
 */
export class ServicoPrimeiroUso {
  /** A missão do Nuno já foi vista feita neste processo. */
  private nunoVisto = false;

  constructor(
    private readonly repo: RepositorioPrimeiroUso,
    private readonly emitir: (estado: EstadoPrimeiroUso) => void,
  ) {}

  obter(): EstadoPrimeiroUso {
    const linhas = this.repo.ler();
    const estado = (chave: string): EstadoEtapa => linhas.get(chave)?.estado ?? "pendente";
    const configuracao = linhas.get(CONFIGURACAO);
    const concluido = configuracao !== undefined && configuracao.estado !== "pendente";
    return {
      concluido,
      concluidoEm: concluido ? configuracao.concluidoEm : null,
      passos: Object.fromEntries(
        PASSOS_PRIMEIRO_USO.map((p) => [p, estado(p)]),
      ) as EstadoPrimeiroUso["passos"],
      tutorial: estado(TUTORIAL),
      missoes: Object.fromEntries(
        MISSOES_TUTORIAL.map((m) => [m, estado(missao(m))]),
      ) as EstadoPrimeiroUso["missoes"],
    };
  }

  concluir(entrada: PedidoConcluirPrimeiroUso): EstadoPrimeiroUso {
    const { passos } = PedidoConcluirPrimeiroUso.parse(entrada);
    const mudancas: [string, EstadoEtapa][] = PASSOS_PRIMEIRO_USO.map((p) => [p, passos[p] ?? "pulado"]);
    // Feita se ao menos um passo foi seguido; pular tudo de saída conta como pulada.
    const algumFeito = mudancas.some(([, e]) => e === "feito");
    mudancas.push([CONFIGURACAO, algumFeito ? "feito" : "pulado"]);
    this.repo.gravar(mudancas);
    return this.publicar();
  }

  marcar(entrada: PedidoMarcarTutorial): EstadoPrimeiroUso {
    const pedido = PedidoMarcarTutorial.parse(entrada);
    if (pedido.alvo === "tutorial") {
      this.repo.gravar([[TUTORIAL, pedido.estado]]);
      return this.publicar();
    }
    this.repo.gravar([[missao(pedido.missao), pedido.estado]]);
    // A missão do Nuno voltou a valer: a próxima sessão do Claude Code a faz de novo.
    if (pedido.missao === "nuno-sessao" && pedido.estado === "pendente") this.nunoVisto = false;
    const { missoes, tutorial } = this.obter();
    if (tutorial === "pendente" && Object.values(missoes).every((e) => e === "feito")) {
      this.repo.gravar([[TUTORIAL, "feito"]]);
    }
    return this.publicar();
  }

  /**
   * Chegou evento de uma sessão do Claude Code pelos hooks: a missão do Nuno ("abra uma sessão do
   * Claude Code") está feita de verdade. Grava e avisa só na primeira vez; depois, nem lê o banco,
   * porque cada ferramenta usada na sessão manda um evento.
   */
  sessaoDoClaudeCode(): void {
    if (this.nunoVisto) return;
    if (this.obter().missoes["nuno-sessao"] === "pendente") {
      this.marcar({ alvo: "missao", missao: "nuno-sessao", estado: "feito" });
    }
    this.nunoVisto = true;
  }

  private publicar(): EstadoPrimeiroUso {
    const estado = this.obter();
    this.emitir(estado);
    return estado;
  }
}
