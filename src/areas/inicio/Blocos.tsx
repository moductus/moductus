import type { IdBlocoInicio, Lista } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useId, useState, type ReactNode, type Ref } from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { Progresso } from "../../componentes/Progresso.tsx";
import { Selo } from "../../componentes/Selo.tsx";
import { useFuso, useListas, useTarefasDoDia } from "../../janelas/painel/dados.ts";
import { diaNoFuso, duracao, fusoLocal, horaNoFuso, minutosDaHora } from "../../janelas/painel/dia.ts";
import {
  chaveDoAviso,
  LinhaDesfazer,
  LinhaTarefa,
  marcarTarefa,
  useAvisoDesfazer,
} from "../../janelas/painel/Dia.tsx";
import { nomeDaSessao, situacaoDasSessoes } from "../../janelas/painel/PedidosSessoes.tsx";
import { sessoesAbertas } from "../../janelas/painel/sessoes.ts";
import { deCima, feitasDoDia, linhasDoHoje } from "../../janelas/painel/tarefas.ts";
import { useAcoesSistema } from "../../janelas/sistema/primeiro-uso/estado.ts";
import { servico } from "../../servico/conexao.ts";
import {
  fracaoFeita,
  relogioDoFoco,
  relogioFalado,
  useEstadoFoco,
  useSegundosRestantes,
} from "../../servico/foco.ts";
import type { IdArea } from "../areas.ts";
import { referencia, useDadosDev } from "../dev/dev.ts";
import { AbrirConexoes } from "../FaixaNuno.tsx";
import { estadoDaSessao, nomesDosProjetos, useDadosSessoes } from "../sessoes/sessoes.ts";
import { CampoFrase } from "../tarefas/CampoFrase.tsx";
import {
  DADOS_BLOCOS,
  ITENS_NO_BLOCO,
  TAREFAS_NO_INICIO,
  trechosDoInicio,
  useBriefingDeHoje,
} from "./inicio.ts";
import "../tarefas/Tarefas.css";

interface PropsBlocos {
  canal: EstadoConexao;
  /** Hoje, agora: o relógio da página, que vira o dia e o tempo das sessões. */
  agora: Date;
  lista: readonly IdBlocoInicio[];
  /** O bloco de tarefas, para o "Nova tarefa" do cabeçalho achar a frase. */
  refTarefas: Ref<HTMLElement>;
}

/** Os blocos do Início que aparecem, na ordem e nas colunas do Sistema.dc.html. */
export function BlocosDoInicio({ canal, agora, lista, refTarefas }: PropsBlocos) {
  const bloco = (id: IdBlocoInicio) => {
    switch (id) {
      case "briefing":
        return <BlocoBriefing key={id} canal={canal} />;
      case "tarefas":
        return <BlocoTarefas key={id} canal={canal} agora={agora} refBloco={refTarefas} />;
      case "foco":
        return <BlocoFoco key={id} canal={canal} />;
      case "financas":
        return <BlocoFinancas key={id} />;
      case "dev":
        return <BlocoDev key={id} canal={canal} />;
      case "sessoes":
        return <BlocoSessoes key={id} canal={canal} agora={agora} />;
    }
  };
  return (
    <div className="inicio-blocos">
      {trechosDoInicio(lista).map((trecho) =>
        trecho.tipo === "faixa" ? (
          bloco(trecho.id)
        ) : (
          <div
            key={trecho.colunas.flat().join("|")}
            className="inicio-colunas"
            data-colunas={trecho.colunas.length}
          >
            {trecho.colunas.map((coluna) => (
              <div key={coluna.join("|")} className="inicio-coluna">
                {coluna.map(bloco)}
              </div>
            ))}
          </div>
        ),
      )}
    </div>
  );
}

interface PropsBloco {
  id: IdBlocoInicio;
  /** O que vai à direita do título: a contagem, o tempo de hoje. */
  direita?: ReactNode;
  children: ReactNode;
  refBloco?: Ref<HTMLElement>;
}

/** O cartão de um bloco: o título pequeno à esquerda, a situação à direita e o conteúdo. */
function Bloco({ id, direita, children, refBloco }: PropsBloco) {
  const idTitulo = useId();
  return (
    <section ref={refBloco} className="inicio-bloco" data-bloco={id} aria-labelledby={idTitulo}>
      <header className="inicio-bloco-topo">
        <h2 id={idTitulo} className="inicio-bloco-titulo">
          {DADOS_BLOCOS[id].nome}
        </h2>
        {direita}
      </header>
      {children}
    </section>
  );
}

