import { mkdirSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { VERSAO_PROTOCOLO, type EstadoConfig } from "@moductus/contrato";
import { RepositorioAgentes, ServicoAgentes } from "./agentes/agentes.ts";
import { autorizarPorAprovacao } from "./agentes/autorizar.ts";
import { RepositorioExecucoes, ServicoExecucoes } from "./agentes/execucoes.ts";
import { aberturaMcpDoRuntime } from "./agentes/mcp.ts";
import { classificadorPeloRuntime, Roteador } from "./agentes/roteador.ts";
import { encerrarInterrompidas, Runtime } from "./agentes/runtime.ts";
import { VigiaAlba } from "./agentes/vigias/alba.ts";
import { RepositorioMarcasDosVigias } from "./agentes/vigias/marcas.ts";
import { VigiaNuno } from "./agentes/vigias/nuno.ts";
import { Agendador, RepositorioDisparos } from "./agendador/agendador.ts";
import { abrirServidorWs, semAtendente, type ServidorWs } from "./api/servidor.ts";
import { RepositorioAprovacoes, ServicoAprovacoes } from "./aprovacoes/aprovacoes.ts";
import { RepositorioAgenda, ServicoAgenda } from "./areas/agenda/agenda.ts";
import { RepositorioTarefasDoDia } from "./areas/agenda/tarefas-do-dia.ts";
import { ServicoCaptura } from "./areas/captura/captura.ts";
import { atendentesDaCaptura } from "./areas/captura/canal.ts";
import { interpretePeloRuntime } from "./areas/captura/modelo.ts";
import { ServicoContagens, sessoesEsperando } from "./areas/contagens.ts";
import {
  motivoDaCasca,
  PrimeiraAtividade,
  RepositorioAtividade,
  type MotivoAtividade,
} from "./areas/dia/atividade.ts";
import { RelogioDoDia } from "./areas/dia/relogio.ts";
import { TempoDoDia } from "./areas/dia/tempo.ts";
import { atendentesDoFoco, ouvirAtalhoDoFoco } from "./areas/foco/canal.ts";
import { RepositorioFoco, ServicoFoco } from "./areas/foco/foco.ts";
import { RepositorioLembretes, ServicoLembretes } from "./areas/lembretes/lembretes.ts";
import { RepositorioNotas, ServicoNotas } from "./areas/notas/notas.ts";
import { atendentesDasTarefas } from "./areas/tarefas/canal.ts";
import { RepositorioTarefas } from "./areas/tarefas/repositorio.ts";
import { ServicoTarefas } from "./areas/tarefas/tarefas.ts";
import { abrirBanco, pastaDeDados, portable } from "./banco/conexao.ts";
import { ligarBandeja } from "./bandeja/bandeja.ts";
import { converterPelaConfig, ServicoCambio, vigiarCotacao } from "./cambio/cambio.ts";
import { abrirPelaCasca, projetosNaCasca } from "./casca/abrir.ts";
import { ambientePelaCasca } from "./casca/ambiente.ts";
import { avisosPelaCasca, CLIQUE_NO_AVISO, lerClique } from "./casca/avisos.ts";
import { CanalCasca } from "./casca/canal.ts";
import { credenciaisPelaCasca } from "./casca/credenciais.ts";
import { RepositorioConfig, ServicoConfig, type AplicadorNativo } from "./config/config.ts";
import { RepositorioConexoes, ServicoConexoes } from "./conexoes/conexoes.ts";
import { RepositorioConversas, ServicoConversas } from "./conversas/conversas.ts";
import { executorGh } from "./conexoes/github/gh.ts";
import { RepositorioGithub, ServicoGithub } from "./conexoes/github/github.ts";
import { ServicoGoogleAgenda } from "./conexoes/google/google-agenda.ts";
import { EspelhoGoogleAgenda, RepositorioEspelhoGoogle } from "./conexoes/google/espelho.ts";
import { EscritaGoogleAgenda } from "./conexoes/google/escrita.ts";
import { LeituraGoogleAgenda, RepositorioLeituraGoogle } from "./conexoes/google/leitura.ts";
import { ferramentasAgenda } from "./ferramentas/agenda/agenda.ts";
import { Catalogo } from "./ferramentas/catalogo.ts";
import { ferramentasFoco } from "./ferramentas/foco/foco.ts";
import { ferramentasGithub } from "./ferramentas/github/github.ts";
import { ferramentasLembretes } from "./ferramentas/lembretes/lembretes.ts";
import { ferramentasNotas } from "./ferramentas/notas/notas.ts";
import { ferramentasSessoes } from "./ferramentas/sessoes/sessoes.ts";
import { ferramentasTarefas } from "./ferramentas/tarefas/tarefas.ts";
import { ferramentasUso } from "./ferramentas/uso/uso.ts";
import { abrirServidorMcp } from "./mcp/servidor.ts";
import { MIGRACOES } from "./migracoes/index.ts";
import { avisarAprovacoes } from "./notificacoes/aprovacoes.ts";
import { avisarContexto, avisarDoVigia } from "./notificacoes/nuno.ts";
import { RepositorioNotificacoes, ServicoNotificacoes } from "./notificacoes/notificacoes.ts";
import { ServicoOutroPc } from "./outro-pc/outro-pc.ts";
import { RepositorioPrimeiroUso, ServicoPrimeiroUso } from "./primeiro-uso/primeiro-uso.ts";
import { fabricaClaudeCli, rotaPreToolUse, type AberturaMcp } from "./provedores/claude-cli/claude-cli.ts";
import { detectar } from "./provedores/deteccao.ts";
import { fabricaOpenAiCompativel } from "./provedores/openai-compativel/openai-compativel.ts";
import { RepositorioProvedores, ServicoProvedores } from "./provedores/provedores.ts";
import { RegistroProvedores } from "./provedores/registro.ts";
import { TRANSCRIPTS_DO_DISCO } from "./sessoes/contexto.ts";
import { caminhoSettingsClaude, LigacaoClaudeCode } from "./sessoes/ligacao.ts";
import { atenderHooks } from "./sessoes/permissao.ts";
import { abrirReceptorHooks, portaDosHooks } from "./sessoes/receptor.ts";
import { RepositorioSessoes, ServicoSessoes } from "./sessoes/sessoes.ts";
import { tokenDosHooks } from "./sessoes/token.ts";
import pacote from "../package.json" with { type: "json" };

/**
 * moductus-servico: sobe pela casca como sidecar. Recebe a pasta de dados e o token
 * por variável de ambiente, abre o servidor em 127.0.0.1 numa porta aleatória e avisa
 * a casca pelo stdout. Se cair, a casca sobe outro.
 */
const banco = abrirBanco(pastaDeDados());
const canal = new CanalCasca(process.stdout);
canal.ouvir(process.stdin);

const token = process.env.MODUCTUS_TOKEN;
if (!token) {
  console.error("MODUCTUS_TOKEN ausente: o serviço só sobe pela casca");
  process.exit(1);
}

/** A casca aplica o que é nativo e responde { ok, falhas_atalhos } ou { erro }. */
const nativo: AplicadorNativo = {
  async aplicar(config, mudou) {
    const r = await canal.pedir<{ erro?: string; falhas_atalhos?: Record<string, string> }>({
      tipo: "aplicar",
      config,
      mudou,
    });
    if (r.erro) throw new Error(r.erro);
    return { falhasAtalhos: r.falhas_atalhos ?? {} };
  },
};

let servidor: ServidorWs | null = null;
// Os vigias do Nuno (F2-26) nascem com o runtime; os eventos de antes disso não pedem julgamento.
let vigiaNuno: VigiaNuno | null = null;
// Os vigias da Alba (F3-28) nascem com o relógio do dia; a agenda que muda antes disso não perde nada.
let vigiaAlba: VigiaAlba | null = null;
// O foco (F3-18) nasce com o relógio do dia, mais adiante; até lá, ninguém está em foco.
let foco: ServicoFoco | null = null;
const repositorioConfig = new RepositorioConfig(banco);
// A cotação nova vale já (F3-08), venha de config.definir ou de config.importar: os dois passam
// pelo aviso abaixo. A reação (acordar quem saiu do teto) nasce com o runtime, mais adiante.
let reagirACotacao: () => void = () => {};
const cotacaoMudou = vigiarCotacao(repositorioConfig.ler().cambio, () => reagirACotacao());
// As contagens das áreas (F3-20) nascem depois das áreas que contam; até lá, recontar não faz nada.
let recontarAreas: () => void = () => {};
const config = new ServicoConfig(
  repositorioConfig,
  nativo,
  (estado: EstadoConfig) => {
    servidor?.emitir("config.mudou", estado);
    cotacaoMudou(estado.config.cambio);
    // O fuso pode ter mudado: o "hoje" das tarefas muda junto.
    recontarAreas();
  },
  portable(),
);
const primeiroUso = new ServicoPrimeiroUso(new RepositorioPrimeiroUso(banco), (estado) =>
  servidor?.emitir("primeiroUso.mudou", estado),
);
const outroPc = new ServicoOutroPc(config, banco, {
  versaoApp: pacote.version,
  versaoEsquema: MIGRACOES.length,
  pcOrigem: hostname(),
});
// Notificações (F2-20): preferência por agente e tipo, ponto no dock e aviso do Windows pela casca.
const agentesDoTime = new RepositorioAgentes(banco);
const notificacoes = new ServicoNotificacoes(
  new RepositorioNotificacoes(banco),
  {
    agentes: () => agentesDoTime.agentes().map((a) => ({ id: a.id, nome: a.nome })),
    silencio: () => config.obter().config.silencio,
    windows: avisosPelaCasca(canal),
    // Com um foco correndo, o Windows só mostra aprovações e lembretes; na pausa, tudo volta.
    emFoco: () => foco?.emFoco() ?? false,
  },
  {
    estado: (estado) => servidor?.emitir("notificacoes.mudou", estado),
    nova: (notificacao) => servidor?.emitir("notificacoes.nova", notificacao),
    naoVistas: (lista) => servidor?.emitir("notificacoes.naoVistas", lista),
  },
);
const leituraSessoes = new RepositorioSessoes(banco);
const avisarAprovacao = avisarAprovacoes(
  notificacoes,
  { obter: (id) => aprovacoes.obter(id), decidir: (pedido) => aprovacoes.decidir(pedido) },
  {
    nomeDoAgente: (id) => agentesDoTime.agente(id)?.nome ?? null,
    projetoDaSessao: (id) => {
      const projetoId = leituraSessoes.sessao(id)?.projetoId;
      return projetoId ? (leituraSessoes.projeto(projetoId)?.nome ?? null) : null;
    },
  },
);
canal.aoAvisar(CLIQUE_NO_AVISO, (aviso) => {
  const clique = lerClique(aviso);
  if (!clique) return;
  notificacoes
    .aoClicar(clique.id, clique.botao)
    .catch((erro: unknown) => console.error(`notificações: clique no aviso falhou: ${String(erro)}`));
});
const avisarContextoAoUsuario = avisarContexto(notificacoes);
// A casca só abre arquivo de projeto que conhece (ADR-0038): ela recebe as pastas ao subir e quando
// chega sessão de projeto novo.
const projetosDaCasca = projetosNaCasca(abrirPelaCasca(canal), () => sessoes.projetos());
const sessoes = new ServicoSessoes(
  new RepositorioSessoes(banco),
  (mudanca) => {
    servidor?.emitir("sessoes.mudou", mudanca);
    projetosDaCasca.aoMudarSessao(mudanca.sessao.projetoId);
    vigiaNuno?.aoMudarSessao(mudanca);
    // A missão do Nuno nos Primeiros passos (F2-32): a primeira sessão do Claude Code que chega.
    if (mudanca.sessao.ferramenta === "claude-code") primeiroUso.sessaoDoClaudeCode();
  },
  {
    transcripts: TRANSCRIPTS_DO_DISCO,
    // O aviso de contexto vai às notificações (preferência do Nuno, ponto, Windows) e ao vigia.
    aoAvisarContexto: (aviso) => {
      avisarContextoAoUsuario(aviso);
      vigiaNuno?.aoAvisarContexto(aviso);
    },
  },
);
projetosDaCasca.mandar();
const aprovacoes = new ServicoAprovacoes(new RepositorioAprovacoes(banco), {
  aprovacao: (aprovacao) => {
    servidor?.emitir("aprovacoes.mudou", aprovacao);
    recontarAreas();
    avisarAprovacao(aprovacao).catch((erro: unknown) =>
      console.error(`notificações: aviso da aprovação falhou: ${String(erro)}`),
    );
  },
  regras: (regras) => servidor?.emitir("regras.mudou", regras),
});
// Quem segurava a resposta dos hooks do terminal era o serviço que caiu: esses cartões expiram.
aprovacoes.expirarDoTerminal();
const repositorioConexoes = new RepositorioConexoes(banco);
const github = new ServicoGithub(new RepositorioGithub(banco), repositorioConexoes, executorGh(), {
  github: (situacao) => {
    servidor?.emitir("github.mudou", situacao);
    recontarAreas();
    vigiaNuno?.aoLerGithub(situacao);
  },
  conexao: (conexao) => servidor?.emitir("conexoes.mudou", conexao),
});
// A leitura dos calendários do Google (F3-23) nasce com a agenda, mais adiante: ela sabe da conexão
// pelo aviso abaixo (conectou: lê; desconectou: esquece).
let leituraGoogle: LeituraGoogleAgenda | null = null;
// O espelho no calendário "Moductus" (F3-24) nasce depois das Tarefas e dos Lembretes, que adotam
// o que mudou no Google; as áreas o avisam a cada mudança, e a conexão, ao conectar.
let espelhoGoogle: EspelhoGoogleAgenda | null = null;
// Google Agenda da Alba (F3-22): OAuth no navegador pela casca, refresh token no Gerenciador.
const googleAgenda = new ServicoGoogleAgenda({
  conexoes: repositorioConexoes,
  credenciais: credenciaisPelaCasca(canal),
  abrir: abrirPelaCasca(canal),
  avisar: (conexao) => {
    servidor?.emitir("conexoes.mudou", conexao);
    leituraGoogle?.aoMudarConexao(conexao);
    espelhoGoogle?.aoMudarConexao(conexao);
  },
});
const conexoes = new ServicoConexoes(
  repositorioConexoes,
  {
    github,
    google: googleAgenda,
    ligacao: new LigacaoClaudeCode({
      caminho: caminhoSettingsClaude(),
      porta: portaDosHooks(),
      memoria: join(pastaDeDados(), "ligacao-claude-code.json"),
      copiasForaDoLink: join(pastaDeDados(), "copias", "claude-code"),
    }),
    ambiente: ambientePelaCasca(canal),
    token: () => tokenDosHooks(credenciaisPelaCasca(canal)),
  },
  (conexao) => servidor?.emitir("conexoes.mudou", conexao),
);

/**
 * Os adaptadores de modelo que esta versão tem. O CLI roda numa pasta própria, para não herdar
 * CLAUDE.md nem `.claude/` de um projeto qualquer, e recebe as ferramentas do agente pelo MCP do
 * Moductus. Sem o MCP, o agente ainda conversa, só sem ferramentas. As APIs compatíveis com OpenAI
 * rodam o ciclo de ferramentas no serviço e leem a chave do Gerenciador de Credenciais a cada uso.
 */
function registrarProvedores(mcp: AberturaMcp | undefined): RegistroProvedores {
  const pastaDoClaudeCli = join(pastaDeDados(), "claude-cli");
  mkdirSync(pastaDoClaudeCli, { recursive: true });
  const api = fabricaOpenAiCompativel({ credenciais: credenciaisPelaCasca(canal) });
  return new RegistroProvedores()
    .registrar("claude-cli", fabricaClaudeCli({ pasta: pastaDoClaudeCli, mcp }))
    .registrar("openai-compativel", api)
    .registrar("openai", api);
}

// Servidor MCP do Moductus (F2-11): cada execução em CLI abre o próprio acesso, e as chamadas rodam
// pelo executor da execução no runtime (escopo, cartão e registro). O mesmo acesso atende o
// PreToolUse do CLI (F2-12).
const servidorMcp = await abrirServidorMcp(0, [rotaPreToolUse]).catch((erro: unknown) => {
  console.error(`MCP do Moductus fora do ar: ${String(erro)}`);
  return null;
});
if (servidorMcp) console.error(`MCP do Moductus na porta ${servidorMcp.porta}`);

// Runtime dos agentes (F2-15).
const provedores = registrarProvedores(
  servidorMcp
    ? aberturaMcpDoRuntime(servidorMcp, (execucaoId) => runtime.executorDaExecucao(execucaoId))
    : undefined,
);
const repositorioExecucoes = new RepositorioExecucoes(banco);
// Agenda (F3-16): o local e o cache do Google, o livre no expediente de `config` e o encaixe da
// Alba, que só o clique aplica e o histórico desfaz.
const agenda = new ServicoAgenda(
  {
    repo: new RepositorioAgenda(banco),
    tarefas: new RepositorioTarefasDoDia(banco),
    chamadas: repositorioExecucoes,
    lerDia: () => repositorioConfig.ler().dia,
  },
  {
    mudou: (mudanca) => {
      servidor?.emitir("agenda.mudou", mudanca);
      // O evento do "Moductus" entrou na fila de saída: o espelho manda.
      espelhoGoogle?.aoMudar();
      vigiaAlba?.agendaMudou();
    },
    calendarios: (calendarios) => {
      servidor?.emitir("agenda.calendarios", calendarios);
      vigiaAlba?.agendaMudou();
    },
  },
);
// Os calendários do Google no cache da agenda (F3-23, ADR-0035): a cada 10 min com variação, na
// retomada, ao abrir a área e ao escolher ler um calendário. A falha vira a fala de erro da Alba.
const repositorioLeituraGoogle = new RepositorioLeituraGoogle(banco);
leituraGoogle = new LeituraGoogleAgenda({
  google: googleAgenda,
  repo: repositorioLeituraGoogle,
  lerFuso: () => repositorioConfig.ler().dia.fuso,
  avisos: {
    eventos: ({ mudados, apagados }) => {
      const eventos = mudados.flatMap((id) => {
        try {
          return [agenda.obterEvento({ id })];
        } catch {
          return [];
        }
      });
      servidor?.emitir("agenda.mudou", { eventos, apagados });
    },
    calendarios: () => servidor?.emitir("agenda.calendarios", agenda.calendarios()),
    erro: ({ titulo, corpo }) => {
      notificacoes
        .avisar({
          agenteId: "alba",
          tipo: "erro",
          titulo,
          corpo,
          referencia: "conexao:google-agenda",
          origem: "conexao",
        })
        .catch((erro: unknown) =>
          console.error(`notificações: aviso da leitura do Google falhou: ${String(erro)}`),
        );
    },
  },
});
// O dia das ferramentas da Alba: "hoje" e "amanhã" no fuso de config, lido a cada pergunta.
const tempoDoDia = new TempoDoDia(() => repositorioConfig.ler().dia.fuso);
// Criar e mudar evento nos outros calendários do Google (F3-25), só com o sim do cartão; o que foi
// escrito volta ao cache pela leitura.
const escritaGoogle = new EscritaGoogleAgenda({
  google: googleAgenda,
  repo: repositorioLeituraGoogle,
  lerFuso: () => repositorioConfig.ler().dia.fuso,
  aoEscrever: () => leituraGoogle?.aoEscrever(),
});
// As ferramentas de cada área (F2-26: as do Nuno; F3-26: as da Alba); cada agente só vê as da lista
// dele. As das áreas que nascem mais adiante entram quando elas nascem, antes do servidor abrir.
const catalogo = new Catalogo([
  ...ferramentasSessoes(sessoes),
  ...ferramentasUso(sessoes),
  ...ferramentasGithub(github),
  ...ferramentasAgenda(agenda, tempoDoDia, escritaGoogle),
]);
const repositorioAgentes = new RepositorioAgentes(banco);
// Quem rodava essas execuções era o serviço que parou: fecham como erro e os cartões delas expiram.
const interrompidas = encerrarInterrompidas(repositorioExecucoes, aprovacoes);
if (interrompidas.length > 0)
  console.error(`execuções interrompidas na última subida: ${interrompidas.length}`);
const runtime = new Runtime(
  {
    agentes: repositorioAgentes,
    execucoes: repositorioExecucoes,
    provedores,
    catalogo,
    autorizar: autorizarPorAprovacao(aprovacoes),
  },
  {
    execucao: (execucao) => {
      servidor?.emitir("execucoes.mudou", execucao);
      // O que custou muda o gasto de hoje contra o teto, que vem com o agente.
      if (execucao.fim !== null && execucao.custoEstimadoMicrodolares !== null)
        emitirAgente(execucao.agenteId);
    },
    agente: (agenteId) => {
      const agente = agentes.procurar(agenteId);
      if (agente) servidor?.emitir("agentes.mudou", agente);
      // O Nuno retomou ou acordou: o vigia confere o que anotou enquanto ele não podia chamar o modelo.
      if (agente) vigiaNuno?.aoMudarAgente(agente);
      bandeja.atualizar();
    },
  },
  // O teto diário vale na moeda escolhida, pela cotação da configuração (ADR-0040).
  { emCentavos: converterPelaConfig(() => config.obter().config.cambio) },
);
const agentes = new ServicoAgentes(
  repositorioAgentes,
  catalogo,
  (agente) => runtime.situacao(agente),
  runtime.estados,
);
/** Avisa as janelas de um agente que mudou (estado, modelo ou o gasto de hoje). */
function emitirAgente(agenteId: string): void {
  const agente = agentes.procurar(agenteId);
  if (agente) servidor?.emitir("agentes.mudou", agente);
}
// Pausar pela bandeja (F2-18): o menu do ícone mostra o estado de cada agente e se refaz quando muda.
const bandeja = ligarBandeja({ agentes, canal });
// A cotação mudou: o gasto de hoje muda, e o teto vale de novo para cada agente (acorda ou adormece).
reagirACotacao = () => {
  for (const agente of repositorioAgentes.agentes()) {
    runtime.estados.tetoMudou(agente.id);
    emitirAgente(agente.id);
  }
  bandeja.atualizar();
};
// "Buscar cotação" (ADR-0040): só quando o usuário pede, e o valor só vale depois de confirmado.
const cambio = new ServicoCambio();
// Provedores (F2-08): detecção dos CLIs, configuração e o teste de verdade, pelo registro do runtime.
const servicoProvedores = new ServicoProvedores(
  new RepositorioProvedores(banco),
  {
    credenciais: credenciaisPelaCasca(canal),
    registro: provedores,
    detectar: () => detectar({ atende: (tipo) => provedores.atende(tipo) }),
  },
  {
    provedores: (lista) => servidor?.emitir("provedores.mudou", lista),
    agentesMudaram: (ids) => {
      for (const id of ids) {
        const agente = agentes.procurar(id);
        if (agente) servidor?.emitir("agentes.mudou", agente);
      }
      bandeja.atualizar();
    },
    // Só vêm os que dormem pelo provedor; quem dorme pelo teto continua dormindo.
    provedorVoltou: (ids) => ids.forEach((id) => runtime.estados.acordar(id)),
  },
);
vigiaNuno = new VigiaNuno({
  executar: (pedido) => runtime.executar(pedido),
  githubConhecido: github.obter().itens,
  avisar: avisarDoVigia(notificacoes),
  detalhar: (alvo) => github.detalhe(alvo),
});
const execucoes = new ServicoExecucoes(repositorioExecucoes, catalogo, {
  mudou: (execucao) => servidor?.emitir("execucoes.mudou", execucao),
});
// Conversas (F2-19): o roteamento classifica pelo modelo da Alba o que as regras não pegam.
const conversas = new ServicoConversas(
  {
    repo: new RepositorioConversas(banco),
    agentes: repositorioAgentes,
    runtime,
    roteador: new Roteador(classificadorPeloRuntime(runtime, repositorioAgentes)),
  },
  {
    conversa: (conversa) => servidor?.emitir("conversas.mudou", conversa),
    mensagem: (mensagem) => servidor?.emitir("conversas.mensagem", mensagem),
    parcial: (parcial) => servidor?.emitir("conversas.parcial", parcial),
  },
);
// Notas (F3-19): salvam com a versão que a janela conhece; o bloco rápido fica fixo no topo.
const notas = new ServicoNotas(new RepositorioNotas(banco), {
  mudou: (mudanca) => servidor?.emitir("notas.mudou", mudanca),
});
// Relógio do dia (F3-17, ADR-0032): lembretes disparam por um timer próprio, sem modelo e sem rede.
const relogio = new RelogioDoDia();
const lembretes = new ServicoLembretes(
  new RepositorioLembretes(banco),
  {
    lerFuso: () => repositorioConfig.ler().dia.fuso,
    notificacoes,
    relogio,
    // O do canal `calendario` que já está no "Moductus" toca pelo celular (F3-24).
    noGoogle: (id) => espelhoGoogle?.chegouAoGoogle(id) ?? false,
  },
  {
    mudou: (mudanca) => {
      servidor?.emitir("lembretes.mudou", mudanca);
      // Disparou, adiou, concluiu ou virou perdido: os atrasados das contagens mudam.
      recontarAreas();
      espelhoGoogle?.aoMudar();
    },
    hoje: (hoje) => servidor?.emitir("lembretes.hoje", hoje),
  },
);
relogio.registrar(lembretes);
// Foco (F3-18): o fim de cada etapa pelo mesmo relógio; a janela conta o tempo pelo fim planejado.
const servicoFoco = new ServicoFoco(
  new RepositorioFoco(banco),
  { lerDia: () => repositorioConfig.ler().dia, notificacoes, relogio },
  { mudou: (estado) => servidor?.emitir("foco.mudou", estado) },
);
foco = servicoFoco;
relogio.registrar(servicoFoco);
// Tarefas (F3-15): "hoje" no fuso de config; a tarefa com hora mantém o lembrete ligado a ela.
const tarefas = new ServicoTarefas(
  new RepositorioTarefas(banco),
  { lerFuso: () => repositorioConfig.ler().dia.fuso, notas },
  {
    tarefas: (mudanca) => {
      servidor?.emitir("tarefas.mudou", mudanca);
      recontarAreas();
      // A tarefa com hora (e o lembrete dela, que é o alerta) vai ao "Moductus".
      espelhoGoogle?.aoMudar();
    },
    listas: (listas) => servidor?.emitir("listas.mudou", listas),
    // O lembrete da tarefa muda pelas Tarefas: o relógio se rearma e o aviso da ocorrência trocada sai.
    lembretes: (mudanca) => {
      servidor?.emitir("lembretes.mudou", mudanca);
      lembretes.mudaramPorFora(mudanca);
      recontarAreas();
      espelhoGoogle?.aoMudar();
    },
  },
);
// As ferramentas da Alba sobre as áreas do dia (F3-26); o `tarefas.criar` vale também para o Nuno.
catalogo.registrar(
  ...ferramentasTarefas(tarefas, tempoDoDia),
  ...ferramentasLembretes(lembretes, tempoDoDia),
  ...ferramentasFoco(servicoFoco, tempoDoDia),
  ...ferramentasNotas(notas),
);
// Captura rápida (F3-32, ADR-0034): o entendedor de frases e, quando ele não reconhece nada além do
// título, o modelo da Alba com prazo de 8 s. Lança pela área de cada tipo; o desfazer vale por 10 s.
const captura = new ServicoCaptura({
  lerFuso: () => repositorioConfig.ler().dia.fuso,
  tarefas,
  lembretes,
  agenda,
  notas,
  interpretar: interpretePeloRuntime(runtime, repositorioAgentes),
  pediuLembrete: () => primeiroUso.lembretePedido(),
});
// Contagens das áreas (F3-20): a barra lateral do Sistema e os badges do dock leem daqui. As
// sessões esperando são os pedidos do terminal, como o Nuno no dock.
const leituraAprovacoes = new RepositorioAprovacoes(banco);
const leituraLembretes = new RepositorioLembretes(banco);
const leituraGithub = new RepositorioGithub(banco);
const contagens = new ServicoContagens(
  {
    tarefasPendentes: () => tarefas.pendentesDeHoje(),
    lembretesAtrasados: () => leituraLembretes.contarPerdidos(),
    sessoesEsperando: () => sessoesEsperando(leituraAprovacoes.pendentes()),
    devPrecisando: () => leituraGithub.contarPrecisandoDeMim(),
  },
  (novas) => servidor?.emitir("areas.contagens", novas),
);
recontarAreas = () => contagens.recontar();
contagens.recontar();
contagens.vigiar();
// O calendário "Moductus" (F3-24, ADR-0035): tarefas com hora e lembretes com horário viram evento
// com alerta no Google, pela fila de saída; o que você muda lá volta pelas áreas, como conexão.
const pelaConexao = { origem: "conexao" } as const;
espelhoGoogle = new EspelhoGoogleAgenda({
  google: googleAgenda,
  repo: new RepositorioEspelhoGoogle(banco),
  lerFuso: () => repositorioConfig.ler().dia.fuso,
  adotar: {
    tarefa: (id, mudanca) => void tarefas.definir({ id, ...mudanca }, pelaConexao),
    lembrete: async (id, mudanca) => void (await lembretes.definir({ id, ...mudanca }, pelaConexao)),
  },
  avisos: {
    eventos: ({ mudados, apagados }) => {
      const eventos = mudados.flatMap((id) => {
        try {
          return [agenda.obterEvento({ id })];
        } catch {
          return [];
        }
      });
      servidor?.emitir("agenda.mudou", { eventos, apagados });
      vigiaAlba?.agendaMudou();
    },
    calendarios: () => {
      servidor?.emitir("agenda.calendarios", agenda.calendarios());
      vigiaAlba?.agendaMudou();
    },
    recriado: ({ titulo, corpo }) => {
      notificacoes
        .avisar({
          agenteId: "alba",
          tipo: "aviso",
          titulo,
          corpo,
          referencia: "conexao:google-agenda:moductus",
          origem: "conexao",
        })
        .catch((erro: unknown) =>
          console.error(`notificações: aviso do calendário "Moductus" falhou: ${String(erro)}`),
        );
    },
  },
});
// Estados (F2-16): acorda quem passou da hora com o serviço parado e programa os despertadores.
// Depois, a fala que esperava resposta quando o serviço parou vai de novo à fila do agente.
runtime.estados.vigiar();
bandeja.atualizar();
conversas
  .retomarPendentes()
  .then((n) => n > 0 && console.error(`falas pendentes retomadas: ${n}`))
  .catch((erro: unknown) => console.error(`falas pendentes não retomadas: ${String(erro)}`));

servidor = await abrirServidorWs(token, {
  "sistema.ping": () => ({ protocolo: VERSAO_PROTOCOLO, pid: process.pid }),
  "config.obter": () => config.obter(),
  "config.definir": (mudanca) => config.definir(mudanca),
  "cambio.buscar": (pedido) => cambio.buscar(pedido.moeda),
  "config.exportar": (pedido) => outroPc.exportar(pedido),
  "config.previaImportar": (pedido) => outroPc.previa(pedido),
  "config.importar": (pedido) => outroPc.importar(pedido),
  "primeiroUso.obter": () => primeiroUso.obter(),
  "primeiroUso.concluir": (pedido) => primeiroUso.concluir(pedido),
  "primeiroUso.marcar": (pedido) => primeiroUso.marcar(pedido),
  "sessoes.listar": () => sessoes.listar(),
  "sessoes.eventos": (pedido) => sessoes.eventos(pedido),
  "sessoes.uso": (pedido) => sessoes.uso(pedido),
  "aprovacoes.pendentes": () => aprovacoes.pendentes(),
  "aprovacoes.decidir": (pedido) => aprovacoes.decidir(pedido),
  "regras.listar": () => aprovacoes.regras(),
  "regras.remover": (pedido) => aprovacoes.removerRegra(pedido),
  "conexoes.listar": () => conexoes.listar(),
  "conexoes.previa": (pedido) => conexoes.previa(pedido),
  "conexoes.ligar": (pedido) => conexoes.ligar(pedido),
  "conexoes.desligar": (pedido) => conexoes.desligar(pedido),
  "github.obter": () => github.obter(),
  "github.atualizar": () => github.atualizar(),
  "agentes.listar": () => agentes.listar(),
  "agentes.obter": (pedido) => agentes.obter(pedido),
  "agentes.capacidades": (pedido) => agentes.capacidades(pedido),
  "agentes.ligar": (pedido) => agentes.ligar(pedido),
  "agentes.pausar": (pedido) => agentes.pausar(pedido),
  "agentes.retomar": (pedido) => agentes.retomar(pedido),
  "agentes.acordar": (pedido) => agentes.acordar(pedido),
  // O cartão de teto (F3-08): solta mais até a meia-noite e a fila roda; o aviso sai pelo runtime.
  "agentes.liberarTeto": (pedido) => agentes.liberarTeto(pedido),
  // Configurações › Modelos (F2-32): vale na próxima execução; as janelas ficam sabendo pelo aviso.
  "agentes.definir": (mudanca) => {
    const agente = agentes.definir(mudanca);
    servidor?.emitir("agentes.mudou", agente);
    bandeja.atualizar();
    return agente;
  },
  // A página do agente (F3-04): volta ao de fábrica; o modelo e o estado ficam.
  "agentes.restaurarPadrao": (pedido) => {
    const agente = agentes.restaurarPadrao(pedido);
    servidor?.emitir("agentes.mudou", agente);
    bandeja.atualizar();
    return agente;
  },
  "execucoes.listar": (pedido) => execucoes.listar(pedido),
  "execucoes.obter": (pedido) => execucoes.obter(pedido),
  "execucoes.desfazer": (pedido) => execucoes.desfazer(pedido),
  "conversas.listar": () => conversas.listar(),
  "conversas.abrir": (pedido) => conversas.abrir(pedido),
  "conversas.mensagens": (pedido) => conversas.mensagens(pedido),
  "conversas.enviar": (pedido) => conversas.enviar(pedido),
  "conversas.arquivar": (pedido) => conversas.arquivar(pedido),
  "conversas.apagar": (pedido) => conversas.apagar(pedido),
  "notificacoes.obter": () => notificacoes.obter(),
  "notificacoes.definir": (mudanca) => notificacoes.definir(mudanca),
  "notificacoes.restaurar": (pedido) => notificacoes.restaurar(pedido),
  "notificacoes.listar": (pedido) => notificacoes.listar(pedido),
  "notificacoes.naoVistas": () => notificacoes.naoVistas(),
  "notificacoes.marcarVistas": (pedido) => notificacoes.marcarVistas(pedido),
  "provedores.listar": () => servicoProvedores.listar(),
  "provedores.detectar": () => servicoProvedores.detectar(),
  "provedores.criar": (novo) => servicoProvedores.criar(novo),
  "provedores.definir": (mudanca) => servicoProvedores.definir(mudanca),
  "provedores.remover": (pedido) => servicoProvedores.remover(pedido),
  "provedores.testar": (pedido) => servicoProvedores.testar(pedido),
  "notas.listar": (pedido) => notas.listar(pedido),
  "notas.obter": (pedido) => notas.obter(pedido),
  "notas.criar": (nova) => notas.criar(nova),
  "notas.salvar": (pedido) => notas.salvar(pedido),
  "notas.definir": (mudanca) => notas.definir(mudanca),
  "notas.apagar": (pedido) => notas.apagar(pedido),
  "notas.buscar": (pedido) => notas.buscar(pedido),
  ...atendentesDasTarefas(tarefas),
  ...atendentesDoFoco(servicoFoco),
  // Abrir a área lê o Google de novo, se a última leitura não acabou de terminar (F3-23).
  "agenda.calendarios": () => {
    leituraGoogle?.aoAbrirArea();
    return agenda.calendarios();
  },
  "agenda.definirCalendario": (mudanca) => {
    const calendario = agenda.definirCalendario(mudanca);
    // Passou a ler um calendário do Google: os eventos dele vêm já.
    if (calendario.fonte === "google" && mudanca.ler === true) leituraGoogle?.aoEscolherCalendario();
    return calendario;
  },
  "agenda.consultar": (pedido) => {
    leituraGoogle?.aoAbrirArea();
    return agenda.consultar(pedido);
  },
  "agenda.obterEvento": (pedido) => agenda.obterEvento(pedido),
  "agenda.criarEvento": (novo) => agenda.criarEvento(novo),
  "agenda.definirEvento": (mudanca) => agenda.definirEvento(mudanca),
  "agenda.apagarEvento": (pedido) => agenda.apagarEvento(pedido),
  "agenda.aplicarSugestao": (pedido) => agenda.aplicarSugestao(pedido),
  "lembretes.listar": (pedido) => lembretes.listar(pedido),
  "lembretes.hoje": () => lembretes.hoje(),
  "lembretes.criar": (novo) => lembretes.criar(novo),
  "lembretes.definir": (mudanca) => lembretes.definir(mudanca),
  "lembretes.adiar": (pedido) => lembretes.adiar(pedido),
  "lembretes.concluir": (pedido) => lembretes.concluir(pedido),
  "lembretes.cancelar": (pedido) => lembretes.cancelar(pedido),
  ...atendentesDaCaptura(captura),
  // O dia (F3-12): o contrato já tem os métodos e o serviço responde que ainda não estão disponíveis.
  // Cada tarefa que implementa uma área (F3-15 a F3-20, F3-32) tira os dela daqui.
  ...semAtendente(["rotinas.listar", "rotinas.definir", "rotinas.hoje", "rotinas.agir"]),
  "areas.contagens": () => contagens.obter(),
});
console.error(`servico pronto na porta ${servidor.porta}, pid ${process.pid}`);
canal.avisar({ tipo: "pronto", porta: servidor.porta, pid: process.pid });
config
  .aplicarAoSubir()
  .catch((erro: unknown) => console.error(`configuração não aplicada ao subir: ${String(erro)}`));

// Hooks das sessões de IA (F2-21): sem o token ou com a porta ocupada, o resto do serviço segue.
sessoes.vigiar();
aprovacoes.vigiar();
// GitHub pelo `gh` (F2-25): lê agora e a cada 15 min, se a conexão não estiver desligada.
github.vigiar();
// Calendários do Google (F3-23): lê agora e a cada 10 min com variação, se a conexão não estiver desligada.
leituraGoogle.vigiar();
// O "Moductus" (F3-24): garante o calendário, lê de volta e manda a fila, agora e a cada 10 min.
espelhoGoogle.vigiar();
// Agendador (F2-17): horário, intervalo e evento. As áreas avisam os eventos internos por
// `agendador.emitir` (o tipo `EmitirEvento`). Na volta da suspensão (a casca avisa), depois do
// prazo para a rede voltar, o que venceu dispara uma vez só e o GitHub é lido (AGENTS.md §6).
const agendador = new Agendador({
  agentes: repositorioAgentes,
  disparos: new RepositorioDisparos(banco),
  runtime,
});
agendador.vigiar();
// A primeira atividade do dia (F3-27, ADR-0033): o desbloqueio ou o logon (a casca avisa
// `atividade`), a retomada e a subida, depois das 05:00 no fuso de config, ou o horário fixo do
// briefing, que o vigia da Alba confere no relógio do dia. Uma vez por dia; o briefing que sai
// daqui é a F3-29.
const repositorioAtividade = new RepositorioAtividade(banco);
const primeiraAtividade = new PrimeiraAtividade(
  repositorioAtividade,
  new TempoDoDia(() => repositorioConfig.ler().dia.fuso),
  (inicio) => console.error(`dia: ${inicio.dia} começou (${inicio.motivo})`),
);
// Os vigias da Alba (F3-28, AGENTS.md §6): a virada do dia, os alertas dos compromissos e as horas
// das rotinas, no relógio do dia, sem modelo. O fechamento que sai daqui é a F3-30.
const leituraNotificacoes = new RepositorioNotificacoes(banco);
vigiaAlba = new VigiaAlba({
  lerFuso: () => repositorioConfig.ler().dia.fuso,
  abertasEntre: (desde, ate) => tarefas.abertasQueVenciam(desde, ate),
  compromissos: (janela) => agenda.alertasDeCompromissos(janela),
  jaAvisou: (referencia) => leituraNotificacoes.idsDa(referencia).length > 0,
  avisar: (aviso) => notificacoes.avisar(aviso),
  rotinas: repositorioAtividade,
  briefingNoHorario: () => sinalDeAtividade("horario"),
  marcas: new RepositorioMarcasDosVigias(banco),
  relogio,
  avisos: {
    // As abertas de ontem passam à vista das atrasadas, com o dia em que venciam: as janelas e as
    // contagens não esperam a próxima leitura delas.
    virou: ({ de, para, abertas }) => {
      console.error(`dia: virou de ${de} para ${para}, ${abertas.length} aberta(s) vêm para hoje`);
      if (abertas.length > 0) servidor?.emitir("tarefas.mudou", { tarefas: abertas, apagadas: [] });
      recontarAreas();
    },
    fechamento: ({ dia, atrasado }) =>
      console.error(`dia: hora do fechamento de ${dia}${atrasado ? " (atrasado)" : ""}`),
  },
});
for (const fonte of vigiaAlba.fontes) relogio.registrar(fonte);
// O que venceu com o serviço parado vira atrasado, num aviso só; depois o timer fica armado.
relogio.ligar().catch((erro: unknown) => console.error(`relógio do dia não ligou: ${String(erro)}`));
/** Um sinal de atividade; banco com problema não derruba quem avisou. */
function sinalDeAtividade(motivo: MotivoAtividade): void {
  try {
    primeiraAtividade.sinal(motivo);
  } catch (erro) {
    console.error(`dia: sinal de atividade (${motivo}) falhou: ${String(erro)}`);
  }
}
sinalDeAtividade("subida");
canal.aoAvisar("atividade", (aviso) => sinalDeAtividade(motivoDaCasca(aviso)));
// O atalho do foco (Ctrl+Alt+P) vem da casca e inicia, pausa ou retoma.
ouvirAtalhoDoFoco(canal, servicoFoco);
canal.aoAvisar("retomou", () => {
  sinalDeAtividade("retomada");
  // Na volta da suspensão, os lembretes que venceram com o PC dormindo chegam juntos.
  relogio
    .retomar()
    .catch((erro: unknown) => console.error(`relógio do dia: retomada falhou: ${String(erro)}`));
  // O PC dormiu: o dia pode ter virado antes da próxima volta do relógio das contagens.
  recontarAreas();
  agendador
    .retomar()
    .then(() => github.atualizar("conexao"))
    .catch((erro: unknown) => console.error(`github: leitura na retomada falhou: ${String(erro)}`))
    // O Google também, depois do prazo para a rede voltar que o agendador já esperou.
    .finally(() => {
      void leituraGoogle?.atualizar();
      void espelhoGoogle?.sincronizar();
    });
});
tokenDosHooks(credenciaisPelaCasca(canal))
  .then((tokenHooks) => abrirReceptorHooks(tokenHooks, atenderHooks(sessoes, aprovacoes), portaDosHooks()))
  .then((receptor) => console.error(`hooks das sessões na porta ${receptor.porta}`))
  .catch((erro: unknown) => console.error(`hooks das sessões fora do ar: ${String(erro)}`));

// A casca fechou o stdin: ela saiu, então o serviço sai junto.
process.stdin.on("end", () => {
  banco.close();
  process.exit(0);
});
