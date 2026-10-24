import { z } from "zod";
import { Id, Instante } from "./comum.ts";

/**
 * Provedores de modelo (AGENTS.md §3; DATA.md §6 provedores). A chave de API vai da interface ao
 * serviço só para ser guardada no Gerenciador de Credenciais: nenhuma saída deste contrato a traz
 * de volta, nem o nome da credencial.
 */
export const TIPOS_PROVEDOR = [
  "claude-cli",
  "codex-cli",
  "gemini-cli",
  "opencode-cli",
  "anthropic",
  "openai",
  "openai-compativel",
  "gemini",
] as const;
export const TipoProvedor = z.enum(TIPOS_PROVEDOR);
export type TipoProvedor = z.infer<typeof TipoProvedor>;

/** Os que rodam um CLI com a assinatura do usuário: uso sem custo por token a mostrar. */
export const TIPOS_PROVEDOR_CLI = ["claude-cli", "codex-cli", "gemini-cli", "opencode-cli"] as const;
export const TipoProvedorCli = z.enum(TIPOS_PROVEDOR_CLI);
export type TipoProvedorCli = z.infer<typeof TipoProvedorCli>;

/**
 * O nome de cada CLI no PATH: o serviço procura por ele, e a interface diz qual rodar no terminal
 * quando o CLI está sem login.
 */
export const COMANDOS_CLI: Readonly<Record<TipoProvedorCli, string>> = {
  "claude-cli": "claude",
  "codex-cli": "codex",
  "gemini-cli": "gemini",
  "opencode-cli": "opencode",
};

/**
 * Como o uso de um provedor é pago (F2-09): `assinatura` (CLI com a conta do usuário: não há custo
 * por token a mostrar) ou `por_token` (API: custo estimado pela tabela de preços do serviço,
 * vazio quando o modelo não está nela).
 */
export const Cobranca = z.enum(["assinatura", "por_token"]);
export type Cobranca = z.infer<typeof Cobranca>;

/**
 * Por que o provedor falhou (F2-05): limite de uso, fora do ar, credencial recusada ou CLI
 * ausente. É o que decide se o agente dorme e até quando.
 */
export const MotivoFalhaProvedor = z.enum(["limite", "fora_do_ar", "credencial", "ausente"]);
export type MotivoFalhaProvedor = z.infer<typeof MotivoFalhaProvedor>;

export const FalhaProvedor = z.object({
  motivo: MotivoFalhaProvedor,
  mensagem: z.string(),
  /** Quando volta, se o provedor informou (fim da janela de uso). */
  voltaEm: Instante.nullable(),
});
export type FalhaProvedor = z.infer<typeof FalhaProvedor>;

const baseUrl = z.url({ protocol: /^https?$/, error: "o endereço precisa começar com http:// ou https://" });

/** Por que a chave não vai a um endereço `http:` de fora deste PC (F3-52). */
export const MENSAGEM_CHAVE_SEM_HTTPS = "A chave só vai por https, ou para um endereço deste PC.";

/**
 * A chave só sai por `https:`, ou por `http:` para este PC (localhost, 127.0.0.0/8, [::1]): em
 * `http:` para fora ela iria em texto aberto pela rede. Sem endereço (OpenAI, endereço fixo em
 * https) vale; endereço que não dá para ler não é deste ponto decidir.
 */
