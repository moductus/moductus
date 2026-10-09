import type {
  CanalNotificacao,
  NivelNotificacao,
  PreferenciaNotificacao,
  Silencio,
} from "@moductus/contrato";
import { Campo } from "../../componentes/Campo.tsx";
import { Interruptor } from "../../componentes/Interruptor.tsx";
import { AGENTES, DADOS_AGENTES, type Agente } from "../../componentes/personagem/agentes.ts";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { Seletor, type OpcaoSeletor } from "../../componentes/Seletor.tsx";
import { Aviso, Carregando, Grupo, Opcao } from "./Partes.tsx";
import { Secao } from "./Secao.tsx";
import { useConfig } from "./useConfig.ts";
import { useNotificacoes } from "./useNotificacoes.ts";

const NIVEIS: readonly OpcaoSeletor<NivelNotificacao>[] = [
  { valor: "tudo", rotulo: "Tudo" },
  { valor: "so_o_que_precisa", rotulo: "Só o que precisa de mim" },
  { valor: "nada", rotulo: "Nada" },
];

const CANAIS: readonly OpcaoSeletor<CanalNotificacao>[] = [
  { valor: "ambos", rotulo: "Windows e dock" },
  { valor: "windows", rotulo: "Só o Windows" },
  { valor: "dock", rotulo: "Só o ponto no dock" },
];

/** O que cada agente costuma avisar (AreaNotificacoes.dc.html). */
const EXEMPLOS: Readonly<Record<Agente, string>> = {
  alba: "lembretes, briefing",
  tula: "vencimentos, orçamento",
  faina: "prévias para aprovar",
  nuno: "sessões, CI, limites",
};

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "07:30" vira "7:30", como o quadro escreve. */
const hora = (valor: string) => valor.replace(/^0(\d)/, "$1");

const desativadas = <T extends string>(opcoes: readonly OpcaoSeletor<T>[], desativar: boolean) =>
  desativar ? opcoes.map((o) => ({ ...o, desativada: true })) : opcoes;

/**
 * O valor que vale para todos os tipos do agente, ou `null` quando a preferência foi mudada só
 * para um tipo (aí nenhum segmento fica marcado e a linha diz que varia).
 */
function unico<T>(
  preferencias: readonly PreferenciaNotificacao[],
  campo: (p: PreferenciaNotificacao) => T,
): T | null {
  const valores = new Set(preferencias.map(campo));
  return valores.size === 1 ? (valores.values().next().value ?? null) : null;
}

/**
 * Notificações (AreaNotificacoes.dc.html): por agente, quanto avisar e onde; o silêncio do aviso
 * do Windows (horário, tela cheia, foco) e o início com o Windows. A tela muda os cinco tipos do
 * agente de uma vez; quem decide o que sai é o serviço.
 */
