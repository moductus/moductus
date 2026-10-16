import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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

/**
 * Cópias de segurança guardadas ao lado do `settings.json`: a primeira, que é o arquivo de antes
 * do Moductus, e as últimas; as do meio saem.
 */
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

/**
 * Para comparar o bloco de antes de ligar com o que sobra ao desligar: evento com lista vazia e
 * bloco ausente valem como nada, porque a retirada do Moductus não sabe deixá-los de volta.
 */
function semVazios(hooks: unknown): string {
  if (hooks === undefined) return "{}";
  if (!eObjeto(hooks)) return canonico(hooks);
  const resto = Object.fromEntries(
    Object.entries(hooks).filter(([, grupos]) => !(Array.isArray(grupos) && grupos.length === 0)),
  );
  return canonico(resto);
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

/** O novo valor da chave: um dado, serializado no estilo do arquivo, ou um texto já pronto. */
type NovoValor = { valor: unknown } | { bruto: string } | undefined;

function editarChaveRaiz(texto: string, chave: string, novoValor: NovoValor): string {
  const raiz = lerRaiz(texto);
  const eol = texto.includes("\r\n") ? "\r\n" : "\n";
  const recuo = recuoDe(texto);
  const primeiro = raiz.membros[0];
  const compacto = primeiro !== undefined && !texto.slice(raiz.abre, primeiro.inicioChave).includes("\n");
  const serializar = (v: NonNullable<NovoValor>) => {
    if ("bruto" in v) return v.bruto;
    return compacto
      ? JSON.stringify(v.valor)
      : JSON.stringify(v.valor, null, recuo)
          .split("\n")
          .join(eol + recuo);
  };

  const indice = raiz.membros.findIndex((m) => m.chave === chave);
  const membro = raiz.membros[indice];
  if (membro) {
    if (novoValor !== undefined) {
      return texto.slice(0, membro.inicioValor) + serializar(novoValor) + texto.slice(membro.fimValor);
    }
    const anterior = raiz.membros[indice - 1];
    const proximo = raiz.membros[indice + 1];
    if (anterior) return texto.slice(0, anterior.fimValor) + texto.slice(membro.fimValor);
    if (proximo) return texto.slice(0, membro.inicioChave) + texto.slice(proximo.inicioChave);
    return texto.slice(0, raiz.abre + 1) + texto.slice(raiz.fecha);
  }
  if (novoValor === undefined) return texto;
  const novo = `${JSON.stringify(chave)}:${compacto ? "" : " "}${serializar(novoValor)}`;
  const ultimo = raiz.membros.at(-1);
  if (ultimo) {
    const separador = compacto ? "," : `,${eol}${recuo}`;
    return texto.slice(0, ultimo.fimValor) + separador + novo + texto.slice(ultimo.fimValor);
  }
  return `${texto.slice(0, raiz.abre + 1)}${eol}${recuo}${novo}${eol}${texto.slice(raiz.fecha)}`;
}

/**
 * O texto com a chave `chave` da raiz trocada por `valor` (`undefined` tira a chave). Chave nova
 * entra no fim do objeto; tirá-la apaga do fim do membro anterior ao fim dela, que é exatamente o
 * que a inserção acrescentou.
 */
export function trocarChaveRaiz(texto: string, chave: string, valor: unknown): string {
  return editarChaveRaiz(texto, chave, valor === undefined ? undefined : { valor });
}

/** O texto do valor da chave da raiz, como está no arquivo; `null` quando a chave não existe. */
export function textoDaChaveRaiz(texto: string, chave: string): string | null {
  const membro = lerRaiz(texto).membros.find((m) => m.chave === chave);
  return membro ? texto.slice(membro.inicioValor, membro.fimValor) : null;
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

/**
 * O que havia antes de ligar, para desligar devolver o bloco `hooks` como estava, byte a byte
 * (escapes, números como `5.0`, bloco compacto, `{}` vazio), e apagar o arquivo que o Moductus
 * criou. Vale só para o mesmo caminho e só se o que sobra sem o Moductus for o mesmo dado.
 */
export interface Memoria {
  caminho: string;
  criouArquivo: boolean;
  /** O texto do valor de `hooks` antes de ligar; `null` quando a chave não existia. */
  hooks: string | null;
  /**
   * O arquivo inteiro, só quando a raiz era um objeto vazio (`{}`, `{\n}`): não há o que
   * esconder nele, e é o único jeito de devolver o espaço entre as chaves como era.
   */
  vazio: string | null;
}

/** Escreve um arquivo; os testes trocam para simular disco cheio no meio da escrita. */
export type Gravar = (caminho: string, conteudo: string | Buffer) => void;

export interface OpcoesLigacao {
  /** O `settings.json` do Claude Code (`caminhoSettingsClaude()`; nos testes, uma pasta temporária). */
  caminho: string;
  /** Porta do receptor (`portaDosHooks()`). */
  porta: number;
  /**
   * Arquivo onde a memória de antes de ligar sobrevive a reinícios (na pasta de dados do
   * Moductus); sem ele, a memória fica só neste processo.
   */
  memoria?: string;
  /**
   * Pasta das cópias de segurança quando a pasta do `settings.json` é junção ou link para outro
   * lugar (um repositório de configuração, que não deve ganhar `.bak`): a pasta de dados do
   * Moductus. Sem ela, as cópias ficam na pasta declarada mesmo assim.
   */
  copiasForaDoLink?: string;
  gravar?: Gravar;
  agora?: () => Date;
}

export interface ResultadoEscrita {
  /** O arquivo mudou; ligar o que já está ligado (ou desligar o desligado) não escreve nada. */
  mudou: boolean;
  /** Cópia do arquivo de antes da escrita; `null` quando não houve escrita ou o arquivo não existia. */
  copia: string | null;
}

/**
 * A pasta, ou alguma acima dela, é junção ou link simbólico. Olha cada trecho do caminho em vez de
 * comparar com o `realpath`, que no Windows também expande nome curto (`RUNNER~1`, `PROGRA~1`) e
 * corrige a caixa das letras: nada disso é link, e as cópias continuam ao lado do arquivo.
 */
function passaPorLink(pasta: string): boolean {
  let atual = resolve(pasta);
  while (!lstatSync(atual).isSymbolicLink()) {
    const acima = dirname(atual);
    if (acima === atual) return false;
    atual = acima;
  }
  return true;
}

/** `settings.json.moductus-2026-10-09T12-00-00-000Z.bak`, e `-2.bak`, `-3.bak` na colisão. */
const COPIA = /\.moductus-(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z)(?:-(\d+))?\.bak$/;

/**
 * Instala e desinstala a ligação no `settings.json`. Antes de escrever, guarda uma cópia do
 * arquivo ao lado dele. Arquivo que não é JSON (ou cuja raiz não é objeto) não é tocado.
 *
 * O `settings.json` pode ser link para um repositório de configuração: a escrita vai ao arquivo
 * de verdade (`realpath`), por um temporário na pasta dele e troca de nome, para que uma queda no
 * meio não deixe o arquivo pela metade. Com mais de um nome para o mesmo arquivo (hardlink), a
 * troca de nome quebraria o vínculo: aí o conteúdo, já validado e com a cópia feita, é gravado
 * por cima, depois de um temporário provar que cabe no disco; se a escrita falhar no meio, o
 * conteúdo de antes volta.
 */
export class LigacaoClaudeCode {
  private readonly agora: () => Date;
  private readonly gravar: Gravar;
  private memoriaLocal: Memoria | null = null;

  constructor(private readonly opcoes: OpcoesLigacao) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.gravar = opcoes.gravar ?? ((caminho, conteudo) => writeFileSync(caminho, conteudo));
  }

  get caminho(): string {
    return this.opcoes.caminho;
  }

  /** A porta do receptor que os hooks chamam. */
  get porta(): number {
    return this.opcoes.porta;
  }

  /**
   * O nome da cópia de segurança mais recente do `settings.json`, para a tela de Conexões dizer
   * onde está o arquivo de antes; `null` sem cópia ou sem como olhar a pasta.
   */
  ultimaCopia(): string | null {
    try {
      return this.copiasEm(this.pastaDasCopias()).at(-1)?.f ?? null;
    } catch {
      return null;
    }
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

  /**
   * Liga. Se ainda não havia nada do Moductus no arquivo, guarda a memória de antes; religar (por
   * troca de porta, por exemplo) mantém a memória da primeira vez.
   */
  ligar(): ResultadoEscrita {
    const lido = this.ler();
    const primeiraVez = situacaoDosHooks(lido.hooks, this.opcoes.porta) === "desligada";
    const memoria: Memoria = {
      caminho: this.caminho,
      criouArquivo: !lido.existe,
      hooks: lido.existe ? textoDaChaveRaiz(lido.texto, TRECHO) : null,
      vazio: lido.existe && lerRaiz(lido.texto).membros.length === 0 ? lido.texto : null,
    };
    const resultado = this.escrever(
      lido,
      trocarChaveRaiz(lido.texto, TRECHO, comOMoductus(lido.hooks, this.opcoes.porta)),
    );
    if (primeiraVez && resultado.mudou) this.guardarMemoria(memoria);
    return resultado;
  }

  /**
   * Desliga. Com a memória de antes de ligar e nada mudado no que é do usuário, o bloco volta
   * como era, byte a byte, e o arquivo que o Moductus criou sai se ficou vazio. Sem memória (ou
   * com o bloco mudado pelo usuário), só os hooks do Moductus saem.
   */
  desligar(): ResultadoEscrita {
    const lido = this.ler();
    const memoria = this.lerMemoria();
    // Nada do Moductus no arquivo: nada a desfazer, e o bloco do usuário não é reescrito.
    if (situacaoDosHooks(lido.hooks, this.opcoes.porta) === "desligada") {
      this.guardarMemoria(null);
      return { mudou: false, copia: null };
    }
    const sobra = semOMoductus(lido.hooks);
    let texto = trocarChaveRaiz(lido.texto, TRECHO, sobra);
    if (memoria && this.mesmoDeAntes(memoria, sobra)) {
      texto = editarChaveRaiz(
        lido.texto,
        TRECHO,
        memoria.hooks === null ? undefined : { bruto: memoria.hooks },
      );
      const vazia = lerRaiz(texto).membros.length === 0;
      if (vazia && memoria.criouArquivo && this.apagarCriado()) {
        this.guardarMemoria(null);
        return { mudou: true, copia: null };
      }
      if (vazia && memoria.vazio !== null) texto = memoria.vazio;
    }
    const resultado = this.escrever(lido, texto);
    this.guardarMemoria(null);
    return resultado;
  }

  private mesmoDeAntes(memoria: Memoria, sobra: unknown): boolean {
    if (memoria.caminho !== this.caminho) return false;
    try {
      const antes: unknown = memoria.hooks === null ? undefined : JSON.parse(memoria.hooks);
      return semVazios(antes) === semVazios(sobra);
    } catch {
      return false;
    }
  }

  /** Só apaga o arquivo comum, de um nome só, que o próprio Moductus criou. */
  private apagarCriado(): boolean {
    const info = lstatSync(this.caminho);
    if (!info.isFile() || info.nlink > 1) return false;
    rmSync(this.caminho);
    return true;
  }

  private lerMemoria(): Memoria | null {
    const arquivo = this.opcoes.memoria;
    if (!arquivo) return this.memoriaLocal;
    try {
      const dado = JSON.parse(readFileSync(arquivo, "utf8")) as Partial<Memoria>;
      const valida =
        typeof dado.caminho === "string" &&
        typeof dado.criouArquivo === "boolean" &&
        (dado.hooks === null || typeof dado.hooks === "string");
      if (!valida) return null;
      return { ...(dado as Memoria), vazio: typeof dado.vazio === "string" ? dado.vazio : null };
    } catch {
      return null;
    }
  }

  private guardarMemoria(memoria: Memoria | null): void {
    const arquivo = this.opcoes.memoria;
    if (!arquivo) {
      this.memoriaLocal = memoria;
      return;
    }
    if (memoria === null) {
      rmSync(arquivo, { force: true });
      return;
    }
    mkdirSync(dirname(arquivo), { recursive: true });
    writeFileSync(arquivo, JSON.stringify(memoria), "utf8");
  }

  private escrever(lido: Lido, novo: string): ResultadoEscrita {
    // Arquivo novo ganha a quebra de linha final, como o Claude Code grava.
    const final = lido.existe ? novo : `${novo}\n`;
    if (lido.existe && final === lido.texto) return { mudou: false, copia: null };
    // Nada sai daqui que o Claude Code não consiga ler.
    if (!eObjeto(JSON.parse(final.replace(/^\uFEFF/, "")))) {
      throw new SettingsInvalido("a edição do settings.json não deu um objeto JSON");
    }
    if (!lido.existe) {
      mkdirSync(dirname(this.caminho), { recursive: true });
      this.trocarPorTemporario(this.caminho, final);
      return { mudou: true, copia: null };
    }
    const alvo = realpathSync(this.caminho);
    const copia = this.copiar(alvo);
    if (statSync(alvo).nlink > 1) this.gravarNoLugar(alvo, final);
    else this.trocarPorTemporario(alvo, final);
    return { mudou: true, copia };
  }

  private temporario(alvo: string): string {
    return join(dirname(alvo), `${basename(alvo)}.moductus-tmp`);
  }

  private trocarPorTemporario(alvo: string, conteudo: string): void {
    const temporario = this.temporario(alvo);
    this.gravar(temporario, conteudo);
    renameSync(temporario, alvo);
  }

  /**
   * Hardlink: o temporário só prova que o conteúdo cabe no disco e sai; a escrita é no próprio
   * arquivo, para os outros nomes verem a mudança. Falha no meio devolve os bytes de antes.
   */
  private gravarNoLugar(alvo: string, conteudo: string): void {
    const temporario = this.temporario(alvo);
    try {
      this.gravar(temporario, conteudo);
    } finally {
      rmSync(temporario, { force: true });
    }
    const antes = readFileSync(alvo);
    try {
      this.gravar(alvo, conteudo);
    } catch (erro) {
      this.gravar(alvo, antes);
      throw erro;
    }
  }

  /**
   * Onde ficam as cópias: junto do `settings.json`, a não ser que a própria pasta seja junção ou
   * link para outro lugar; aí na pasta de dados do Moductus, para não sujar o repositório.
   */
  private pastaDasCopias(): string {
    const declarada = dirname(this.caminho);
    const reserva = this.opcoes.copiasForaDoLink;
    if (!reserva || !passaPorLink(declarada)) return declarada;
    mkdirSync(reserva, { recursive: true });
    return reserva;
  }

  /** Copia o conteúdo do arquivo de verdade (nunca o link). Ficam a primeira cópia e as últimas. */
  /** As cópias do `settings.json` na pasta, da mais antiga para a mais nova. */
  private copiasEm(pasta: string): { f: string; carimbo: string; n: number }[] {
    const nome = basename(this.caminho);
    return readdirSync(pasta)
      .flatMap((f) => {
        const achado = f.startsWith(`${nome}.moductus-`) ? COPIA.exec(f) : null;
        return achado ? [{ f, carimbo: achado[1] ?? "", n: Number(achado[2] ?? "1") }] : [];
      })
      .sort((a, b) => (a.carimbo === b.carimbo ? a.n - b.n : a.carimbo < b.carimbo ? -1 : 1));
  }

  private copiar(origem: string): string {
    const pasta = this.pastaDasCopias();
    const nome = basename(this.caminho);
    const carimbo = this.agora().toISOString().replace(/[:.]/g, "-");
    const lista = () => this.copiasEm(pasta);
    // Na colisão, o sufixo segue o maior do mesmo instante, nunca reaproveita um que saiu.
    const maior = Math.max(
      0,
      ...lista()
        .filter((c) => c.carimbo === carimbo)
        .map((c) => c.n),
    );
    const copia = join(pasta, `${nome}.moductus-${carimbo}${maior === 0 ? "" : `-${maior + 1}`}.bak`);
    copyFileSync(origem, copia);
    const copias = lista();
    for (const antiga of copias.slice(1, Math.max(1, copias.length - COPIAS_GUARDADAS))) {
      rmSync(join(pasta, antiga.f), { force: true });
    }
    return copia;
  }
}
