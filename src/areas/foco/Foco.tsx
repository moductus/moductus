import type {
  CiclosFoco,
  DiaDaAgenda,
  EstadoFoco,
  EtapaFoco,
  FocoPorDia,
  FocoPorTarefa,
  NomeMetodo,
  Tarefa,
} from "@moductus/contrato";
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { Atalho } from "../../componentes/Atalho.tsx";
import { Botao } from "../../componentes/Botao.tsx";
import { Caixa } from "../../componentes/Caixa.tsx";
import { Cartao } from "../../componentes/Cartao.tsx";
import { FalaAgente } from "../../componentes/FalaAgente.tsx";
import { Icone } from "../../componentes/Icone.tsx";
import { formatarHora } from "../../componentes/personagem/quando.ts";
import { Progresso } from "../../componentes/Progresso.tsx";
import { Selo } from "../../componentes/Selo.tsx";
import {
  chaveDoEncaixe,
  diaNoFuso,
  falaDoEncaixe,
  proximoEncaixe,
  useConfigDoFoco,
  useDiaDaAgenda,
  useTarefasDoFoco,
  type Encaixe,
} from "../../janelas/painel/foco.ts";
import { useAcoesSistema } from "../../janelas/sistema/primeiro-uso/estado.ts";
import { useServico } from "../../nativo/eventos.ts";
import { servico, useCanal } from "../../servico/conexao.ts";
import {
  fracaoFeita,
  horaFalada,
  relogioDoFoco,
  relogioFalado,
  useEstadoFoco,
  useSegundosRestantes,
} from "../../servico/foco.ts";
import { eIdSecao } from "../configuracoes/secoes.ts";
import { Pagina } from "../Pagina.tsx";
import { haQuanto, useAgora } from "../tempo.ts";
import {
  ciclosDoDia,
  ciclosEmTexto,
  duracaoDoFoco,
  etapasDaRodada,
  etapasDeHoje,
  falaDaRodada,
  falaDoCicloTerminado,
  inicioDaSemana,
  intervalo,
  metaDaTarefa,
  opcoesDeTarefa,
  relatorioPorTarefa,
  resumoDaRodada,
  semanaDoFoco,
  situacaoDoCiclo,
  textoDosCiclos,
  titulosConhecidos,
  useHistoricoFoco,
  type EtapaDaRodada,
  type RodadaCompleta,
  type SituacaoDoCiclo,
} from "./foco.ts";
import "./Foco.css";

/** O "+5 min" da área, o mesmo do painel e do aviso de ciclo terminado. */
const MINUTOS_A_MAIS = 5;

/** A seção de Configurações onde ficam os ciclos (ConfigDia.dc.html, F3-45). */
const SECAO_CICLOS = "dia";

const hora = (instante: string | number) => formatarHora(new Date(instante));

/** O que vai no erro: o que o botão pediu. */
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

/** Um pedido de botão: o erro vira uma linha na área, sem o texto cru do serviço. */
type Pedir = (metodo: NomeMetodo, entrada?: unknown) => Promise<unknown>;

/** A fração vai ao CSS, que a multiplica pela altura ou largura dos tokens. */
const fracaoCss = (fracao: number) => ({ "--fracao": fracao }) as CSSProperties;

/**
 * Sistema · Foco (AreaFoco.dc.html, AreaFocoEstados.dc.html, AreaFocoVazio.dc.html): o ciclo
 * atual com o relógio que a janela conta a partir do fim planejado, as etapas da rodada, os focos
 * de hoje, a semana e o relatório por tarefa. Sem nenhum ciclo hoje, explica como começar.
 */
