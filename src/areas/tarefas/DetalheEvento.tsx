import type { Calendario, EventoAgenda, MudancaEvento } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useId, useState } from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { Interruptor } from "../../componentes/Interruptor.tsx";
import { servico } from "../../servico/conexao.ts";
import { formatarAntes } from "../dia.ts";
import { LeituraPendente } from "../FaixaNuno.tsx";
import {
  alertasEmOrdem,
  alertasQueFaltam,
  alternarDiaInteiro,
  MAXIMO_ALERTAS,
  moverInicio,
  opcoesRepeticao,
  quandoNaTela,
  quandoParaGravar,
  useEvento,
  valorDaRepeticao,
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

interface PropsDetalheEvento {
  canal: EstadoConexao;
  id: string;
  fuso: string;
  /** O começo do expediente: a hora do evento que deixa de ser de dia inteiro. */
  horaPadrao: string;
  agora: Date;
  /** Os calendários, para a escolha quando há mais de um; `null` até chegarem. */
  calendarios: readonly Calendario[] | null;
  aoFechar: () => void;
}

/** O detalhe de um evento da agenda, para editar (DetalheEvento.dc.html). */
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
  calendarios: readonly Calendario[] | null;
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

  // Com um calendário só, não há o que escolher.
  const opcoes = calendarios ?? [];

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
      {opcoes.length > 1 && (
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
      <div className="tarefas-detalhe-espaco" />
      <RodapeDetalhe
        apagar={{
          texto: "Apagar evento",
          aoApagar: () => gravacao.gravar(() => servico.pedir("agenda.apagarEvento", { id }), aoFechar),
        }}
        nota="fica 30 dias na Lixeira"
        gravacao={gravacao}
        atualizadoEm={evento.atualizadoEm}
        agora={agora}
      />
    </PainelDetalhe>
  );
}

/** Um calendário na escolha. */
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
  return (
    <label className="tarefas-detalhe-calendario" data-marcada={marcado}>
      <input type="radio" name={nome} checked={marcado} onChange={aoMarcar} />
      <span className="tarefas-detalhe-calendario-nome">{calendario.nome}</span>
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
