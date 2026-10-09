import {
  existsSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { MudancaArquivo } from "@moductus/contrato";
import { ROTAS_HOOKS } from "./receptor.ts";

/**
 * Ligação do Claude Code ao receptor dos hooks (AGENTS.md §5 "Como os eventos chegam", ADR-0010,
 * ADR-0015): hooks `http` no `settings.json` do usuário, com o token no `Authorization` lido de
 * `MODUCTUS_HOOKS_TOKEN` (`allowedEnvVars`). O Moductus só mexe nos hooks que são dele, achados
 * pela URL do receptor; o resto do arquivo, inclusive os hooks do usuário, fica como estava.
 */

/** Variável do usuário que o Claude Code lê para o cabeçalho; o valor é o token dos hooks. */
export const VARIAVEL_TOKEN = "MODUCTUS_HOOKS_TOKEN";

/** Eventos ligados, na ordem em que entram no arquivo (AGENTS.md §5). */
export const EVENTOS_LIGADOS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Notification",
  "Stop",
  "SessionEnd",
] as const;

/** Eventos de ferramenta, que no Claude Code filtram pelo `matcher`: o Moductus quer todas. */
const COM_MATCHER = new Set<string>(["PreToolUse", "PostToolUse", "PermissionRequest"]);

/**
 * Quanto o Claude Code espera o receptor, em segundos. O `PermissionRequest` fica segurado até a
 * decisão no dock, no máximo 600 s (spec da fase 2, §3); os outros eventos só informam, e o
 * receptor responde na hora: o prazo curto garante que um Moductus travado não segura a sessão.
 */
export const ESPERA_PERMISSAO_S = 600;
export const ESPERA_EVENTO_S = 10;

/** Cópias de segurança guardadas ao lado do `settings.json`; as mais antigas saem. */
export const COPIAS_GUARDADAS = 5;

/** A chave do `settings.json` que a ligação muda; o resto do arquivo nunca é reescrito. */
export const TRECHO = "hooks";

const ROTA =
  Object.keys(ROTAS_HOOKS).find((rota) => ROTAS_HOOKS[rota] === "claude-code") ?? "/hooks/claude-code";

/** URL de um hook do Moductus, em qualquer porta: é por ela que desligar acha o que é dele. */
const URL_DO_MODUCTUS = new RegExp(
  `^http://(127\\.0\\.0\\.1|localhost):\\d{1,5}${ROTA.replace(/[/]/g, "\\/")}$`,
);

/** O `settings.json` do Claude Code: `CLAUDE_CONFIG_DIR` quando definido, senão `~/.claude`. */
export function caminhoSettingsClaude(
  env: NodeJS.ProcessEnv = process.env,
  casa: string = homedir(),
): string {
  const pasta = env.CLAUDE_CONFIG_DIR?.trim();
  return join(pasta ? pasta : join(casa, ".claude"), "settings.json");
}

export function urlDosHooks(porta: number): string {
  return `http://127.0.0.1:${porta}${ROTA}`;
}

/** O hook de um evento, como entra no arquivo. O token nunca vai literal: só o nome da variável. */
export function hookDoMoductus(porta: number, evento: string): Record<string, unknown> {
  return {
    type: "http",
    url: urlDosHooks(porta),
    headers: { Authorization: `Bearer $${VARIAVEL_TOKEN}` },
    allowedEnvVars: [VARIAVEL_TOKEN],
    timeout: evento === "PermissionRequest" ? ESPERA_PERMISSAO_S : ESPERA_EVENTO_S,
  };
}

function grupoDoMoductus(porta: number, evento: string): Record<string, unknown> {
  return COM_MATCHER.has(evento)
    ? { matcher: "*", hooks: [hookDoMoductus(porta, evento)] }
    : { hooks: [hookDoMoductus(porta, evento)] };
}

type Objeto = Record<string, unknown>;

const eObjeto = (valor: unknown): valor is Objeto =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

/** Hook que o Moductus gravou: `http` apontando para a rota dele em 127.0.0.1, em qualquer porta. */
export function eDoMoductus(hook: unknown): boolean {
  return (
    eObjeto(hook) && hook.type === "http" && typeof hook.url === "string" && URL_DO_MODUCTUS.test(hook.url)
  );
}