export function Foco() {
  const canal = useCanal(useServico({ silencioso: true }));
  const foco = useEstadoFoco(canal);
  const config = useConfigDoFoco(canal)?.config ?? null;
  const agora = useAgora();
  const fuso = config?.dia.fuso ?? null;
  const hoje = diaNoFuso(agora, fuso);
  const historico = useHistoricoFoco(canal, inicioDaSemana(hoje), hoje);
  const tarefas = useTarefasDoFoco(canal, hoje);
  const dia = useDiaDaAgenda(canal, hoje, hoje);
  const etapa = foco?.etapa ?? null;
  const segundos = useSegundosRestantes(etapa);
  const { ir } = useAcoesSistema();
  const [erro, setErro] = useState<string | null>(null);
  // A rodada que fechou fica no alto até "Fechar por aqui"; a próxima rodada a apaga sozinha.
  const [fechada, setFechada] = useState<string | null>(null);

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
  const rotulo = atalho ? (
    <>
      Alba guarda o tempo · <Atalho teclas={atalho} /> de qualquer lugar
    </>
  ) : (
    "Alba guarda o tempo"
  );

  if (foco === null) {
    return (
      <Pagina titulo="Foco" rotulo={rotulo}>
        <p className="area-carregando" role="status">
          Esperando o serviço responder.
        </p>
      </Pagina>
    );
  }

  const ciclos = config?.dia.foco ?? null;
  const etapasHoje = etapasDeHoje(historico, foco, hoje, fuso);
  const vazio = etapasHoje.length === 0;
  const titulos = titulosConhecidos(historico, tarefas, foco);
  const situacao = situacaoDoCiclo(foco, etapasHoje, fechada);
  const ajustar = eIdSecao(SECAO_CICLOS) ? (
    <Botao onClick={() => ir({ area: "configuracoes", secao: SECAO_CICLOS })}>Ajustar ciclos</Botao>
  ) : null;

  return (
    <Pagina
      titulo="Foco"
      rotulo={rotulo}
      acao={
        (ciclos || ajustar) && (
          <div className="area-foco-acao">
            {ciclos && !vazio && <span>{textoDosCiclos(ciclos)}</span>}
            {ajustar}
          </div>
        )
      }
    >
      <div className="area-foco-topo">
        <div className="area-foco-ciclo">
          <CicloAtual
            situacao={situacao}
            aoFecharRodada={setFechada}
            foco={foco}
            etapasHoje={etapasHoje}
            ciclos={ciclos}
            segundos={segundos}
            agora={agora}
            tarefas={tarefas}
            dia={dia}
            titulos={titulos}
            silenciaNoFoco={config?.silencio.foco ?? true}
            atalho={atalho}
            pedir={pedir}
          />
          {erro && (
            <p className="area-foco-erro" role="alert">
              {erro}
            </p>
          )}
        </div>
        {vazio && etapa === null ? (
          <ComoFunciona ciclos={ciclos} foco={foco} silenciaNoFoco={config?.silencio.foco ?? true} />
        ) : (
          <EtapasDaRodada
            etapas={etapasDaRodada(foco, etapasHoje, ciclos, agora.getTime())}
            fracaoAgora={etapa && segundos !== null ? fracaoFeita(etapa, segundos) : 0}
          />
        )}
      </div>
      <div className="area-foco-baixo">
        <Hoje foco={foco} etapasHoje={etapasHoje} segundos={segundos} titulos={titulos} />
        <Semana historico={historico?.porDia ?? null} hoje={hoje} />
        <PorTarefa porTarefa={historico?.porTarefa ?? null} />
      </div>
      {situacao.tipo === "comecar" && <SugestaoDaAlba dia={dia} tarefas={tarefas ?? []} pedir={pedir} />}
    </Pagina>
  );
}

// ---------- o ciclo atual ----------

interface PropsCiclo {
  foco: EstadoFoco;
  etapasHoje: readonly EtapaFoco[];
  ciclos: CiclosFoco | null;
  segundos: number | null;
  agora: Date;
  tarefas: readonly Tarefa[] | null;
  dia: DiaDaAgenda | null;
  titulos: ReadonlyMap<string, string>;
  silenciaNoFoco: boolean;
  atalho: string;
  pedir: Pedir;
}

/** O cartão do quadro para cada situação do ciclo. */
function CicloAtual({
  situacao,
  aoFecharRodada,
  ...props
}: PropsCiclo & { situacao: SituacaoDoCiclo; aoFecharRodada: (chave: string) => void }) {
  const { segundos } = props;
  switch (situacao.tipo) {
    case "etapa":
      if (segundos === null) return null;
      return situacao.etapa.tipo === "foco" ? (
        <CartaoFoco {...props} etapa={situacao.etapa} segundos={segundos} />
      ) : (
        <CartaoPausa {...props} etapa={situacao.etapa} segundos={segundos} />
      );
    case "terminado":
      return <CartaoTerminado {...props} terminado={situacao.foco} />;
    case "completa":
      return (
        <CartaoRodadaCompleta
          {...props}
          rodada={situacao.rodada}
          aoFechar={() => aoFecharRodada(situacao.rodada.chave)}
        />
      );
    case "comecar":
      return <CartaoComecar {...props} />;
  }
}

