import type { SugestaoAplicada } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useId, useState, type CSSProperties } from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { chaveDoEncaixe, proximoEncaixe, type Encaixe } from "../../janelas/painel/foco.ts";
import { useAcoesSistema } from "../../janelas/sistema/primeiro-uso/estado.ts";
import { servico } from "../../servico/conexao.ts";
import {
  falaDaSugestao,
  falaDoGuardado,
  fonteDaAgenda,
  montarColuna,
  useAgendaDoDia,
  type BlocoDaColuna,
} from "./agenda.ts";
import { mensagemDaRecusa, type DadosTarefas } from "./tarefas.ts";

/** O que o "Guardar o bloco" criou: o desfazer da ação `interno`, até `desfazerAte`. */
interface Guardado {
  dia: string;
  texto: string;
  chamadaId: string;
  desfazerAte: string;
}

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
}: {
  canal: EstadoConexao;
  dados: DadosTarefas;
  agora: Date;
}) {
  const leitura = useAgendaDoDia(canal, dados.dia);
  const { ir } = useAcoesSistema();
  const idTitulo = useId();
  const [recusados, setRecusados] = useState<ReadonlySet<string>>(() => new Set());
  const [guardado, setGuardado] = useState<Guardado | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const pronta = leitura.estado === "pronta" ? leitura.dados : null;
  const dia = pronta?.dia ?? dados.dia;
  const doDia = pronta?.agenda.dias.find((d) => d.dia === dia) ?? null;
  const guardadoAgora =
    guardado && guardado.dia === dia && Date.parse(guardado.desfazerAte) > agora.getTime() ? guardado : null;
  const encaixe = guardadoAgora
    ? null
    : proximoEncaixe(doDia, [...dados.atrasadas, ...dados.hoje], null, recusados);
  const coluna = montarColuna({
    ocorrencias: pronta?.agenda.ocorrencias ?? [],
    livres: doDia?.livres ?? [],
    dia,
    fuso: dados.fuso,
    expediente: dados.expediente,
    sugestao: encaixe && { ...encaixe.sugestao, titulo: encaixe.titulo },
    agora,
  });
  const fonte = fonteDaAgenda(pronta?.calendarios ?? []);

  const guardar = (e: Encaixe) => {
    setErro(null);
    servico
      .pedir("agenda.aplicarSugestao", e.sugestao)
      .then(({ chamadaId, desfazerAte }: SugestaoAplicada) =>
        setGuardado({ dia, texto: falaDoGuardado(e, dia, dados.fuso), chamadaId, desfazerAte }),
      )
      .catch((motivo: unknown) => setErro(mensagemDaRecusa(motivo)));
  };
  const desfazer = (g: Guardado) => {
    setErro(null);
    servico
      .pedir("execucoes.desfazer", { chamadaId: g.chamadaId })
      .then(() => setGuardado(null))
      .catch((motivo: unknown) => setErro(mensagemDaRecusa(motivo)));
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
      {coluna.diaTodo.length > 0 && (
        <ul className="tarefas-agenda-dia-todo" aria-label="O dia todo">
          {coluna.diaTodo.map((d) => (
            <li key={d.chave} className="tarefas-agenda-dia-todo-item">
              {d.nome}
            </li>
          ))}
        </ul>
      )}
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
              style={posicaoDoBloco(b, coluna.de)}
            >
              <span className="tarefas-agenda-bloco-nome">{b.nome}</span>
              <span className="tarefas-agenda-bloco-hora">{b.hora}</span>
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
      {(guardadoAgora ?? encaixe) && (
        <section className="tarefas-agenda-sugestao" aria-label="Sugestão da Alba">
          <div className="tarefas-agenda-fala">
            <Personagem agente="alba" modo="cabeca" tamanho="aviso" estado="ocioso" />
            <p>{guardadoAgora ? guardadoAgora.texto : falaDaSugestao(encaixe!, dia, dados.fuso)}</p>
          </div>
          <div className="tarefas-agenda-acoes">
            {guardadoAgora ? (
              <Botao variante="fantasma" tamanho="pequeno" onClick={() => desfazer(guardadoAgora)}>
                Desfazer
              </Botao>
            ) : (
              <>
                <Botao
                  tamanho="pequeno"
                  onClick={() =>
                    setRecusados((atual) => new Set(atual).add(chaveDoEncaixe(encaixe!.sugestao)))
                  }
                >
                  Agora não
                </Botao>
                <Botao variante="primario" tamanho="pequeno" onClick={() => guardar(encaixe!)}>
                  Guardar o bloco
                </Botao>
              </>
            )}
          </div>
        </section>
      )}
      {erro && (
        <p className="tarefas-erro" role="alert">
          {erro}
        </p>
      )}
    </aside>
  );
}
