import { z } from "zod";

/**
 * Primeiro uso (PRODUCT.md, "Primeiro uso"; DATA.md, tabela onboarding): a configuração
 * inicial em passos e, depois dela, o tutorial "Primeiros passos" com uma missão por agente.
 * O estado fica no serviço, por PC: não vai no arquivo de outro PC.
 */
export const PASSOS_PRIMEIRO_USO = ["boas-vindas", "tema-dock", "modelo", "time", "conexoes"] as const;
export const PassoPrimeiroUso = z.enum(PASSOS_PRIMEIRO_USO);
export type PassoPrimeiroUso = z.infer<typeof PassoPrimeiroUso>;

export const MISSOES_TUTORIAL = [
  "alba-lembrete",
  "tula-extrato",
  "faina-aprovacao",
  "faina-downloads",
  "nuno-sessao",
] as const;
export const MissaoTutorial = z.enum(MISSOES_TUTORIAL);
export type MissaoTutorial = z.infer<typeof MissaoTutorial>;

export const EstadoEtapa = z.enum(["pendente", "feito", "pulado"]);
export type EstadoEtapa = z.infer<typeof EstadoEtapa>;

/** Como um passo terminou: feito (seguiu adiante) ou pulado ("Depois", "Pular configuração"). */
export const FimDoPasso = z.enum(["feito", "pulado"]);
export type FimDoPasso = z.infer<typeof FimDoPasso>;

export const EstadoPrimeiroUso = z.object({
  /** A configuração inicial terminou (feita ou pulada): o Sistema abre direto nas áreas. */
  concluido: z.boolean(),
  concluidoEm: z.iso.datetime().nullable(),
  passos: z.record(PassoPrimeiroUso, EstadoEtapa),
  /** "Primeiros passos" no Início: pendente aparece, feito ou pulado some. */
  tutorial: EstadoEtapa,
  missoes: z.record(MissaoTutorial, EstadoEtapa),
});
export type EstadoPrimeiroUso = z.infer<typeof EstadoPrimeiroUso>;

/** Concluir a configuração: como cada passo terminou; passo não informado conta como pulado. */
export const PedidoConcluirPrimeiroUso = z.object({
  passos: z.partialRecord(PassoPrimeiroUso, FimDoPasso),
});
export type PedidoConcluirPrimeiroUso = z.infer<typeof PedidoConcluirPrimeiroUso>;

/** Marcar o tutorial (rever, pular) ou uma missão dele. */
export const PedidoMarcarTutorial = z.discriminatedUnion("alvo", [
  z.object({ alvo: z.literal("tutorial"), estado: EstadoEtapa }),
  z.object({ alvo: z.literal("missao"), missao: MissaoTutorial, estado: EstadoEtapa }),
]);
export type PedidoMarcarTutorial = z.infer<typeof PedidoMarcarTutorial>;