function Rotulo({ esquerda, direita }: { esquerda: ReactNode; direita?: ReactNode }) {
  return (
    <div className="area-foco-rotulo">
      <span>{esquerda}</span>
      {direita != null && <span>{direita}</span>}
    </div>
  );
}

function Relogio({ segundos, falado, apagado }: { segundos: number; falado: string; apagado: boolean }) {
  return (
    <div className="area-foco-relogio" role="timer" aria-label={falado} data-apagado={apagado || undefined}>
      {relogioDoFoco(segundos)}
    </div>
  );
}

function Barra({ fracao, rotulo, tom }: { fracao: number; rotulo: string; tom: "destaque" | "neutro" }) {
  const pct = Math.round(fracao * 100);
  return (
    <div className="area-foco-barra">
      <Progresso valor={pct} rotulo={rotulo} textoValor={`${pct}%`} tom={tom} />
    </div>
  );
}

/** A tarefa da etapa, com a caixa que a conclui; sem tarefa, o foco é livre. */
function LigadoA({
  rotulo,
  depois = false,
  tarefaId,
  titulos,
  tarefas,
  pedir,
}: {
  rotulo: string;
  /** Na pausa, a tarefa do próximo foco, sem destaque. */
  depois?: boolean;
  tarefaId: string | null;
  titulos: ReadonlyMap<string, string>;
  tarefas: readonly Tarefa[] | null;
  pedir: Pedir;
}) {
  const titulo = tarefaId ? titulos.get(tarefaId) : null;
  const tarefa = tarefas?.find((t) => t.id === tarefaId);
  const etiqueta = tarefa?.etiquetas[0]?.nome;
  return (
    <div className="area-foco-ligado" data-depois={depois || undefined}>
      <span className="area-foco-ligado-rotulo">{rotulo}</span>
      {tarefaId && titulo ? (
        <>
          <Caixa
            marcado={tarefa?.estado === "feita"}
            aria-label={`Concluir ${titulo}`}
            aoMudar={() => void pedir("tarefas.concluir", { id: tarefaId })}
          />
          <span className="area-foco-ligado-titulo" title={titulo}>
            {titulo}
          </span>
          {etiqueta && !depois && <Selo>{etiqueta}</Selo>}
        </>
      ) : (
        <span className="area-foco-ligado-livre">Sem tarefa ligada</span>
      )}
    </div>
  );
}

function Botoes({ children }: { children: ReactNode }) {
  return <div className="area-foco-botoes">{children}</div>;
}

function CartaoFoco({
  foco,
  etapa,
  segundos,
  agora,
  titulos,
  tarefas,
  silenciaNoFoco,
  atalho,
  pedir,
}: PropsCiclo & { etapa: EtapaFoco; segundos: number }) {
  const pausada = etapa.pausadaEm !== null;
  const planejado = etapa.duracaoPlanejadaMin;
  const feito = relogioDoFoco(planejado * 60 - segundos);
  return (
    <Cartao
      como="section"
      variante="elevado"
      className="area-foco-cartao"
      aria-label={pausada ? "Ciclo em pausa" : "Ciclo atual"}
    >
      <Rotulo
        esquerda={`Ciclo ${foco.cicloAtual} de ${foco.ciclosAtePausaLonga} · foco de ${planejado} min`}
        direita={
          pausada ? (
            <Selo tom="aviso">{`em pausa ${haQuanto(etapa.pausadaEm!, agora)}`}</Selo>
          ) : (
            `termina ${hora(etapa.terminaEm)}`
          )
        }
      />
      <div className="area-foco-relogio-linha">
        <Relogio
          segundos={segundos}
          falado={`${relogioFalado(segundos)} restantes${pausada ? ", em pausa" : ""}`}
          apagado={pausada}
        />
        <Botoes>
          {pausada ? (
            <>
              <Botao onClick={() => void pedir("foco.terminar")}>Terminar ciclo</Botao>
              <Botao variante="primario" onClick={() => void pedir("foco.retomar")}>
                Continuar
              </Botao>
            </>
          ) : (
            <>
              <Botao
                variante="fantasma"
                onClick={() => void pedir("foco.estender", { minutos: MINUTOS_A_MAIS })}
              >
                {`+${MINUTOS_A_MAIS} min`}
              </Botao>
              <Botao onClick={() => void pedir("foco.terminar")}>Terminar ciclo</Botao>
              <Botao variante="primario" onClick={() => void pedir("foco.pausar")}>
                Pausar
              </Botao>
            </>
          )}
        </Botoes>
      </div>
      <Barra
        fracao={fracaoFeita(etapa, segundos)}
        rotulo="Andamento do ciclo"
        tom={pausada ? "neutro" : "destaque"}
      />
      <LigadoA
        rotulo="Ligado a"
        tarefaId={etapa.tarefaId}
        titulos={titulos}
        tarefas={tarefas}
        pedir={pedir}
      />
      {pausada ? (
        <p className="area-foco-nota">
          <span>
            {`Parado aos ${feito} de ${planejado} min. O tempo parado não conta no histórico`}
            {atalho ? (
              <>
                ; <Atalho teclas={atalho} /> continua.
              </>
            ) : (
              "."
            )}
          </span>
        </p>
      ) : (
        silenciaNoFoco && (
          <p className="area-foco-nota">
            <Icone nome="silencio" tamanho={14} />
            <span>{`Avisos em silêncio até ${hora(etapa.terminaEm)}, menos aprovações e lembretes.`}</span>
          </p>
        )
      )}
    </Cartao>
  );
}

