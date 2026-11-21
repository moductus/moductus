import { z } from "zod";
import { CamposOrigem, Dia, Id, Instante } from "./comum.ts";
import { Centavos, Moeda, NovaConta, NovaRegraCategoria, PropostaRegra, RegraCategoria } from "./financas.ts";

/**
 * Importar extrato (ADR-0041, ADR-0042, ADR-0045; DATA.md §3 `importacoes`, `perfis_importacao`):
 * ler o arquivo autorizado (ADR-0044), escolher a conta e, no CSV sem perfil, as colunas; revisar a
 * prévia (novos, repetidos, possíveis repetidos, categorias e sugestões da Tula) e lançar numa
 * transação; desfazer a importação inteira. Quem lê, reconhece repetidos e categoriza é o serviço
 * (`areas/financas/importacao`); aqui só a forma.
 */

/** "XML" é OFX 2.x (ADR-0041); o leitor decide pelo conteúdo, não pela extensão. */
export const FormatoExtrato = z.enum(["ofx", "csv", "xml"]);
export type FormatoExtrato = z.infer<typeof FormatoExtrato>;

export const EstadoImportacao = z.enum(["previa", "concluida", "desfeita", "falhou"]);
export type EstadoImportacao = z.infer<typeof EstadoImportacao>;

/** O extrato é de conta ou de cartão (`perfis_importacao.tipo_conta`). */
export const TipoContaExtrato = z.enum(["conta", "cartao"]);
export type TipoContaExtrato = z.infer<typeof TipoContaExtrato>;

const Periodo = z.object({ inicio: Dia.nullable(), fim: Dia.nullable() });

/** Uma importação: do arquivo fica só o nome, nunca o caminho; sem conta, só a que falhou antes. */
export const Importacao = z.object({
  id: Id,
  contaId: Id.nullable(),
  arquivoNome: z.string().min(1),
  formato: FormatoExtrato,
  perfilId: Id.nullable(),
  periodoInicio: Dia.nullable(),
  periodoFim: Dia.nullable(),
  lancamentosNovos: z.number().int().nonnegative(),
  /** Os que já existiam e ficaram de fora. */
  lancamentosIgnorados: z.number().int().nonnegative(),
  estado: EstadoImportacao,
  erro: z.string().min(1).nullable(),
  ...CamposOrigem,
  criadoEm: Instante,
  atualizadoEm: Instante,
});
export type Importacao = z.infer<typeof Importacao>;

/** Sem conta, as de todas, da mais nova para a mais antiga ("Último extrato: Nubank, ontem"). */
export const PedidoImportacoes = z.object({
  contaId: Id.optional(),
  limite: z.number().int().min(1).max(200).optional(),
});
export type PedidoImportacoes = z.infer<typeof PedidoImportacoes>;

export const PedidoImportacao = z.object({ id: Id });
export type PedidoImportacao = z.infer<typeof PedidoImportacao>;

// ---------- CSV: o mapeamento das colunas ----------

export const SeparadorCsv = z.enum([";", ",", "\t"]);
export type SeparadorCsv = z.infer<typeof SeparadorCsv>;

export const DecimalCsv = z.enum([",", "."]);
export type DecimalCsv = z.infer<typeof DecimalCsv>;

/** Os formatos de data que o leitor conhece; hora depois da data é ignorada. */
export const FormatoDataCsv = z.enum([
  "dd/mm/aaaa",
  "dd/mm/aa",
  "dd-mm-aaaa",
  "dd.mm.aaaa",
  "aaaa-mm-dd",
  "mm/dd/aaaa",
]);
export type FormatoDataCsv = z.infer<typeof FormatoDataCsv>;

export const CodificacaoCsv = z.enum(["utf-8", "windows-1252"]);
export type CodificacaoCsv = z.infer<typeof CodificacaoCsv>;

const coluna = z.number().int().min(0);

/**
 * Como o valor sai das colunas: uma coluna com sinal (e o que o negativo quer dizer: no extrato de
 * conta é saída; no de cartão, em geral, a compra vem positiva) ou duas, débito e crédito, sem sinal.
 */
export const ValorCsv = z.discriminatedUnion("modo", [
  z.object({ modo: z.literal("sinal"), coluna, negativo: z.enum(["saida", "entrada"]) }),
  z.object({ modo: z.literal("debito_credito"), debito: coluna, credito: coluna }),
]);
export type ValorCsv = z.infer<typeof ValorCsv>;

