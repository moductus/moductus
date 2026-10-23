import type { Lista, Tarefa } from "@moductus/contrato";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { Caixa } from "../../componentes/Caixa.tsx";
import { Campo } from "../../componentes/Campo.tsx";
import { Selo } from "../../componentes/Selo.tsx";
import { useServico } from "../../nativo/eventos.ts";
import { servico, useCanal } from "../../servico/conexao.ts";
import { ROTULOS_CONTAGEM, useContagens } from "../../servico/contagens.ts";
import { LeituraPendente } from "../FaixaNuno.tsx";
import { ListaNavegacao, type ItemNavegacao } from "../ListaNavegacao.tsx";
import { dataCurta, EstadoVazio, Pagina } from "../Pagina.tsx";
import { useAgora } from "../tempo.ts";
import { CampoFrase } from "./CampoFrase.tsx";
import { ColunaAgenda } from "./ColunaAgenda.tsx";
import { DetalheEvento } from "./DetalheEvento.tsx";
import { DetalheTarefa } from "./DetalheTarefa.tsx";
import { dataDoDia } from "../dia.ts";
import { useCalendarios, useTarefaAberta, type Aberto, type Calendarios } from "./detalhe.ts";
import {
  contarLinhas,
  emLotes,
  gruposDasAbertas,
  gruposDoHoje,
  gruposDosLembretes,
  gruposDosProximos,
  idDaLista,
  mensagemDaRecusa,
  moverNoGrupo,
  progressoDoHoje,
  soltarNoGrupo,
  textoDaPrioridade,
  totalDasAbertas,
  useDadosTarefas,
  VISTAS_FIXAS,
  type DadosTarefas,
  type GrupoLembretes,
  type GrupoTarefas,
  type IdVista,
  type LinhaTarefa,
} from "./tarefas.ts";
import "./Tarefas.css";

const ABERTAS = { um: "tarefa aberta", varios: "tarefas abertas" };

/**
 * Tarefas (AreaTarefas.dc.html): a sub-navegação com Hoje, Próximos 7 dias, Todas, Lembretes e as
 * listas; o campo em linguagem natural com o "Entendi:"; as tarefas da vista em grupos, para marcar
 * e ordenar; e, ao lado, a Agenda de hoje com o encaixe da Alba. A tarefa ou o evento aberto vem
 * numa coluna à direita (DetalheTarefa.dc.html, DetalheEvento.dc.html); com a tarefa aberta, a
 * Agenda dá lugar ao detalhe.
 */