/** O arquivo não está no formato que o Claude Code lê; o Moductus não mexe nele. */
export class SettingsInvalido extends Error {}

/**
 * O bloco `hooks` sem nada do Moductus. Grupo e evento que ficam vazios por causa da retirada
 * saem; os que já estavam vazios ficam. Devolve `undefined` quando o bloco inteiro era do Moductus.
 */
export function semOMoductus(hooks: unknown): Objeto | undefined {
  if (hooks === undefined) return undefined;
  if (!eObjeto(hooks)) throw new SettingsInvalido("o bloco hooks do settings.json não é um objeto");
  let tirou = false;
  const resultado: Objeto = {};
  for (const [evento, grupos] of Object.entries(hooks)) {
    if (!Array.isArray(grupos)) {
      resultado[evento] = grupos;
      continue;
    }
    const restantes: unknown[] = [];
    for (const grupo of grupos) {
      if (!eObjeto(grupo) || !Array.isArray(grupo.hooks) || !grupo.hooks.some(eDoMoductus)) {
        restantes.push(grupo);
        continue;
      }
      tirou = true;
      const dele = grupo.hooks.filter((h) => !eDoMoductus(h));
      if (dele.length > 0) restantes.push({ ...grupo, hooks: dele });
    }
    if (restantes.length > 0 || grupos.length === 0) resultado[evento] = restantes;
  }
  return tirou && Object.keys(resultado).length === 0 ? undefined : resultado;
}

/** O bloco `hooks` com os do Moductus, uma vez cada, no fim de cada evento. */
export function comOMoductus(hooks: unknown, porta: number): Objeto {
  const resultado = semOMoductus(hooks) ?? {};
  for (const evento of EVENTOS_LIGADOS) {
    const grupos = resultado[evento];
    if (grupos !== undefined && !Array.isArray(grupos)) {
      throw new SettingsInvalido(`o evento ${evento} do settings.json não é uma lista`);
    }
    resultado[evento] = [...(grupos ?? []), grupoDoMoductus(porta, evento)];
  }
  return resultado;
}

/** JSON com as chaves em ordem, para comparar hooks sem depender da ordem em que foram escritos. */
function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  if (eObjeto(valor)) {
    const chaves = Object.keys(valor).sort();
    return `{${chaves.map((c) => `${JSON.stringify(c)}:${canonico(valor[c])}`).join(",")}}`;
  }
  return JSON.stringify(valor);
}

export type SituacaoLigacao = "ligada" | "desatualizada" | "desligada";

/**
 * `ligada`: todo evento tem o hook do Moductus como ele grava hoje, na porta de hoje.
 * `desatualizada`: há hook do Moductus, mas falta evento ou mudou a porta; ligar de novo arruma.
 */
export function situacaoDosHooks(hooks: unknown, porta: number): SituacaoLigacao {
  if (!eObjeto(hooks)) return "desligada";
  const handlers = (evento: string): unknown[] => {
    const grupos = hooks[evento];
    if (!Array.isArray(grupos)) return [];
    return grupos.flatMap((g) => (eObjeto(g) && Array.isArray(g.hooks) ? (g.hooks as unknown[]) : []));
  };
  const algum = Object.keys(hooks).some((evento) => handlers(evento).some(eDoMoductus));
  if (!algum) return "desligada";
  const completo = EVENTOS_LIGADOS.every((evento) => {
    const esperado = canonico(hookDoMoductus(porta, evento));
    return handlers(evento).some((h) => canonico(h) === esperado);
  });
  return completo ? "ligada" : "desatualizada";
}

/* ----------------------------------------------------------------------------------------------
 * Edição do texto. O arquivo não é reserializado: só o valor da chave `hooks` é trocado, inserido
 * ou tirado, com o recuo e a quebra de linha do próprio arquivo. Assim ligar e desligar devolvem o
 * arquivo byte a byte, e a formatação do usuário fora do bloco nunca muda.
 * ------------------------------------------------------------------------------------------- */

interface Membro {
  chave: string;
  inicioChave: number;
  inicioValor: number;
  fimValor: number;
}

interface Raiz {
  abre: number;
  fecha: number;
  membros: Membro[];
}

const BRANCO = new Set([" ", "\t", "\r", "\n", "\uFEFF"]);

