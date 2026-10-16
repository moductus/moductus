import { execFile } from "node:child_process";

/** O que o `gh` devolveu. O stdout vem mesmo com código diferente de zero (erro do GraphQL). */
export interface SaidaGh {
  codigo: number;
  saida: string;
  erro: string;
}

/**
 * Roda o `gh` com os argumentos dados. Rejeita com {@link GhAusente} quando o programa não está
 * instalado; qualquer outra falha de execução rejeita com o motivo. Os testes trocam por um falso.
 */
export type ExecutorGh = (args: readonly string[]) => Promise<SaidaGh>;

/** O `gh` não foi achado no PATH. */
export class GhAusente extends Error {
  constructor() {
    super("o gh não está instalado");
  }
}

export interface OpcoesGh {
  /** Programa a rodar; o padrão é `gh`, achado pelo PATH. */
  comando?: string;
  /** Argumentos antes dos do pedido (o teste roda um `gh` falso pelo próprio Node). */
  prefixo?: readonly string[];
  tempoMs?: number;
}

const TEMPO_PADRAO_MS = 60_000;
const SAIDA_MAXIMA = 16 * 1024 * 1024;

/**
 * O `gh` de verdade, com a autenticação que o usuário já fez nele (`gh auth login`): o Moductus
 * nunca vê o token. Sem shell, sem janela, sem pergunta interativa e sem aviso de versão nova.
 */
export function executorGh(opcoes: OpcoesGh = {}): ExecutorGh {
  const comando = opcoes.comando ?? "gh";
  const tempoMs = opcoes.tempoMs ?? TEMPO_PADRAO_MS;
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        comando,
        [...(opcoes.prefixo ?? []), ...args],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: tempoMs,
          maxBuffer: SAIDA_MAXIMA,
          env: {
            ...process.env,
            GH_PROMPT_DISABLED: "1",
            GH_NO_UPDATE_NOTIFIER: "1",
            GH_SPINNER_DISABLED: "1",
            NO_COLOR: "1",
          },
        },
        (falha, saida, erro) => {
          if (!falha) return resolve({ codigo: 0, saida, erro });
          if (falha.code === "ENOENT") return reject(new GhAusente());
          if (falha.killed) return reject(new Error(`o gh não respondeu em ${Math.round(tempoMs / 1000)} s`));
          if (typeof falha.code === "number") return resolve({ codigo: falha.code, saida, erro });
          reject(new Error(falha.message));
        },
      );
    });
}
