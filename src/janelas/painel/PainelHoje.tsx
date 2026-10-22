import type { EstadoFoco, TipoEtapa } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useId, useState } from "react";
import type { Leitura } from "../../areas/leitura.ts";
import { useAgora } from "../../areas/tempo.ts";
import { Botao } from "../../componentes/Botao.tsx";
import { Progresso } from "../../componentes/Progresso.tsx";
import { Selo } from "../../componentes/Selo.tsx";
import { servico } from "../../servico/conexao.ts";
import { usePedidosDoTerminal } from "../../servico/aprovacoes.ts";
import { CabecalhoPainel } from "./Cabecalho.tsx";
import {
  useAtalhoDoSistema,
  useFoco,
  useFuso,
  useLembretesDeHoje,
  useListas,
  useTarefasDoDia,
} from "./dados.ts";
import {
  cronometro,
  dataPorExtenso,
  diaNoFuso,
  duracao,
  fusoLocal,
  horaNoFuso,
  minutosDaHora,
} from "./dia.ts";
import {
  CampoFrase,
  chaveDoAviso,
  LinhaDesfazer,
  LinhaTarefa,
  marcarTarefa,
  useAvisoDesfazer,
} from "./Dia.tsx";
import { LembretesDoHoje } from "./LembretesDoHoje.tsx";
import { abrirNoSistema, PedidoDaSessao } from "./PedidosSessoes.tsx";
import { itensDasSessoes } from "./sessoes.ts";
import { deCima, feitasDoDia, linhasDoHoje } from "./tarefas.ts";

/** O nome de cada etapa no alto do bloco. */
const NOME_DA_ETAPA: Readonly<Record<TipoEtapa, string>> = {
  foco: "Foco",
  pausa: "Pausa",
  pausa_longa: "Pausa longa",
};

/** O botão que começa a etapa que vem agora, quando nada está rodando. */
const COMECAR: Readonly<Record<TipoEtapa, string>> = {
  foco: "Começar foco",
  pausa: "Começar a pausa",
  pausa_longa: "Começar a pausa longa",
};

/**
 * O foco no Hoje (Main.dc.html): a etapa, o ciclo ("2 de 4"), o tempo que falta contado na tela a
 * partir de `terminaEm` (o fim é do relógio do serviço), a tarefa, a barra e [Pausar] [Encerrar].
 * Parado, uma linha diz isso e oferece começar o que vem agora.
 */
