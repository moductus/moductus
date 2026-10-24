import type { Calendario, EventoAgenda, MudancaEvento } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useId, useState } from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { Interruptor } from "../../componentes/Interruptor.tsx";
import { Selo } from "../../componentes/Selo.tsx";
import { useAcoesSistema } from "../../janelas/sistema/primeiro-uso/estado.ts";
import { servico } from "../../servico/conexao.ts";
import { formatarAntes } from "../dia.ts";
import { LeituraPendente } from "../FaixaNuno.tsx";
import {
  alertasEmOrdem,
  alertasQueFaltam,
  alternarDiaInteiro,
  avisosDoCelular,
  calendarioPorExtenso,
  espelhoLigado,
  MAXIMO_ALERTAS,
  moverInicio,
  notaDoCalendario,
  opcoesRepeticao,
  pedidoParaAlba,
  quandoNaTela,
  quandoParaGravar,
  quandoPorExtenso,
  useEvento,
  valorDaRepeticao,
  type Calendarios,
  type QuandoNaTela,
} from "./detalhe.ts";
import {
  AreaDeTexto,
  ChipQueSai,
  Entrada,
  LinhaOrigem,
  ListaSuspensa,
  PainelDetalhe,
  RodapeDetalhe,
  useGravacao,
} from "./PecasDetalhe.tsx";
import { mensagemDaRecusa } from "./tarefas.ts";

interface PropsDetalheEvento {
  canal: EstadoConexao;
  id: string;
  fuso: string;
  /** O começo do expediente: a hora do evento que deixa de ser de dia inteiro. */
  horaPadrao: string;
  agora: Date;
  calendarios: Calendarios | null;
  aoFechar: () => void;
}

/**
 * O detalhe de um evento da agenda. O do local e o do "Moductus" abrem para editar
 * (DetalheEvento.dc.html); o de outro calendário abre só leitura, com o pedido à Alba
 * (DetalheEventoLeitura.dc.html), porque mudar lá é ação `externo`, com aprovação.
 */
export function DetalheEvento({
  canal,
  id,
  fuso,
  horaPadrao,
  agora,
  calendarios,
  aoFechar,
}: PropsDetalheEvento) {
  const { leitura, recebido } = useEvento(canal, id);
  if (leitura.estado !== "pronto") {
    return (
      <PainelDetalhe rotulo="Detalhe do evento" alto="Evento" aoFechar={aoFechar}>
        {leitura.estado === "sumiu" ? (
          <p className="tarefas-detalhe-rot">Este evento saiu da agenda.</p>
        ) : (
          <LeituraPendente
            agente="alba"
            oQue="o evento"
            tentarDeNovo={leitura.estado === "falhou" ? leitura.tentarDeNovo : undefined}
          />
        )}
      </PainelDetalhe>
    );
  }
  const { evento } = leitura;
  const lista = calendarios?.calendarios ?? [];
  const calendario = lista.find((c) => c.id === evento.calendarioId) ?? null;
  if (!evento.editavel) {
    return <EventoSoLeitura evento={evento} calendario={calendario} fuso={fuso} aoFechar={aoFechar} />;
  }
  return (
    <EventoEditavel
      key={evento.id}
      evento={evento}
      calendarios={calendarios}
      fuso={fuso}
      horaPadrao={horaPadrao}
      agora={agora}
      aoReceber={recebido}
      aoFechar={aoFechar}
    />
  );
}

interface PropsEditavel {
  evento: EventoAgenda;
  calendarios: Calendarios | null;
  fuso: string;
  horaPadrao: string;
  agora: Date;
  aoReceber: (evento: EventoAgenda) => void;
  aoFechar: () => void;
}

