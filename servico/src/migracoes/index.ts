import type { Migracao } from "../banco/migracoes.ts";
import { m001 } from "./001-config.ts";
import { m002 } from "./002-onboarding.ts";
import { m003 } from "./003-agentes.ts";
import { m004 } from "./004-sessoes-dev.ts";
import { m005 } from "./005-notificacoes.ts";
import { m006 } from "./006-conexoes-lida-em.ts";
import { m007 } from "./007-transcript-lido.ts";
import { m008 } from "./008-uso-respostas-contadas.ts";
import { m009 } from "./009-execucoes-cobranca.ts";
import { m010 } from "./010-agendador-disparos.ts";
import { m011 } from "./011-agentes-sono.ts";
import { m012 } from "./012-execucoes-falha-do-provedor.ts";
import { m013 } from "./013-tarefas.ts";
import { m014 } from "./014-agenda-foco.ts";
import { m015 } from "./015-notas.ts";
import { m016 } from "./016-provedores-caminho.ts";
import { m017 } from "./017-agentes-teto-moeda.ts";
import { m018 } from "./018-tarefas-fechamento.ts";
import { m019 } from "./019-lembretes-inicio.ts";
import { m020 } from "./020-foco-etapas.ts";

/** Todas as migrações, em ordem. Migração publicada não muda: corrige-se com outra. */
export const MIGRACOES: readonly Migracao[] = [
  m001,
  m002,
  m003,
  m004,
  m005,
  m006,
  m007,
  m008,
  m009,
  m010,
  m011,
  m012,
  m013,
  m014,
  m015,
  m016,
  m017,
  m018,
  m019,
  m020,
];
