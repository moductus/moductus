import type { Aprovacao, Conexao, SessaoIa } from "@moductus/contrato";
import { useId, type CSSProperties } from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { Cartao } from "../../componentes/Cartao.tsx";
import { CartaoAprovacao } from "../../componentes/CartaoAprovacao.tsx";
import { Progresso } from "../../componentes/Progresso.tsx";
import { Selo } from "../../componentes/Selo.tsx";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { NOME_FERRAMENTA } from "../../janelas/painel/PedidosSessoes.tsx";
import { useAcoesSistema } from "../../janelas/sistema/primeiro-uso/estado.ts";
import { useServico } from "../../nativo/eventos.ts";
import {
  decidirPedido,
  detalheDoPedido,
  usePedidosDoTerminal,
  type PedidosDoTerminal,
} from "../../servico/aprovacoes.ts";
import { useCanal } from "../../servico/conexao.ts";
import { EstadoVazio, Pagina } from "../Pagina.tsx";
import { diaLocal, useAgora } from "../tempo.ts";
import {
  claudeCodeLigado,
  contextoDaSessao,
  estadoDaSessao,
  ferramentasAcompanhadas,
  formatarTokens,
  gastoDeHoje,
  nomesDosProjetos,
  semanaDeUso,
  ultimaAcao,
  useDadosSessoes,
  type DadosSessoes,
} from "./sessoes.ts";
import "./Sessoes.css";

const TITULO = "Sessões de IA";
const ROTULO = "Nuno · sessões de agentes de código";

/**
 * Sessões de IA (AreaSessoes.dc.html): o uso da semana, os pedidos que esperam você, a tabela das
 * sessões por projeto e os avisos do Nuno. Sem a ligação do Claude Code e sem sessão, o vazio diz
 * como ligar.
 */
export function Sessoes() {
  const canal = useCanal(useServico({ silencioso: true }));
  const agora = useAgora();
  const dados = useDadosSessoes(canal, agora);
  const pedidos = usePedidosDoTerminal(canal, null);

  if (!dados) {
    return (
      <Pagina titulo={TITULO} rotulo={ROTULO}>
        <p className="area-carregando" role="status">
          Esperando o serviço responder.
        </p>
      </Pagina>
    );
  }

  if (dados.lista.sessoes.length === 0) {
    return (
      <Pagina titulo={TITULO} rotulo={ROTULO}>
        <SemSessoes conexao={dados.conexao} />
      </Pagina>
    );
  }

  const ferramentas = ferramentasAcompanhadas(dados).map((f) => NOME_FERRAMENTA[f]);
  return (
    <Pagina
      titulo={TITULO}
      rotulo={ROTULO}
      acao={<span className="sessoes-ferramentas">{ferramentas.join(" · ")}</span>}
    >
      <div className="sessoes-alto" data-com-pedidos={pedidos.aprovacoes.length > 0}>
        <UsoDaSemana dados={dados} agora={agora} />
        <Pedidos pedidos={pedidos} />
      </div>
      <TabelaSessoes dados={dados} agora={agora} />
      <Avisos />
    </Pagina>
  );
}

/** O vazio: sem ligação, como ligar; ligado, como fazer a primeira sessão aparecer. */
function SemSessoes({ conexao }: { conexao: Conexao | null }) {
  const { ir } = useAcoesSistema();
  if (claudeCodeLigado(conexao)) {
    return (
      <EstadoVazio
        agentes={["nuno"]}
        titulo="Nenhuma sessão nas últimas 24 horas"
        texto="O Claude Code está ligado. Abra um terminal novo e rode o claude em qualquer projeto: a sessão aparece aqui na hora."
      />
    );
  }
  const erro = conexao?.estado === "erro" ? conexao.ultimoErro : null;
  return (
    <EstadoVazio
      agentes={["nuno"]}
      titulo="O Claude Code ainda não está ligado"
      texto={
        erro ??
        "Ligue em Configurações › Conexões e o Nuno passa a ver cada sessão do Claude Code: projeto, estado, contexto, pedidos para aprovar e consumo."
      }
      acoes={
        <Botao variante="primario" onClick={() => ir({ area: "configuracoes", secao: "conexoes" })}>
          Abrir Conexões
        </Botao>
      }
    />
  );
}