export function Tarefas() {
  const canal = useCanal(useServico({ silencioso: true }));
  const agora = useAgora();
  const leitura = useDadosTarefas(canal, agora);
  const contagens = useContagens(canal);
  const calendarios = useCalendarios(canal);
  const [vista, setVista] = useState<IdVista>("hoje");
  const [aberto, setAberto] = useState<Aberto | null>(null);
  // Quem abriu o detalhe recebe o foco de volta quando ele fecha.
  const quemAbriu = useRef<HTMLElement | null>(null);
  const devolverFoco = useRef(false);

  useEffect(() => {
    if (aberto !== null || !devolverFoco.current) return;
    devolverFoco.current = false;
    const alvo = quemAbriu.current;
    quemAbriu.current = null;
    if (alvo?.isConnected) alvo.focus();
  }, [aberto]);

  const abrir = (a: Aberto) => {
    if (aberto === null && document.activeElement instanceof HTMLElement) {
      quemAbriu.current = document.activeElement;
    }
    setAberto(a);
  };
  const fechar = () => {
    devolverFoco.current = true;
    setAberto(null);
  };

  if (leitura.estado !== "pronta") {
    return (
      <Pagina titulo="Tarefas" rotulo="Alba · Tarefas">
        <LeituraPendente
          agente="alba"
          oQue="as suas tarefas"
          tentarDeNovo={leitura.estado === "falhou" ? leitura.tentarDeNovo : undefined}
        />
      </Pagina>
    );
  }

  const { dados } = leitura;
  const listas = dados.listas.filter((l) => !l.arquivada);
  const listaAberta = idDaLista(vista);
  // A lista que saiu (apagada ou arquivada em outro lugar) devolve a vista ao Hoje.
  const ativa: IdVista = listaAberta && !listas.some((l) => l.id === listaAberta) ? "hoje" : vista;
  const hoje = dados.dia;
  const conteudo = montarVista(ativa, dados, listas, agora);

  return (
    <div className="tarefas">
      <Lateral
        dados={dados}
        listas={listas}
        hoje={hoje}
        pendentesHoje={contagens.tarefasPendentes}
        ativa={ativa}
        aoEscolher={setVista}
      />
      <div className="tarefas-conteudo">
        <Pagina
          titulo={conteudo.titulo}
          rotulo={dataCurta(dataDoDia(hoje))}
          acao={<span className="tarefas-rotulo">{conteudo.acao}</span>}
        >
          {/* Fora da vista com chave: trocar de vista não apaga a frase nem o Desfazer. */}
          <CampoFrase
            listas={listas}
            hoje={hoje}
            contexto={{ listaId: conteudo.listaId, dia: ativa === "hoje" ? hoje : null }}
          />
          <div className="tarefas-corpo">
            <div className="tarefas-principal">
              <Vista
                key={ativa}
                vista={ativa}
                conteudo={conteudo}
                dados={dados}
                listas={listas}
                tarefaAberta={aberto?.tipo === "tarefa" ? aberto.id : null}
                aoAbrir={(id) => abrir({ tipo: "tarefa", id })}
              />
            </div>
            {aberto?.tipo !== "tarefa" && (
              <ColunaAgenda
                canal={canal}
                dados={dados}
                agora={agora}
                eventoAberto={aberto?.tipo === "evento" ? aberto.id : null}
                aoAbrirEvento={(id) => abrir({ tipo: "evento", id })}
              />
            )}
          </div>
        </Pagina>
      </div>
      {aberto?.tipo === "tarefa" && (
        <TarefaAberta
          key={aberto.id}
          id={aberto.id}
          dados={dados}
          listas={dados.listas}
          agora={agora}
          calendarios={calendarios}
          aoAbrir={(id) => abrir({ tipo: "tarefa", id })}
          aoFechar={fechar}
        />
      )}
      {aberto?.tipo === "evento" && (
        <DetalheEvento
          key={aberto.id}
          canal={canal}
          id={aberto.id}
          fuso={dados.fuso}
          horaPadrao={dados.expediente.inicio}
          agora={agora}
          calendarios={calendarios}
          aoFechar={fechar}
        />
      )}
    </div>
  );
}

/** As tarefas das vistas, uma vez cada (a mesma pode vir em dois recortes). */
function todasAsTarefas(dados: DadosTarefas): Map<string, Tarefa> {
  return new Map(
    [...dados.atrasadas, ...dados.hoje, ...dados.abertas, ...dados.proximas].map((t) => [t.id, t]),
  );
}

/** A tarefa aberta: a da vista, ou a última que chegou; fecha quando ela vai para a Lixeira. */
function TarefaAberta({
  id,
  dados,
  listas,
  agora,
  calendarios,
  aoAbrir,
  aoFechar,
}: {
  id: string;
  dados: DadosTarefas;
  listas: readonly Lista[];
  agora: Date;
  calendarios: Calendarios | null;
  aoAbrir: (id: string) => void;
  aoFechar: () => void;
}) {
  const todas = todasAsTarefas(dados);
  const { tarefa, recebida } = useTarefaAberta(id, todas.get(id) ?? null);
  const some = tarefa === null;
  useEffect(() => {
    if (some) aoFechar();
  }, [some, aoFechar]);
  if (!tarefa) return null;
  const subtarefas = [...todas.values()]
    .filter((t) => t.tarefaPaiId === id)
    .sort((a, b) => a.ordem - b.ordem || (a.criadoEm < b.criadoEm ? -1 : 1));
  return (
    <DetalheTarefa
      tarefa={tarefa}
      subtarefas={subtarefas}
      listas={listas}
      fuso={dados.fuso}
      agora={agora}
      calendarios={calendarios}
      aoReceber={recebida}
      aoAbrir={aoAbrir}
      aoFechar={aoFechar}
    />
  );
}

