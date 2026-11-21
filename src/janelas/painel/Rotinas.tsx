import {
  DIA_ENCERRADO,
  type AcaoEscolhida,
  type ApresentacaoRotina,
  type LinhaRotina,
  type PerguntaDosIgnorados,
  type RespostaDosIgnorados,
  type Tarefa,
} from "@moductus/contrato";
import { RecusaDoServico } from "@moductus/contrato/cliente";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { somarDias } from "../../areas/dia.ts";
import { Botao } from "../../componentes/Botao.tsx";
import { Campo } from "../../componentes/Campo.tsx";
import { FalaAgente } from "../../componentes/FalaAgente.tsx";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import type { EstadoPersonagem } from "../../componentes/personagem/agentes.ts";
import { servico } from "../../servico/conexao.ts";
import { dataPorExtenso, horaNoFuso, nomeDoDia } from "./dia.ts";
import { chaveDoAviso, DESFAZER_MS, LinhaDesfazer, useAvisoDesfazer, type AvisoDesfazer } from "./Dia.tsx";
import { abrirNoSistema } from "./PedidosSessoes.tsx";
import {
  aindaAbertas,
  ehOntem,
  linhaDoFeito,
  linhasDaAlba,
  linhasDosOutros,
  pendentesDoOntem,
  RESPOSTAS,
  rotuloDaLinha,
  textoDoAdiado,
} from "./rotinas.ts";
import { emLotes } from "../../areas/tarefas/tarefas.ts";
import "./Rotinas.css";

/*
 * O briefing da manhã e o fechamento do dia no painel Hoje (Briefing.dc.html, Fechamento.dc.html,
 * AGENTS.md §2). As linhas vêm prontas do serviço; cada botão pede ao serviço a mesma ação que a
 * tela de Tarefas pediria. O X do briefing ("Fechar"), "Começar o dia", "Ajustar plano", "Adiar 30
 * min" e "Encerrar o dia" ficam gravados na rotina (`rotinas.agir`).
 */

const fecharPainel = () => void invoke("painel_fechar");

const primeiraMaiuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

/** A recusa do serviço vai como ele escreveu; outra falha vira a frase da tela, sem texto cru. */
const mensagemDa = (erro: unknown, padrao: string) =>
  erro instanceof RecusaDoServico ? erro.message : padrao;

/** Um pedido por vez, com a falha na tela. */
function useAcao() {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fazer = (pedido: () => Promise<unknown>, falhou: string) => {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    pedido()
      .catch((e: unknown) => setErro(mensagemDa(e, falhou)))
      .finally(() => setOcupado(false));
  };
  return { ocupado, erro, fazer };
}

const MENSAGEM_DA_ROTINA = "Não consegui registrar agora. Tente de novo.";

/** Grava a ação na rotina e põe a resposta no painel; depois, o que a ação faz na tela. */
async function agir(
  apresentacao: ApresentacaoRotina,
  acao: AcaoEscolhida,
  aplicar: (apresentacao: ApresentacaoRotina) => void,
) {
  const agida = await servico.pedir("rotinas.agir", { id: apresentacao.id, acao });
  aplicar(agida);
}

