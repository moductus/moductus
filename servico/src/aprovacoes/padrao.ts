/** O padrão que cobre a ferramenta inteira, dentro do escopo da regra. */
export const TODA_A_FERRAMENTA = "*";

/** Ferramentas de terminal: o comando muda tudo, então a regra vale só para o mesmo comando. */
const DE_COMANDO = new Set(["Bash", "PowerShell"]);

/**
 * O que uma regra criada a partir deste pedido cobre (`regras_permissao.padrao`, DATA.md §6).
 *
 * Comando de terminal vira o próprio comando, sem prefixo nem curinga: `pnpm test` não autoriza
 * `pnpm test && rm -rf .`. O resto cobre a ferramenta inteira no escopo escolhido, como o próprio
 * Claude Code faz com edições, e como se lê "sempre para este agente" num pedido do Moductus: o
 * agente pode usar aquela ferramenta sem cartão. A regra aparece na lista e sai com um clique.
 *
 * `null` quando o pedido não tem o que comparar (comando ausente): não vira regra, e só uma regra
 * da ferramenta inteira o cobre.
 */
export function padraoDe(ferramenta: string, entrada: unknown): string | null {
  if (!DE_COMANDO.has(ferramenta)) return TODA_A_FERRAMENTA;
  const comando = (entrada as { command?: unknown } | null)?.command;
  return typeof comando === "string" && comando.trim() !== "" ? comando.trim() : null;
}

/** A regra cobre o pedido: a ferramenta inteira ou exatamente o mesmo padrão. */
export function cobre(padraoDaRegra: string, padraoDoPedido: string | null): boolean {
  return padraoDaRegra === TODA_A_FERRAMENTA || padraoDaRegra === padraoDoPedido;
}