function BlocoFoco({ foco }: { foco: EstadoFoco }) {
  const idTitulo = useId();
  const agora = useAgora(1000);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const agir = (pedido: () => Promise<unknown>) => {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    pedido()
      .catch(() => setErro("Não consegui mudar o foco agora. Tente de novo."))
      .finally(() => setOcupado(false));
  };
  const { etapa } = foco;
  const falha = erro && (
    <p className="dia-erro" role="alert">
      {erro}
    </p>
  );

  if (etapa === null) {
    return (
      <section className="dia-bloco" aria-labelledby={idTitulo}>
        <div className="dia-bloco-topo">
          <h2 id={idTitulo} className="dia-bloco-titulo">
            Foco
          </h2>
          {foco.focoHojeMin > 0 && <span>{`${duracao(foco.focoHojeMin * 60_000)} hoje`}</span>}
        </div>
        <div className="dia-bloco-linha">
          <p className="dia-bloco-texto">Nenhum foco agora.</p>
          <Botao
            tamanho="pequeno"
            disabled={ocupado}
            onClick={() => agir(() => servico.pedir("foco.iniciar", { tipo: foco.proxima }))}
          >
            {COMECAR[foco.proxima]}
          </Botao>
        </div>
        {falha}
      </section>
    );
  }

  const pausada = etapa.pausadaEm !== null;
  const ate = pausada ? Date.parse(etapa.pausadaEm!) : agora.getTime();
  const restante = Math.max(0, Date.parse(etapa.terminaEm) - ate);
  const planejada = etapa.duracaoPlanejadaMin * 60_000;
  return (
    <section className="dia-bloco" aria-labelledby={idTitulo}>
      <div className="dia-bloco-topo">
        <h2 id={idTitulo} className="dia-bloco-titulo">
          {NOME_DA_ETAPA[etapa.tipo]}
          {pausada && <Selo tom="apagado">em pausa</Selo>}
        </h2>
        {etapa.tipo === "foco" && <span>{`${foco.cicloAtual} de ${foco.ciclosAtePausaLonga}`}</span>}
      </div>
      <span className="dia-cronometro" role="timer" aria-label="Tempo que falta">
        {cronometro(restante)}
      </span>
      {foco.tarefaTitulo && <span className="dia-bloco-tarefa">{foco.tarefaTitulo}</span>}
      <Progresso
        valor={planejada - restante}
        maximo={planejada}
        rotulo={`Tempo de ${NOME_DA_ETAPA[etapa.tipo].toLowerCase()}`}
        textoValor={`faltam ${cronometro(restante)}`}
      />
      {falha}
      <div className="dia-bloco-acoes">
        {pausada ? (
          <Botao disabled={ocupado} onClick={() => agir(() => servico.pedir("foco.retomar"))}>
            Retomar
          </Botao>
        ) : (
          <Botao disabled={ocupado} onClick={() => agir(() => servico.pedir("foco.pausar"))}>
            Pausar
          </Botao>
        )}
        <Botao
          variante="fantasma"
          disabled={ocupado}
          onClick={() => agir(() => servico.pedir("foco.terminar"))}
        >
          Encerrar
        </Botao>
      </div>
    </section>
  );
}

interface PropsLeituraVazia {
  leitura: Leitura<unknown>;
  /** Sem ele, enquanto lê nada aparece (o lembrete não pisca no alto do Hoje). */
  lendo?: string;
  falhou: string;
}

/** O vazio de uma leitura do dia: lendo, ou não leu (com tentar de novo). */
export function LeituraVazia({ leitura, lendo, falhou }: PropsLeituraVazia) {
  if (leitura.estado === "pronta" || (leitura.estado === "esperando" && !lendo)) return null;
  return (
    <div className="painel-secao-vazia" role={leitura.estado === "esperando" ? "status" : undefined}>
      <p>{leitura.estado === "esperando" ? lendo : falhou}</p>
      {leitura.estado === "falhou" && (
        <Botao tamanho="pequeno" onClick={leitura.tentarDeNovo}>
          Tentar de novo
        </Botao>
      )}
    </div>
  );
}

/**
 * Finanças, vazio honesto: a Tula chega na fase 4, e sem lançamento não há número (DESIGN.md §5,
 * "Ainda não vale"). Nada de orçamento inventado.
 */
function FinancasVazio() {
  const idTitulo = useId();
  return (
    <section className="dia-ainda-nao" aria-labelledby={idTitulo}>
      <div className="painel-secao-cabecalho">
        <h2 id={idTitulo} className="painel-secao-titulo">
          Finanças
        </h2>
        <Selo tom="apagado">chega com Finanças</Selo>
      </div>
      <p>O orçamento do mês aparece aqui quando a Tula chegar.</p>
    </section>
  );
}

/**
 * O painel Hoje do dock (Main.dc.html, Papel.dc.html, Vidro.dc.html, LembreteHoje.dc.html): o dia
 * numa tela. No alto o lembrete (atrasados, tocando, chegando), depois o foco, as tarefas de hoje
 * com a captura por frase, as finanças (vazio honesto até a Tula) e as sessões de IA esperando
 * você. Tudo vem do serviço; o que ele não disse, o painel não inventa.
 */
