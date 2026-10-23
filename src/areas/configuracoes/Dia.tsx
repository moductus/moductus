import {
  fusoDoSistema,
  type CiclosFoco,
  type ConfigDia,
  type Expediente,
  type MudancaRotina,
  type Rotina,
} from "@moductus/contrato";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Atalho } from "../../componentes/Atalho.tsx";
import { Botao } from "../../componentes/Botao.tsx";
import { Campo } from "../../componentes/Campo.tsx";
import { Cartao } from "../../componentes/Cartao.tsx";
import { FalaAgente } from "../../componentes/FalaAgente.tsx";
import { Icone } from "../../componentes/Icone.tsx";
import { Interruptor } from "../../componentes/Interruptor.tsx";
import { Aviso, Carregando } from "./Partes.tsx";
import { Secao } from "./Secao.tsx";
import { useConfig } from "./useConfig.ts";
import { useRotinas } from "./useRotinas.ts";
import {
  DIAS_DA_SEMANA,
  alternarDia,
  avisoDaHoraDeParar,
  diaDaSemanaNoFuso,
  etapasDaRodada,
  opcoesDeFuso,
  opcoesDoCiclo,
  resumoDaRodada,
  type CampoCiclo,
} from "./dia.ts";

const TITULO = "O dia";
const INTRO =
  "Quando a Alba abre e fecha o seu dia, o expediente em que ela procura horário livre e o tempo do foco.";

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** O horário fixo que aparece antes de você escolher um (ConfigDia.dc.html). */
export const HORA_FIXA_SUGERIDA = "08:30";

export const MENSAGEM_EXPEDIENTE_AO_CONTRARIO = "O expediente termina depois de começar.";

interface PropsCampoHora {
  rotulo: string;
  valor: string;
  desativado: boolean;
  /** Só a hora completa chega aqui; o que é digitado pela metade fica no campo. */
  aoMudar: (hora: string) => void;
}

/** Hora `HH:MM` em fonte mono; o rótulo fica para o leitor de tela, a frase em volta diz o resto. */
function CampoHora({ rotulo, valor, desativado, aoMudar }: PropsCampoHora) {
  const [rascunho, setRascunho] = useState(valor);
  // A hora que chega de fora (outra janela, o Desfazer) troca o que estava no campo.
  const [vista, setVista] = useState(valor);
  if (valor !== vista) {
    setVista(valor);
    setRascunho(valor);
  }
  return (
    <Campo
      rotulo={rotulo}
      rotuloOculto
      className="config-dia-hora"
      type="time"
      value={rascunho}
      disabled={desativado}
      onChange={(e) => {
        setRascunho(e.target.value);
        if (HORA.test(e.target.value) && e.target.value !== valor) aoMudar(e.target.value);
      }}
    />
  );
}

interface PropsLista<T extends string | number> {
  rotulo: string;
  valor: T;
  opcoes: readonly { valor: T; rotulo: string }[];
  desativada: boolean;
  aoMudar: (valor: string) => void;
}