/** Membros do objeto raiz de um texto que o `JSON.parse` já aceitou. */
function lerRaiz(texto: string): Raiz {
  let i = 0;
  const pular = () => {
    while (i < texto.length && BRANCO.has(texto[i] ?? "")) i++;
  };
  const pularTexto = () => {
    i++;
    while (i < texto.length && texto[i] !== '"') i += texto[i] === "\\" ? 2 : 1;
    i++;
  };
  const pularValor = () => {
    const c = texto[i];
    if (c === '"') return pularTexto();
    if (c === "{" || c === "[") {
      let nivel = 0;
      do {
        const d = texto[i];
        if (d === '"') {
          pularTexto();
          continue;
        }
        if (d === "{" || d === "[") nivel++;
        if (d === "}" || d === "]") nivel--;
        i++;
      } while (nivel > 0 && i < texto.length);
      return;
    }
    while (i < texto.length && !BRANCO.has(texto[i] ?? "") && !",}]".includes(texto[i] ?? "")) i++;
  };

  pular();
  const abre = i;
  i++;
  const membros: Membro[] = [];
  for (;;) {
    pular();
    if (texto[i] === "}") return { abre, fecha: i, membros };
    const inicioChave = i;
    pularTexto();
    const chave = JSON.parse(texto.slice(inicioChave, i)) as string;
    pular();
    i++; // ":"
    pular();
    const inicioValor = i;
    pularValor();
    membros.push({ chave, inicioChave, inicioValor, fimValor: i });
    pular();
    if (texto[i] === ",") i++;
  }
}

/** Recuo de um nível: o da primeira linha recuada do arquivo; sem nenhuma, dois espaços. */
function recuoDe(texto: string): string {
  return /\n([ \t]+)\S/.exec(texto)?.[1] ?? "  ";
}

/**
 * O texto com a chave `chave` da raiz trocada por `valor` (`undefined` tira a chave). Chave nova
 * entra no fim do objeto; tirá-la apaga do fim do membro anterior ao fim dela, que é exatamente o
 * que a inserção acrescentou.
 */
export function trocarChaveRaiz(texto: string, chave: string, valor: unknown): string {
  const raiz = lerRaiz(texto);
  const eol = texto.includes("\r\n") ? "\r\n" : "\n";
  const recuo = recuoDe(texto);
  const primeiro = raiz.membros[0];
  const compacto = primeiro !== undefined && !texto.slice(raiz.abre, primeiro.inicioChave).includes("\n");
  const serializar = (v: unknown) =>
    compacto
      ? JSON.stringify(v)
      : JSON.stringify(v, null, recuo)
          .split("\n")
          .join(eol + recuo);

  const indice = raiz.membros.findIndex((m) => m.chave === chave);
  const membro = raiz.membros[indice];
  if (membro) {
    if (valor !== undefined) {
      return texto.slice(0, membro.inicioValor) + serializar(valor) + texto.slice(membro.fimValor);
    }
    const anterior = raiz.membros[indice - 1];
    const proximo = raiz.membros[indice + 1];
    if (anterior) return texto.slice(0, anterior.fimValor) + texto.slice(membro.fimValor);
    if (proximo) return texto.slice(0, membro.inicioChave) + texto.slice(proximo.inicioChave);
    return texto.slice(0, raiz.abre + 1) + texto.slice(raiz.fecha);
  }
  if (valor === undefined) return texto;
  const novo = `${JSON.stringify(chave)}:${compacto ? "" : " "}${serializar(valor)}`;
  const ultimo = raiz.membros.at(-1);
  if (ultimo) {
    const separador = compacto ? "," : `,${eol}${recuo}`;
    return texto.slice(0, ultimo.fimValor) + separador + novo + texto.slice(ultimo.fimValor);
  }
  return `${texto.slice(0, raiz.abre + 1)}${eol}${recuo}${novo}${eol}${texto.slice(raiz.fecha)}`;
}

/* ----------------------------------------------------------------------------------------------
 * O arquivo.
 * ------------------------------------------------------------------------------------------- */

interface Lido {
  /** Texto de hoje; arquivo que não existe (ou vazio) vale como `{}`. */
  texto: string;
  existe: boolean;
  hooks: unknown;
}