/** A fração do maior dia vai ao CSS, que a multiplica pela altura da barra nos tokens. */
const alturaDaBarra = (pct: number) => ({ "--fracao-uso": pct / 100 }) as CSSProperties;

/**
 * Tokens por dia nos últimos 7 dias, todas as ferramentas. O limite da assinatura do quadro fica
 * de fora: o Claude Code não o expõe (AGENTS.md §5 "Consumo"), e número sem fonte não aparece.
 */
function UsoDaSemana({ dados, agora }: { dados: DadosSessoes; agora: Date }) {
  const idTitulo = useId();
  const semana = semanaDeUso(dados.uso, agora);
  const hoje = semana.dias.find((d) => d.hoje)?.tokens ?? 0;
  const resumo =
    semana.total === 0
      ? "Nenhum token registrado nos últimos 7 dias."
      : `${formatarTokens(semana.total)} tokens em 7 dias, ${formatarTokens(hoje)} hoje.`;
  return (
    <Cartao como="section" className="uso" aria-labelledby={idTitulo}>
      <div className="uso-cabecalho">
        <h2 id={idTitulo} className="uso-titulo">
          Uso de tokens · últimos 7 dias
        </h2>
        {semana.estimativa && <span>parte é estimativa</span>}
      </div>
      <ol className="uso-grafico">
        {semana.dias.map((d) => (
          <li key={d.dia} className="uso-dia" data-hoje={d.hoje}>
            <span className="uso-numero" aria-hidden="true">
              {formatarTokens(d.tokens)}
            </span>
            <span className="uso-barra" style={alturaDaBarra(d.pct)} />
            <span className="uso-rotulo" aria-hidden="true">
              {d.rotulo}
            </span>
            <span className="so-leitor">{`${d.hoje ? "hoje" : d.rotulo}: ${formatarTokens(d.tokens)} tokens`}</span>
          </li>
        ))}
      </ol>
      <div className="uso-rodape">
        <span>{resumo}</span>
        <span className="uso-total" aria-hidden="true">
          {formatarTokens(semana.total)}
        </span>
      </div>
    </Cartao>
  );
}

/** Os pedidos de permissão das sessões, com Negar, Sempre neste projeto e Permitir. */
function Pedidos({ pedidos }: { pedidos: PedidosDoTerminal }) {
  const idTitulo = useId();
  if (pedidos.aprovacoes.length === 0) return null;
  return (
    <section className="sessoes-pedidos" aria-labelledby={idTitulo}>
      <h2 id={idTitulo} className="so-leitor">
        Pedidos esperando você
      </h2>
      {pedidos.aprovacoes.map((aprovacao) => {
        const detalhe = detalheDoPedido(aprovacao.acao);
        return (
          <CartaoAprovacao
            key={aprovacao.id}
            aprovacao={aprovacao}
            tamanho="pequeno"
            origem={<OrigemPedido aprovacao={aprovacao} pedidos={pedidos} />}
            detalhe={detalhe && <code>{detalhe}</code>}
            aoDecidir={decidirPedido}
          />
        );
      })}
    </section>
  );
}

function OrigemPedido({ aprovacao, pedidos }: { aprovacao: Aprovacao; pedidos: PedidosDoTerminal }) {
  const projeto = aprovacao.sessaoId ? pedidos.projetos[aprovacao.sessaoId] : undefined;
  return (
    <>
      {projeto && <span className="sessoes-pedido-projeto">{projeto}</span>}
      {aprovacao.fonte !== "moductus" && (
        <span className="sessoes-pedido-ferramenta">{NOME_FERRAMENTA[aprovacao.fonte]}</span>
      )}
      {aprovacao.estado === "pendente" && (
        <span className="sessoes-pedido-estado">
          <Selo forma="ponto" tom="aviso">
            esperando você
          </Selo>
        </span>
      )}
    </>
  );
}