/** O que uma vista mostra: o título, o número do alto e os grupos. */
interface ConteudoDaVista {
  titulo: string;
  acao: string;
  listaId: string | null;
  lista: Lista | null;
  grupos: GrupoTarefas[];
  lembretes: GrupoLembretes[];
}

function montarVista(
  vista: IdVista,
  dados: DadosTarefas,
  listas: readonly Lista[],
  agora: Date,
): ConteudoDaVista {
  const hoje = dados.dia;
  const listaId = idDaLista(vista);
  const lista = listas.find((l) => l.id === listaId) ?? null;
  const titulo = lista?.nome ?? VISTAS_FIXAS.find((v) => v.id === vista)?.nome ?? "Hoje";
  const grupos: GrupoTarefas[] =
    vista === "hoje"
      ? gruposDoHoje(dados.hoje, dados.atrasadas, hoje)
      : vista === "proximos"
        ? gruposDosProximos(dados.proximas, hoje)
        : vista === "lembretes"
          ? []
          : gruposDasAbertas(
              listaId ? dados.abertas.filter((t) => t.listaId === listaId) : dados.abertas,
              hoje,
            );
  const lembretes = vista === "lembretes" ? gruposDosLembretes(dados.lembretes, dados.fuso, agora) : [];
  const acao =
    vista === "hoje"
      ? progressoDoHoje(grupos)
      : vista === "lembretes"
        ? `${dados.lembretes.length} ${dados.lembretes.length === 1 ? "lembrete" : "lembretes"}`
        : totalDasAbertas(grupos);
  return { titulo, acao, listaId, lista, grupos, lembretes };
}

interface PropsLateral {
  dados: DadosTarefas;
  listas: readonly Lista[];
  hoje: string;
  pendentesHoje: number;
  ativa: IdVista;
  aoEscolher: (vista: IdVista) => void;
}

/** A coluna das vistas e das listas, cada uma com quantas abertas tem. */
function Lateral({ dados, listas, hoje, pendentesHoje, ativa, aoEscolher }: PropsLateral) {
  const [criando, setCriando] = useState(false);
  const proximos = gruposDosProximos(dados.proximas, hoje).reduce((n, g) => n + g.linhas.length, 0);
  const contagem: Record<(typeof VISTAS_FIXAS)[number]["id"], ItemNavegacao<IdVista>["contagem"]> = {
    hoje: { valor: pendentesHoje, rotulo: ROTULOS_CONTAGEM.tarefasPendentes },
    proximos: { valor: proximos, rotulo: ABERTAS },
    todas: { valor: contarLinhas(dados.abertas), rotulo: ABERTAS },
    lembretes: { valor: dados.lembretes.length, rotulo: { um: "lembrete", varios: "lembretes" } },
  };
  const vistas: ItemNavegacao<IdVista>[] = VISTAS_FIXAS.map((v) => ({ ...v, contagem: contagem[v.id] }));
  const itensListas: ItemNavegacao<IdVista>[] = listas.map((l) => ({
    id: `lista:${l.id}`,
    nome: l.nome,
    contagem: { valor: contarLinhas(dados.abertas.filter((t) => t.listaId === l.id)), rotulo: ABERTAS },
  }));
  return (
    <aside className="tarefas-lateral" aria-label="Vistas e listas">
      <h2 className="tarefas-lateral-titulo">Tarefas</h2>
      <ListaNavegacao rotulo="Vistas" itens={vistas} ativo={ativa} aoEscolher={aoEscolher} />
      <div className="tarefas-listas-cabeca">
        <span className="tarefas-rotulo">Listas</span>
        <Botao
          variante="fantasma"
          tamanho="pequeno"
          icone="mais"
          aria-label="Nova lista"
          aria-expanded={criando}
          onClick={() => setCriando((c) => !c)}
        />
      </div>
      {criando && (
        <NovaLista
          aoTerminar={(lista) => {
            setCriando(false);
            if (lista) aoEscolher(`lista:${lista.id}`);
          }}
        />
      )}
      <ListaNavegacao rotulo="Listas" itens={itensListas} ativo={ativa} aoEscolher={aoEscolher} />
    </aside>
  );
}

