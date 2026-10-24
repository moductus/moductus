import type { PedidoClienteGoogle, SituacaoGoogle } from "@moductus/contrato";
import type { RepositorioConexoes } from "../conexoes.ts";
import type { ServicoGoogleAgenda } from "./google-agenda.ts";

export interface DependenciasSituacaoGoogle {
  google: Pick<
    ServicoGoogleAgenda,
    "conexao" | "autorizacaoAberta" | "problema" | "usaClienteProprio" | "definirCliente"
  >;
  conexoes: Pick<RepositorioConexoes, "obter">;
  /** Quantos itens esperam na fila de saída do espelho (`RepositorioEspelhoGoogle.tamanhoDaFila`). */
  fila: () => number;
  /** Lê o Calendar já (`LeituraGoogleAgenda.atualizar`); nunca rejeita. */
  ler: () => Promise<unknown>;
}

/**
 * O que o cartão do Google Agenda em Configurações › Conexões mostra além da conexão (F3-44): a
 * autorização que espera no navegador, a última leitura, a fila para o "Moductus", se o cliente
 * OAuth é o seu e por que a conexão está em erro. "Ler agora" e "Usar meu próprio cliente" passam
 * por aqui; conectar e desconectar são os de `conexoes`.
 */
export class SituacaoGoogleAgenda {
  constructor(private readonly deps: DependenciasSituacaoGoogle) {}

  async obter(): Promise<SituacaoGoogle> {
    const desligada = this.deps.google.conexao().estado === "desligada";
    const autorizacao = this.deps.google.autorizacaoAberta();
    return {
      // A casca só abre https: um endereço de teste em http não chega ao cartão.
      autorizacao: autorizacao?.endereco.startsWith("https://") ? autorizacao : null,
      lidaEm: desligada ? null : (this.deps.conexoes.obter("google-agenda")?.lida_em ?? null),
      fila: this.deps.fila(),
      clienteProprio: await this.deps.google.usaClienteProprio(),
      problema: this.deps.google.problema(),
    };
  }

  async atualizar(): Promise<SituacaoGoogle> {
    await this.deps.ler();
    return this.obter();
  }

  async definirCliente(pedido: PedidoClienteGoogle): Promise<SituacaoGoogle> {
    await this.deps.google.definirCliente(pedido.cliente);
    return this.obter();
  }
}
