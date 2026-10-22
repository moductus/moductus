import type { CiclosFoco, EstadoFoco, EtapaFoco, NomeMetodo, Tarefa } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useId, useState, type ReactNode } from "react";
import { haQuanto, useAgora } from "../../areas/tempo.ts";
import { Botao } from "../../componentes/Botao.tsx";
import { Caixa } from "../../componentes/Caixa.tsx";
import { FalaAgente } from "../../componentes/FalaAgente.tsx";
import { Icone } from "../../componentes/Icone.tsx";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { formatarHora } from "../../componentes/personagem/quando.ts";
import { Progresso } from "../../componentes/Progresso.tsx";
import { servico } from "../../servico/conexao.ts";
import {
  ciclosDaRodada,
  duracaoCurta,
  fracaoFeita,
  horaFalada,
  relogioDoFoco,
  relogioFalado,
  useEstadoFoco,
  useSegundosRestantes,
} from "../../servico/foco.ts";
import { CabecalhoPainel } from "./Cabecalho.tsx";
import {
  chaveDoEncaixe,
  depoisDeste,
  diaNoFuso,
  falaDoEncaixe,
  proximoEncaixe,
  useConfigDoFoco,
  useDiaDaAgenda,
  useTarefasDoFoco,
  type Encaixe,
} from "./foco.ts";
import "./PainelFoco.css";

/** O "+5 min" do painel, o mesmo do aviso de ciclo terminado. */
const MINUTOS_A_MAIS = 5;

const hora = (instante: string) => formatarHora(new Date(instante));

const NOME_DA_PAUSA = { pausa: "pausa", pausa_longa: "pausa longa" } as const;

/** "1 ciclo hoje", "3 ciclos hoje". */
const ciclosHoje = (n: number) => `${n} ${n === 1 ? "ciclo" : "ciclos"} hoje`;

/** O que vai entre parênteses do erro: o que o botão pediu. */
const O_QUE_PEDIU: Partial<Record<NomeMetodo, string>> = {
  "foco.iniciar": "começar",
  "foco.pausar": "pausar",
  "foco.retomar": "continuar",
  "foco.terminar": "terminar",
  "foco.estender": "estender",
  "foco.pularPausa": "pular a pausa",
  "tarefas.concluir": "concluir a tarefa",
  "agenda.aplicarSugestao": "guardar o bloco",
  "execucoes.desfazer": "desfazer",
};

/** Um pedido de botão: o erro vira uma linha no painel, sem o texto cru do serviço. */
type Pedir = (metodo: NomeMetodo, entrada?: unknown) => Promise<unknown>;

interface PropsCartao {
  foco: EstadoFoco;
  etapa: EtapaFoco;
  segundos: number;
  agora: Date;
  etiqueta: string | null;
  pedir: Pedir;
}

