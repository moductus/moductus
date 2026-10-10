import { Botao } from "../componentes/Botao.tsx";
import { Cartao } from "../componentes/Cartao.tsx";
import { Personagem } from "../componentes/personagem/Personagem.tsx";
import { useAcoesSistema } from "../janelas/sistema/primeiro-uso/estado.ts";
import { EstadoVazio } from "./Pagina.tsx";

/** O atalho para Configurações › Conexões, de onde se liga o Claude Code e o GitHub. */
export function AbrirConexoes({ variante }: { variante: "primario" | "secundario" }) {
  const { ir } = useAcoesSistema();
  return (
    <Botao
      variante={variante}
      tamanho={variante === "primario" ? "normal" : "pequeno"}
      onClick={() => ir({ area: "configuracoes", secao: "conexoes" })}
    >
      Abrir Conexões
    </Botao>
  );
}

/**
 * A linha do Nuno no alto de uma área dele (AreaDev.dc.html): o que mais precisa de você, ou o
 * que deu errado na conexão, com o atalho para resolver.
 */
export function FaixaNuno({ texto, erro }: { texto: string; erro: boolean }) {
  return (
    <Cartao variante="elevado" className="faixa-nuno" role={erro ? "alert" : undefined}>
      <Personagem
        agente="nuno"
        modo="cabeca"
        tamanho="faixa"
        estado={erro ? "erro" : "esperando"}
        rotulo="Nuno"
      />
      <p className="faixa-nuno-texto">{texto}</p>
      {erro && <AbrirConexoes variante="secundario" />}
    </Cartao>
  );
}

/**
 * Enquanto a leitura não chega, uma linha; se o serviço recusou o pedido, a área diz que não
 * conseguiu ler e oferece tentar de novo, em vez de esperar para sempre.
 */
export function LeituraPendente({ oQue, tentarDeNovo }: { oQue: string; tentarDeNovo?: () => void }) {
  if (!tentarDeNovo) {
    return (
      <p className="area-carregando" role="status">
        Esperando o serviço responder.
      </p>
    );
  }
  return (
    <EstadoVazio
      agentes={["nuno"]}
      titulo="O serviço não respondeu"
      texto={`Não consegui ler ${oQue} agora. Nada foi perdido: tente de novo.`}
      acoes={
        <Botao variante="primario" onClick={tentarDeNovo}>
          Tentar de novo
        </Botao>
      }
    />
  );
}