function Erro({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return (
    <p className="dia-erro" role="alert">
      {texto}
    </p>
  );
}

interface PropsCabecalho {
  titulo: string;
  subtitulo: string;
  acao: { texto: string; rotulo?: string; aoClicar: () => void; desativada: boolean };
}

/** O alto da rotina: o título, a linha do dia e o botão à direita (Fechar ou Adiar 30 min). */
function CabecalhoRotina({ titulo, subtitulo, acao }: PropsCabecalho) {
  return (
    <header className="painel-cabecalho rotina-cabecalho">
      <div className="painel-cabecalho-linha">
        <h1 className="painel-titulo">{titulo}</h1>
        <Botao
          variante="fantasma"
          aria-label={acao.rotulo}
          disabled={acao.desativada}
          onClick={acao.aoClicar}
        >
          {acao.texto}
        </Botao>
      </div>
      <p className="painel-subtitulo">{subtitulo}</p>
    </header>
  );
}

/** A cabeça e o nome de quem fala a linha; sem agente conhecido, só o nome. */
function quemFala(linha: LinhaRotina, estado: EstadoPersonagem, tamanho: "briefing" | "lista") {
  const { agente, texto } = rotuloDaLinha(linha);
  return {
    cabeca: (
      <span className="rotina-cabeca" data-tamanho={tamanho}>
        {agente && <Personagem agente={agente} modo="cabeca" tamanho={tamanho} estado={estado} />}
      </span>
    ),
    nome: (
      <span className="rotina-nome" data-agente={agente ?? undefined}>
        {texto}
      </span>
    ),
  };
}

// ---------- Briefing ----------

interface PropsOntem {
  linha: LinhaRotina;
  atrasadas: readonly Tarefa[] | null;
  aoRevisar: () => void;
  ocupado: boolean;
}

/** [Trazer para hoje] [Revisar] do "Ontem": só enquanto alguma delas continua atrasada. */
function AcoesDoOntem({ linha, atrasadas, aoRevisar, ocupado }: PropsOntem) {
  const acao = useAcao();
  const [trazidas, setTrazidas] = useState(false);
  const pendentes = pendentesDoOntem(linha, atrasadas);
  if (trazidas)
    return (
      <p className="rotina-feito" role="status">
        Vieram para hoje.
      </p>
    );
  if (pendentes.length === 0) return null;
  const trazer = () =>
    acao.fazer(async () => {
      for (const ids of emLotes(pendentes)) await servico.pedir("tarefas.adiar", { ids, para: "hoje" });
      setTrazidas(true);
    }, "Não consegui trazer as tarefas agora. Tente de novo.");
  return (
    <>
      <div className="rotina-acoes-linha">
        <Botao tamanho="pequeno" disabled={acao.ocupado || ocupado} onClick={trazer}>
          Trazer para hoje
        </Botao>
        <Botao tamanho="pequeno" disabled={acao.ocupado || ocupado} onClick={aoRevisar}>
          Revisar
        </Botao>
      </div>
      <Erro texto={acao.erro} />
    </>
  );
}

/** "Deixo o briefing mais curto ou desligo?", a fala da Alba depois de 3 ignorados, com 3 botões. */
function PerguntaDaAlba({ pergunta }: { pergunta: PerguntaDosIgnorados }) {
  const acao = useAcao();
  const [respondida, setRespondida] = useState(false);
  if (respondida) return null;
  const responder = (resposta: RespostaDosIgnorados) =>
    acao.fazer(async () => {
      await servico.pedir("rotinas.responder", { resposta });
      setRespondida(true);
    }, "Não consegui guardar a resposta agora. Tente de novo.");
  const oferecidas = RESPOSTAS.filter((r) => pergunta.respostas.includes(r.resposta));
  return (
    <div className="rotina-pergunta">
      <FalaAgente
        agente="alba"
        estado="esperando"
        tamanho="briefing"
        acao={
          <>
            <div className="rotina-acoes-linha">
              {oferecidas.map((r) => (
                <Botao
                  key={r.resposta}
                  tamanho="pequeno"
                  disabled={acao.ocupado}
                  onClick={() => responder(r.resposta)}
                >
                  {r.texto}
                </Botao>
              ))}
            </div>
            <Erro texto={acao.erro} />
          </>
        }
      >
        {pergunta.texto}
      </FalaAgente>
    </div>
  );
}

interface PropsBriefing {
  apresentacao: ApresentacaoRotina;
  pergunta: PerguntaDosIgnorados | null;
  /** As atrasadas lidas agora, para o "Ontem" só oferecer o que ainda está atrasado. */
  atrasadas: readonly Tarefa[] | null;
  fuso: string;
  agora: Date;
  aplicar: (apresentacao: ApresentacaoRotina) => void;
}

/**
 * O briefing da manhã (Briefing.dc.html): "Bom dia", o dia e a hora, as linhas na ordem do serviço
 * (Alba, Ontem, Tula, Nuno, Faina), cada uma com a cabeça do agente, e [Ajustar plano] [Começar o
 * dia]. "Começar o dia" deixa o Hoje no painel; "Ajustar plano" e "Revisar" abrem as Tarefas.
 */
export function BriefingDoDia({ apresentacao, pergunta, atrasadas, fuso, agora, aplicar }: PropsBriefing) {
  const acao = useAcao();
  const fazer = (escolhida: AcaoEscolhida, depois?: () => void) =>
    acao.fazer(async () => {
      await agir(apresentacao, escolhida, aplicar);
      depois?.();
    }, MENSAGEM_DA_ROTINA);
  const ajustar = () => fazer("ajustar", () => abrirNoSistema("tarefas"));
  const { linhas } = apresentacao;

  return (
    <>
      <CabecalhoRotina
        titulo="Bom dia"
        subtitulo={`${primeiraMaiuscula(dataPorExtenso(apresentacao.dia))} · ${horaNoFuso(agora, fuso)}`}
        acao={{
          texto: "Fechar",
          rotulo: "Fechar o briefing",
          desativada: acao.ocupado,
          aoClicar: () => fazer("fechar", fecharPainel),
        }}
      />
      <div className="painel-corpo rotina-corpo">
        {linhas.length === 0 ? (
          // Sem linha nenhuma, a abertura da Alba é o briefing ("Bom dia. Nada marcado para hoje.").
          <FalaAgente agente="alba" tamanho="briefing">
            {apresentacao.abertura}
          </FalaAgente>
        ) : (
          <ul className="rotina-linhas" aria-label="Briefing da manhã">
            {linhas.map((linha, i) => {
              const ontem = ehOntem(linha);
              const quem = quemFala(linha, ontem ? "esperando" : "ocioso", "briefing");
              return (
                <li key={i} className="rotina-linha">
                  {quem.cabeca}
                  <div className="rotina-linha-corpo">
                    {quem.nome}
                    <span className="rotina-texto">{linha.texto}</span>
                    {ontem && (
                      <AcoesDoOntem
                        linha={linha}
                        atrasadas={atrasadas}
                        aoRevisar={ajustar}
                        ocupado={acao.ocupado}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {pergunta && <PerguntaDaAlba pergunta={pergunta} />}
        <Erro texto={acao.erro} />
        <div className="rotina-acoes">
          <Botao disabled={acao.ocupado} onClick={ajustar}>
            Ajustar plano
          </Botao>
          <Botao variante="primario" disabled={acao.ocupado} onClick={() => fazer("comecar")}>
            Começar o dia
          </Botao>
        </div>
        <p className="rotina-nota">Se ficar fechado 10 minutos, vira um aviso do Windows.</p>
      </div>
    </>
  );
}

// ---------- Fechamento ----------

interface PropsAberta {
  tarefa: Tarefa;
  hoje: string;
  aoResolver: (tarefa: Tarefa, aviso: AvisoDesfazer) => void;
}

/** O que desfaz o adiar: o dia que a tarefa tinha (sem dia, tira o dia). */
const voltarODia = (t: Tarefa) =>
  t.venceEm === null
    ? servico.pedir("tarefas.definir", { id: t.id, venceEm: null })
    : servico.pedir("tarefas.adiar", { ids: [t.id], para: t.venceEm });

/**
 * Uma tarefa do "Ficou aberto" com [Amanhã] [Outra data] [Descartar]. "Outra data" abre o campo
 * do dia ali mesmo, com [Mover] e [Cancelar]; Enter move e Esc volta aos botões.
 */
function TarefaAberta({ tarefa, hoje, aoResolver }: PropsAberta) {
  const idTitulo = useId();
  const acao = useAcao();
  const amanha = somarDias(hoje, 1);
  const [escolhendo, setEscolhendo] = useState(false);
  const [dia, setDia] = useState(amanha);
  // Fechado o campo (Esc ou Cancelar), o foco volta ao "Outra data" que o abriu.
  const botaoOutraData = useRef<HTMLButtonElement>(null);
  const voltarFoco = useRef(false);
  const fecharCampo = () => {
    voltarFoco.current = true;
    setEscolhendo(false);
  };
  useEffect(() => {
    if (escolhendo || !voltarFoco.current) return;
    voltarFoco.current = false;
    botaoOutraData.current?.focus();
  }, [escolhendo]);

  const adiar = (para: string) =>
    acao.fazer(async () => {
      await servico.pedir("tarefas.adiar", { ids: [tarefa.id], para });
      aoResolver(tarefa, {
        texto: textoDoAdiado(tarefa.titulo, para === "amanha" ? amanha : para, hoje),
        desfazer: () => voltarODia(tarefa),
        ate: Date.now() + DESFAZER_MS,
      });
    }, "Não consegui mudar o dia agora. Tente de novo.");
  const descartar = () =>
    acao.fazer(async () => {
      await servico.pedir("tarefas.cancelar", { id: tarefa.id });
      aoResolver(tarefa, {
        texto: `${tarefa.titulo}: descartada.`,
        desfazer: () => servico.pedir("tarefas.reabrir", { id: tarefa.id }),
        ate: Date.now() + DESFAZER_MS,
      });
    }, "Não consegui descartar agora. Tente de novo.");
  const mover = () => {
    if (dia === "" || dia <= hoje) return;
    adiar(dia);
  };
  const aoTeclar = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      mover();
    } else if (e.key === "Escape") {
      // Esc fecha o campo, não o painel.
      e.preventDefault();
      e.stopPropagation();
      fecharCampo();
    }
  };
  const teclado = (quer: boolean) => () => void invoke("painel_foco", { quer });

  return (
    <li className="rotina-aberta" data-tarefa={tarefa.id}>
      <span id={idTitulo} className="rotina-aberta-titulo" title={tarefa.titulo}>
        {tarefa.titulo}
      </span>
      {escolhendo ? (
        <div className="rotina-outra-data" role="group" aria-labelledby={idTitulo}>
          <Campo
            rotulo="Nova data"
            rotuloOculto
            type="date"
            className="rotina-campo-data"
            min={amanha}
            value={dia}
            autoFocus
            onChange={(e) => setDia(e.target.value)}
            onKeyDown={aoTeclar}
            onPointerDown={teclado(true)}
            onFocus={teclado(true)}
            onBlur={teclado(false)}
          />
          <Botao
            variante="primario"
            tamanho="pequeno"
            disabled={acao.ocupado || dia === "" || dia <= hoje}
            onClick={mover}
          >
            Mover
          </Botao>
          <Botao variante="fantasma" tamanho="pequeno" disabled={acao.ocupado} onClick={fecharCampo}>
            Cancelar
          </Botao>
        </div>
      ) : (
        <div className="rotina-acoes-linha" role="group" aria-labelledby={idTitulo}>
          <Botao
            variante="primario"
            tamanho="pequeno"
            disabled={acao.ocupado}
            onClick={() => adiar("amanha")}
          >
            Amanhã
          </Botao>
          <Botao
            ref={botaoOutraData}
            tamanho="pequeno"
            disabled={acao.ocupado}
            onClick={() => setEscolhendo(true)}
          >
            Outra data
          </Botao>
          <Botao tamanho="pequeno" disabled={acao.ocupado} onClick={descartar}>
            Descartar
          </Botao>
        </div>
      )}
      <Erro texto={acao.erro} />
    </li>
  );
}

interface PropsFechamento {
  apresentacao: ApresentacaoRotina;
  /** As tarefas do dia lidas agora (hoje e atrasadas), para o "Ficou aberto" seguir o que mudou. */
  doDia: readonly Tarefa[] | null;
  hoje: string;
  fuso: string;
  agora: Date;
  aplicar: (apresentacao: ApresentacaoRotina) => void;
  /** "Encerrar o dia" gravou: o painel mostra o "Dia encerrado." da Alba. */
  aoEncerrar: () => void;
}

/** "Quinta · 18:00 · uns 2 minutos", a linha de baixo do fechamento. */
const subtituloDoFechamento = (dia: string, agora: Date, fuso: string) =>
  `${primeiraMaiuscula(nomeDoDia(dia))} · ${horaNoFuso(agora, fuso)} · uns 2 minutos`;

/**
 * O fechamento do dia (Fechamento.dc.html): a Alba com o que foi feito, o "Ficou aberto" com
 * [Amanhã] [Outra data] [Descartar] por tarefa (com Desfazer), amanhã numa linha, os outros
 * agentes e [Encerrar o dia]. "Adiar 30 min" fica no alto, no lugar do fechar.
 */
export function FechamentoDoDia({
  apresentacao,
  doDia,
  hoje,
  fuso,
  agora,
  aplicar,
  aoEncerrar,
}: PropsFechamento) {
  const acao = useAcao();
  const [resolvidas, setResolvidas] = useState<ReadonlySet<string>>(() => new Set());
  const [aviso, setAviso] = useAvisoDesfazer();
  const idAberto = useId();
  const { linhas } = apresentacao;
  const feito = linhaDoFeito(linhas);
  const abertas = aindaAbertas(apresentacao.abertas, resolvidas, doDia);
  // Pelo teclado, o foco não se perde com a linha que sai: vai ao Desfazer; desfeito, à tarefa que
  // voltou; sumido o Desfazer no prazo, à primeira tarefa do "Ficou aberto" (ou ao Encerrar o dia).
  const corpo = useRef<HTMLDivElement>(null);
  const focar = useRef<"desfazer" | { tarefaId: string } | null>(null);
  const tinhaAviso = useRef(false);
  useEffect(() => {
    const raiz = corpo.current;
    const alvo = focar.current;
    focar.current = null;
    const primeiro = () =>
      raiz?.querySelector<HTMLElement>(".rotina-aberta button") ??
      raiz?.querySelector<HTMLElement>(".rotina-encerrar") ??
      null;
    if (alvo === "desfazer") raiz?.querySelector<HTMLElement>(".dia-desfazer button")?.focus();
    else if (alvo) {
      const linha = [...(raiz?.querySelectorAll<HTMLElement>(".rotina-aberta") ?? [])].find(
        (li) => li.dataset.tarefa === alvo.tarefaId,
      );
      (linha?.querySelector<HTMLElement>("button") ?? primeiro())?.focus();
    } else if (!aviso && tinhaAviso.current && document.activeElement === document.body) primeiro()?.focus();
    tinhaAviso.current = aviso !== null;
  }, [aviso, resolvidas]);

  const fazer = (escolhida: AcaoEscolhida, depois: () => void) =>
    acao.fazer(async () => {
      await agir(apresentacao, escolhida, aplicar);
      depois();
    }, MENSAGEM_DA_ROTINA);
  const resolver = (tarefa: Tarefa, novo: AvisoDesfazer) => {
    focar.current = "desfazer";
    setResolvidas((atual) => new Set(atual).add(tarefa.id));
    setAviso({
      ...novo,
      // Desfeito, a tarefa volta ao "Ficou aberto".
      desfazer: () =>
        novo.desfazer().then(() => {
          focar.current = { tarefaId: tarefa.id };
          setResolvidas((atual) => {
            const sem = new Set(atual);
            sem.delete(tarefa.id);
            return sem;
          });
        }),
    });
  };

  return (
    <>
      <CabecalhoRotina
        titulo="Fechamento do dia"
        subtitulo={subtituloDoFechamento(apresentacao.dia, agora, fuso)}
        acao={{
          texto: "Adiar 30 min",
          desativada: acao.ocupado,
          aoClicar: () => fazer("adiar", fecharPainel),
        }}
      />
      <div ref={corpo} className="painel-corpo rotina-corpo">
        <div className="rotina-alba">
          <div className="rotina-alba-topo">
            <span className="rotina-cabeca" data-tamanho="lista">
              <Personagem agente="alba" modo="cabeca" tamanho="lista" estado="ocioso" />
            </span>
            <span className="rotina-nome" data-agente="alba">
              Alba
            </span>
            {feito && <span className="rotina-meta">{feito.texto}</span>}
          </div>
          {abertas.length > 0 && (
            <>
              <h2 id={idAberto} className="rotina-rotulo">
                Ficou aberto
              </h2>
              <ul className="rotina-abertas" aria-labelledby={idAberto}>
                {abertas.map((t) => (
                  <TarefaAberta key={t.id} tarefa={t} hoje={hoje} aoResolver={resolver} />
                ))}
              </ul>
            </>
          )}
          {aviso && <LinhaDesfazer key={chaveDoAviso(aviso)} aviso={aviso} aoAcabar={() => setAviso(null)} />}
          {linhasDaAlba(linhas).map((l, i) => (
            <p key={i} className="rotina-texto-2">{`${l.rotulo}: ${l.texto}`}</p>
          ))}
        </div>
        {linhasDosOutros(linhas).map((linha, i) => {
          const quem = quemFala(linha, "ocioso", "lista");
          return (
            <div key={i} className="rotina-outro">
              {quem.cabeca}
              <div className="rotina-linha-corpo">
                {quem.nome}
                <span className="rotina-texto-2">{linha.texto}</span>
              </div>
            </div>
          );
        })}
        <Erro texto={acao.erro} />
        <Botao
          variante="primario"
          className="rotina-encerrar"
          disabled={acao.ocupado}
          onClick={() => fazer("encerrar", aoEncerrar)}
        >
          Encerrar o dia
        </Botao>
        <p className="rotina-nota">Depois disso, os agentes só avisam aprovações e lembretes até amanhã.</p>
      </div>
    </>
  );
}

/** Depois de "Encerrar o dia": a Alba responde "Dia encerrado." (AGENTS.md §2) e o painel fecha no X. */
export function DiaEncerrado({ dia, agora, fuso }: { dia: string; agora: Date; fuso: string }) {
  return (
    <>
      <CabecalhoRotina
        titulo="Fechamento do dia"
        subtitulo={subtituloDoFechamento(dia, agora, fuso)}
        acao={{ texto: "Fechar", rotulo: "Fechar o painel", desativada: false, aoClicar: fecharPainel }}
      />
      <div className="painel-corpo rotina-corpo" role="status">
        <FalaAgente agente="alba" tamanho="briefing">
          {DIA_ENCERRADO}
        </FalaAgente>
      </div>
    </>
  );
}
