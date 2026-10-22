import type { Tarefa } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { useCallback, useId, useState } from "react";
import { useAgora } from "../../areas/tempo.ts";
import { Botao } from "../../componentes/Botao.tsx";
import { servico } from "../../servico/conexao.ts";
import { CabecalhoPainel } from "./Cabecalho.tsx";
import { useFuso, useListas, useProximas, useRelida, useTarefasDoDia } from "./dados.ts";
import {
  dataPorExtenso,
  diaNoFuso,
  fusoLocal,
  horaNoFuso,
  inicioDoDia,
  minutosDaHora,
  somarDias,
} from "./dia.ts";
import {
  CampoFrase,
  chaveDoAviso,
  LinhaDesfazer,
  LinhaTarefa,
  marcarTarefa,
  useAvisoDesfazer,
} from "./Dia.tsx";
import { LeituraVazia } from "./PainelHoje.tsx";
import { abrirNoSistema } from "./PedidosSessoes.tsx";
import { deCima, feitasDoDia, ordemDoDia } from "./tarefas.ts";

/** Até quantos dias o pé do painel conta as próximas ("Próximos 7 dias · 15"). */
export const DIAS_DAS_PROXIMAS = 7;

/** "Trazer as 2 para hoje", verbo com objeto; uma só, "Trazer para hoje". */
export const trazerParaHoje = (n: number) => (n === 1 ? "Trazer para hoje" : `Trazer as ${n} para hoje`);

/**
 * O painel Tarefas do dock (PainelTarefas.dc.html): adicionar por frase com o "Entendi:" antes do
 * Enter, as atrasadas com "Trazer para hoje", as de hoje com a caixa para marcar, o "feita.
 * Desfazer" da última e, no pé, as próximas e os lembretes do dia, que abrem a área no Sistema.
 */
export function PainelTarefas({ canal, abertura }: { canal: EstadoConexao; abertura: number }) {
  const agora = useAgora();
  const fuso = useFuso(canal) ?? fusoLocal();
  const hoje = diaNoFuso(agora, fuso);
  const minutoAgora = minutosDaHora(horaNoFuso(agora, fuso));
  const listas = useListas(canal, abertura);
  const tarefas = useTarefasDoDia(canal, hoje, abertura);
  const proximas = useProximas(canal, hoje, abertura);
  // Os lembretes do dia inteiro, no fuso: o intervalo muda só na virada do dia.
  const pedirLembretes = useCallback(
    () =>
      servico.pedir("lembretes.listar", {
        de: inicioDoDia(hoje, fuso).toISOString(),
        ate: inicioDoDia(somarDias(hoje, 1), fuso).toISOString(),
      }),
    [hoje, fuso],
  );
  const lembretes = useRelida(canal, pedirLembretes, "lembretes.mudou", abertura);
  const [aviso, setAviso] = useAvisoDesfazer();
  const [erro, setErro] = useState<string | null>(null);
  const [trazendo, setTrazendo] = useState(false);
  const idAtrasadas = useId();
  const idHoje = useId();

  const doDia = tarefas.estado === "pronta" ? tarefas.dados : null;
  const atrasadas = deCima(doDia?.atrasadas ?? []);
  const deHoje = ordemDoDia(deCima(doDia?.hoje ?? []).filter((t) => t.estado !== "cancelada"));
  const contagem = feitasDoDia(deHoje);
  const limite = somarDias(hoje, DIAS_DAS_PROXIMAS);
  const nasProximas =
    proximas.estado === "pronta"
      ? deCima(proximas.dados).filter((t) => t.venceEm !== null && t.venceEm <= limite).length
      : null;
  const doDiaLembretes = lembretes.estado === "pronta" ? lembretes.dados.length : null;

  const marcar = (tarefa: Tarefa, feita: boolean) => {
    setErro(null);
    marcarTarefa(tarefa, feita, setAviso, setErro);
  };
  const trazer = () => {
    if (trazendo || atrasadas.length === 0) return;
    setTrazendo(true);
    setErro(null);
    servico
      .pedir("tarefas.adiar", { ids: atrasadas.map((t) => t.id), para: "hoje" })
      .catch(() => setErro("Não consegui trazer para hoje agora. Tente de novo."))
      .finally(() => setTrazendo(false));
  };
  const linha = (t: Tarefa) => (
    <LinhaTarefa
      key={t.id}
      tarefa={t}
      listas={listas}
      hoje={hoje}
      minutoAgora={minutoAgora}
      aoMarcar={marcar}
    />
  );

  return (
    <>
      <CabecalhoPainel titulo="Tarefas" subtitulo={`Alba · ${dataPorExtenso(hoje)}`} sistema="tarefas" />
      <div className="painel-corpo">
        <CampoFrase
          rotulo="Adicionar por frase"
          rotuloVisivel
          comIcone
          placeholder="ligar pro banco amanhã 15h"
          aoLancar={setAviso}
        />

        <LeituraVazia leitura={tarefas} lendo="Lendo as tarefas." />

        {atrasadas.length > 0 && (
          <section className="painel-secao dia-tarefas" aria-labelledby={idAtrasadas}>
            <header className="painel-secao-cabecalho dia-atrasadas-cabecalho">
              <h2 id={idAtrasadas} className="painel-secao-titulo dia-atrasadas-titulo">
                <span className="lembrete-ponto" aria-hidden="true" />
                {`Atrasadas · ${atrasadas.length}`}
              </h2>
              <Botao tamanho="pequeno" disabled={trazendo} onClick={trazer}>
                {trazerParaHoje(atrasadas.length)}
              </Botao>
            </header>
            <ul className="tarefas-lista">{atrasadas.map(linha)}</ul>
          </section>
        )}

        {doDia && (
          <section className="painel-secao dia-tarefas" aria-labelledby={idHoje}>
            <header className="painel-secao-cabecalho">
              <h2 id={idHoje} className="painel-secao-titulo">
                Hoje
              </h2>
              {contagem.total > 0 && <span>{`${contagem.feitas} de ${contagem.total} feitas`}</span>}
            </header>
            {deHoje.length === 0 ? (
              <p className="dia-vazio">
                Nada para hoje. Escreva acima o que precisa fazer, com dia e hora se quiser: &quot;pagar a
                fatura sexta 10h&quot;.
              </p>
            ) : (
              <ul className="tarefas-lista">{deHoje.map(linha)}</ul>
            )}
          </section>
        )}

        {erro && (
          <p className="dia-erro" role="alert">
            {erro}
          </p>
        )}
        {aviso && <LinhaDesfazer key={chaveDoAviso(aviso)} aviso={aviso} aoAcabar={() => setAviso(null)} />}

        <footer className="dia-pe">
          <button type="button" className="dia-link" onClick={() => abrirNoSistema("tarefas")}>
            {nasProximas === null
              ? `Próximos ${DIAS_DAS_PROXIMAS} dias`
              : `Próximos ${DIAS_DAS_PROXIMAS} dias · ${nasProximas}`}
          </button>
          <button type="button" className="dia-link" onClick={() => abrirNoSistema("tarefas")}>
            {doDiaLembretes === null ? "Lembretes" : `Lembretes · ${doDiaLembretes}`}
          </button>
        </footer>
      </div>
    </>
  );
}