export interface OpcoesLigacao {
  /** O `settings.json` do Claude Code (`caminhoSettingsClaude()`; nos testes, uma pasta temporária). */
  caminho: string;
  /** Porta do receptor (`portaDosHooks()`). */
  porta: number;
  agora?: () => Date;
}

export interface ResultadoEscrita {
  /** O arquivo mudou; ligar o que já está ligado (ou desligar o desligado) não escreve nada. */
  mudou: boolean;
  /** Cópia do arquivo de antes da escrita; `null` quando não houve escrita ou o arquivo não existia. */
  copia: string | null;
}

/**
 * Instala e desinstala a ligação no `settings.json`. Antes de escrever, guarda uma cópia do
 * arquivo ao lado dele; escreve num temporário e troca, para que uma queda no meio não deixe o
 * arquivo pela metade. Arquivo que não é JSON (ou cuja raiz não é objeto) não é tocado.
 */
export class LigacaoClaudeCode {
  private readonly agora: () => Date;

  constructor(private readonly opcoes: OpcoesLigacao) {
    this.agora = opcoes.agora ?? (() => new Date());
  }

  get caminho(): string {
    return this.opcoes.caminho;
  }

  private ler(): Lido {
    const existe = existsSync(this.caminho);
    const texto = existe ? readFileSync(this.caminho, "utf8") : "";
    if (texto.trim() === "") return { texto: "{}", existe, hooks: undefined };
    let dado: unknown;
    try {
      dado = JSON.parse(texto.replace(/^\uFEFF/, ""));
    } catch {
      throw new SettingsInvalido(`${this.caminho} não é um JSON válido; corrija o arquivo antes de ligar`);
    }
    if (!eObjeto(dado)) throw new SettingsInvalido(`${this.caminho} não guarda um objeto JSON`);
    return { texto, existe, hooks: dado[TRECHO] };
  }

  situacao(): SituacaoLigacao {
    return situacaoDosHooks(this.ler().hooks, this.opcoes.porta);
  }

  /** O que ligar muda, sem gravar nada: só o bloco `hooks`, antes e depois. */
  previa(): MudancaArquivo {
    const { hooks } = this.ler();
    return {
      caminho: this.caminho,
      trecho: TRECHO,
      antes: hooks === undefined ? null : JSON.stringify(hooks, null, 2),
      depois: JSON.stringify(comOMoductus(hooks, this.opcoes.porta), null, 2),
    };
  }

  ligar(): ResultadoEscrita {
    const lido = this.ler();
    return this.escrever(lido, comOMoductus(lido.hooks, this.opcoes.porta));
  }

  desligar(): ResultadoEscrita {
    const lido = this.ler();
    return this.escrever(lido, semOMoductus(lido.hooks));
  }

  private escrever(lido: Lido, hooks: unknown): ResultadoEscrita {
    const novo = trocarChaveRaiz(lido.texto, TRECHO, hooks);
    // Arquivo novo ganha a quebra de linha final, como o Claude Code grava.
    const final = lido.existe ? novo : `${novo}\n`;
    if (lido.existe && final === lido.texto) return { mudou: false, copia: null };
    mkdirSync(dirname(this.caminho), { recursive: true });
    const copia = lido.existe ? this.copiar() : null;
    const temporario = `${this.caminho}.moductus-tmp`;
    writeFileSync(temporario, final, "utf8");
    renameSync(temporario, this.caminho);
    return { mudou: true, copia };
  }

  /** `settings.json.moductus-2026-10-09T12-00-00-000Z.bak`; das cópias do Moductus, ficam as últimas. */
  private copiar(): string {
    const pasta = dirname(this.caminho);
    const nome = basename(this.caminho);
    const carimbo = this.agora().toISOString().replace(/[:.]/g, "-");
    let copia = join(pasta, `${nome}.moductus-${carimbo}.bak`);
    for (let n = 2; existsSync(copia); n++) copia = join(pasta, `${nome}.moductus-${carimbo}-${n}.bak`);
    copyFileSync(this.caminho, copia);
    const prefixo = `${nome}.moductus-`;
    const copias = readdirSync(pasta)
      .filter((f) => f.startsWith(prefixo) && f.endsWith(".bak"))
      .sort();
    for (const antiga of copias.slice(0, Math.max(0, copias.length - COPIAS_GUARDADAS))) {
      rmSync(join(pasta, antiga), { force: true });
    }
    return copia;
  }
}
