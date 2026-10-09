import type { AvisoContexto } from "../sessoes/contexto.ts";
import type { NovoAviso, ServicoNotificacoes } from "./notificacoes.ts";

/**
 * O aviso de contexto alto (F2-24) em nome do Nuno, com a sessão como referência: passa pela
 * preferência dele como qualquer aviso. Enquanto o aviso da mesma sessão não for visto, um novo
 * (depois de uma compactação) não repete.
 */
export function avisoDoContexto(aviso: AvisoContexto): NovoAviso {
  return {
    agenteId: "nuno",
    tipo: "aviso",
    titulo: aviso.titulo,
    corpo: aviso.corpo,
    referencia: `sessao:${aviso.sessaoId}`,
    origem: "conexao",
  };
}

/** Entrega o aviso de contexto pelas notificações; falha vai ao log, nunca à leitura do transcript. */
export function avisarContexto(notificacoes: ServicoNotificacoes): (aviso: AvisoContexto) => void {
  return (aviso) => {
    notificacoes
      .avisar(avisoDoContexto(aviso))
      .catch((erro: unknown) => console.error(`notificações: aviso de contexto falhou: ${String(erro)}`));
  };
}