/** Lista suspensa nativa com rótulo em cima, como o "Onde" das Notificações, na altura do campo. */
function Lista<T extends string | number>({ rotulo, valor, opcoes, desativada, aoMudar }: PropsLista<T>) {
  const id = useId();
  return (
    <div className="config-dia-campo">
      <label htmlFor={id} className="config-dia-rotulo">
        {rotulo}
      </label>
      <span className="config-lista config-dia-lista" data-desativada={desativada || undefined}>
        <select id={id} value={valor} disabled={desativada} onChange={(e) => aoMudar(e.target.value)}>
          {opcoes.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
        <Icone nome="abrirLista" tamanho={12} />
      </span>
    </div>
  );
}

/** O título do cartão e, à direita, o que vai ao lado dele. */
function Cabeca({ id, titulo, children }: { id: string; titulo: string; children?: ReactNode }) {
  return (
    <div className="config-dia-cabeca">
      <h3 id={id} className="config-dia-titulo">
        {titulo}
      </h3>
      {children}
    </div>
  );
}

function Ligado({ rotulo, rotina, desativado, definir }: PropsRotina & { rotulo: string }) {
  return (
    <span className="config-dia-ligado">
      <span aria-hidden="true">{rotina.ativa ? "ligado" : "desligado"}</span>
      <Interruptor
        aria-label={rotulo}
        ligado={rotina.ativa}
        desativado={desativado}
        aoMudar={(ativa) => void definir({ id: rotina.id, ativa })}
      />
    </span>
  );
}

interface PropsRotina {
  rotina: Rotina;
  desativado: boolean;
  definir: (mudanca: MudancaRotina) => Promise<Rotina | null>;
}

function Briefing({ rotina, desativado, definir }: PropsRotina) {
  const id = useId();
  // A última hora fixa fica no campo quando o briefing volta à primeira atividade.
  const [horaFixa, setHoraFixa] = useState(rotina.hora ?? HORA_FIXA_SUGERIDA);
  const [vista, setVista] = useState(rotina.hora);
  if (rotina.hora !== vista) {
    setVista(rotina.hora);
    if (rotina.hora !== null) setHoraFixa(rotina.hora);
  }
  const fixo = rotina.hora !== null;
  const travado = desativado || !rotina.ativa;
  return (
    <Cartao como="section" className="config-dia-cartao" aria-labelledby={id}>
      <Cabeca id={id} titulo="Briefing da manhã">
        <Ligado rotulo="Briefing da manhã" rotina={rotina} desativado={desativado} definir={definir} />
      </Cabeca>
      <fieldset className="config-dia-modos" disabled={travado}>
        <legend className="so-leitor">Quando o briefing aparece</legend>
        <div className="config-dia-modo" data-marcada={!fixo}>
          <label className="config-dia-modo-escolha">
            <input
              type="radio"
              name={`${id}-quando`}
              checked={!fixo}
              disabled={travado}
              onChange={() => void definir({ id: rotina.id, hora: null })}
            />
            <span className="config-dia-modo-textos">
              <span className="config-dia-modo-nome">Na primeira atividade do dia</span>
              <span className="config-dia-rotulo">
                Ao desbloquear ou voltar da suspensão, depois das 05:00.
              </span>
            </span>
          </label>
        </div>
        <div className="config-dia-modo" data-marcada={fixo}>
          <label className="config-dia-modo-escolha">
            <input
              type="radio"
              name={`${id}-quando`}
              checked={fixo}
              disabled={travado}
              onChange={() => void definir({ id: rotina.id, hora: horaFixa })}
            />
            <span className="config-dia-modo-textos">
              <span className="config-dia-modo-nome">Num horário fixo</span>
              <span className="config-dia-rotulo">Para quem deixa o PC ligado direto.</span>
            </span>
          </label>
          <CampoHora
            rotulo="Horário fixo do briefing"
            valor={horaFixa}
            desativado={travado}
            aoMudar={(hora) => {
              setHoraFixa(hora);
              void definir({ id: rotina.id, hora });
            }}
          />
        </div>
      </fieldset>
      <p className="config-dia-rotulo">Desligado, os avisos de prazo, limite e orçamento continuam.</p>
    </Cartao>
  );
}

function Fechamento({ rotina, desativado, definir, fuso }: PropsRotina & { fuso: string }) {
  const id = useId();
  /** A troca da hora de parar desde que a seção abriu: `de` é a hora de antes, para o Desfazer. */
  const [troca, setTroca] = useState<{ de: string; para: string } | null>(null);
  const hora = rotina.hora ?? "";
  const valeHoje = rotina.ativa && rotina.diasSemana.includes(diaDaSemanaNoFuso(new Date(), fuso));

  const mudar = async (para: string) => {
    const de = troca?.de ?? hora;
    const feita = await definir({ id: rotina.id, hora: para });
    if (feita) setTroca(feita.hora === de ? null : { de, para: feita.hora ?? para });
  };
  const desfazer = async () => {
    if (!troca) return;
    if (await definir({ id: rotina.id, hora: troca.de })) setTroca(null);
  };

  return (
    <Cartao como="section" className="config-dia-cartao" aria-labelledby={id}>
      <Cabeca id={id} titulo="Fechamento do dia">
        <Ligado rotulo="Fechamento do dia" rotina={rotina} desativado={desativado} definir={definir} />
      </Cabeca>
      <div className="config-dia-linha">
        <span className="config-dia-linha-nome" aria-hidden="true">
          Hora de parar
        </span>
        <CampoHora
          rotulo="Hora de parar"
          valor={hora}
          desativado={desativado || !rotina.ativa}
          aoMudar={(para) => void mudar(para)}
        />
      </div>
      <p className="config-dia-rotulo">
        Adiar dá mais 30 min. Se o PC suspender antes, o fechamento aparece de manhã, como "Ontem", no topo do
        briefing.
      </p>
      <div role="status" className="config-dia-status-lugar">
        {troca && (
          <div className="config-dia-status">
            <span>{avisoDaHoraDeParar(troca.de, troca.para, valeHoje)}</span>
            <Botao
              variante="fantasma"
              tamanho="pequeno"
              disabled={desativado}
              onClick={() => void desfazer()}
            >
              Desfazer
            </Botao>
          </div>
        )}
      </div>
    </Cartao>
  );
}

function CartaoExpediente({
  expediente,
  desativado,
  aoMudar,
}: {
  expediente: Expediente;
  desativado: boolean;
  aoMudar: (expediente: Expediente) => void;
}) {
  const id = useId();
  const [erro, setErro] = useState<string | null>(null);
  const mudar = (parte: Partial<Expediente>) => {
    const novo = { ...expediente, ...parte };
    if (novo.fim <= novo.inicio) {
      setErro(MENSAGEM_EXPEDIENTE_AO_CONTRARIO);
      return;
    }
    setErro(null);
    aoMudar(novo);
  };
  return (
    <Cartao como="section" className="config-dia-cartao" aria-labelledby={id}>
      <Cabeca id={id} titulo="Expediente">
        <span className="config-dia-rotulo">para achar horário livre</span>
      </Cabeca>
      <div className="config-dia-expediente">
        <span aria-hidden="true">Das</span>
        <CampoHora
          rotulo="Começo do expediente"
          valor={expediente.inicio}
          desativado={desativado}
          aoMudar={(inicio) => mudar({ inicio })}
        />
        <span aria-hidden="true">às</span>
        <CampoHora
          rotulo="Fim do expediente"
          valor={expediente.fim}
          desativado={desativado}
          aoMudar={(fim) => mudar({ fim })}
        />
        <span className="config-dia-rotulo">nos dias de trabalho</span>
      </div>
      {erro && <Aviso>{erro}</Aviso>}
      <FalaAgente agente="alba" tamanho="aviso">
        Só sugiro encaixe dentro do expediente, e sempre pergunto antes de mexer na agenda.
      </FalaAgente>
    </Cartao>
  );
}

const CAMPOS_DO_CICLO: readonly { campo: CampoCiclo; rotulo: string }[] = [
  { campo: "focoMin", rotulo: "Foco" },
  { campo: "pausaMin", rotulo: "Pausa" },
  { campo: "pausaLongaMin", rotulo: "Pausa longa" },
  { campo: "ciclosAtePausaLonga", rotulo: "A cada" },
];

function Ciclos({
  ciclos,
  atalho,
  desativado,
  aoMudar,
}: {
  ciclos: CiclosFoco;
  atalho: string;
  desativado: boolean;
  aoMudar: (ciclos: CiclosFoco) => void;
}) {
  const id = useId();
  return (
    <Cartao como="section" className="config-dia-cartao" aria-labelledby={id}>
      <Cabeca id={id} titulo="Ciclos do foco">
        {atalho === "" ? (
          <span className="config-dia-rotulo">sem atalho</span>
        ) : (
          <span className="config-dia-atalho">
            <span className="config-dia-rotulo">iniciar ou pausar</span>
            <Atalho teclas={atalho} />
          </span>
        )}
      </Cabeca>
      <div className="config-dia-ciclos">
        {CAMPOS_DO_CICLO.map(({ campo, rotulo }) => (
          <Lista
            key={campo}
            rotulo={rotulo}
            valor={ciclos[campo]}
            opcoes={opcoesDoCiclo(campo, ciclos[campo])}
            desativada={desativado}
            aoMudar={(valor) => aoMudar({ ...ciclos, [campo]: Number(valor) })}
          />
        ))}
      </div>
      <div className="config-dia-segmentos" aria-hidden="true">
        {etapasDaRodada(ciclos).map((e, i) => (
          <span key={i} className="config-dia-segmento" data-tipo={e.tipo} style={{ flexGrow: e.minutos }} />
        ))}
      </div>
      <p className="config-dia-rotulo">{resumoDaRodada(ciclos)} Mudar vale a partir do próximo ciclo.</p>
    </Cartao>
  );
}

/**
 * Configurações › O dia (ConfigDia.dc.html): os dias de trabalho e o fuso; quando o briefing
 * aparece e a hora de parar (as rotinas, que o serviço rearma no relógio do dia: vale já hoje); o
 * expediente em que a Alba procura horário livre; e os ciclos do foco.
 */
export function SecaoDia() {
  const { estado, conectado, erro: erroConfig, definir: definirConfig } = useConfig();
  const rotinas = useRotinas();
  // O deslocamento de cada fuso é o de agora (horário de verão incluído); a lista é montada uma vez.
  const [agora] = useState(() => new Date());
  const fuso = estado?.config.dia.fuso ?? null;
  const fusos = useMemo(() => (fuso ? opcoesDeFuso(fuso, fusoDoSistema(), agora) : []), [fuso, agora]);
  const idDias = useId();

  if (!estado || !rotinas.rotinas) {
    return (
      <Secao titulo={TITULO} intro={INTRO}>
        <Carregando />
      </Secao>
    );
  }
  const dia = estado.config.dia;
  const travado = !conectado || !rotinas.conectado;
  const briefing = rotinas.rotinas.find((r) => r.tipo === "briefing") ?? null;
  const fechamento = rotinas.rotinas.find((r) => r.tipo === "fechamento") ?? null;
  const primeira = briefing ?? fechamento;
  const dias = primeira?.diasSemana ?? [];
  const mudarDia = (parte: Partial<ConfigDia>) => void definirConfig({ dia: { ...dia, ...parte } });
  const erro = rotinas.erro ?? erroConfig;

  return (
    <Secao titulo={TITULO} intro={INTRO}>
      <Cartao className="config-dia-topo">
        {primeira && (
          <fieldset className="config-dia-dias" aria-describedby={`${idDias}-dica`}>
            <legend className="config-dia-titulo">Dias de trabalho</legend>
            <div className="config-dia-semana">
              {DIAS_DA_SEMANA.map((d) => {
                const ligado = dias.includes(d.numero);
                const proximos = alternarDia(dias, d.numero);
                return (
                  <button
                    key={d.numero}
                    type="button"
                    className="config-dia-semana-dia"
                    aria-label={d.nome}
                    aria-pressed={ligado}
                    disabled={travado || proximos === null}
                    onClick={() => {
                      if (proximos) void rotinas.definir({ id: primeira.id, diasSemana: proximos });
                    }}
                  >
                    {d.curto}
                  </button>
                );
              })}
            </div>
            <span id={`${idDias}-dica`} className="config-dia-rotulo">
              Valem para o briefing, o fechamento e o expediente.
            </span>
          </fieldset>
        )}
        <div className="config-dia-fuso">
          <Lista
            rotulo="Fuso horário"
            valor={dia.fuso}
            opcoes={fusos}
            desativada={travado}
            aoMudar={(novo) => mudarDia({ fuso: novo })}
          />
        </div>
      </Cartao>
      {erro && <Aviso>{erro}</Aviso>}
      <div className="config-dia-grade">
        {briefing && <Briefing rotina={briefing} desativado={travado} definir={rotinas.definir} />}
        {fechamento && (
          <Fechamento rotina={fechamento} desativado={travado} definir={rotinas.definir} fuso={dia.fuso} />
        )}
        <CartaoExpediente
          expediente={dia.expediente}
          desativado={travado}
          aoMudar={(expediente) => mudarDia({ expediente })}
        />
        <Ciclos
          ciclos={dia.foco}
          atalho={estado.config.atalhos.foco}
          desativado={travado}
          aoMudar={(foco) => mudarDia({ foco })}
        />
      </div>
    </Secao>
  );
}