/** O nome da lista nova: Enter cria e abre a lista, Esc desiste. */
function NovaLista({ aoTerminar }: { aoTerminar: (lista: Lista | null) => void }) {
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const criar = async () => {
    if (nome.trim() === "") return;
    try {
      aoTerminar(await servico.pedir("listas.criar", { nome: nome.trim() }));
    } catch (e) {
      setErro(mensagemDaRecusa(e));
    }
  };
  return (
    <div className="tarefas-nova-lista">
      <Campo
        rotulo="Nome da lista nova"
        rotuloOculto
        autoFocus
        value={nome}
        maxLength={80}
        placeholder="Viagem de dezembro"
        onChange={(e) => {
          setNome(e.target.value);
          setErro(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void criar();
          } else if (e.key === "Escape") {
            e.preventDefault();
            aoTerminar(null);
          }
        }}
      />
      {erro && (
        <p className="tarefas-erro" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}

interface PropsVista {
  vista: IdVista;
  conteudo: ConteudoDaVista;
  dados: DadosTarefas;
  listas: readonly Lista[];
  tarefaAberta: string | null;
  aoAbrir: (id: string) => void;
}

function Vista({ vista, conteudo, dados, listas, tarefaAberta, aoAbrir }: PropsVista) {
  const [erro, setErro] = useState<string | null>(null);
  const { listaId, lista, grupos, lembretes } = conteudo;

  /** Um pedido da tela: a recusa aparece no alto da lista até o próximo. */
  const fazer = (pedido: () => Promise<unknown>) => {
    setErro(null);
    pedido().catch((e: unknown) => setErro(mensagemDaRecusa(e)));
  };

  const nadaAinda = dados.abertas.length === 0 && dados.hoje.length === 0 && dados.lembretes.length === 0;

  return (
    <>
      {erro && (
        <p className="tarefas-erro" role="alert">
          {erro}
        </p>
      )}
      {nadaAinda ? (
        <EstadoVazio
          agentes={["alba"]}
          titulo="Nenhuma tarefa ainda"
          texto="Escreva no campo acima do jeito que falaria, como “ligar pro banco amanhã 15h”. Antes do Enter, o Entendi mostra o dia, a hora, o lembrete e a lista; Enter cria, Esc limpa."
        />
      ) : vista === "lembretes" ? (
        <Lembretes grupos={lembretes} fazer={fazer} />
      ) : grupos.length === 0 ? (
        <VazioDaVista vista={vista} lista={lista} />
      ) : (
        <ListaDeTarefas
          grupos={grupos}
          listas={listas}
          mostrarLista={listaId === null}
          fazer={fazer}
          tarefaAberta={tarefaAberta}
          aoAbrir={aoAbrir}
        />
      )}
    </>
  );
}

function VazioDaVista({ vista, lista }: { vista: IdVista; lista: Lista | null }) {
  if (lista) {
    return (
      <EstadoVazio
        agentes={["alba"]}
        titulo={`Nada aberto em ${lista.nome}`}
        texto={`Escreva no campo acima: a frase que não disser outra lista vai para ${lista.nome}.`}
      />
    );
  }
  if (vista === "proximos") {
    return (
      <EstadoVazio
        agentes={["alba"]}
        titulo="Nada nos próximos 7 dias"
        texto="Uma frase com dia, como “revisar o contrato sexta”, já cai aqui."
      />
    );
  }
  if (vista === "todas") {
    return (
      <EstadoVazio
        agentes={["alba"]}
        titulo="Nenhuma tarefa aberta"
        texto="Tudo feito. A próxima frase no campo acima vira tarefa."
      />
    );
  }
  return (
    <EstadoVazio
      agentes={["alba"]}
      titulo="Nada para hoje"
      texto="As tarefas de hoje e as atrasadas aparecem aqui. Escreva no campo acima: a frase sem dia, nesta vista, fica para hoje."
    />
  );
}

interface PropsListaDeTarefas {
  grupos: readonly GrupoTarefas[];
  listas: readonly Lista[];
  mostrarLista: boolean;
  fazer: (pedido: () => Promise<unknown>) => void;
  tarefaAberta: string | null;
  aoAbrir: (id: string) => void;
}

/**
 * Os grupos da vista. Marcar conclui ou reabre; o título abre o detalhe; Alt+↑ e Alt+↓ (ou
 * arrastar) mudam a ordem dentro do grupo, entre tarefas do mesmo dia e hora; as atrasadas vêm
 * para hoje de uma vez.
 */
function ListaDeTarefas({ grupos, listas, mostrarLista, fazer, tarefaAberta, aoAbrir }: PropsListaDeTarefas) {
  const idDica = useId();
  const arrastando = useRef<{ id: string; grupo: string } | null>(null);
  // Depois de mudar a ordem, o foco volta à caixa da tarefa movida uma vez, quando a ordem nova
  // chega: `antes` é a ordem do grupo na hora do pedido.
  const focar = useRef<{ id: string; antes: string } | null>(null);
  const raiz = useRef<HTMLDivElement>(null);

  // Mover o nó na lista pode tirar o foco dele. Ele volta se caiu no vazio ou ficou na linha; se a
  // pessoa já foi para outro lugar, fica onde ela está. Depois disso, nada mais puxa o foco.
  useEffect(() => {
    const pedido = focar.current;
    if (!pedido || ordemDoGrupo(grupos, pedido.id) === pedido.antes) return;
    focar.current = null;
    const seletor = `[data-tarefa="${CSS.escape(pedido.id)}"]`;
    const ativo = document.activeElement;
    if (ativo && ativo !== document.body && !ativo.closest(seletor)) return;
    raiz.current?.querySelector<HTMLElement>(`${seletor} [role="checkbox"]`)?.focus();
  });

  const ordenar = (ids: string[] | null, id: string) => {
    if (!ids) return;
    focar.current = { id, antes: ordemDoGrupo(grupos, id) };
    fazer(() =>
      servico.pedir("tarefas.ordenar", { ids }).catch((e: unknown) => {
        focar.current = null;
        throw e;
      }),
    );
  };

  const nomeDaLista = (t: Tarefa) => listas.find((l) => l.id === t.listaId)?.nome ?? "";

  return (
    <div className="tarefas-grupos" ref={raiz}>
      <p id={idDica} className="so-leitor">
        Alt+seta para cima e Alt+seta para baixo mudam a ordem.
      </p>
      {grupos.map((g) => (
        <Grupo
          key={g.id}
          grupo={g}
          aoTrazer={() =>
            fazer(async () => {
              for (const ids of emLotes(g.linhas.map((l) => l.tarefa.id))) {
                await servico.pedir("tarefas.adiar", { ids, para: "hoje" });
              }
            })
          }
        >
          {g.linhas.map((l) => (
            <LinhaDaTarefa
              key={l.tarefa.id}
              linha={l}
              lista={mostrarLista ? nomeDaLista(l.tarefa) : null}
              idDica={idDica}
              aberta={tarefaAberta === l.tarefa.id}
              aoAbrir={() => aoAbrir(l.tarefa.id)}
              aoMarcar={(feita) =>
                fazer(() =>
                  servico.pedir(feita ? "tarefas.concluir" : "tarefas.reabrir", { id: l.tarefa.id }),
                )
              }
              aoTeclar={(e) => {
                if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                e.preventDefault();
                ordenar(moverNoGrupo(g.linhas, l.tarefa.id, e.key === "ArrowUp" ? -1 : 1), l.tarefa.id);
              }}
              arrastar={{
                inicio: (e) => {
                  arrastando.current = { id: l.tarefa.id, grupo: g.id };
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", l.tarefa.titulo);
                },
                sobre: (e) => {
                  if (arrastando.current?.grupo === g.id) e.preventDefault();
                },
                solta: (e) => {
                  const origem = arrastando.current;
                  arrastando.current = null;
                  if (origem?.grupo !== g.id) return;
                  e.preventDefault();
                  ordenar(soltarNoGrupo(g.linhas, origem.id, l.tarefa.id), origem.id);
                },
                fim: () => {
                  arrastando.current = null;
                },
              }}
            />
          ))}
        </Grupo>
      ))}
    </div>
  );
}

/** A ordem atual do grupo da tarefa, para saber quando a ordem nova chegou. */
const ordemDoGrupo = (grupos: readonly GrupoTarefas[], id: string) =>
  grupos
    .find((g) => g.linhas.some((l) => l.tarefa.id === id))
    ?.linhas.map((l) => l.tarefa.id)
    .join(" ") ?? "";

function Grupo({
  grupo,
  aoTrazer,
  children,
}: {
  grupo: GrupoTarefas | GrupoLembretes;
  aoTrazer?: () => void;
  children: ReactNode;
}) {
  const idTitulo = useId();
  return (
    <section className="tarefas-grupo" aria-labelledby={idTitulo}>
      <div className="tarefas-grupo-cabeca">
        <h2 id={idTitulo} className="tarefas-grupo-nome" data-atrasado={grupo.atrasado || undefined}>
          {grupo.nome}
        </h2>
        {grupo.atrasado && aoTrazer && (
          <Botao variante="fantasma" tamanho="pequeno" onClick={aoTrazer}>
            Trazer para hoje
          </Botao>
        )}
      </div>
      <ul className="tarefas-linhas">{children}</ul>
    </section>
  );
}

interface PropsLinha {
  linha: LinhaTarefa;
  lista: string | null;
  idDica: string;
  aberta: boolean;
  aoAbrir: () => void;
  aoMarcar: (feita: boolean) => void;
  aoTeclar: (e: KeyboardEvent) => void;
  arrastar: {
    inicio: (e: DragEvent) => void;
    sobre: (e: DragEvent) => void;
    solta: (e: DragEvent) => void;
    fim: () => void;
  };
}

function LinhaDaTarefa({ linha, lista, idDica, aberta, aoAbrir, aoMarcar, aoTeclar, arrastar }: PropsLinha) {
  const { tarefa, nota, quando } = linha;
  const feita = tarefa.estado === "feita";
  const prioridade = textoDaPrioridade(tarefa.prioridade);
  return (
    <li
      className="tarefa"
      data-tarefa={tarefa.id}
      data-feita={feita || undefined}
      data-aberta={aberta || undefined}
      draggable
      onDragStart={arrastar.inicio}
      onDragOver={arrastar.sobre}
      onDrop={arrastar.solta}
      onDragEnd={arrastar.fim}
      onKeyDown={aoTeclar}
    >
      <Caixa marcado={feita} aoMudar={aoMarcar} aria-label={tarefa.titulo} aria-describedby={idDica} />
      <span className="tarefa-prioridade" data-prioridade={tarefa.prioridade}>
        {prioridade && <span className="so-leitor">{prioridade}</span>}
      </span>
      {/* O título abre o detalhe; Alt+setas, nele, também mudam a ordem. */}
      <button
        type="button"
        className="tarefa-texto tarefa-abrir"
        aria-expanded={aberta}
        aria-describedby={idDica}
        onClick={aoAbrir}
      >
        <span className="tarefa-titulo">{tarefa.titulo}</span>
        {nota && <span className="tarefa-nota">{nota}</span>}
      </button>
      {lista !== null && <span className="tarefa-lista">{lista}</span>}
      <span className="tarefa-quando">{quando}</span>
    </li>
  );
}

/** Os lembretes vivos: marcar é o "Feito" do aviso (o recorrente volta com o próximo horário). */
function Lembretes({
  grupos,
  fazer,
}: {
  grupos: readonly GrupoLembretes[];
  fazer: (pedido: () => Promise<unknown>) => void;
}) {
  if (grupos.length === 0) {
    return (
      <EstadoVazio
        agentes={["alba"]}
        titulo="Nenhum lembrete"
        texto="Escreva “me lembra de beber água às 15h” no campo acima. O lembrete toca no horário, mesmo sem modelo."
      />
    );
  }
  return (
    <div className="tarefas-grupos">
      {grupos.map((g) => (
        <Grupo key={g.id} grupo={g}>
          {g.linhas.map(({ lembrete, quando, selo }) => (
            <li key={lembrete.id} className="tarefa">
              <Caixa
                marcado={false}
                aoMudar={() => fazer(() => servico.pedir("lembretes.concluir", { ids: [lembrete.id] }))}
                aria-label={lembrete.texto}
              />
              <span className="tarefa-texto">
                <span className="tarefa-titulo">{lembrete.texto}</span>
              </span>
              {selo && <Selo tom={selo.tom}>{selo.texto}</Selo>}
              <span className="tarefa-quando tarefa-quando--larga">{quando}</span>
            </li>
          ))}
        </Grupo>
      ))}
    </div>
  );
}
