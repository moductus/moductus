import { win32 } from "node:path";

/**
 * O que uma regra criada a partir de um pedido cobre (`regras_permissao.padrao`, DATA.md §6).
 * "Sempre" vale para os próximos pedidos **iguais**: nenhum padrão libera a ferramenta inteira.
 *
 * - Comando de terminal: o próprio comando, sem prefixo nem curinga (`pnpm test` não autoriza
 *   `pnpm test && rm -rf .`).
 * - Ferramenta de arquivo: o caminho absoluto, normalizado (`..` resolvido). No escopo do projeto,
 *   só cobre caminho dentro da pasta do projeto.
 * - Busca na web: o domínio.
 * - O resto (MCP, ferramentas dos agentes do Moductus): a entrada inteira, com as chaves em ordem.
 */

const DE_COMANDO = new Set(["Bash", "PowerShell"]);
const CAMPO_DO_CAMINHO: Readonly<Record<string, string>> = {
  Edit: "file_path",
  MultiEdit: "file_path",
  Write: "file_path",
  Read: "file_path",
  NotebookEdit: "notebook_path",
};

/** A ferramenta mexe num arquivo: o padrão é um caminho. */
export function ehDeArquivo(ferramenta: string): boolean {
  return Object.hasOwn(CAMPO_DO_CAMINHO, ferramenta);
}

/**
 * O que um pedido guarda da entrada: das ferramentas de arquivo, só o caminho (o que o padrão e
 * o cartão usam); o conteúdo (`old_string`, `content`, o texto inteiro) não vai ao banco nem às
 * janelas. As outras ficam com a entrada como veio.
 */
export function entradaParaGuardar(ferramenta: string, entrada: unknown): unknown {
  const campo = CAMPO_DO_CAMINHO[ferramenta];
  if (campo === undefined) return entrada;
  const campos = typeof entrada === "object" && entrada !== null ? (entrada as Record<string, unknown>) : {};
  return Object.hasOwn(campos, campo) ? { [campo]: campos[campo] } : {};
}

/**
 * O padrão do pedido, ou `null` quando ele não tem o que comparar (comando ausente, caminho
 * relativo, endereço inválido): pedido assim não vira regra nem é coberto por uma.
 */
export function padraoDe(ferramenta: string, entrada: unknown): string | null {
  const campos = typeof entrada === "object" && entrada !== null ? (entrada as Record<string, unknown>) : {};
  if (DE_COMANDO.has(ferramenta)) {
    const comando = campos.command;
    return typeof comando === "string" && comando.trim() !== "" ? comando.trim() : null;
  }
  const campo = CAMPO_DO_CAMINHO[ferramenta];
  if (campo !== undefined) {
    const caminho = campos[campo];
    return typeof caminho === "string" ? caminhoNormalizado(caminho) : null;
  }
  if (ferramenta === "WebFetch") return dominioDe(campos.url);
  return entradaCanonica(entrada ?? null);
}

/** A regra cobre o pedido: o mesmo padrão (caminho sem diferença de caixa, como no Windows). */
export function cobre(ferramenta: string, padraoDaRegra: string, padraoDoPedido: string | null): boolean {
  if (padraoDoPedido === null) return false;
  if (ehDeArquivo(ferramenta)) return chave(padraoDaRegra) === chave(padraoDoPedido);
  return padraoDaRegra === padraoDoPedido;
}

/** `caminho` é a pasta `base` ou está dentro dela, depois de resolver `..`, barra e caixa. */
export function dentroDe(caminho: string, base: string): boolean {
  const c = caminhoNormalizado(caminho);
  const b = caminhoNormalizado(base);
  if (c === null || b === null) return false;
  const kc = chave(c);
  const kb = chave(b);
  return kc === kb || kc.startsWith(kb.endsWith("\\") ? kb : `${kb}\\`);
}

/** Caminho absoluto do Windows, com `..` resolvido e sem barra no fim; relativo não serve. */
function caminhoNormalizado(caminho: string): string | null {
  if (caminho.trim() === "" || !win32.isAbsolute(caminho)) return null;
  const normal = win32.normalize(caminho);
  // A raiz do disco (`V:\`) fica com a barra; o resto, sem.
  return normal.length > 3 ? normal.replace(/\\+$/, "") : normal;
}

function chave(caminho: string): string {
  return caminho.toLowerCase();
}

function dominioDe(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const { hostname } = new URL(url);
    return hostname === "" ? null : hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** JSON com as chaves dos objetos em ordem: a mesma entrada dá sempre o mesmo texto. */
function entradaCanonica(valor: unknown): string {
  return JSON.stringify(ordenado(valor));
}

function ordenado(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenado);
  if (typeof valor === "object" && valor !== null) {
    return Object.fromEntries(
      Object.keys(valor)
        .sort()
        .map((k) => [k, ordenado((valor as Record<string, unknown>)[k])]),
    );
  }
  return valor;
}