function CartaoPausa({
  foco,
  etapa,
  segundos,
  agora,
  titulos,
  tarefas,
  pedir,
}: PropsCiclo & { etapa: EtapaFoco; segundos: number }) {
  const pausada = etapa.pausadaEm !== null;
  const longa = etapa.tipo === "pausa_longa";
  const proximo = (foco.cicloAtual % foco.ciclosAtePausaLonga) + 1;
  const quando = pausada ? (
    <Selo tom="aviso">{`em pausa ${haQuanto(etapa.pausadaEm!, agora)}`}</Selo>
  ) : longa ? (
    `rodada termina ${hora(etapa.terminaEm)}`
  ) : (
    `foco ${proximo} de ${foco.ciclosAtePausaLonga} começa ${hora(etapa.terminaEm)}`
  );
  const nota = pausada
    ? "Na pausa, os avisos voltam ao normal."
    : longa
      ? "Na pausa longa, os avisos voltam ao normal. Depois dela, a rodada fecha."
      : `Na pausa, os avisos voltam ao normal. O próximo foco começa sozinho às ${hora(etapa.terminaEm)}.`;
  return (
    <Cartao como="section" variante="elevado" className="area-foco-cartao" aria-label="Pausa rodando">
      <Rotulo
        esquerda={`${longa ? "Pausa longa" : "Pausa"} · ${etapa.duracaoPlanejadaMin} min`}
        direita={quando}
      />
      <div className="area-foco-relogio-linha">
        <Relogio
          segundos={segundos}
          falado={`${relogioFalado(segundos)} de pausa${pausada ? ", em pausa" : ""}`}
          apagado={pausada}
        />
        <Botoes>
          <Botao onClick={() => void pedir("foco.terminar")}>Encerrar a rodada</Botao>
          {pausada ? (
            <Botao variante="primario" onClick={() => void pedir("foco.retomar")}>
              Continuar
            </Botao>
          ) : (
            <Botao variante="primario" onClick={() => void pedir("foco.pularPausa")}>
              Voltar ao foco agora
            </Botao>
          )}
        </Botoes>
      </div>
      <Barra fracao={fracaoFeita(etapa, segundos)} rotulo="Andamento da pausa" tom="neutro" />
      {!longa && (
        <LigadoA
          rotulo="Depois"
          depois
          tarefaId={etapa.tarefaId}
          titulos={titulos}
          tarefas={tarefas}
          pedir={pedir}
        />
      )}
      <p className="area-foco-nota">{nota}</p>
    </Cartao>
  );
}