/**
 * O `mapeamento` do perfil (DATA.md §3): as colunas pela posição, do zero. `cabecalho` é a linha de
 * títulos como veio, e é por ela, exata, que o perfil é reconhecido na próxima vez; vazio quando o
 * arquivo não tem títulos. `pularLinhas` são as linhas antes dela (agência, conta, período).
 */
export const MapeamentoCsv = z.object({
  pularLinhas: z.number().int().min(0).default(0),
  cabecalho: z.array(z.string()).min(1).nullable(),
  data: coluna,
  /** Mais de uma coluna junta com espaço ("Histórico" e "Complemento"). */
  descricao: z.array(coluna).min(1),
  valor: ValorCsv,
  identificador: coluna.nullable().default(null),
});
export type MapeamentoCsv = z.infer<typeof MapeamentoCsv>;

/** O mapeamento e o que o leitor precisa fixar para ler o CSV. */
export const LeituraCsv = z.object({
  mapeamento: MapeamentoCsv,
  separador: SeparadorCsv,
  formatoDecimal: DecimalCsv,
  formatoData: FormatoDataCsv,
  codificacao: CodificacaoCsv,
});
export type LeituraCsv = z.infer<typeof LeituraCsv>;

/**
 * O que a amostra do CSV sem perfil deu (quadro `ExtratoColunas`): separador, codificação,
 * decimal, data, o mapeamento sugerido (vazio quando falta data, descrição ou valor), as primeiras
 * linhas para a tabela e a frase da Tula.
 */
export const DeteccaoCsv = z.object({
  codificacao: CodificacaoCsv,
  separador: SeparadorCsv,
  formatoDecimal: DecimalCsv,
  formatoData: FormatoDataCsv.nullable(),
  mapeamento: MapeamentoCsv.nullable(),
  pularLinhas: z.number().int().nonnegative(),
  cabecalho: z.array(z.string()).nullable(),
  colunas: z.number().int().nonnegative(),
  amostra: z.array(z.array(z.string())),
  /** "CSV · 96 linhas". */
  totalLinhas: z.number().int().nonnegative(),
  frase: z.string().min(1),
});
export type DeteccaoCsv = z.infer<typeof DeteccaoCsv>;

// ---------- Perfis ----------

/**
 * Como ler o extrato de um banco: os de fábrica (com arquivo real conferido) e os que você mapeou.
 * O OFX não tem mapeamento. Separador, data, decimal e codificação vazios são detectados pela
 * amostra.
 */
export const PerfilImportacao = z.object({
  id: Id,
  banco: z.string().min(1),
  tipoConta: TipoContaExtrato,
  formato: FormatoExtrato,
  mapeamento: MapeamentoCsv.nullable(),
  separador: SeparadorCsv.nullable(),
  formatoData: FormatoDataCsv.nullable(),
  formatoDecimal: DecimalCsv.nullable(),
  codificacao: CodificacaoCsv.nullable(),
  deFabrica: z.boolean(),
  ...CamposOrigem,
  criadoEm: Instante,
  atualizadoEm: Instante,
});
export type PerfilImportacao = z.infer<typeof PerfilImportacao>;

/** "Salvar como perfil" (`Cooperativa · conta corrente`): o mesmo cabeçalho atualiza o que já existe. */
export const NovoPerfilImportacao = z.object({
  banco: z.string().trim().min(1).max(60),
  tipoConta: TipoContaExtrato,
});
export type NovoPerfilImportacao = z.infer<typeof NovoPerfilImportacao>;

export const PedidoPerfilImportacao = z.object({ id: Id });
export type PedidoPerfilImportacao = z.infer<typeof PedidoPerfilImportacao>;

// ---------- Ler o arquivo ----------

/** Ler o arquivo que o usuário escolheu, pela autorização de uso único (`arquivos.autorizar`). */
export const PedidoLerExtrato = z.object({ autorizacaoId: Id });
export type PedidoLerExtrato = z.infer<typeof PedidoLerExtrato>;

/** O mesmo arquivo (pelo hash) já entrou: quando e por qual importação ("Este arquivo já entrou em 12/11"). */
const JaImportado = z.object({ importacaoId: Id, em: Instante }).nullable();

