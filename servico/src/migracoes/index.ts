import type { Migracao } from "../banco/migracoes.ts";
import { m001 } from "./001-config.ts";

/** Todas as migrações, em ordem. Migração publicada não muda: corrige-se com outra. */
export const MIGRACOES: readonly Migracao[] = [m001];