function EventoEditavel({
  evento,
  calendarios,
  fuso,
  horaPadrao,
  agora,
  aoReceber,
  aoFechar,
}: PropsEditavel) {
  const gravacao = useGravacao();
  const idCalendarios = useId();
  const [erroQuando, setErroQuando] = useState<string | null>(null);
  const { id } = evento;
  const q = quandoNaTela(evento, fuso);
  const espelho = calendarios ? espelhoLigado(calendarios.calendarios, calendarios.google) : null;
  const noMoductus = calendarios?.calendarios.some((c) => c.id === evento.calendarioId && c.espelho) ?? false;

  const definir = (mudanca: Omit<MudancaEvento, "id">) =>
    gravacao.gravar(() => servico.pedir("agenda.definirEvento", { id, ...mudanca }), aoReceber);

  /** O quando vai inteiro (início, fim e dia inteiro andam juntos no contrato). */
  const gravarQuando = (novo: QuandoNaTela) => {
    const quando = quandoParaGravar(novo, fuso);
    if (!quando) {
      setErroQuando("O fim vem depois do começo.");
      return;
    }
    setErroQuando(null);
    definir(quando);
  };

  // A escolha: o local, o "Moductus" (com o Google ligado, ou o do próprio evento) e, sem escolha
  // por aqui, os outros que a Alba lê.
  const opcoes = (calendarios?.calendarios ?? []).filter((c) => {
    if (c.fonte === "local") return true;
    if (c.espelho) return espelho !== null || c.id === evento.calendarioId;
    return c.ler;
  });

  return (
    <PainelDetalhe rotulo="Detalhe do evento" alto="Evento" aoFechar={aoFechar}>
      <div className="tarefas-detalhe-cabeca-evento">
        <Entrada
          rotulo="Título"
          rotuloOculto
          className="tarefas-detalhe-titulo-campo"
          valor={evento.titulo}
          maxLength={500}
          autoFocus
          obrigatoria
          aoGravar={(titulo) => definir({ titulo: titulo.trim() })}
        />
        <LinhaOrigem item={evento} genero="o" fuso={fuso} agora={agora} />
      </div>
      {opcoes.length > 0 && (
        <fieldset className="tarefas-detalhe-calendarios">
          <legend className="tarefas-detalhe-rot">Calendário</legend>
          {opcoes.map((c) => (
            <OpcaoCalendario
              key={c.id}
              nome={idCalendarios}
              calendario={c}
              marcado={c.id === evento.calendarioId}
              aoMarcar={() => definir({ calendarioId: c.id })}
            />
          ))}
        </fieldset>
      )}
      <Interruptor ligado={q.diaInteiro} aoMudar={() => gravarQuando(alternarDiaInteiro(q, horaPadrao))}>
        Dia inteiro
      </Interruptor>
      <div className="tarefas-detalhe-quando" data-dia-inteiro={q.diaInteiro || undefined}>
        <span className="tarefas-detalhe-rot" aria-hidden="true">
          Começa
        </span>
        <Entrada
          rotulo="Data de início"
          rotuloOculto
          tipo="date"
          valor={q.inicioDia}
          obrigatoria
          aoGravar={(dia) => gravarQuando(moverInicio(q, dia, q.inicioHora, fuso))}
        />
        {!q.diaInteiro && (
          <Entrada
            rotulo="Hora de início"
            rotuloOculto
            tipo="time"
            valor={q.inicioHora}
            obrigatoria
            aoGravar={(hora) => gravarQuando(moverInicio(q, q.inicioDia, hora, fuso))}
          />
        )}
        <span className="tarefas-detalhe-rot" aria-hidden="true">
          Termina
        </span>
        <Entrada
          rotulo="Data do fim"
          rotuloOculto
          tipo="date"
          valor={q.fimDia}
          obrigatoria
          aoGravar={(dia) => gravarQuando({ ...q, fimDia: dia })}
        />
        {!q.diaInteiro && (
          <Entrada
            rotulo="Hora do fim"
            rotuloOculto
            tipo="time"
            valor={q.fimHora}
            obrigatoria
            aoGravar={(hora) => gravarQuando({ ...q, fimHora: hora })}
          />
        )}
      </div>
      {erroQuando && (
        <p className="tarefas-erro" role="alert">
          {erroQuando}
        </p>
      )}
      <div className="tarefas-detalhe-grade">
        <ListaSuspensa
          rotulo="Repetir"
          valor={valorDaRepeticao(evento.recorrencia)}
          opcoes={opcoesRepeticao(evento.recorrencia)}
          aoMudar={(regra) => definir({ recorrencia: regra === "" ? null : regra })}
        />
        <Entrada
          rotulo="Local"
          valor={evento.local ?? ""}
          maxLength={500}
          aoGravar={(local) => definir({ local: local.trim() === "" ? null : local.trim() })}
        />
      </div>
      <Alertas alertas={evento.alertas} aoMudar={(alertas) => definir({ alertas })} />
      <AreaDeTexto
        rotulo="Descrição"
        valor={evento.descricao ?? ""}
        maxLength={10_000}
        aoGravar={(descricao) => definir({ descricao: descricao.trim() === "" ? null : descricao })}
      />
      <p className="tarefas-detalhe-google">
        {noMoductus ? (
          <>
            {calendarios?.google?.estado === "erro" ? (
              <Selo tom="aviso" forma="ponto">
                Google com erro
              </Selo>
            ) : espelho ? (
              <Selo tom="sucesso" forma="ponto">
                vai ao Google
              </Selo>
            ) : (
              <Selo tom="apagado" forma="ponto">
                Google desconectado
              </Selo>
            )}
            <span>· {avisosDoCelular(evento.alertas)}</span>
          </>
        ) : (
          <span>Fica só neste PC, sem aviso no celular.</span>
        )}
      </p>
      <div className="tarefas-detalhe-espaco" />
      <RodapeDetalhe
        apagar={{
          texto: "Apagar evento",
          aoApagar: () => gravacao.gravar(() => servico.pedir("agenda.apagarEvento", { id }), aoFechar),
        }}
        nota={noMoductus ? "sai também do Google" : "fica 30 dias na Lixeira"}
        gravacao={gravacao}
        atualizadoEm={evento.atualizadoEm}
        agora={agora}
      />
    </PainelDetalhe>
  );
}

