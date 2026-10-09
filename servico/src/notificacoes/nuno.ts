import type { AvisoDoNuno } from "../agentes/vigias/nuno.ts";
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

/**
 * O aviso do vigia do Nuno (o que precisa de você no GitHub, sessão esperando), com o carimbo da
 * execução que o escreveu: passa pela preferência do Nuno para o tipo "aviso" como qualquer outro.
 */
export function avisoDoVigia(aviso: AvisoDoNuno): NovoAviso {
  return {
    agenteId: "nuno",
    tipo: "aviso",
    titulo: aviso.titulo,
    corpo: aviso.corpo,
    referencia: aviso.referencia,
    origem: "agente",
    execucaoId: aviso.execucaoId,
  };
}

/** Entrega o aviso do vigia pelas notificações; falha vai ao log, nunca ao vigia. */
export function avisarDoVigia(notificacoes: ServicoNotificacoes): (aviso: AvisoDoNuno) => void {
  return (aviso) => {
    notificacoes
      .avisar(avisoDoVigia(aviso))
      .catch((erro: unknown) => console.error(`notificações: aviso do Nuno falhou: ${String(erro)}`));
  };
}