/** O foco ou a pausa correndo (ou parados), como no quadro: rótulo, relógio, tarefa, barra e botões. */
function CartaoEtapa({ foco, etapa, segundos, agora, etiqueta, pedir }: PropsCartao) {
  const pausada = etapa.pausadaEm !== null;
  const ehFoco = etapa.tipo === "foco";
  const proximoCiclo = (foco.cicloAtual % foco.ciclosAtePausaLonga) + 1;
  const rotulo = ehFoco
    ? `Ciclo ${foco.cicloAtual} de ${foco.ciclosAtePausaLonga} · ${etapa.duracaoPlanejadaMin} min`
    : `${etapa.tipo === "pausa" ? "Pausa" : "Pausa longa"} · ${etapa.duracaoPlanejadaMin} min`;
  const quando = pausada
    ? `em pausa ${haQuanto(etapa.pausadaEm!, agora)}`
    : ehFoco
      ? `termina ${hora(etapa.terminaEm)}`
      : etapa.tipo === "pausa"
        ? `foco ${proximoCiclo} de ${foco.ciclosAtePausaLonga} começa ${hora(etapa.terminaEm)}`
        : `rodada termina ${hora(etapa.terminaEm)}`;
  const fracao = fracaoFeita(etapa, segundos);
  const falado = `${relogioFalado(segundos)} ${ehFoco ? "restantes" : "de pausa"}${pausada ? ", em pausa" : ""}`;

  return (
    <section className="foco-cartao" aria-label={ehFoco ? "Ciclo de foco" : "Pausa"}>
      <div className="foco-linha-rotulo">
        <span>{rotulo}</span>
        <span>{quando}</span>
      </div>
      <div className="foco-relogio" role="timer" aria-label={falado} data-pausado={pausada || undefined}>
        {relogioDoFoco(segundos)}
      </div>
      {foco.tarefaTitulo && (
        <div className="foco-tarefa">
          <span className="foco-tarefa-titulo" title={foco.tarefaTitulo}>
            {foco.tarefaTitulo}
          </span>
          {etiqueta && <code className="foco-etiqueta">{etiqueta}</code>}
        </div>
      )}
      <Progresso
        valor={Math.round(fracao * 100)}
        rotulo={ehFoco ? "Andamento do ciclo" : "Andamento da pausa"}
        textoValor={`${Math.round(fracao * 100)}%`}
        tom={pausada ? "neutro" : "destaque"}
      />
      <div className="foco-botoes">
        {!ehFoco && !pausada ? (
          <>
            <Botao variante="primario" onClick={() => void pedir("foco.pularPausa")}>
              Voltar ao foco agora
            </Botao>
            <Botao onClick={() => void pedir("foco.terminar")}>Encerrar a rodada</Botao>
          </>
        ) : (
          <>
            {pausada ? (
              <Botao variante="primario" onClick={() => void pedir("foco.retomar")}>
                Continuar
              </Botao>
            ) : (
              <Botao variante="primario" onClick={() => void pedir("foco.pausar")}>
                Pausar
              </Botao>
            )}
            <Botao onClick={() => void pedir("foco.terminar")}>
              {ehFoco ? "Terminar ciclo" : "Encerrar a rodada"}
            </Botao>
            {ehFoco && (
              <Botao
                variante="fantasma"
                onClick={() => void pedir("foco.estender", { minutos: MINUTOS_A_MAIS })}
              >
                {`+${MINUTOS_A_MAIS} min`}
              </Botao>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Nada correndo. Depois de um foco, a Alba propõe a pausa (AreaFocoEstados, "Ciclo terminado");
 * sem proposta, o próximo foco espera o "Começar foco" (ou o atalho).
 */
function CartaoParado({
  foco,
  ciclos,
  pedir,
}: {
  foco: EstadoFoco;
  ciclos: CiclosFoco | null;
  pedir: Pedir;
}) {
  if (foco.proxima !== "foco") {
    const minutos = ciclos ? (foco.proxima === "pausa" ? ciclos.pausaMin : ciclos.pausaLongaMin) : null;
    const pausa = `${NOME_DA_PAUSA[foco.proxima]}${minutos ? ` de ${minutos} min` : ""}`;
    return (
      <section className="foco-cartao" aria-label="Ciclo terminado">
        <FalaAgente agente="alba" estado="ocioso" tamanho="lista">
          {`Ciclo ${foco.cicloAtual} de ${foco.ciclosAtePausaLonga} terminou. Começo a ${pausa}?`}
        </FalaAgente>
        <div className="foco-botoes">
          <Botao variante="primario" onClick={() => void pedir("foco.iniciar", { tipo: foco.proxima })}>
            Começar a pausa
          </Botao>
          <Botao onClick={() => void pedir("foco.pularPausa")}>Pular a pausa</Botao>
          <Botao variante="fantasma" onClick={() => void pedir("foco.estender", { minutos: MINUTOS_A_MAIS })}>
            {`+${MINUTOS_A_MAIS} min de foco`}
          </Botao>
        </div>
      </section>
    );
  }
  const minutos = ciclos?.focoMin ?? null;
  return (
    <section className="foco-cartao" aria-label="Foco parado">
      <div className="foco-linha-rotulo">
        <span>
          {`Ciclo ${foco.cicloAtual} de ${foco.ciclosAtePausaLonga}`}
          {minutos !== null && ` · ${minutos} min`}
        </span>
        <span>parado</span>
      </div>
      {minutos !== null && (
        <div
          className="foco-relogio"
          role="timer"
          aria-label={`${relogioFalado(minutos * 60)}, parado`}
          data-pausado
        >
          {relogioDoFoco(minutos * 60)}
        </div>
      )}
      {foco.tarefaTitulo && (
        <div className="foco-tarefa">
          <span className="foco-tarefa-titulo" title={foco.tarefaTitulo}>
            {foco.tarefaTitulo}
          </span>
        </div>
      )}
      <div className="foco-botoes">
        <Botao variante="primario" onClick={() => void pedir("foco.iniciar", {})}>
          Começar foco
        </Botao>
      </div>
    </section>
  );
}

/**
 * A linha do silêncio: com o foco correndo, os avisos esperam até o fim dele, menos aprovações e
 * lembretes (Configurações › Notificações, "Durante o foco"); pausado ou na pausa, voltam.
 */
function LinhaSilencio({ etapa, silenciaNoFoco }: { etapa: EtapaFoco; silenciaNoFoco: boolean }) {
  const pausada = etapa.pausadaEm !== null;
  let texto: string | null;
  if (etapa.tipo === "foco" && !pausada) {
    texto = silenciaNoFoco
      ? `Avisos em silêncio até ${hora(etapa.terminaEm)}, menos aprovações e lembretes.`
      : null;
  } else if (etapa.tipo === "foco") {
    texto = "Em pausa, os avisos voltam ao normal.";
  } else {
    texto =
      etapa.tipo === "pausa" && !pausada
        ? `Na pausa, os avisos voltam ao normal. O próximo foco começa sozinho às ${hora(etapa.terminaEm)}.`
        : "Na pausa, os avisos voltam ao normal.";
  }
  if (texto === null) return null;
  return (
    <p className="foco-silencio">
      {etapa.tipo === "foco" && !pausada && <Icone nome="silencio" tamanho={16} />}
      <span>{texto}</span>
    </p>
  );
}

/** O foco de hoje e a rodada em trilhos: feitos, o atual e os que faltam. */
function Hoje({ foco }: { foco: EstadoFoco }) {
  const id = useId();
  const ciclos = ciclosDaRodada(foco);
  const feitos = ciclos.filter((c) => c === "feito").length;
  return (
    <section className="painel-secao" aria-labelledby={id}>
      <header className="painel-secao-cabecalho">
        <h2 id={id} className="painel-secao-titulo">
          Hoje
        </h2>
        <span>{duracaoCurta(foco.focoHojeMin)}</span>
      </header>
      <div
        className="foco-ciclos"
        role="img"
        aria-label={`${feitos} de ${ciclos.length} ciclos da rodada feitos`}
      >
        {ciclos.map((situacao, i) => (
          <span key={i} className="foco-ciclo" data-situacao={situacao} />
        ))}
      </div>
    </section>
  );
}

/** A meta de uma tarefa na lista: a estimativa ("25 min") ou, sem ela, a hora marcada. */
const metaDaTarefa = (t: Tarefa) =>
  t.duracaoEstimadaMin !== null ? duracaoCurta(t.duracaoEstimadaMin) : (t.hora ?? "");

function DepoisDeste({ tarefas, pedir }: { tarefas: readonly Tarefa[]; pedir: Pedir }) {
  const id = useId();
  return (
    <section className="painel-secao foco-depois" aria-labelledby={id}>
      <header className="painel-secao-cabecalho">
        <h2 id={id} className="painel-secao-titulo">
          Depois deste
        </h2>
      </header>
      {tarefas.length === 0 ? (
        <p className="foco-nada">Nenhuma outra tarefa para hoje.</p>
      ) : (
        <ul className="foco-lista">
          {tarefas.map((t) => (
            <li key={t.id} className="foco-lista-linha">
              <Caixa
                marcado={false}
                aria-label={`Concluir ${t.titulo}`}
                aoMudar={() => void pedir("tarefas.concluir", { id: t.id })}
              />
              <span className="foco-lista-titulo" title={t.titulo}>
                {t.titulo}
              </span>
              <span className="foco-lista-meta">{metaDaTarefa(t)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** O que o "Guardar bloco" criou, com o desfazer de 24 h da ação `interno`. */
interface Guardado {
  texto: string;
  chamadaId: string;
}

function SugestaoDaAlba({ children, acoes }: { children: ReactNode; acoes: ReactNode }) {
  return (
    <section className="foco-sugestao" aria-label="Sugestão da Alba">
      <div className="foco-sugestao-fala">
        <Personagem agente="alba" modo="cabeca" tamanho="lista" estado="ocioso" />
        <p>{children}</p>
      </div>
      <div className="foco-sugestao-acoes">{acoes}</div>
    </section>
  );
}

/**
 * O painel Foco do dock (PainelFoco.dc.html): o ciclo com o relógio que a janela conta sozinha a
 * partir do fim planejado, os botões que pedem ao serviço, a linha do silêncio, o foco de hoje, as
 * próximas tarefas e a sugestão da Alba para o próximo bloco livre. O Ctrl+Alt+P (Configurações ›
 * Atalhos) vale de qualquer lugar e chega aqui pelo `foco.mudou`.
 */
export function PainelFoco({ canal, abertura }: { canal: EstadoConexao; abertura: number }) {
  const foco = useEstadoFoco(canal, abertura);
  const estadoConfig = useConfigDoFoco(canal);
  const config = estadoConfig?.config ?? null;
  const agora = useAgora();
  const hoje = diaNoFuso(agora, config?.dia.fuso ?? null);
  const tarefas = useTarefasDoFoco(canal, abertura);
  const dia = useDiaDaAgenda(canal, hoje, abertura);
  const etapa = foco?.etapa ?? null;
  const segundos = useSegundosRestantes(etapa, 1, abertura);
  const [recusados, setRecusados] = useState<ReadonlySet<string>>(() => new Set());
  const [guardado, setGuardado] = useState<Guardado | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const pedir: Pedir = (metodo, entrada) =>
    (servico.pedir as (m: NomeMetodo, e?: unknown) => Promise<unknown>)(metodo, entrada).then(
      (resposta) => {
        setErro(null);
        return resposta;
      },
      () => {
        setErro(`Não consegui ${O_QUE_PEDIU[metodo] ?? "fazer isso"} agora. Tente de novo.`);
        return null;
      },
    );

  const atalho = config?.atalhos.foco ?? "";
  const atualId = etapa?.tarefaId ?? null;
  const lista = tarefas ?? [];
  const etiqueta = lista.find((t) => t.id === atualId)?.etiquetas[0]?.nome ?? null;
  const encaixe = proximoEncaixe(dia, lista, atualId, recusados);

  const guardar = (e: Encaixe) =>
    void pedir("agenda.aplicarSugestao", e.sugestao).then((aplicada) => {
      if (!aplicada) return;
      const { chamadaId } = aplicada as { chamadaId: string };
      const { inicio, fim } = e.sugestao;
      setGuardado({
        texto: `Guardei das ${horaFalada(inicio)} às ${horaFalada(fim)} para “${e.titulo}”.`,
        chamadaId,
      });
    });
  const desfazer = (g: Guardado) =>
    void pedir("execucoes.desfazer", { chamadaId: g.chamadaId }).then((feito) => {
      if (feito) setGuardado(null);
    });
  const recusar = (e: Encaixe) => setRecusados((atual) => new Set(atual).add(chaveDoEncaixe(e.sugestao)));

  return (
    <>
      <CabecalhoPainel
        titulo="Foco"
        subtitulo={foco ? `Alba guarda o tempo · ${ciclosHoje(foco.ciclosHoje)}` : undefined}
        atalhoDaArea={atalho ? { teclas: atalho, acao: "Iniciar ou pausar o foco" } : undefined}
      />
      <div className="painel-corpo">
        {foco === null ? (
          <div className="painel-vazio" role="status">
            <h2 className="painel-vazio-titulo">Sem notícia do foco agora</h2>
            <p className="painel-vazio-texto">Esperando o serviço dizer como está o ciclo.</p>
          </div>
        ) : (
          <>
            {etapa && segundos !== null ? (
              <CartaoEtapa
                foco={foco}
                etapa={etapa}
                segundos={segundos}
                agora={agora}
                etiqueta={etiqueta}
                pedir={pedir}
              />
            ) : (
              <CartaoParado foco={foco} ciclos={config?.dia.foco ?? null} pedir={pedir} />
            )}
            {erro && (
              <p className="painel-secao-erro" role="alert">
                {erro}
              </p>
            )}
            {etapa && <LinhaSilencio etapa={etapa} silenciaNoFoco={config?.silencio.foco ?? true} />}
            <Hoje foco={foco} />
            {tarefas && <DepoisDeste tarefas={depoisDeste(lista, atualId)} pedir={pedir} />}
            {guardado ? (
              <SugestaoDaAlba
                acoes={
                  <Botao variante="fantasma" tamanho="pequeno" onClick={() => desfazer(guardado)}>
                    Desfazer
                  </Botao>
                }
              >
                {guardado.texto}
              </SugestaoDaAlba>
            ) : (
              encaixe && (
                <SugestaoDaAlba
                  acoes={
                    <>
                      <Botao tamanho="pequeno" onClick={() => recusar(encaixe)}>
                        Não
                      </Botao>
                      <Botao variante="primario" tamanho="pequeno" onClick={() => guardar(encaixe)}>
                        Guardar bloco
                      </Botao>
                    </>
                  }
                >
                  {falaDoEncaixe(encaixe)}
                </SugestaoDaAlba>
              )
            )}
          </>
        )}
      </div>
    </>
  );
}