/** Um texto curto no lugar do que não há (ou ainda não chegou), com a ação que resolve. */
function Vazio({ texto, lendo = false, acao }: { texto: string; lendo?: boolean; acao?: ReactNode }) {
  return (
    <div className="inicio-vazio" role={lendo ? "status" : undefined}>
      <p className="inicio-texto">{texto}</p>
      {acao}
    </div>
  );
}

function TentarDeNovo({ aoClicar }: { aoClicar: () => void }) {
  return (
    <Botao tamanho="pequeno" onClick={aoClicar}>
      Tentar de novo
    </Botao>
  );
}

/** "Mais 2 em Tarefas": o que não coube no bloco fica na área. */
function MaisNaArea({ quantos, area, nome }: { quantos: number; area: IdArea; nome: string }) {
  const { ir } = useAcoesSistema();
  if (quantos <= 0) return null;
  return (
    <Botao variante="fantasma" tamanho="pequeno" className="inicio-mais" onClick={() => ir({ area })}>
      {`Mais ${quantos} em ${nome}`}
    </Botao>
  );
}

/**
 * A abertura do briefing da Alba (Sistema.dc.html). O briefing inteiro, com as linhas e as ações,
 * é o do painel Hoje; aqui fica só a abertura. Enquanto ele não apareceu hoje, o bloco diz quando
 * ele chega; se o serviço não respondeu, diz isso e oferece tentar de novo.
 */
