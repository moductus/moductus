import type { Migracao } from "../banco/migracoes.ts";
import { m001 } from "./001-config.ts";
import { m002 } from "./002-onboarding.ts";
import { m003 } from "./003-agentes.ts";
import { m004 } from "./004-sessoes-dev.ts";
import { m005 } from "./005-notificacoes.ts";
import { m006 } from "./006-conexoes-lida-em.ts";

/** Todas as migrações, em ordem. Migração publicada não muda: corrige-se com outra. */
export const MIGRACOES: readonly Migracao[] = [m001, m002, m003, m004, m005, m006];