function CartaoTerminado({
  foco,
  terminado,
  ciclos,
  titulos,
  tarefas,
  pedir,
}: PropsCiclo & { terminado: EtapaFoco }) {
  const titulo = terminado.tarefaId ? (titulos.get(terminado.tarefaId) ?? null) : null;
  const tarefa = tarefas?.find((t) => t.id === terminado.tarefaId);
  const [feita, setFeita] = useState(false);
  const aberta = titulo !== null && !feita && tarefa?.estado !== "feita";
  const nomePausa = foco.proxima === "pausa_longa" ? "pausa longa" : "pausa";
  const minutos = ciclos ? (foco.proxima === "pausa_longa" ? ciclos.pausaLongaMin : ciclos.pausaMin) : null;
  const concluir = () =>
    void pedir("tarefas.concluir", { id: terminado.tarefaId }).then((r) => {
      if (r) setFeita(true);
    });
  return (
    <Cartao como="section" variante="elevado" className="area-foco-cartao" aria-label="Ciclo terminado">
      <Rotulo
        esquerda={`Ciclo ${foco.cicloAtual} de ${foco.ciclosAtePausaLonga} terminou · ${hora(terminado.fim!)}`}
        direita={`próxima: ${nomePausa}${minutos ? ` de ${minutos} min` : ""}`}
      />
      <FalaAgente agente="alba" tamanho="ciclo">
        {falaDoCicloTerminado(terminado, titulo, foco.proxima, ciclos)}
      </FalaAgente>
      {aberta && (
        <div className="area-foco-feita">
          <Caixa marcado={false} aria-label={`Concluir ${titulo}`} aoMudar={concluir} />
          <span className="area-foco-ligado-titulo" title={titulo}>
            {titulo}
          </span>
          <span className="area-foco-feita-pergunta">já terminou?</span>
          <Botao tamanho="pequeno" onClick={concluir}>
            Marcar como feita
          </Botao>
        </div>
      )}
      <Botoes>
        {!terminado.interrompida && (
          <Botao variante="fantasma" onClick={() => void pedir("foco.estender", { minutos: MINUTOS_A_MAIS })}>
            {`+${MINUTOS_A_MAIS} min de foco`}
          </Botao>
        )}
        <Botao onClick={() => void pedir("foco.pularPausa")}>Pular a pausa</Botao>
        <Botao variante="primario" onClick={() => void pedir("foco.iniciar", { tipo: foco.proxima })}>
          Começar a pausa
        </Botao>
      </Botoes>
    </Cartao>
  );
}

function CartaoRodadaCompleta({
  foco,
  rodada,
  titulos,
  pedir,
  aoFechar,
}: PropsCiclo & { rodada: RodadaCompleta; aoFechar: () => void }) {
  return (
    <Cartao como="section" variante="elevado" className="area-foco-cartao" aria-label="Rodada terminada">
      <Rotulo
        esquerda={`Rodada completa · ${hora(rodada.fim)}`}
        direita={`${rodada.focos.length} de ${foco.ciclosAtePausaLonga} focos`}
      />
      <Segmentos etapas={rodada.etapas} fracaoAgora={0} />
      <FalaAgente agente="alba" tamanho="ciclo">
        {falaDaRodada(rodada, titulos)}
      </FalaAgente>
      <Botoes>
        <Botao onClick={aoFechar}>Fechar por aqui</Botao>
        <Botao variante="primario" onClick={() => void pedir("foco.iniciar", {})}>
          Começar outra rodada
        </Botao>
      </Botoes>
    </Cartao>
  );
}

/** O primeiro bloco livre que ainda não acabou: "14:00–16:00". */
function proximoLivre(dia: DiaDaAgenda | null, agora: Date): string | null {
  const bloco = dia?.livres.find((b) => Date.parse(b.fim) > agora.getTime());
  return bloco ? intervalo(Date.parse(bloco.inicio), Date.parse(bloco.fim)) : null;
}

