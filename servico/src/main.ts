import { mkdirSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { VERSAO_PROTOCOLO, type EstadoConfig } from "@moductus/contrato";
import { RepositorioAgentes, ServicoAgentes } from "./agentes/agentes.ts";
import { autorizarPorAprovacao } from "./agentes/autorizar.ts";
import { RepositorioExecucoes, ServicoExecucoes } from "./agentes/execucoes.ts";
import { Runtime } from "./agentes/runtime.ts";
import { abrirServidorWs, semAtendente, type ServidorWs } from "./api/servidor.ts";
import { RepositorioAprovacoes, ServicoAprovacoes } from "./aprovacoes/aprovacoes.ts";
import { abrirBanco, pastaDeDados, portable } from "./banco/conexao.ts";
import { ambientePelaCasca } from "./casca/ambiente.ts";
import { CanalCasca } from "./casca/canal.ts";
import { credenciaisPelaCasca } from "./casca/credenciais.ts";
import { RepositorioConfig, ServicoConfig, type AplicadorNativo } from "./config/config.ts";
import { RepositorioConexoes, ServicoConexoes } from "./conexoes/conexoes.ts";
import { executorGh } from "./conexoes/github/gh.ts";
import { RepositorioGithub, ServicoGithub } from "./conexoes/github/github.ts";
import { Catalogo } from "./ferramentas/catalogo.ts";
import { MIGRACOES } from "./migracoes/index.ts";
import { ServicoOutroPc } from "./outro-pc/outro-pc.ts";
import { RepositorioPrimeiroUso, ServicoPrimeiroUso } from "./primeiro-uso/primeiro-uso.ts";
import { fabricaClaudeCli } from "./provedores/claude-cli/claude-cli.ts";
import { RegistroProvedores } from "./provedores/registro.ts";
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
const sessoes = new ServicoSessoes(new RepositorioSessoes(banco), (mudanca) =>
  servidor?.emitir("sessoes.mudou", mudanca),
);
const aprovacoes = new ServicoAprovacoes(new RepositorioAprovacoes(banco), {
  aprovacao: (aprovacao) => servidor?.emitir("aprovacoes.mudou", aprovacao),
  regras: (regras) => servidor?.emitir("regras.mudou", regras),
});
// Quem segurava a resposta dos hooks do terminal era o serviço que caiu: esses cartões expiram.
aprovacoes.expirarDoTerminal();
const repositorioConexoes = new RepositorioConexoes(banco);
const github = new ServicoGithub(new RepositorioGithub(banco), repositorioConexoes, executorGh(), {
  github: (situacao) => servidor?.emitir("github.mudou", situacao),
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
 * CLAUDE.md nem `.claude/` de um projeto qualquer; o MCP do Moductus (F2-11) entra aqui, nas
 * opções do adaptador.
 */
function registrarProvedores(): RegistroProvedores {
  const pastaDoClaudeCli = join(pastaDeDados(), "claude-cli");
  mkdirSync(pastaDoClaudeCli, { recursive: true });
  return new RegistroProvedores().registrar("claude-cli", fabricaClaudeCli({ pasta: pastaDoClaudeCli }));
}

// Runtime dos agentes (F2-15).
const provedores = registrarProvedores();
const catalogo = new Catalogo();
const repositorioAgentes = new RepositorioAgentes(banco);
const repositorioExecucoes = new RepositorioExecucoes(banco);
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
const execucoes = new ServicoExecucoes(repositorioExecucoes);

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
  // Contrato da fase 2 (F2-04): cada tarefa tira daqui o que passa a atender.
  ...semAtendente([
    "agentes.definir",
    "agentes.restaurarPadrao",
    "agentes.ligar",
    "agentes.pausar",
    "agentes.retomar",
    "execucoes.desfazer",
    "provedores.listar",
    "provedores.detectar",
    "provedores.criar",
    "provedores.definir",
    "provedores.remover",
    "provedores.testar",
    "conversas.listar",
    "conversas.abrir",
    "conversas.mensagens",
    "conversas.enviar",
    "conversas.arquivar",
    "sessoes.uso",
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
