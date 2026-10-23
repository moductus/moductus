import type { DatabaseSync } from "node:sqlite";
import { novoId } from "../../banco/ulid.ts";

/**
 * Até onde cada vigia já olhou (`vigias_marcas`, migração 024): um texto por nome (`alba.dia`), que
 * sobrevive ao serviço reiniciando e ao PC desligado. Controle deste PC. O nome começa pelo agente
 * do vigia, que carimba a linha.
 */
export interface MarcasDosVigias {
  ler(nome: string): string | null;
  gravar(nome: string, valor: string): void;
}

export class RepositorioMarcasDosVigias implements MarcasDosVigias {
  constructor(
    private readonly db: DatabaseSync,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  ler(nome: string): string | null {
    const linha = this.db.prepare("SELECT valor FROM vigias_marcas WHERE nome = ?").get(nome) as
      { valor: string } | undefined;
    return linha?.valor ?? null;
  }

  gravar(nome: string, valor: string): void {
    const agora = this.agora().toISOString();
    this.db
      .prepare(
        `INSERT INTO vigias_marcas (id, nome, valor, criado_em, atualizado_em, origem, agente_id)
         VALUES (?, ?, ?, ?, ?, 'agente', ?)
         ON CONFLICT (nome) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`,
      )
      .run(novoId(), nome, valor, agora, agora, nome.split(".")[0]!);
  }
}