export function enderecoAceitaChave(endereco: string | null | undefined): boolean {
  if (!endereco) return true;
  let url: URL;
  try {
    url = new URL(endereco);
  } catch {
    return true;
  }
  if (url.protocol !== "http:") return true;
  const host = url.hostname;
  return host === "localhost" || host === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** O pedido que leva chave e endereço juntos é recusado já no canal quando a chave iria aberta. */
const chaveComEnderecoSeguro = (pedido: { baseUrl?: string | null; chave?: string | null }) =>
  typeof pedido.chave !== "string" || enderecoAceitaChave(pedido.baseUrl);
const recusaChave = { message: MENSAGEM_CHAVE_SEM_HTTPS, path: ["chave"] };

export const Provedor = z.object({
  id: Id,
  tipo: TipoProvedor,
  nome: z.string().min(1),
  modelo: z.string().min(1).nullable(),
  baseUrl: baseUrl.nullable(),
  /** Há uma chave guardada no Gerenciador de Credenciais para ele. */
  temChave: z.boolean(),
  testadoEm: Instante.nullable(),
  /**
   * O modelo chamou a ferramenta no último teste que passou (F3-52); `false` é "só conversa".
   * `null` (ou ausente): não testado, ou CLI.
   */
  ferramentas: z.boolean().nullable().optional(),
});
export type Provedor = z.infer<typeof Provedor>;

export const NovoProvedor = z
  .object({
    tipo: TipoProvedor,
    nome: z.string().trim().min(1),
    modelo: z.string().trim().min(1).nullable().optional(),
    baseUrl: baseUrl.nullable().optional(),
    /** Vai direto para o Gerenciador de Credenciais. */
    chave: z.string().min(1).optional(),
  })
  .refine(chaveComEnderecoSeguro, recusaChave);
export type NovoProvedor = z.infer<typeof NovoProvedor>;

/** Mudança parcial; `chave: null` apaga a chave guardada. */
export const MudancaProvedor = z
  .object({
    id: Id,
    nome: z.string().trim().min(1).optional(),
    modelo: z.string().trim().min(1).nullable().optional(),
    baseUrl: baseUrl.nullable().optional(),
    chave: z.string().min(1).nullable().optional(),
  })
  .refine(chaveComEnderecoSeguro, recusaChave);
export type MudancaProvedor = z.infer<typeof MudancaProvedor>;

export const PedidoProvedor = z.object({ id: Id });
export type PedidoProvedor = z.infer<typeof PedidoProvedor>;

/**
 * Um CLI achado no PATH (F2-08). `logado` é `null` quando o CLI não diz. A detecção só pergunta a
 * versão e o login: não chama o modelo nem gasta a assinatura.
 */
export const ProvedorDetectado = z.object({
  tipo: TipoProvedorCli,
  caminho: z.string().min(1),
  versao: z.string().nullable(),
  logado: z.boolean().nullable(),
  /**
   * Por que esta versão do Moductus não usa este CLI; `null` quando usa. `sem_adaptador`: ainda
   * não fala com ele (hoje só fala com o Claude Code). `instalado_pelo_npm`: o Claude Code achado
   * é um `.cmd` do npm em que o serviço não acha o programa que ele chama, e sem esse programa ele
   * só rodaria por shell (ADR-0037).
   */
  impedimento: z.enum(["sem_adaptador", "instalado_pelo_npm"]).nullable(),
  /** A versão que o Moductus pede, quando a achada é mais velha; `null` quando serve ou não dá para saber. */
  versaoMinima: z.string().nullable(),
});
export type ProvedorDetectado = z.infer<typeof ProvedorDetectado>;

/**
 * Testar um provedor (F2-08). `substitui`: provedores que ele toma o lugar se passar no teste
 * (os agentes que os usavam passam a usar este, e eles vão para a lixeira); se não passar, nada
 * muda. Id que já não existe é ignorado: já saiu.
 */
export const PedidoTesteProvedor = z.object({ id: Id, substitui: z.array(Id).max(20).optional() });
export type PedidoTesteProvedor = z.infer<typeof PedidoTesteProvedor>;

/** Resultado de uma chamada curta de verdade ao provedor (F2-08). */
export const ResultadoTesteProvedor = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    provedorId: Id,
    latenciaMs: z.number().int().nonnegative(),
    testadoEm: Instante,
    /**
     * O modelo chamou a ferramenta do teste (F3-52). `false`: ele só conversa, e os agentes não
     * consultam nem fazem nada com ele. `null` (ou ausente): não se testa, como no CLI, que usa as
     * ferramentas pelo MCP do Moductus.
     */
    ferramentas: z.boolean().nullable().optional(),
  }),
  z.object({ ok: z.literal(false), provedorId: Id, falha: FalhaProvedor, testadoEm: Instante }),
]);
export type ResultadoTesteProvedor = z.infer<typeof ResultadoTesteProvedor>;

/** Os tipos que falam a API da OpenAI e têm a lista de modelos em `GET {base_url}/models`. */
export const TIPOS_PROVEDOR_API = ["openai", "openai-compativel"] as const;
export const TipoProvedorApi = z.enum(TIPOS_PROVEDOR_API);
export type TipoProvedorApi = z.infer<typeof TipoProvedorApi>;

/**
 * Os modelos que um endereço oferece (F3-52), para escolher em vez de digitar. Serve o formulário
 * antes de gravar (endereço e chave vêm no pedido) e a edição de um provedor gravado (`id`): a
 * chave guardada só vai junto quando o endereço é o mesmo dela.
 */
export const PedidoModelosProvedor = z
  .object({
    id: Id.optional(),
    tipo: TipoProvedorApi,
    baseUrl: baseUrl.nullable().optional(),
    chave: z.string().min(1).optional(),
  })
  .refine(chaveComEnderecoSeguro, recusaChave);
export type PedidoModelosProvedor = z.infer<typeof PedidoModelosProvedor>;

/**
 * Um modelo da lista. `ferramentas` é o que o endereço diz dele (`supported_parameters` ou
 * `capabilities`); `null` quando não diz, e só o teste responde.
 */
export const ModeloDoProvedor = z.object({ id: z.string().min(1), ferramentas: z.boolean().nullable() });
export type ModeloDoProvedor = z.infer<typeof ModeloDoProvedor>;

export const ResultadoModelosProvedor = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), modelos: z.array(ModeloDoProvedor) }),
  z.object({ ok: z.literal(false), falha: FalhaProvedor }),
]);
export type ResultadoModelosProvedor = z.infer<typeof ResultadoModelosProvedor>;
