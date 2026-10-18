import type { Migracao } from "../banco/migracoes.ts";

/**
 * O teto diário na moeda que o usuário escolhe (F3-08, ADR-0040, DATA.md §6): `teto_moeda` diz em
 * que moeda o `teto_diario_centavos` vale, com o real como padrão (o teto que já existia estava
 * vazio, porque a fase 2 recusava gravar valor). A lista curta de moedas mora no contrato; aqui só
 * a forma do código ISO 4217, para uma moeda nova não pedir migração.
 *
 * `teto_liberado_centavos` e `teto_liberado_ate` são o "Liberar" do cartão de teto: quanto foi
 * solto a mais hoje, por cima do teto, e até quando vale (a meia-noite). Só existem juntos, e só
 * com teto. É situação deste PC e deste dia: não vai no arquivo de levar para outro PC.
 */
export const m017: Migracao = {
  versao: 17,
  nome: "agentes-teto-moeda",
  sql: `ALTER TABLE agentes ADD COLUMN teto_moeda TEXT NOT NULL DEFAULT 'BRL'
    CHECK (teto_moeda GLOB '[A-Z][A-Z][A-Z]');
  ALTER TABLE agentes ADD COLUMN teto_liberado_centavos INTEGER
    CHECK (teto_liberado_centavos IS NULL OR (teto_liberado_centavos > 0 AND teto_diario_centavos IS NOT NULL));
  ALTER TABLE agentes ADD COLUMN teto_liberado_ate TEXT
    CHECK ((teto_liberado_ate IS NULL) = (teto_liberado_centavos IS NULL));`,
};
