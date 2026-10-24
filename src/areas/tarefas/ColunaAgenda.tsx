import type { Agenda, SugestaoAplicada } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { FalaAgente } from "../../componentes/FalaAgente.tsx";
import { chaveDoEncaixe, proximoEncaixe, type Encaixe } from "../../janelas/painel/foco.ts";
import { useAcoesSistema } from "../../janelas/sistema/primeiro-uso/estado.ts";
import { servico } from "../../servico/conexao.ts";
import {
  falaDaSugestao,
  falaDoGuardado,
  fonteDaAgenda,
  montarColuna,
  ocorrenciasDaFonte,
  useAgendaDoDia,
  type BlocoDaColuna,
} from "./agenda.ts";
import { mensagemDaRecusa, type DadosTarefas } from "./tarefas.ts";

/**
 * O que o "Guardar o bloco" criou, com o desfazer da ação `interno`. Fica até `desfazerAte` ou até
 * a releitura da agenda que vem depois da que já trouxe o compromisso: aí a Alba passa ao próximo
 * encaixe.
 */
interface Guardado {
  dia: string;
  texto: string;
  chamadaId: string;
  desfazerAte: string;
  eventoId: string;
  /** Uma releitura já trouxe o compromisso criado. */
  visto: boolean;
}

/** Abaixo de uma hora o bloco não cabe nome e hora em duas linhas: vão numa só. */
const MINUTOS_BLOCO_CURTO = 60;

/** As medidas da régua vão ao CSS em horas, que ele multiplica pela altura de uma hora. */
const variaveis = (valores: Record<string, number>) =>
  Object.fromEntries(Object.entries(valores).map(([nome, valor]) => [`--${nome}`, valor])) as CSSProperties;

const posicaoDoBloco = (b: BlocoDaColuna, de: number) =>
  variaveis({
    inicio: b.inicio / 60 - de,
    duracao: (b.fim - b.inicio) / 60,
    coluna: b.coluna,
    colunas: b.colunas,
  });

/**
 * A coluna Agenda das Tarefas (AreaTarefas.dc.html): hoje na régua do expediente, com o local, o
 * "Moductus" e os calendários lidos, a linha de agora e o encaixe que a Alba sugere, tracejado no
 * bloco livre. A sugestão só vira compromisso com o clique em "Guardar o bloco" (`interno`, com
 * desfazer); sem o Google, a coluna mostra só o local e convida a conectar.
 */