/** Um calendário na escolha; o do Google que não é o "Moductus" não se escolhe por aqui. */
function OpcaoCalendario({
  nome,
  calendario,
  marcado,
  aoMarcar,
}: {
  nome: string;
  calendario: Calendario;
  marcado: boolean;
  aoMarcar: () => void;
}) {
  const escolhivel = calendario.fonte === "local" || calendario.espelho;
  const idNota = useId();
  return (
    <label
      className="tarefas-detalhe-calendario"
      data-marcada={marcado}
      data-desativada={!escolhivel || undefined}
    >
      <input
        type="radio"
        name={nome}
        checked={marcado}
        disabled={!escolhivel}
        aria-describedby={idNota}
        onChange={aoMarcar}
      />
      <span className="tarefas-detalhe-calendario-nome">{calendario.nome}</span>
      <span id={idNota} className="tarefas-detalhe-calendario-nota">
        {notaDoCalendario(calendario)}
      </span>
    </label>
  );
}

/** Os alertas: o "x" tira, "+ Alerta" abre a lista das antecedências que faltam. */
function Alertas({ alertas, aoMudar }: { alertas: readonly number[]; aoMudar: (alertas: number[]) => void }) {
  const idTitulo = useId();
  const idLista = useId();
  const [pondo, setPondo] = useState(false);
  const faltam = alertasQueFaltam(alertas);
  return (
    <div className="tarefas-detalhe-campo" role="group" aria-labelledby={idTitulo}>
      <span id={idTitulo} className="tarefas-detalhe-rot">
        Alertas
      </span>
      <div className="tarefas-detalhe-etiquetas">
        {alertasEmOrdem(alertas).map((m) => (
          <ChipQueSai
            key={m}
            texto={formatarAntes(m)}
            rotuloTirar={`Tirar o alerta ${formatarAntes(m)}`}
            aoTirar={() => aoMudar(alertas.filter((a) => a !== m))}
          />
        ))}
        {pondo ? (
          <span className="tarefas-detalhe-lista tarefas-detalhe-lista--curta">
            <label htmlFor={idLista} className="so-leitor">
              Novo alerta
            </label>
            <select
              id={idLista}
              autoFocus
              value=""
              onBlur={() => setPondo(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  // Desistir do alerta não fecha o detalhe.
                  e.preventDefault();
                  setPondo(false);
                }
              }}
              onChange={(e) => {
                setPondo(false);
                if (e.target.value !== "") aoMudar([...alertas, Number(e.target.value)]);
              }}
            >
              <option value="" disabled>
                Escolha quando
              </option>
              {faltam.map((m) => (
                <option key={m} value={m}>
                  {formatarAntes(m)}
                </option>
              ))}
            </select>
          </span>
        ) : (
          alertas.length < MAXIMO_ALERTAS &&
          faltam.length > 0 && (
            <Botao tamanho="pequeno" onClick={() => setPondo(true)}>
              + Alerta
            </Botao>
          )
        )}
      </div>
    </div>
  );
}

