import { z } from "zod";
import { metodo } from "./canal.ts";
import { EstadoConfig, MudancaConfig } from "./config.ts";
import { PedidoExportar, PedidoImportar, ResultadoExportar } from "./outro-pc.ts";
import { EstadoPrimeiroUso, PedidoConcluirPrimeiroUso, PedidoMarcarTutorial } from "./primeiro-uso.ts";

/** Todos os métodos que o serviço atende, com entrada e saída. */
export const METODOS = {
  "sistema.ping": metodo(z.undefined(), z.object({ protocolo: z.number().int(), pid: z.number().int() })),
  "config.obter": metodo(z.undefined(), EstadoConfig),
  "config.definir": metodo(MudancaConfig, EstadoConfig),
  "config.exportar": metodo(PedidoExportar, ResultadoExportar),
  "config.importar": metodo(PedidoImportar, EstadoConfig),
  "primeiroUso.obter": metodo(z.undefined(), EstadoPrimeiroUso),
  "primeiroUso.concluir": metodo(PedidoConcluirPrimeiroUso, EstadoPrimeiroUso),
  "primeiroUso.marcar": metodo(PedidoMarcarTutorial, EstadoPrimeiroUso),
} as const;

export type Metodos = typeof METODOS;
export type NomeMetodo = keyof Metodos;
export type EntradaDe<M extends NomeMetodo> = z.infer<Metodos[M]["entrada"]>;
export type SaidaDe<M extends NomeMetodo> = z.infer<Metodos[M]["saida"]>;

/** Eventos que o serviço emite, com os dados de cada um. */
export const EVENTOS = {
  "sistema.ola": z.object({ protocolo: z.number().int() }),
  "config.mudou": EstadoConfig,
  "primeiroUso.mudou": EstadoPrimeiroUso,
} as const;

export type NomeEvento = keyof typeof EVENTOS;
export type DadosDe<N extends NomeEvento> = z.infer<(typeof EVENTOS)[N]>;
