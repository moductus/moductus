import { randomBytes } from "node:crypto";
import type { Credenciais } from "../casca/credenciais.ts";

/** Nome no Gerenciador de Credenciais (fica "Moductus/hooks"). */
export const CREDENCIAL_HOOKS = "hooks";

/**
 * Token dos hooks (ADR-0015): próprio e estável, ao contrário do token das janelas, que muda a
 * cada subida, porque o `settings.json` do usuário o lê de `MODUCTUS_HOOKS_TOKEN`. Na primeira
 * subida é sorteado e guardado; dali em diante, o mesmo. Nunca vai para log nem para o banco.
 */
export async function tokenDosHooks(
  credenciais: Credenciais,
  sortear: () => string = () => randomBytes(32).toString("base64url"),
): Promise<string> {
  const guardado = await credenciais.ler(CREDENCIAL_HOOKS);
  if (guardado) return guardado;
  const novo = sortear();
  await credenciais.guardar(CREDENCIAL_HOOKS, novo);
  return novo;
}