/**
 * O evento de outro calendário (DetalheEventoLeitura.dc.html): só leitura, com o pedido à Alba.
 * O pedido vai para a conversa com ela; mudar no Google é ação `externo`, que ela só faz com a sua
 * aprovação, lá na conversa.
 */
function EventoSoLeitura({
  evento,
  calendario,
  fuso,
  aoFechar,
}: {
  evento: EventoAgenda;
  calendario: Calendario | null;
  fuso: string;
  aoFechar: () => void;
}) {
  const { ir } = useAcoesSistema();
  const idPedido = useId();
  const [pedindo, setPedindo] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const campos: [string, string][] = [
    ["Calendário", calendarioPorExtenso(calendario)],
    ["Quando", quandoPorExtenso(evento, fuso)],
  ];
  if (evento.recorrencia) {
    const valor = valorDaRepeticao(evento.recorrencia);
    const regra = opcoesRepeticao(evento.recorrencia).find((o) => o.valor === valor);
    campos.push(["Repetir", regra?.rotulo ?? "Repete"]);
  }
  if (evento.alertas.length > 0)
    campos.push(["Alertas", `${alertasEmOrdem(evento.alertas).map(formatarAntes).join(", ")}, do Google`]);
  if (evento.local) campos.push(["Local", evento.local]);
  if (evento.descricao) campos.push(["Descrição", evento.descricao]);

  const pedir = async () => {
    const oQue = texto.trim();
    if (oQue === "" || enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      const conversa = await servico.pedir("conversas.abrir", { agenteId: "alba" });
      await servico.pedir("conversas.enviar", {
        conversaId: conversa.id,
        conteudo: pedidoParaAlba(evento, calendario, fuso, oQue),
      });
      setEnviado(true);
      setTexto("");
    } catch (e) {
      setErro(mensagemDaRecusa(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <PainelDetalhe
      rotulo="Detalhe do evento, só leitura"
      alto={
        <>
          {`Evento · ${calendario?.nome ?? "outro calendário"}`}
          <Selo tom="apagado">só leitura</Selo>
        </>
      }
      aoFechar={aoFechar}
    >
      <h2 className="tarefas-detalhe-titulo-leitura">
        {evento.titulo.trim() === "" ? "Sem título" : evento.titulo}
      </h2>
      <dl className="tarefas-detalhe-campos-leitura">
        {campos.map(([rotulo, valor]) => (
          <div key={rotulo} className="tarefas-detalhe-campo-leitura">
            <dt className="tarefas-detalhe-rot">{rotulo}</dt>
            <dd>{valor}</dd>
          </div>
        ))}
      </dl>
      <div className="tarefas-detalhe-acoes-leitura">
        <Botao aria-expanded={pedindo} onClick={() => setPedindo((p) => !p)}>
          Pedir à Alba para mudar
        </Botao>
      </div>
      {pedindo && (
        <div className="tarefas-detalhe-campo">
          <label htmlFor={idPedido} className="tarefas-detalhe-rot">
            O que mudar?
          </label>
          <div className="tarefas-detalhe-pedido">
            <input
              id={idPedido}
              className="tarefas-detalhe-pedido-entrada"
              autoFocus
              maxLength={2000}
              value={texto}
              placeholder="passar para as 14h, só esta semana"
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void pedir();
                }
              }}
            />
            <span className="tarefas-detalhe-atalho" aria-hidden="true">
              Enter
            </span>
          </div>
        </div>
      )}
      {enviado && (
        <div className="tarefas-detalhe-enviado" role="status">
          <p>
            Pedido enviado à Alba. Antes de mudar no Google, ela mostra o que vai fazer e pede a sua aprovação
            na conversa.
          </p>
          <Botao tamanho="pequeno" onClick={() => ir({ area: "agentes", secao: "alba" })}>
            Abrir a conversa
          </Botao>
        </div>
      )}
      {erro && (
        <p className="tarefas-erro" role="alert">
          {erro}
        </p>
      )}
    </PainelDetalhe>
  );
}