/** A tabela do quadro: projeto, ferramenta, estado, contexto, gasto de hoje e última ação. */
function TabelaSessoes({ dados, agora }: { dados: DadosSessoes; agora: Date }) {
  const projetos = nomesDosProjetos(dados.lista);
  const hoje = diaLocal(agora);
  return (
    <div className="sessoes-tabela">
      <table>
        <caption className="so-leitor">Sessões das últimas 24 horas</caption>
        <thead>
          <tr>
            <th scope="col">Projeto</th>
            <th scope="col">Ferramenta</th>
            <th scope="col">Estado</th>
            <th scope="col">Contexto</th>
            <th scope="col">Gasto hoje</th>
            <th scope="col">Última ação</th>
          </tr>
        </thead>
        <tbody>
          {dados.lista.sessoes.map((sessao) => {
            const projeto = sessao.projetoId ? projetos.get(sessao.projetoId) : undefined;
            return (
              <LinhaSessao
                key={sessao.id}
                sessao={sessao}
                projeto={projeto?.nome ?? null}
                caminho={projeto?.caminho ?? null}
                dados={dados}
                hoje={hoje}
                agora={agora}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface PropsLinhaSessao {
  sessao: SessaoIa;
  projeto: string | null;
  caminho: string | null;
  dados: DadosSessoes;
  hoje: string;
  agora: Date;
}

function LinhaSessao({ sessao, projeto, caminho, dados, hoje, agora }: PropsLinhaSessao) {
  const estado = estadoDaSessao(sessao, agora);
  const contexto = contextoDaSessao(sessao);
  const gasto = gastoDeHoje(dados.uso, sessao, hoje);
  const acao = ultimaAcao(sessao.ultimoEvento, caminho);
  const nome = projeto ?? "sem projeto";
  return (
    <tr>
      <td className="sessao-projeto" data-sem-projeto={projeto === null}>
        {nome}
      </td>
      <td className="sessao-ferramenta">{NOME_FERRAMENTA[sessao.ferramenta]}</td>
      <td>
        <Selo forma="ponto" tom={estado.tom}>
          {estado.texto}
        </Selo>
      </td>
      <td>
        <span className="sessao-contexto" data-alto={contexto.alto}>
          {contexto.pct !== null && (
            <span className="sessao-contexto-trilho">
              <Progresso
                valor={contexto.pct}
                rotulo={`Contexto de ${nome}`}
                textoValor={`${contexto.texto} da janela`}
                tom={contexto.alto ? "aviso" : "neutro"}
              />
            </span>
          )}
          <span className="sessao-numero">{contexto.texto}</span>
        </span>
      </td>
      <td>
        <span className="sessao-numero" data-vazio={gasto.vazio}>
          <span aria-hidden="true">{gasto.texto}</span>
          <span className="so-leitor">{gasto.rotulo}</span>
        </span>
      </td>
      <td className="sessao-acao" title={acao ?? undefined}>
        {acao ?? "—"}
      </td>
    </tr>
  );
}

/** Os avisos que o Nuno dá sobre as sessões, com o atalho para ajustar nas Notificações. */
function Avisos() {
  const { ir } = useAcoesSistema();
  return (
    <div className="sessoes-avisos">
      <Personagem agente="nuno" modo="cabeca" tamanho="aviso" estado="ocioso" rotulo="Nuno" />
      <p className="sessoes-avisos-texto">
        Avisos: contexto em 80% e sessão esperando você há mais de 5 min.
      </p>
      <Botao
        variante="fantasma"
        tamanho="pequeno"
        onClick={() => ir({ area: "configuracoes", secao: "notificacoes" })}
      >
        Ajustar
      </Botao>
    </div>
  );
}