/**
 * Um extrato dentro do OFX (o arquivo pode trazer mais de um). Do número da conta só os últimos
 * dígitos, para escolher a conta; `contaId` é a conta daqui que já casou com ele.
 */
export const ExtratoLido = z.object({
  indice: z.number().int().nonnegative(),
  tipo: TipoContaExtrato,
  banco: z.string().min(1).nullable(),
  contaFinal: z.string().min(1).max(8),
  moeda: Moeda,
  periodo: Periodo,
  transacoes: z.number().int().nonnegative(),
  contaId: Id.nullable(),
});
export type ExtratoLido = z.infer<typeof ExtratoLido>;

/**
 * O que a leitura achou, antes de escolher a conta: os extratos do OFX, ou a detecção do CSV e o
 * perfil reconhecido pelo cabeçalho. `leituraId` segue para a prévia; o arquivo não é lido de novo.
 */
export const LeituraExtrato = z.discriminatedUnion("leitor", [
  z.object({
    leitor: z.literal("ofx"),
    leituraId: Id,
    arquivoNome: z.string().min(1),
    formato: FormatoExtrato.extract(["ofx", "xml"]),
    jaImportado: JaImportado,
    versao: z.string().min(1).nullable(),
    extratos: z.array(ExtratoLido).min(1),
  }),
  z.object({
    leitor: z.literal("csv"),
    leituraId: Id,
    arquivoNome: z.string().min(1),
    formato: z.literal("csv"),
    jaImportado: JaImportado,
    perfilId: Id.nullable(),
    deteccao: DeteccaoCsv,
  }),
]);
export type LeituraExtrato = z.infer<typeof LeituraExtrato>;

// ---------- Prévia ----------

/**
 * Montar a prévia: a conta de destino (uma que existe ou uma nova, criada ao lançar), o extrato do
 * OFX (`extrato`, o primeiro sem o campo) e, no CSV, o perfil ou a leitura pelas colunas, que pode
 * virar perfil (`salvarPerfil`).
 */
export const PedidoPreviaImportacao = z
  .object({
    leituraId: Id,
    contaId: Id.optional(),
    novaConta: NovaConta.optional(),
    extrato: z.number().int().nonnegative().optional(),
    perfilId: Id.optional(),
    csv: LeituraCsv.optional(),
    salvarPerfil: NovoPerfilImportacao.optional(),
  })
  .refine((p) => (p.contaId === undefined) !== (p.novaConta === undefined), {
    path: ["contaId"],
    message: "escolha uma conta ou crie uma nova",
  })
  .refine((p) => p.perfilId === undefined || p.csv === undefined, {
    path: ["csv"],
    message: "o CSV é lido pelo perfil ou pelas colunas, não pelos dois",
  })
  .refine((p) => p.salvarPerfil === undefined || p.csv !== undefined, {
    path: ["salvarPerfil"],
    message: "só as colunas escolhidas viram perfil",
  });
export type PedidoPreviaImportacao = z.infer<typeof PedidoPreviaImportacao>;

/**
 * Cada linha diante do que a conta já tem (ADR-0042): nova; repetida (fica de fora); possível
 * repetida (mesmo valor a ±1 dia, desmarcada por padrão, você decide); ou conciliada com um
 * lançamento feito à mão.
 */
export const SituacaoLinha = z.enum(["nova", "repetida", "possivel_repetida", "conciliada"]);
export type SituacaoLinha = z.infer<typeof SituacaoLinha>;

/** De onde veio a categoria (ADR-0045): regra, o lançamento igual anterior, sugestão da Tula ou você. */
export const CategoriaPor = z.enum(["regra", "anterior", "tula", "usuario"]);
export type CategoriaPor = z.infer<typeof CategoriaPor>;