function BlocoBriefing({ canal }: { canal: EstadoConexao }) {
  const idRotulo = useId();
  const leitura = useBriefingDeHoje(canal);
  return (
    <section className="inicio-briefing" data-bloco="briefing" aria-labelledby={idRotulo}>
      <Personagem agente="alba" modo="cabeca" tamanho="inicio" estado="ocioso" />
      <div className="inicio-briefing-corpo">
        <h2 id={idRotulo} className="inicio-briefing-rotulo">
          Alba · briefing da manhã
        </h2>
        {leitura.estado === "esperando" && <Vazio texto="Lendo o briefing." lendo />}
        {leitura.estado === "falhou" && (
          <Vazio
            texto="Não consegui ler o briefing agora."
            acao={<TentarDeNovo aoClicar={leitura.tentarDeNovo} />}
          />
        )}
        {leitura.estado === "pronta" && (
          <p className="inicio-briefing-texto">
            {leitura.dados?.abertura ?? "O briefing da manhã aparece aqui quando a Alba abrir o dia."}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * As tarefas de hoje (as atrasadas primeiro), até 5, com "3 de 7" feitas, a caixa que marca com o
 * Desfazer e a frase que cria para hoje. Quem decide o que é hoje é o serviço.
 */
function BlocoTarefas({
  canal,
  agora,
  refBloco,
}: {
  canal: EstadoConexao;
  agora: Date;
  refBloco: Ref<HTMLElement>;
}) {
  const fuso = useFuso(canal) ?? fusoLocal();
  const hoje = diaNoFuso(agora, fuso);
  const minutoAgora = minutosDaHora(horaNoFuso(agora, fuso));
  const tarefas = useTarefasDoDia(canal, hoje);
  const listas = useListas(canal);
  const [aviso, setAviso] = useAvisoDesfazer();
  const [erro, setErro] = useState<string | null>(null);

  const doDia = tarefas.estado === "pronta" ? tarefas.dados : null;
  const { linhas, fora } = linhasDoHoje(doDia?.atrasadas ?? [], doDia?.hoje ?? [], TAREFAS_NO_INICIO);
  const contagem = feitasDoDia(deCima(doDia?.hoje ?? []));
  const abertas: Lista[] = (listas ?? []).filter((l) => !l.arquivada);

  const marcar = (tarefa: Parameters<typeof marcarTarefa>[0], feita: boolean) => {
    setErro(null);
    marcarTarefa(tarefa, feita, setAviso, setErro);
  };

  return (
    <Bloco
      id="tarefas"
      refBloco={refBloco}
      direita={doDia && contagem.total > 0 && <span>{`${contagem.feitas} de ${contagem.total}`}</span>}
    >
      {tarefas.estado === "esperando" && <Vazio texto="Lendo as tarefas." lendo />}
      {tarefas.estado === "falhou" && (
        <Vazio
          texto="Não consegui ler as tarefas agora."
          acao={<TentarDeNovo aoClicar={tarefas.tentarDeNovo} />}
        />
      )}
      {doDia && linhas.length === 0 && <Vazio texto="Nada para hoje. Escreva abaixo o que precisa fazer." />}
      {linhas.length > 0 && (
        <ul className="tarefas-lista">
          {linhas.map((t) => (
            <LinhaTarefa
              key={t.id}
              tarefa={t}
              listas={listas}
              hoje={hoje}
              minutoAgora={minutoAgora}
              aoMarcar={marcar}
            />
          ))}
        </ul>
      )}
      <MaisNaArea quantos={fora} area="tarefas" nome="Tarefas" />
      {erro && (
        <p className="dia-erro" role="alert">
          {erro}
        </p>
      )}
      {aviso && <LinhaDesfazer key={chaveDoAviso(aviso)} aviso={aviso} aoAcabar={() => setAviso(null)} />}
      <CampoFrase listas={abertas} hoje={hoje} contexto={{ listaId: null, dia: hoje }} />
    </Bloco>
  );
}

const NOME_DA_ETAPA = { foco: "Foco", pausa: "Pausa", pausa_longa: "Pausa longa" } as const;
const COMECAR = {
  foco: "Começar foco",
  pausa: "Começar a pausa",
  pausa_longa: "Começar a pausa longa",
} as const;

/**
 * O foco (Sistema.dc.html): o tempo de hoje, o relógio que falta contado na tela a partir de
 * `terminaEm`, a tarefa e a barra. Parado, diz isso e oferece começar o que vem agora.
 */
function BlocoFoco({ canal }: { canal: EstadoConexao }) {
  const foco = useEstadoFoco(canal);
  const segundos = useSegundosRestantes(foco?.etapa ?? null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const hojeTexto =
    foco && foco.focoHojeMin > 0 ? <span>{`${duracao(foco.focoHojeMin * 60_000)} hoje`}</span> : null;

  if (!foco) {
    return (
      <Bloco id="foco">
        <Vazio texto="Lendo o foco." lendo />
      </Bloco>
    );
  }

  const { etapa } = foco;
  if (etapa === null || segundos === null) {
    const comecar = () => {
      if (ocupado) return;
      setOcupado(true);
      setErro(null);
      servico
        .pedir("foco.iniciar", { tipo: foco.proxima })
        .catch(() => setErro("Não consegui começar o foco agora. Tente de novo."))
        .finally(() => setOcupado(false));
    };
    return (
      <Bloco id="foco" direita={hojeTexto}>
        <Vazio
          texto="Nenhum foco agora."
          acao={
            <Botao tamanho="pequeno" disabled={ocupado} onClick={comecar}>
              {COMECAR[foco.proxima]}
            </Botao>
          }
        />
        {erro && (
          <p className="dia-erro" role="alert">
            {erro}
          </p>
        )}
      </Bloco>
    );
  }

  const pausada = etapa.pausadaEm !== null;
  const nome = NOME_DA_ETAPA[etapa.tipo];
  return (
    <Bloco id="foco" direita={hojeTexto}>
      {(etapa.tipo !== "foco" || pausada) && (
        <span className="inicio-foco-etapa">
          {etapa.tipo !== "foco" && nome}
          {pausada && <Selo tom="apagado">em pausa</Selo>}
        </span>
      )}
      <span className="inicio-relogio" role="timer" aria-label={`Faltam ${relogioFalado(segundos)}`}>
        {relogioDoFoco(segundos)}
      </span>
      {foco.tarefaTitulo && <span className="inicio-foco-tarefa">{foco.tarefaTitulo}</span>}
      <Progresso
        valor={fracaoFeita(etapa, segundos)}
        maximo={1}
        rotulo={`Tempo de ${nome.toLowerCase()}`}
        textoValor={`faltam ${relogioDoFoco(segundos)}`}
      />
    </Bloco>
  );
}

/**
 * Finanças, vazio honesto: a Tula chega na fase 4 e, sem lançamento, não há número (DESIGN.md §5,
 * "Ainda não vale"). Nada de orçamento inventado.
 */
function BlocoFinancas() {
  return (
    <Bloco id="financas" direita={<Selo tom="apagado">chega com Finanças</Selo>}>
      <p className="inicio-texto">O orçamento do mês aparece aqui quando a Tula chegar.</p>
    </Bloco>
  );
}

/**
 * Os PRs que esperam você (review pedido a você, CI do seu PR quebrado, mudanças pedidas), até 3,
 * com o repositório e o número. Quem decide o que precisa de você é o serviço (`precisaDeMim`).
 */
function BlocoDev({ canal }: { canal: EstadoConexao }) {
  const github = useDadosDev(canal);
  if (github.estado === "esperando") {
    return (
      <Bloco id="dev">
        <Vazio texto="Lendo o GitHub." lendo />
      </Bloco>
    );
  }
  if (github.estado === "falhou") {
    return (
      <Bloco id="dev">
        <Vazio
          texto="Não consegui ler o GitHub agora."
          acao={<TentarDeNovo aoClicar={github.tentarDeNovo} />}
        />
      </Bloco>
    );
  }
  const { situacao, conexao } = github.dados;
  const esperando = situacao.itens.filter((i) => i.tipo === "pr" && i.estado === "aberto" && i.precisaDeMim);
  const naTela = esperando.slice(0, ITENS_NO_BLOCO);
  const ligado = conexao?.estado === "ligada";
  return (
    <Bloco id="dev" direita={esperando.length > 0 && <span>esperando você</span>}>
      {conexao?.estado === "erro" && (
        <p className="dia-erro" role="alert">
          {conexao.ultimoErro ?? "A conexão com o GitHub deu erro."}
        </p>
      )}
      {naTela.length === 0 &&
        (ligado || conexao?.estado === "erro" ? (
          <Vazio texto="Nenhum PR esperando você." />
        ) : (
          <Vazio
            texto="Conecte o GitHub para ver aqui os PRs que esperam você."
            acao={<AbrirConexoes variante="secundario" />}
          />
        ))}
      {naTela.length > 0 && (
        <ul className="inicio-lista">
          {naTela.map((pr) => (
            <li key={pr.id} className="inicio-pr">
              <span className="inicio-pr-titulo" title={pr.titulo}>
                {pr.titulo || "Sem título"}
              </span>
              <span className="inicio-meta">{referencia(pr)}</span>
            </li>
          ))}
        </ul>
      )}
      <MaisNaArea quantos={esperando.length - naTela.length} area="dev" nome="Dev" />
    </Bloco>
  );
}

/** As sessões abertas, da que espera você à que parou, até 3, com o estado em texto. */
function BlocoSessoes({ canal, agora }: { canal: EstadoConexao; agora: Date }) {
  const sessoes = useDadosSessoes(canal, agora);
  const situacao = situacaoDasSessoes(sessoes);
  const lista = sessoes.estado === "pronta" ? sessoes.dados.lista : null;
  const abertas = lista ? sessoesAbertas(lista) : [];
  const projetos = lista ? nomesDosProjetos(lista) : new Map();
  const naTela = abertas.slice(0, ITENS_NO_BLOCO);
  return (
    <Bloco id="sessoes">
      {naTela.length === 0 && situacao === "esperando" && <Vazio texto="Lendo as sessões." lendo />}
      {naTela.length === 0 && situacao === "falhou" && sessoes.estado === "falhou" && (
        <Vazio
          texto="Não consegui ler as sessões agora."
          acao={<TentarDeNovo aoClicar={sessoes.tentarDeNovo} />}
        />
      )}
      {naTela.length === 0 && situacao === "ligado" && <Vazio texto="Nenhuma sessão aberta agora." />}
      {naTela.length === 0 && situacao === "desligado" && (
        <Vazio
          texto="Ligue o Claude Code em Conexões para acompanhar as sessões aqui."
          acao={<AbrirConexoes variante="secundario" />}
        />
      )}
      {naTela.length > 0 && (
        <ul className="inicio-lista">
          {naTela.map((sessao) => {
            const estado = estadoDaSessao(sessao, agora);
            const projeto = sessao.projetoId ? projetos.get(sessao.projetoId) : undefined;
            return (
              <li key={sessao.id} className="inicio-sessao">
                <span className="inicio-ponto" data-tom={estado.tom} aria-hidden="true" />
                <span className="inicio-sessao-nome">
                  {nomeDaSessao(sessao)}
                  <span className="inicio-sessao-projeto">{` · ${projeto?.nome ?? "sem projeto"}`}</span>
                </span>
                <span className="inicio-sessao-estado" data-tom={estado.tom}>
                  {estado.texto}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <MaisNaArea quantos={abertas.length - naTela.length} area="sessoes" nome="Sessões de IA" />
    </Bloco>
  );
}
