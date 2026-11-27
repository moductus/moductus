import type { ReactNode } from "react";
import { Atalho } from "../../componentes/Atalho.tsx";
import { Cartao } from "../../componentes/Cartao.tsx";
import { Interruptor } from "../../componentes/Interruptor.tsx";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { PrivacidadeContexto } from "../../componentes/privacidade.ts";
import { TextoSensivel } from "../../componentes/TextoSensivel.tsx";
import { Valor } from "../../componentes/Valor.tsx";
import { Aviso, Carregando } from "./Partes.tsx";
import { Secao } from "./Secao.tsx";
import type { PropsSecao } from "./secoes.ts";
import { useConfig } from "./useConfig.ts";

const INTRO = "O que a tela mostra quando outras pessoas podem ver, e onde ficam os seus dados.";

/** Uma linha de rótulo e valor dos cartões (ConfigPrivacidade.dc.html). */
function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="config-privacidade-linha">
      <dt>{rotulo}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Antes e depois de cada tipo de texto, com os próprios componentes: o lado de lá sempre à
 * vista, o de cá sempre mascarado, esteja o modo ligado ou não. A categoria não muda.
 */
function ComoFica() {
  const lados = (conteudo: ReactNode) => (
    <>
      <PrivacidadeContexto value={false}>{conteudo}</PrivacidadeContexto>
      <span aria-hidden="true" className="config-privacidade-seta">
        →
      </span>
      <PrivacidadeContexto value>{conteudo}</PrivacidadeContexto>
    </>
  );
  return (
    <section aria-label="Como fica" className="config-privacidade-como">
      <span className="config-privacidade-rotulo">Como fica</span>
      <div className="config-privacidade-exemplos">
        {lados(<Valor centavos={131240} />)}
        {lados(<TextoSensivel>Mercado do bairro</TextoSensivel>)}
        {lados(<TextoSensivel>Cartão Nubank</TextoSensivel>)}
        {lados(<span>Casa › Mercado</span>)}
      </div>
      <span className="config-privacidade-rotulo">
        Categorias, datas e contagens continuam à vista. O leitor de tela também lê &quot;valor
        escondido&quot;.
      </span>
    </section>
  );
}

/**
 * Privacidade (ConfigPrivacidade.dc.html): o modo privacidade (ADR-0047), que esconde valores e
 * textos sensíveis no dock, nos painéis e no Sistema, o aviso do Windows sem o valor, o que vai para
 * o modelo e onde ficam os dados. A chave grava pelo serviço, que avisa todas as janelas.
 */
export function SecaoPrivacidade({ aoEscolherSecao }: Partial<PropsSecao>) {
  const { estado, conectado, erro, definir } = useConfig();
  if (!estado) {
    return (
      <Secao titulo="Privacidade" intro={INTRO}>
        <Carregando />
      </Secao>
    );
  }
  const { config, portable } = estado;
  const ligado = config.privacidade.ativo;
  const atalho = config.atalhos.privacidade;
  return (
    <Secao titulo="Privacidade" intro={INTRO}>
      <div className="config-privacidade">
        <Cartao como="section" aria-label="Modo privacidade" className="config-privacidade-cartao">
          <div className="config-privacidade-cabeca">
            <h3 className="config-cartao-titulo">Modo privacidade</h3>
            {/* O estado em texto à esquerda da chave, como no quadro e em O dia. */}
            <span className="config-privacidade-ligado">
              <span aria-hidden="true">{ligado ? "ligado" : "desligado"}</span>
              <Interruptor
                aria-label="Modo privacidade"
                ligado={ligado}
                desativado={!conectado}
                aoMudar={(ativo) => void definir({ privacidade: { ativo } })}
              />
            </span>
          </div>
          <p className="config-privacidade-texto">
            Esconde valores em dinheiro, descrições de lançamento e nomes de conta no dock, nos painéis e no
            Sistema. Nada é apagado: só o desenho muda.
          </p>
          {erro && <Aviso>{erro}</Aviso>}
          <dl className="config-privacidade-linhas">
            <Linha rotulo="Atalho">
              {atalho ? <Atalho teclas={atalho} /> : "sem atalho"}
              <button
                type="button"
                className="config-privacidade-link"
                disabled={!aoEscolherSecao}
                onClick={() => aoEscolherSecao?.("atalhos")}
              >
                mudar em Atalhos
              </button>
            </Linha>
            <Linha rotulo="Pela bandeja">botão direito no ícone, &quot;Modo privacidade&quot;</Linha>
            <Linha rotulo="Depois de reiniciar">continua ligado até você desligar</Linha>
            <Linha rotulo="Vale para">só este PC</Linha>
          </dl>
          <ComoFica />
          {ligado && (
            <p role="status" className="config-privacidade-estado">
              <span>Modo privacidade ligado. O dock mostra o selo enquanto durar.</span>
              {atalho && <Atalho teclas={atalho} />}
            </p>
          )}
        </Cartao>
        <div className="config-privacidade-coluna">
          <Cartao como="section" aria-label="Avisos do Windows" className="config-privacidade-cartao">
            <div className="config-privacidade-cabeca">
              <h3 className="config-cartao-titulo">Avisos do Windows</h3>
              <span className="config-privacidade-rotulo">com o modo ligado</span>
            </div>
            {/* Só para ver como sai: o aviso da fatura da Tula, sem o valor. */}
            <div className="config-previa-aviso" aria-hidden="true">
              <Personagem agente="tula" modo="cabeca" tamanho="dock" estado="ocioso" />
              <div className="config-previa-aviso-textos">
                <div className="config-previa-aviso-cabeca">
                  <span className="config-previa-aviso-titulo">Moductus · Tula</span>
                  <span>agora</span>
                </div>
                <span>Fatura do Cartão Cooperativa vence em 2 dias.</span>
              </div>
            </div>
            <p className="config-privacidade-rotulo">
              O aviso sai sem o valor. O histórico de avisos guarda o texto inteiro, com &quot;R$
              642,30&quot;.
            </p>
          </Cartao>
          <Cartao como="section" aria-label="O que vai para o modelo" className="config-privacidade-cartao">
            <h3 className="config-cartao-titulo">O que vai para o modelo</h3>
            <p className="config-privacidade-texto">
              O modo é de tela: não muda o que os agentes mandam ao modelo. Cada agente manda só o contexto
              das próprias ferramentas, e a Tula não manda lançamentos para o Nuno.
            </p>
          </Cartao>
          <Cartao como="section" aria-label="Onde ficam os seus dados" className="config-privacidade-cartao">
            <h3 className="config-cartao-titulo">Onde ficam os seus dados</h3>
            <dl className="config-privacidade-linhas">
              <Linha rotulo="Banco e arquivos">
                {portable ? (
                  "na pasta do programa, ao lado do moductus.exe"
                ) : (
                  <code className="config-privacidade-codigo">%APPDATA%\Moductus</code>
                )}
              </Linha>
              <Linha rotulo="Chaves e tokens">Gerenciador de Credenciais do Windows</Linha>
              <Linha rotulo="Telemetria">nenhuma</Linha>
            </dl>
          </Cartao>
        </div>
      </div>
    </Secao>
  );
}