export function SecaoNotificacoes() {
  const notificacoes = useNotificacoes();
  const { estado: config, conectado, erro: erroConfig, definir: definirConfig } = useConfig();
  const { estado } = notificacoes;
  if (!estado || !config) {
    return (
      <Secao titulo="Notificações">
        <Carregando />
      </Secao>
    );
  }
  const travado = !conectado || !notificacoes.conectado;
  const { silencio, autostart } = config.config;
  const mudarSilencio = (parte: Partial<Silencio>) =>
    void definirConfig({ silencio: { ...silencio, ...parte } });
  const mudarHorario = (parte: Partial<Silencio["horario"]>) =>
    mudarSilencio({ horario: { ...silencio.horario, ...parte } });
  const erro = notificacoes.erro ?? erroConfig;

  return (
    <Secao titulo="Notificações">
      <p className="config-intro">
        Com "nada", o agente continua trabalhando. Você vê tudo no histórico e no dock quando quiser.
      </p>
      <Grupo titulo="Por agente">
        {AGENTES.map((agente) => {
          const doAgente = estado.preferencias.filter((p) => p.agenteId === agente);
          if (doAgente.length === 0) return null;
          const nivel = unico(doAgente, (p) => p.nivel);
          const canal = unico(doAgente, (p) => p.canal);
          const nome = DADOS_AGENTES[agente].nome;
          const variado = nivel === null || canal === null;
          // Muda só o campo escolhido: se o outro varia por tipo, cada tipo guarda o seu.
          const mudar = (parte: { nivel?: NivelNotificacao; canal?: CanalNotificacao }) => {
            if (nivel !== null && canal !== null) {
              void notificacoes.definir({ agenteId: agente, nivel, canal, ...parte });
              return;
            }
            for (const p of doAgente) {
              void notificacoes.definir({
                agenteId: agente,
                tipo: p.tipo,
                nivel: parte.nivel ?? p.nivel,
                canal: parte.canal ?? p.canal,
              });
            }
          };
          return (
            <Opcao
              key={agente}
              titulo={nome}
              descricao={variado ? `${EXEMPLOS[agente]} · varia por tipo` : EXEMPLOS[agente]}
            >
              <div className="config-notificacao-controles">
                <Seletor
                  rotulo={`Avisar de ${nome}`}
                  opcoes={desativadas(NIVEIS, travado)}
                  valor={nivel ?? ("" as NivelNotificacao)}
                  aoMudar={(novo) => mudar({ nivel: novo })}
                />
                <Seletor
                  rotulo={`Onde avisar de ${nome}`}
                  opcoes={desativadas(CANAIS, travado || nivel === "nada")}
                  valor={canal ?? ("" as CanalNotificacao)}
                  aoMudar={(novo) => mudar({ canal: novo })}
                />
              </div>
            </Opcao>
          );
        })}
        <p className="config-nota">"Só o que precisa de mim" = pedidos de aprovação, lembretes e erros.</p>
      </Grupo>
      <Grupo titulo="Silêncio">
        <Opcao
          titulo="Horário de silêncio"
          descricao={`das ${hora(silencio.horario.inicio)} às ${hora(silencio.horario.fim)}`}
        >
          <Interruptor
            aria-label="Horário de silêncio"
            ligado={silencio.horario.ligado}
            desativado={!conectado}
            aoMudar={(ligado) => mudarHorario({ ligado })}
          />
        </Opcao>
        {silencio.horario.ligado && (
          <div className="config-horario">
            <Campo
              rotulo="Começa às"
              type="time"
              value={silencio.horario.inicio}
              disabled={!conectado}
              onChange={(e) => {
                if (HORA.test(e.target.value)) mudarHorario({ inicio: e.target.value });
              }}
            />
            <Campo
              rotulo="Termina às"
              type="time"
              value={silencio.horario.fim}
              disabled={!conectado}
              onChange={(e) => {
                if (HORA.test(e.target.value)) mudarHorario({ fim: e.target.value });
              }}
            />
          </div>
        )}
        <Opcao titulo="Em tela cheia e apresentação" descricao="jogos, vídeos, compartilhamento de tela">
          <Interruptor
            aria-label="Silêncio em tela cheia e apresentação"
            ligado={silencio.telaCheia}
            desativado={!conectado}
            aoMudar={(telaCheia) => mudarSilencio({ telaCheia })}
          />
        </Opcao>
        <Opcao titulo="Durante o foco" descricao="menos aprovações e lembretes">
          <Interruptor
            aria-label="Silêncio durante o foco"
            ligado={silencio.foco}
            desativado={!conectado}
            aoMudar={(foco) => mudarSilencio({ foco })}
          />
        </Opcao>
        <Opcao
          titulo="Iniciar com o Windows"
          descricao={
            config.portable
              ? "Indisponível no modo portable: esta cópia não se registra no Windows."
              : "os agentes só vigiam com o app aberto"
          }
        >
          <Interruptor
            aria-label="Iniciar o Moductus junto com o Windows"
            ligado={autostart}
            desativado={config.portable || !conectado}
            aoMudar={(ligado) => void definirConfig({ autostart: ligado })}
          />
        </Opcao>
      </Grupo>
      {erro && <Aviso>{erro}</Aviso>}
      <Grupo titulo="Prévia de um aviso do Windows">
        {/* Só para ver como sai: os botões do aviso são os do cartão de aprovação. */}
        <div className="config-previa-aviso" aria-hidden="true">
          <Personagem agente="faina" modo="cabeca" tamanho="dock" estado="esperando" />
          <div className="config-previa-aviso-textos">
            <div className="config-previa-aviso-cabeca">
              <span>Moductus · Faina</span>
              <span>agora</span>
            </div>
            <strong className="config-previa-aviso-titulo">Organizar Downloads</strong>
            <span>142 arquivos em 6 pastas. A lista está no painel.</span>
            <div className="config-previa-aviso-botoes">
              <span>Ver lista</span>
              <span data-primario="">Organizar 142 arquivos</span>
            </div>
          </div>
        </div>
      </Grupo>
    </Secao>
  );
}