export function ColunaAgenda({
  canal,
  dados,
  agora,
  eventoAberto = null,
  aoAbrirEvento,
}: {
  canal: EstadoConexao;
  dados: DadosTarefas;
  agora: Date;
  /** O evento cujo detalhe está aberto: o bloco dele fica marcado. */
  eventoAberto?: string | null;
  /** Clicar num compromisso abre o detalhe dele. */
  aoAbrirEvento?: (eventoId: string) => void;
}) {
  const leitura = useAgendaDoDia(canal, dados.dia);
  const { ir } = useAcoesSistema();
  const idTitulo = useId();
  const [recusados, setRecusados] = useState<ReadonlySet<string>>(() => new Set());
  const [guardado, setGuardado] = useState<Guardado | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const pronta = leitura.estado === "pronta" ? leitura.dados : null;
  const agenda = pronta?.agenda ?? null;
  // A agenda da última releitura, para o "Guardar" e o efeito abaixo (roda antes dele).
  const agendaAtual = useRef(agenda);
  useEffect(() => {
    agendaAtual.current = agenda;
  }, [agenda]);

  // Cada releitura nova da agenda: a primeira com o compromisso guardado o mostra na régua junto
  // do "Guardei"; a seguinte encerra o "Guardei" e devolve a vez ao próximo encaixe.
  const carga = pronta?.carga ?? null;
  useEffect(() => {
    if (carga === null) return;
    setGuardado((g) => {
      if (!g) return g;
      if (!g.visto) return temEvento(agendaAtual.current, g.eventoId) ? { ...g, visto: true } : g;
      return null;
    });
  }, [carga]);

  const dia = dados.dia;
  const doDia = agenda?.dias.find((d) => d.dia === dia) ?? null;
  const guardadoAgora =
    guardado && guardado.dia === dia && Date.parse(guardado.desfazerAte) > agora.getTime() ? guardado : null;
  const encaixe = guardadoAgora
    ? null
    : proximoEncaixe(doDia, [...dados.atrasadas, ...dados.hoje], null, recusados);
  const fonte = fonteDaAgenda(pronta?.google ?? null, pronta?.calendarios ?? []);
  const coluna = montarColuna({
    ocorrencias: ocorrenciasDaFonte(agenda?.ocorrencias ?? [], pronta?.calendarios ?? [], fonte.temGoogle),
    livres: doDia?.livres ?? [],
    dia,
    fuso: dados.fuso,
    expediente: dados.expediente,
    sugestao: encaixe && { ...encaixe.sugestao, titulo: encaixe.titulo },
    agora,
  });

  const guardar = (e: Encaixe) => {
    setErro(null);
    setGuardando(true);
    servico
      .pedir("agenda.aplicarSugestao", e.sugestao)
      .then(({ evento, chamadaId, desfazerAte }: SugestaoAplicada) =>
        setGuardado({
          dia,
          texto: falaDoGuardado(e, dia, dados.fuso),
          chamadaId,
          desfazerAte,
          eventoId: evento.id,
          // A releitura do aviso do serviço pode ter chegado antes da resposta.
          visto: temEvento(agendaAtual.current, evento.id),
        }),
      )
      .catch((motivo: unknown) => setErro(mensagemDaRecusa(motivo)))
      .finally(() => setGuardando(false));
  };
  const desfazer = (g: Guardado) => {
    setErro(null);
    servico
      .pedir("execucoes.desfazer", { chamadaId: g.chamadaId })
      .then(() => setGuardado(null))
      .catch((motivo: unknown) => setErro(mensagemDaRecusa(motivo)));
  };
  const recusar = (e: Encaixe) => {
    setErro(null);
    setRecusados((atual) => new Set(atual).add(chaveDoEncaixe(e.sugestao)));
  };

  return (
    <aside className="tarefas-agenda" aria-labelledby={idTitulo}>
      <div className="tarefas-agenda-cabeca">
        <h2 id={idTitulo} className="tarefas-agenda-titulo">
          Agenda
        </h2>
        {pronta && <span>{fonte.rotulo}</span>}
      </div>
      {leitura.estado === "falhou" && (
        <div className="tarefas-agenda-falha" role="alert">
          <p className="tarefas-erro">Não consegui ler a agenda agora.</p>
          <Botao variante="fantasma" tamanho="pequeno" onClick={leitura.tentarDeNovo}>
            Tentar de novo
          </Botao>
        </div>
      )}
      {pronta && coluna.diaTodo.length > 0 && (
        <ul className="tarefas-agenda-dia-todo" aria-label="O dia todo">
          {coluna.diaTodo.map((d) => (
            <li
              key={d.chave}
              className="tarefas-agenda-dia-todo-item"
              data-aberto={d.eventoId === eventoAberto || undefined}
            >
              {aoAbrirEvento ? (
                <button
                  type="button"
                  className="tarefas-agenda-dia-todo-abrir"
                  aria-expanded={d.eventoId === eventoAberto}
                  onClick={() => aoAbrirEvento(d.eventoId)}
                >
                  {d.nome}
                </button>
              ) : (
                d.nome
              )}
            </li>
          ))}
        </ul>
      )}
      {pronta && (
        <div className="tarefas-agenda-regua" style={variaveis({ horas: coluna.ate - coluna.de })}>
          {coluna.horas.map((h) => (
            <div
              key={h}
              className="tarefas-agenda-hora"
              style={variaveis({ inicio: h - coluna.de })}
              aria-hidden="true"
            >
              <span className="tarefas-agenda-hora-rotulo">{h}h</span>
            </div>
          ))}
          <ol className="tarefas-agenda-blocos" aria-label="Compromissos de hoje">
            {coluna.blocos.map((b) => (
              <li
                key={b.chave}
                className="tarefas-agenda-bloco"
                data-tipo={b.tipo}
                data-curto={b.fim - b.inicio < MINUTOS_BLOCO_CURTO || undefined}
                data-aberto={(b.eventoId !== null && b.eventoId === eventoAberto) || undefined}
                style={posicaoDoBloco(b, coluna.de)}
              >
                <span className="tarefas-agenda-bloco-nome">{b.nome}</span>
                <span className="tarefas-agenda-bloco-hora">{b.hora}</span>
                {b.eventoId !== null && aoAbrirEvento && (
                  // O bloco inteiro abre o detalhe; o texto dele fica para quem lê a régua.
                  <button
                    type="button"
                    className="tarefas-agenda-bloco-abrir"
                    aria-label={`${b.nome}, ${b.hora}`}
                    aria-expanded={b.eventoId === eventoAberto}
                    onClick={() => aoAbrirEvento(b.eventoId!)}
                  />
                )}
              </li>
            ))}
          </ol>
          {coluna.agora !== null && (
            <div
              className="tarefas-agenda-agora"
              style={variaveis({ inicio: coluna.agora / 60 - coluna.de })}
              aria-hidden="true"
            />
          )}
        </div>
      )}
      {pronta && (
        <p className="so-leitor">
          {coluna.livres.length === 0 ? "Nenhum bloco livre hoje." : `Livre: ${coluna.livres.join(", ")}.`}
        </p>
      )}
      {pronta && !fonte.temGoogle && (
        <div className="tarefas-agenda-convite">
          <p>Conecte o Google Agenda para ver aqui os seus outros calendários e o “Moductus”.</p>
          <Botao tamanho="pequeno" onClick={() => ir({ area: "configuracoes", secao: "conexoes" })}>
            Abrir Conexões
          </Botao>
        </div>
      )}
      {pronta && (guardadoAgora ?? encaixe) && (
        <div className="tarefas-agenda-sugestao">
          <FalaAgente
            agente="alba"
            tamanho="aviso"
            acao={
              <div className="tarefas-agenda-acoes">
                {guardadoAgora ? (
                  <Botao variante="fantasma" tamanho="pequeno" onClick={() => desfazer(guardadoAgora)}>
                    Desfazer
                  </Botao>
                ) : (
                  <>
                    <Botao tamanho="pequeno" onClick={() => recusar(encaixe!)}>
                      Agora não
                    </Botao>
                    <Botao
                      variante="primario"
                      tamanho="pequeno"
                      disabled={guardando}
                      onClick={() => guardar(encaixe!)}
                    >
                      Guardar o bloco
                    </Botao>
                  </>
                )}
              </div>
            }
          >
            {guardadoAgora ? guardadoAgora.texto : falaDaSugestao(encaixe!, dia, dados.fuso)}
          </FalaAgente>
        </div>
      )}
      {erro && (
        <p className="tarefas-erro" role="alert">
          {erro}
        </p>
      )}
    </aside>
  );
}

/** Se a agenda lida já traz o compromisso. */
const temEvento = (agenda: Agenda | null, eventoId: string) =>
  agenda?.ocorrencias.some((o) => o.eventoId === eventoId) ?? false;