export const LinhaPrevia = z
  .object({
    indice: z.number().int().nonnegative(),
    data: Dia,
    descricao: z.string().min(1),
    descricaoOriginal: z.string().min(1),
    valorCentavos: Centavos,
    idExterno: z.string().min(1).nullable(),
    situacao: SituacaoLinha,
    /** Entra ao lançar; a tela troca. */
    incluir: z.boolean(),
    categoriaId: Id.nullable(),
    categoriaPor: CategoriaPor.nullable(),
    /** O lançamento da conta com que casou (repetida, possível repetida ou conciliada). */
    casouCom: Id.nullable(),
    /** "Parcela 2/10" no texto. */
    parcela: z.object({ numero: z.number().int().positive(), total: z.number().int().min(2) }).nullable(),
  })
  .refine((l) => (l.categoriaId === null) === (l.categoriaPor === null), {
    path: ["categoriaPor"],
    message: "categoria diz de onde veio",
  })
  .refine((l) => l.situacao === "nova" || l.casouCom !== null, {
    path: ["casouCom"],
    message: "a linha que casou diz com qual lançamento",
  });
export type LinhaPrevia = z.infer<typeof LinhaPrevia>;

/** A linha do arquivo que não virou lançamento (data ou valor ilegível), com o motivo. */
export const LinhaRecusada = z.object({ linha: z.number().int().positive(), motivo: z.string().min(1) });
export type LinhaRecusada = z.infer<typeof LinhaRecusada>;

/**
 * Como foi a sugestão da Tula para o que sobrou sem regra (ADR-0045): feita; nada a sugerir (tudo
 * categorizado por código); ou sem sugestão porque não há modelo, ela está pausada ou o prazo passou.
 * Sem sugestão, a linha fica "sem categoria" e a importação segue.
 */
export const SugestaoTula = z.enum(["feita", "nada_a_sugerir", "sem_modelo", "pausada", "prazo"]);
export type SugestaoTula = z.infer<typeof SugestaoTula>;

/**
 * A prévia (quadro `ExtratoRevisar`): as linhas, as recusadas, os números do topo (o que entra, o
 * que já existia), a sobra do que entra, a frase da Tula ("Categorizei 79 sozinha. Faltam 2") e as
 * regras que ela propõe aprender.
 */
export const PreviaImportacao = z.object({
  importacaoId: Id,
  contaId: Id.nullable(),
  arquivoNome: z.string().min(1),
  formato: FormatoExtrato,
  periodo: Periodo,
  linhas: z.array(LinhaPrevia),
  recusadas: z.array(LinhaRecusada),
  novas: z.number().int().nonnegative(),
  repetidas: z.number().int().nonnegative(),
  possiveisRepetidas: z.number().int().nonnegative(),
  semCategoria: z.number().int().nonnegative(),
  entradasCentavos: Centavos.nonnegative(),
  saidasCentavos: Centavos.nonnegative(),
  sobraCentavos: Centavos,
  sugestao: SugestaoTula,
  frase: z.string().min(1).nullable(),
  propostasRegra: z.array(PropostaRegra),
});
export type PreviaImportacao = z.infer<typeof PreviaImportacao>;

/**
 * Lançar: o que a tela mudou em cada linha (entrar ou não, categoria) e as regras aceitas. A linha
 * que não vem fica como a prévia mostrou.
 */
export const PedidoConfirmarImportacao = z.object({
  importacaoId: Id,
  linhas: z.array(
    z.object({
      indice: z.number().int().nonnegative(),
      incluir: z.boolean().optional(),
      categoriaId: Id.nullable().optional(),
    }),
  ),
  regras: z.array(NovaRegraCategoria).optional(),
});
export type PedidoConfirmarImportacao = z.infer<typeof PedidoConfirmarImportacao>;

/** A importação concluída e as regras que nasceram com ela. */
export const ImportacaoConcluida = z.object({ importacao: Importacao, regras: z.array(RegraCategoria) });
export type ImportacaoConcluida = z.infer<typeof ImportacaoConcluida>;

/** Por onde a importação vai, para a tela não parecer parada num arquivo grande ou à espera da Tula. */
export const EtapaImportacao = z.enum([
  "lendo",
  "repetidos",
  "categorizando",
  "tula",
  "lancando",
  "desfazendo",
]);
export type EtapaImportacao = z.infer<typeof EtapaImportacao>;

/** O id é o da leitura ou o da importação, conforme a etapa; `total` vazio quando ainda não se sabe. */
export const ProgressoImportacao = z.object({
  id: Id,
  etapa: EtapaImportacao,
  feitos: z.number().int().nonnegative(),
  total: z.number().int().nonnegative().nullable(),
});
export type ProgressoImportacao = z.infer<typeof ProgressoImportacao>;