/** Nada correndo e nada proposto: escolher a tarefa e começar (AreaFocoVazio.dc.html). */
function CartaoComecar({ foco, ciclos, agora, tarefas, dia, pedir }: PropsCiclo) {
  const idLegenda = useId();
  const opcoes = opcoesDeTarefa(tarefas ?? []);
  // `undefined` é a sugestão (a primeira da lista); `null` é "Sem tarefa".
  const [escolha, setEscolha] = useState<string | null | undefined>(undefined);
  const escolhida =
    escolha === undefined ? (opcoes[0]?.id ?? null) : opcoes.some((t) => t.id === escolha) ? escolha : null;
  const livre = proximoLivre(dia, agora);
  const minutos = ciclos?.focoMin ?? null;
  const hoje =
    foco.ciclosHoje === 0
      ? "Nenhum ciclo hoje"
      : `${ciclosEmTexto(foco.ciclosHoje)} hoje · ${duracaoDoFoco(foco.focoHojeMin)}`;
  return (
    <Cartao
      como="section"
      variante="elevado"
      className="area-foco-cartao area-foco-comecar"
      aria-label="Começar um foco"
    >
      <Rotulo esquerda={hoje} direita={livre ? `próximo bloco livre: ${livre}` : undefined} />
      {minutos !== null && (
        <div className="area-foco-relogio" data-apagado aria-hidden="true">
          {relogioDoFoco(minutos * 60)}
        </div>
      )}
      <fieldset className="area-foco-opcoes" aria-labelledby={idLegenda}>
        <legend id={idLegenda} className="area-foco-ligado-rotulo">
          Ligar a uma tarefa de hoje
        </legend>
        {opcoes.length === 0 ? (
          <p className="area-foco-nota">Nenhuma tarefa para hoje: o foco começa livre.</p>
        ) : (
          opcoes.map((t) => (
            <label key={t.id} className="area-foco-opcao" data-marcada={escolhida === t.id}>
              <input
                type="radio"
                name="tarefa-do-foco"
                checked={escolhida === t.id}
                onChange={() => setEscolha(t.id)}
              />
              <span className="area-foco-opcao-titulo">{t.titulo}</span>
              <span className="area-foco-meta">{metaDaTarefa(t)}</span>
            </label>
          ))
        )}
      </fieldset>
      <div className="area-foco-comecar-rodape">
        {opcoes.length > 0 && (
          <Botao
            variante="fantasma"
            tamanho="pequeno"
            aria-pressed={escolhida === null}
            onClick={() => setEscolha(null)}
          >
            Sem tarefa
          </Botao>
        )}
        <Botao variante="primario" onClick={() => void pedir("foco.iniciar", { tarefaId: escolhida })}>
          {minutos !== null ? `Começar ${minutos} min de foco` : "Começar foco"}
        </Botao>
      </div>
    </Cartao>
  );
}

// ---------- a rodada ----------

function Segmentos({ etapas, fracaoAgora }: { etapas: readonly EtapaDaRodada[]; fracaoAgora: number }) {
  return (
    <div className="area-foco-segmentos" aria-hidden="true">
      {etapas.map((e) => {
        const fracao = e.situacao === "agora" ? fracaoAgora : e.situacao === "falta" ? 0 : 1;
        return (
          <span
            key={e.chave}
            className="area-foco-segmento"
            data-tipo={e.tipo}
            style={{ flexGrow: e.minutos, ...fracaoCss(fracao) }}
          >
            <span className="area-foco-segmento-feito" />
          </span>
        );
      })}
    </div>
  );
}

const ESTADO_DA_ETAPA = { feito: "feito", parou: "parou", agora: "agora", falta: "" } as const;

function EtapasDaRodada({ etapas, fracaoAgora }: { etapas: readonly EtapaDaRodada[]; fracaoAgora: number }) {
  const id = useId();
  return (
    <Cartao como="section" className="area-foco-etapas" aria-labelledby={id}>
      <div className="area-foco-rotulo">
        <h2 id={id} className="area-foco-titulo">
          Etapas desta rodada
        </h2>
        <span>{resumoDaRodada(etapas)}</span>
      </div>
      <Segmentos etapas={etapas} fracaoAgora={fracaoAgora} />
      <ol className="area-foco-lista-etapas">
        {etapas.map((e) => (
          <li key={e.chave} className="area-foco-etapa" data-situacao={e.situacao} data-tipo={e.tipo}>
            <span className="area-foco-ponto" aria-hidden="true" />
            <span className="area-foco-etapa-nome">
              {e.nome} <span className="area-foco-etapa-duracao">· {e.minutos} min</span>
            </span>
            <span className="area-foco-meta">{intervalo(e.inicio, e.fim)}</span>
            <span className="area-foco-etapa-estado">
              {e.situacao === "agora" ? <Selo>agora</Selo> : ESTADO_DA_ETAPA[e.situacao]}
            </span>
          </li>
        ))}
      </ol>
    </Cartao>
  );
}