export function PainelHoje({ canal, abertura }: { canal: EstadoConexao; abertura: number }) {
  const agora = useAgora();
  const fuso = useFuso(canal) ?? fusoLocal();
  const hoje = diaNoFuso(agora, fuso);
  const minutoAgora = minutosDaHora(horaNoFuso(agora, fuso));
  const atalho = useAtalhoDoSistema(canal);
  const lembretes = useLembretesDeHoje(canal, abertura);
  const foco = useFoco(canal, abertura);
  const listas = useListas(canal, abertura);
  const tarefas = useTarefasDoDia(canal, hoje, abertura);
  const pedidos = usePedidosDoTerminal(canal, abertura);
  const [aviso, setAviso] = useAvisoDesfazer();
  const [erro, setErro] = useState<string | null>(null);
  const idTarefas = useId();
  const idSessoes = useId();

  const doDia = tarefas.estado === "pronta" ? tarefas.dados : null;
  const { linhas, fora } = linhasDoHoje(doDia?.atrasadas ?? [], doDia?.hoje ?? []);
  const contagem = feitasDoDia(deCima(doDia?.hoje ?? []));
  const conhecidas = [...(doDia?.hoje ?? []), ...(doDia?.atrasadas ?? [])];
  const pedidosNaTela = itensDasSessoes(null, pedidos).itens.filter((i) => i.tipo === "pedido");

  const marcar = (tarefa: Parameters<typeof marcarTarefa>[0], feita: boolean) => {
    setErro(null);
    marcarTarefa(tarefa, feita, setAviso, setErro);
  };

  return (
    <>
      <CabecalhoPainel
        titulo="Hoje"
        subtitulo={`${dataPorExtenso(hoje)} · ${horaNoFuso(agora, fuso)}`}
        sistema="inicio"
        atalho={atalho ?? undefined}
      />
      <div className="painel-corpo">
        <LeituraVazia leitura={lembretes} falhou="Não consegui ler os lembretes agora." />
        {lembretes.estado === "pronta" && (
          <LembretesDoHoje
            lembretes={lembretes.dados}
            tarefas={conhecidas}
            hoje={hoje}
            fuso={fuso}
            agora={agora}
          />
        )}
        {foco && <BlocoFoco foco={foco} />}

        <section className="painel-secao dia-tarefas" aria-labelledby={idTarefas}>
          <header className="painel-secao-cabecalho">
            <h2 id={idTarefas} className="painel-secao-titulo">
              Tarefas
            </h2>
            {doDia && contagem.total > 0 && <span>{`${contagem.feitas} de ${contagem.total}`}</span>}
          </header>
          <LeituraVazia
            leitura={tarefas}
            lendo="Lendo as tarefas."
            falhou="Não consegui ler as tarefas agora."
          />
          {doDia && linhas.length === 0 && (
            <p className="dia-vazio">Nada para hoje. Escreva abaixo o que precisa fazer.</p>
          )}
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
          {fora > 0 && (
            <Botao variante="fantasma" tamanho="pequeno" onClick={() => abrirNoSistema("tarefas")}>
              {`Mais ${fora} em Tarefas`}
            </Botao>
          )}
          {erro && (
            <p className="dia-erro" role="alert">
              {erro}
            </p>
          )}
          {aviso && <LinhaDesfazer key={chaveDoAviso(aviso)} aviso={aviso} aoAcabar={() => setAviso(null)} />}
          <CampoFrase rotulo="Captura rápida" placeholder="ligar pro banco amanhã 15h" aoLancar={setAviso} />
        </section>

        <FinancasVazio />

        {pedidosNaTela.length > 0 && (
          <section className="painel-secao" aria-labelledby={idSessoes}>
            <header className="painel-secao-cabecalho">
              <h2 id={idSessoes} className="painel-secao-titulo">
                Sessões de IA
              </h2>
            </header>
            {pedidosNaTela.map(
              (item) => item.tipo === "pedido" && <PedidoDaSessao key={item.aprovacao.id} item={item} />,
            )}
          </section>
        )}
      </div>
    </>
  );
}
