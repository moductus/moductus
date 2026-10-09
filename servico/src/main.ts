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
import { gravarAvisoDoNuno, VigiaNuno } from "./agentes/vigias/nuno.ts";
import { abrirServidorWs, semAtendente, type ServidorWs } from "./api/servidor.ts";
import { RepositorioAprovacoes, ServicoAprovacoes } from "./aprovacoes/aprovacoes.ts";
import { abrirBanco, pastaDeDados, portable } from "./banco/conexao.ts";
import { ambientePelaCasca } from "./casca/ambiente.ts";
import { CanalCasca } from "./casca/canal.ts";
import { credenciaisPelaCasca } from "./casca/credenciais.ts";
import { RepositorioConfig, ServicoConfig, type AplicadorNativo } from "./config/config.ts";
import { RepositorioConexoes, ServicoConexoes } from "./conexoes/conexoes.ts";
import { RepositorioConversas, ServicoConversas } from "./conversas/conversas.ts";
import { executorGh } from "./conexoes/github/gh.ts";
import { RepositorioGithub, ServicoGithub } from "./conexoes/github/github.ts";
import { Catalogo } from "./ferramentas/catalogo.ts";
import { ferramentasGithub } from "./ferramentas/github/github.ts";
import { ferramentasSessoes } from "./ferramentas/sessoes/sessoes.ts";
import { ferramentasUso } from "./ferramentas/uso/uso.ts";
import { abrirServidorMcp } from "./mcp/servidor.ts";
import { MIGRACOES } from "./migracoes/index.ts";
import { ServicoOutroPc } from "./outro-pc/outro-pc.ts";
import { RepositorioPrimeiroUso, ServicoPrimeiroUso } from "./primeiro-uso/primeiro-uso.ts";
import { fabricaClaudeCli, rotaPreToolUse, type AberturaMcp } from "./provedores/claude-cli/claude-cli.ts";
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
const config = new ServicoConfig(
  new RepositorioConfig(banco),
  nativo,
  (estado: EstadoConfig) => servidor?.emitir("config.mudou", estado),
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
const sessoes = new ServicoSessoes(
  new RepositorioSessoes(banco),
  (mudanca) => {
    servidor?.emitir("sessoes.mudou", mudanca);
    vigiaNuno?.aoMudarSessao(mudanca);
  },
  { transcripts: TRANSCRIPTS_DO_DISCO, aoAvisarContexto: (aviso) => vigiaNuno?.aoAvisarContexto(aviso) },
);
const aprovacoes = new ServicoAprovacoes(new RepositorioAprovacoes(banco), {
  aprovacao: (aprovacao) => servidor?.emitir("aprovacoes.mudou", aprovacao),
  regras: (regras) => servidor?.emitir("regras.mudou", regras),
});
// Quem segurava a resposta dos hooks do terminal era o serviço que caiu: esses cartões expiram.
aprovacoes.expirarDoTerminal();
const repositorioConexoes = new RepositorioConexoes(banco);
const github = new ServicoGithub(new RepositorioGithub(banco), repositorioConexoes, executorGh(), {
  github: (situacao) => {
    servidor?.emitir("github.mudou", situacao);
    vigiaNuno?.aoLerGithub(situacao);
  },
  conexao: (conexao) => servidor?.emitir("conexoes.mudou", conexao),
});
const conexoes = new ServicoConexoes(
  repositorioConexoes,
  {
    github,
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
 * Moductus. Sem o MCP, o agente ainda conversa, só sem ferramentas.
 */
function registrarProvedores(mcp: AberturaMcp | undefined): RegistroProvedores {
  const pastaDoClaudeCli = join(pastaDeDados(), "claude-cli");
  mkdirSync(pastaDoClaudeCli, { recursive: true });
  return new RegistroProvedores().registrar("claude-cli", fabricaClaudeCli({ pasta: pastaDoClaudeCli, mcp }));
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
// As ferramentas de cada área (F2-26: as do Nuno); cada agente só vê as da lista dele.
const catalogo = new Catalogo([
  ...ferramentasSessoes(sessoes),
  ...ferramentasUso(sessoes),
  ...ferramentasGithub(github),
]);
const repositorioAgentes = new RepositorioAgentes(banco);
const repositorioExecucoes = new RepositorioExecucoes(banco);
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
    execucao: (execucao) => servidor?.emitir("execucoes.mudou", execucao),
    agente: (agenteId) => {
      const agente = agentes.procurar(agenteId);
      if (agente) servidor?.emitir("agentes.mudou", agente);
    },
  },
);
const agentes = new ServicoAgentes(repositorioAgentes, catalogo, (agente) => runtime.situacao(agente));
vigiaNuno = new VigiaNuno({
  executar: (pedido) => runtime.executar(pedido),
  githubConhecido: github.obter().itens,
  avisar: gravarAvisoDoNuno(banco),
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

servidor = await abrirServidorWs(token, {
  "sistema.ping": () => ({ protocolo: VERSAO_PROTOCOLO, pid: process.pid }),
  "config.obter": () => config.obter(),
  "config.definir": (mudanca) => config.definir(mudanca),
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
  "execucoes.listar": (pedido) => execucoes.listar(pedido),
  "execucoes.obter": (pedido) => execucoes.obter(pedido),
  "execucoes.desfazer": (pedido) => execucoes.desfazer(pedido),
  "conversas.listar": () => conversas.listar(),
  "conversas.abrir": (pedido) => conversas.abrir(pedido),
  "conversas.mensagens": (pedido) => conversas.mensagens(pedido),
  "conversas.enviar": (pedido) => conversas.enviar(pedido),
  "conversas.arquivar": (pedido) => conversas.arquivar(pedido),
  // Contrato da fase 2 (F2-04): cada tarefa tira daqui o que passa a atender.
  ...semAtendente([
    "agentes.definir",
    "agentes.restaurarPadrao",
    "agentes.ligar",
    "agentes.pausar",
    "agentes.retomar",
    "provedores.listar",
    "provedores.detectar",
    "provedores.criar",
    "provedores.definir",
    "provedores.remover",
    "provedores.testar",
  ]),
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
tokenDosHooks(credenciaisPelaCasca(canal))
  .then((tokenHooks) => abrirReceptorHooks(tokenHooks, atenderHooks(sessoes, aprovacoes), portaDosHooks()))
  .then((receptor) => console.error(`hooks das sessões na porta ${receptor.porta}`))
  .catch((erro: unknown) => console.error(`hooks das sessões fora do ar: ${String(erro)}`));

// A casca fechou o stdin: ela saiu, então o serviço sai junto.
process.stdin.on("end", () => {
  banco.close();
  process.exit(0);
});
