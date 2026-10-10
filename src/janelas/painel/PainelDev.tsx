import type { ItemGithub } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useId } from "react";
import { useDadosDev, type DadosDev } from "../../areas/dev/dev.ts";
import type { Leitura } from "../../areas/leitura.ts";
import { nomesDosProjetos, useDadosSessoes } from "../../areas/sessoes/sessoes.ts";
import { useAgora } from "../../areas/tempo.ts";
import { Botao } from "../../componentes/Botao.tsx";
import { Selo } from "../../componentes/Selo.tsx";
import { DADOS_AREAS } from "../areas.ts";
import { CabecalhoPainel } from "./Cabecalho.tsx";
import { abrirNoSistema, CartaoSessao, situacaoDasSessoes } from "./PedidosSessoes.tsx";
import {
  metaDoPr,
  prsDoPainel,
  resumoDoDev,
  seloDoPr,
  sessoesAbertas,
  SESSOES_NO_PAINEL,
} from "./sessoes.ts";

interface PropsVazia {
  texto: string;
  /** Mostra o atalho para ligar o que falta em Conexões. */
  conectar?: boolean;
  /** Mostra o "Tentar de novo" quando a leitura falhou. */
  tentarDeNovo?: () => void;
  /** Lendo: o leitor de tela ouve a mudança, sem alarde. */
  lendo?: boolean;
}

/** O vazio de uma seção do painel: lendo, não leu (com tentar de novo) ou falta ligar algo. */
function SecaoVazia({ texto, conectar = false, tentarDeNovo, lendo = false }: PropsVazia) {
  return (
    <div className="painel-secao-vazia" role={lendo ? "status" : undefined}>
      <p>{texto}</p>
      {conectar && (
        <Botao tamanho="pequeno" onClick={() => abrirNoSistema("configuracoes/conexoes")}>
          Abrir Conexões
        </Botao>
      )}
      {tentarDeNovo && (
        <Botao tamanho="pequeno" onClick={tentarDeNovo}>
          Tentar de novo
        </Botao>
      )}
    </div>
  );
}

/** Os PRs com o selo do que precisa de você e a linha de baixo (PainelDev.dc.html). */
function ListaDePrs({ prs, agora }: { prs: readonly ItemGithub[]; agora: Date }) {
  if (prs.length === 0) return <SecaoVazia texto="Nenhum PR aberto com você." />;
  return (
    <ul className="prs-lista">
      {prs.map((pr) => {
        const selo = seloDoPr(pr);
        return (
          <li key={pr.id} className="pr-linha">
            <span className="pr-selo">
              <Selo tom={selo.tom}>{selo.texto}</Selo>
            </span>
            <div className="pr-corpo">
              <span className="pr-titulo" title={pr.titulo}>
                {pr.titulo}
              </span>
              <span className="pr-meta">{metaDoPr(pr, agora)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A seção de PRs pelo que se sabe do GitHub: lendo diz só isso; leitura recusada oferece tentar de
 * novo; conexão em erro diz o que o serviço disse e ainda mostra o que está no cache; desligada
 * convida a conectar.
 */
function PrsDoGithub({ github, agora }: { github: Leitura<DadosDev>; agora: Date }) {
  if (github.estado === "esperando") return <SecaoVazia texto="Lendo o GitHub." lendo />;
  if (github.estado === "falhou") {
    return <SecaoVazia texto="Não consegui ler o GitHub agora." tentarDeNovo={github.tentarDeNovo} />;
  }
  const { conexao, situacao } = github.dados;
  const prs = prsDoPainel(situacao.itens);
  if (conexao?.estado === "erro") {
    return (
      <>
        <p className="painel-secao-erro" role="alert">
          {conexao.ultimoErro ?? "A conexão com o GitHub deu erro."}
        </p>
        <ListaDePrs prs={prs} agora={agora} />
      </>
    );
  }
  if (conexao?.estado !== "ligada") return <SecaoVazia texto={DADOS_AREAS.dev.vazio.texto} conectar />;
  return <ListaDePrs prs={prs} agora={agora} />;
}

/** O vazio das sessões no painel Dev, pelo que se sabe da leitura e da ligação. */
const VAZIO_DAS_SESSOES = {
  esperando: "Lendo as sessões.",
  falhou: "Não consegui ler as sessões agora.",
  ligado: "Nenhuma sessão aberta agora.",
  desligado: "Ligue o Claude Code em Conexões para acompanhar o contexto das sessões.",
} as const;

/**
 * O painel Dev do dock (PainelDev.dc.html): as sessões de IA com o contexto de cada uma (em aviso
 * a partir de 80%) e os PRs abertos com o selo do que precisa de você. O bloco de limites do
 * quadro fica de fora: o Claude Code não expõe o limite da assinatura e o teto diário ainda não
 * tem moeda; número sem fonte não aparece (AGENTS.md §5 "Consumo").
 */
export function PainelDev({ canal }: { canal: EstadoConexao }) {
  const agora = useAgora();
  const sessoes = useDadosSessoes(canal, agora);
  const github = useDadosDev(canal);
  const idSessoes = useId();
  const idPrs = useId();

  const lista = sessoes.estado === "pronta" ? sessoes.dados.lista : null;
  const situacao = situacaoDasSessoes(sessoes);
  const abertas = lista ? sessoesAbertas(lista) : [];
  const projetos = lista ? nomesDosProjetos(lista) : new Map();
  const itens = github.estado === "pronta" ? github.dados.situacao.itens : [];
  const prsEsperando = itens.filter((i) => i.tipo === "pr" && i.estado === "aberto" && i.precisaDeMim).length;

  return (
    <>
      <CabecalhoPainel titulo="Dev" subtitulo={resumoDoDev(abertas.length, prsEsperando)} sistema="dev" />
      <div className="painel-corpo">
        <section className="painel-secao" aria-labelledby={idSessoes}>
          <header className="painel-secao-cabecalho">
            <h2 id={idSessoes} className="painel-secao-titulo">
              Sessões de IA
            </h2>
            <span>contexto</span>
          </header>
          {abertas.length === 0 ? (
            <SecaoVazia
              texto={VAZIO_DAS_SESSOES[situacao]}
              conectar={situacao === "desligado"}
              tentarDeNovo={sessoes.estado === "falhou" ? sessoes.tentarDeNovo : undefined}
              lendo={situacao === "esperando"}
            />
          ) : (
            abertas
              .slice(0, SESSOES_NO_PAINEL)
              .map((sessao) => (
                <CartaoSessao
                  key={sessao.id}
                  sessao={sessao}
                  projeto={sessao.projetoId ? (projetos.get(sessao.projetoId) ?? null) : null}
                  agora={agora}
                  comContexto
                />
              ))
          )}
        </section>

        <section className="painel-secao" aria-labelledby={idPrs}>
          <header className="painel-secao-cabecalho">
            <h2 id={idPrs} className="painel-secao-titulo">
              Pull requests
            </h2>
            <span>GitHub</span>
          </header>
          <PrsDoGithub github={github} agora={agora} />
        </section>
      </div>
    </>
  );
}