/** O lugar das etapas antes do primeiro ciclo: como a rodada funciona, com os números da configuração. */
function ComoFunciona({
  ciclos,
  foco,
  silenciaNoFoco,
}: {
  ciclos: CiclosFoco | null;
  foco: EstadoFoco;
  silenciaNoFoco: boolean;
}) {
  const id = useId();
  const plano = etapasDaRodada({ ...foco, etapa: null, proxima: "foco", cicloAtual: 1 }, [], ciclos, 0);
  const passos = [
    ciclos
      ? `${ciclos.focoMin} min de foco e ${ciclos.pausaMin} de pausa. A cada ${ciclos.ciclosAtePausaLonga} focos, uma pausa de ${ciclos.pausaLongaMin}.`
      : "Foco e pausa curta em sequência, e uma pausa longa no fim da rodada.",
    silenciaNoFoco
      ? "No foco, os avisos ficam em silêncio, menos aprovações e lembretes."
      : "No foco, os avisos seguem normais; o silêncio se liga em Configurações › Notificações.",
    "O tempo restante aparece no ícone do dock e no painel Foco.",
    "O ciclo fica ligado a uma tarefa e entra no relatório dela.",
  ];
  return (
    <Cartao como="section" className="area-foco-etapas" aria-labelledby={id}>
      <div className="area-foco-rotulo">
        <h2 id={id} className="area-foco-titulo">
          Como funciona
        </h2>
      </div>
      <Segmentos etapas={plano} fracaoAgora={0} />
      <ol className="area-foco-passos">
        {passos.map((texto, i) => (
          <li key={i} className="area-foco-passo">
            <span className="area-foco-passo-numero" aria-hidden="true">
              {i + 1}
            </span>
            <span>{texto}</span>
          </li>
        ))}
      </ol>
    </Cartao>
  );
}

// ---------- o dia, a semana e o relatório ----------

function CartaoVazio({ titulo, texto }: { titulo: string; texto: string }) {
  const id = useId();
  return (
    <section className="area-foco-vazio" aria-labelledby={id}>
      <h2 id={id} className="area-foco-titulo">
        {titulo}
      </h2>
      <p>{texto}</p>
    </section>
  );
}

function Hoje({
  foco,
  etapasHoje,
  segundos,
  titulos,
}: {
  foco: EstadoFoco;
  etapasHoje: readonly EtapaFoco[];
  segundos: number | null;
  titulos: ReadonlyMap<string, string>;
}) {
  const id = useId();
  const etapa = foco.etapa;
  const decorrido =
    etapa && segundos !== null ? Math.floor((etapa.duracaoPlanejadaMin * 60 - segundos) / 60) : 0;
  const lista = ciclosDoDia(etapasHoje, decorrido);
  if (lista.length === 0) {
    return (
      <CartaoVazio
        titulo="Hoje"
        texto="Cada ciclo aparece aqui com a hora e a tarefa, assim que terminar o primeiro."
      />
    );
  }
  return (
    <Cartao como="section" className="area-foco-cartao-baixo" aria-labelledby={id}>
      <div className="area-foco-rotulo">
        <h2 id={id} className="area-foco-titulo">
          Hoje
        </h2>
        <span>
          {foco.ciclosHoje > 0
            ? `${duracaoDoFoco(foco.focoHojeMin)} em ${ciclosEmTexto(foco.ciclosHoje)}`
            : "o primeiro está correndo"}
        </span>
      </div>
      <ul className="area-foco-lista-dia">
        {lista.map((c) => (
          <li key={c.chave} className="area-foco-ciclo-dia" data-atual={c.atual || undefined}>
            <span className="area-foco-ponto" aria-hidden="true" />
            <span className="area-foco-ciclo-textos">
              <span className="area-foco-ciclo-titulo">
                {(c.tarefaId && titulos.get(c.tarefaId)) || "Sem tarefa ligada"}
              </span>
              <span className="area-foco-meta">{c.interrompido ? `${c.hora} · interrompido` : c.hora}</span>
            </span>
            <span className="area-foco-numero">{duracaoDoFoco(c.minutos)}</span>
          </li>
        ))}
      </ul>
      <p className="area-foco-rodape">
        As pausas não entram na conta. Ciclo parado antes do fim fica marcado como interrompido.
      </p>
    </Cartao>
  );
}

