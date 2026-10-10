import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useId } from "react";
import { useDadosDev } from "../../areas/dev/dev.ts";
import { claudeCodeLigado, nomesDosProjetos, useDadosSessoes } from "../../areas/sessoes/sessoes.ts";
import { useAgora } from "../../areas/tempo.ts";
import { Botao } from "../../componentes/Botao.tsx";
import { Selo } from "../../componentes/Selo.tsx";
import { DADOS_AREAS } from "../areas.ts";
import { CabecalhoPainel } from "./Cabecalho.tsx";
import { abrirNoSistema, CartaoSessao } from "./PedidosSessoes.tsx";
import {
  metaDoPr,
  prsDoPainel,
  resumoDoDev,
  seloDoPr,
  sessoesAbertas,
  SESSOES_NO_PAINEL,
} from "./sessoes.ts";

/** O vazio de uma seção do painel, com o atalho para ligar o que falta em Conexões. */
function SecaoVazia({ texto, conectar }: { texto: string; conectar: boolean }) {
  return (
    <div className="painel-secao-vazia">
      <p>{texto}</p>
      {conectar && (
        <Botao tamanho="pequeno" onClick={() => abrirNoSistema("configuracoes/conexoes")}>
          Abrir Conexões
        </Botao>
      )}
    </div>
  );
}

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
  const ligado = sessoes.estado === "pronta" && claudeCodeLigado(sessoes.dados.conexao);
  const abertas = lista ? sessoesAbertas(lista) : [];
  const projetos = lista ? nomesDosProjetos(lista) : new Map();
  const githubLigado = github.estado === "pronta" && github.dados.conexao?.estado === "ligada";
  const itens = github.estado === "pronta" ? github.dados.situacao.itens : [];
  const prs = prsDoPainel(itens);
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
              texto={
                ligado
                  ? "Nenhuma sessão aberta agora."
                  : "Ligue o Claude Code em Conexões para acompanhar o contexto das sessões."
              }
              conectar={!ligado}
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
          {!githubLigado ? (
            <SecaoVazia texto={DADOS_AREAS.dev.vazio.texto} conectar />
          ) : prs.length === 0 ? (
            <SecaoVazia texto="Nenhum PR aberto com você." conectar={false} />
          ) : (
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
          )}
        </section>
      </div>
    </>
  );
}
