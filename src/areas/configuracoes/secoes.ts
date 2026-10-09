import type { ComponentType } from "react";
import { SecaoGeral } from "./Geral.tsx";
import { SecaoTemaDock } from "./TemaDock.tsx";
import { SecaoNotificacoes } from "./Notificacoes.tsx";
import { SecaoModelos } from "./Modelos.tsx";
import { SecaoAgentes } from "./Agentes.tsx";
import { SecaoConexoes } from "./Conexoes.tsx";
import { SecaoAtalhos } from "./Atalhos.tsx";
import { SecaoPrivacidade } from "./Privacidade.tsx";
import { SecaoOutroPc } from "./OutroPc.tsx";

/** As 9 seções de Configurações, na ordem da sub-navegação (design, seção E). */
export const SECOES = [
  { id: "geral", nome: "Geral", Componente: SecaoGeral },
  { id: "tema", nome: "Tema e dock", Componente: SecaoTemaDock },
  { id: "notificacoes", nome: "Notificações", Componente: SecaoNotificacoes },
  { id: "modelos", nome: "Modelos", Componente: SecaoModelos },
  { id: "agentes", nome: "Agentes", Componente: SecaoAgentes },
  { id: "conexoes", nome: "Conexões", Componente: SecaoConexoes },
  { id: "atalhos", nome: "Atalhos", Componente: SecaoAtalhos },
  { id: "privacidade", nome: "Privacidade", Componente: SecaoPrivacidade },
  { id: "outro-pc", nome: "Levar para outro PC", Componente: SecaoOutroPc },
] as const satisfies readonly { id: string; nome: string; Componente: ComponentType }[];

export type IdSecao = (typeof SECOES)[number]["id"];
export const SECAO_INICIAL: IdSecao = "geral";

export function eIdSecao(valor: unknown): valor is IdSecao {
  return SECOES.some((s) => s.id === valor);
}