function Semana({ historico, hoje }: { historico: readonly FocoPorDia[] | null; hoje: string }) {
  const id = useId();
  const semana = semanaDoFoco(historico ?? [], hoje);
  if (semana.minutos === 0) {
    return (
      <CartaoVazio
        titulo="Esta semana"
        texto="As horas de foco por dia ficam aqui. Nada para mostrar ainda."
      />
    );
  }
  return (
    <Cartao como="section" className="area-foco-cartao-baixo" aria-labelledby={id}>
      <div className="area-foco-rotulo">
        <h2 id={id} className="area-foco-titulo">
          Esta semana
        </h2>
        <span>{`${duracaoDoFoco(semana.minutos)} em ${ciclosEmTexto(semana.ciclos)}`}</span>
      </div>
      <ol className="area-foco-grafico">
        {semana.dias.map((d) => (
          <li
            key={d.dia}
            className="area-foco-dia"
            data-hoje={d.hoje || undefined}
            data-vazio={d.minutos === 0 || undefined}
          >
            <span className="area-foco-dia-numero" aria-hidden="true">
              {duracaoDoFoco(d.minutos)}
            </span>
            <span className="area-foco-dia-barra" style={fracaoCss(d.fracao)} />
            <span className="area-foco-dia-nome" aria-hidden="true">
              {d.nome}
            </span>
            <span className="so-leitor">{`${d.hoje ? "hoje" : d.nome}: ${d.minutos > 0 ? duracaoDoFoco(d.minutos) : "sem foco"}`}</span>
          </li>
        ))}
      </ol>
      <p className="area-foco-resumo">{semana.resumo}</p>
    </Cartao>
  );
}

function PorTarefa({ porTarefa }: { porTarefa: readonly FocoPorTarefa[] | null }) {
  const id = useId();
  const linhas = relatorioPorTarefa(porTarefa ?? []);
  if (linhas.length === 0) {
    return (
      <CartaoVazio
        titulo="Por tarefa"
        texto="Quanto foco cada tarefa recebeu na semana, e em quantos ciclos."
      />
    );
  }
  return (
    <Cartao como="section" className="area-foco-cartao-baixo" aria-labelledby={id}>
      <div className="area-foco-rotulo">
        <h2 id={id} className="area-foco-titulo">
          Por tarefa · esta semana
        </h2>
        <span aria-hidden="true">foco · ciclos</span>
      </div>
      <ul className="area-foco-lista-tarefas">
        {linhas.map((l) => (
          <li key={l.chave} className="area-foco-tarefa" data-sem-tarefa={l.semTarefa || undefined}>
            <span className="area-foco-tarefa-linha">
              <span className="area-foco-tarefa-titulo" title={l.titulo}>
                {l.titulo}
              </span>
              <span className="area-foco-numero">{duracaoDoFoco(l.minutos)}</span>
              <span className="area-foco-meta area-foco-tarefa-ciclos" aria-label={ciclosEmTexto(l.ciclos)}>
                {l.ciclos}
              </span>
            </span>
            <span className="area-foco-tarefa-trilho" aria-hidden="true">
              <span className="area-foco-tarefa-barra" style={fracaoCss(l.fracao)} />
            </span>
          </li>
        ))}
      </ul>
    </Cartao>
  );
}

// ---------- a sugestão da Alba ----------

/** O que o "Guardar o bloco" criou, com o desfazer da ação `interno`. */
interface Guardado {
  texto: string;
  chamadaId: string;
}

/**
 * Antes de começar: a Alba sugere o próximo bloco livre para uma tarefa, como no painel Foco. Quem
 * acha o bloco e encaixa a tarefa é o serviço (`agenda.consultar`); "Agora não" só esconde esta.
 */
function SugestaoDaAlba({
  dia,
  tarefas,
  pedir,
}: {
  dia: DiaDaAgenda | null;
  tarefas: readonly Tarefa[];
  pedir: Pedir;
}) {
  const [recusados, setRecusados] = useState<ReadonlySet<string>>(() => new Set());
  const [guardado, setGuardado] = useState<Guardado | null>(null);
  const encaixe = proximoEncaixe(dia, tarefas, null, recusados);

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

  if (!guardado && !encaixe) return null;
  return (
    <Cartao className="area-foco-sugestao" aria-label="Sugestão da Alba">
      <FalaAgente agente="alba" tamanho="faixa">
        {guardado ? guardado.texto : falaDoEncaixe(encaixe!)}
      </FalaAgente>
      <div className="area-foco-sugestao-acoes">
        {guardado ? (
          <Botao variante="fantasma" tamanho="pequeno" onClick={() => desfazer(guardado)}>
            Desfazer
          </Botao>
        ) : (
          <>
            <Botao
              tamanho="pequeno"
              onClick={() => setRecusados((atual) => new Set(atual).add(chaveDoEncaixe(encaixe!.sugestao)))}
            >
              Agora não
            </Botao>
            <Botao variante="primario" tamanho="pequeno" onClick={() => guardar(encaixe!)}>
              Guardar o bloco
            </Botao>
          </>
        )}
      </div>
    </Cartao>
  );
}
