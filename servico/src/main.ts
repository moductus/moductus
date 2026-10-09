import { hostname } from "node:os";
import { VERSAO_PROTOCOLO, type EstadoConfig } from "@moductus/contrato";
import { abrirServidorWs, semAtendente, type ServidorWs } from "./api/servidor.ts";
import { RepositorioAprovacoes, ServicoAprovacoes } from "./aprovacoes/aprovacoes.ts";
import { abrirBanco, pastaDeDados, portable } from "./banco/conexao.ts";
import { CanalCasca } from "./casca/canal.ts";
import { credenciaisPelaCasca } from "./casca/credenciais.ts";
import { RepositorioConfig, ServicoConfig, type AplicadorNativo } from "./config/config.ts";
import { MIGRACOES } from "./migracoes/index.ts";
import { ServicoOutroPc } from "./outro-pc/outro-pc.ts";
import { RepositorioPrimeiroUso, ServicoPrimeiroUso } from "./primeiro-uso/primeiro-uso.ts";
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
  // Contrato da fase 2 (F2-04): cada tarefa tira daqui o que passa a atender.
  ...semAtendente([
    "agentes.listar",
    "agentes.obter",
    "agentes.definir",
    "agentes.restaurarPadrao",
    "agentes.ligar",
    "agentes.pausar",
    "agentes.retomar",
    "agentes.capacidades",
    "execucoes.listar",
    "execucoes.obter",
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
    "github.obter",
    "github.atualizar",
    "conexoes.listar",
    "conexoes.previa",
    "conexoes.ligar",
    "conexoes.desligar",
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
tokenDosHooks(credenciaisPelaCasca(canal))
  .then((tokenHooks) =>
    abrirReceptorHooks(
      tokenHooks,
      (ferramenta, evento) => {
        // Sessão que terminou não tem mais a quem responder: os cartões dela expiram.
        const { sessao } = sessoes.registrar(ferramenta, evento);
        if (sessao.encerradaEm) aprovacoes.expirarDaSessao(sessao.id);
        return undefined;
      },
      portaDosHooks(),
    ),
  )
  .then((receptor) => console.error(`hooks das sessões na porta ${receptor.porta}`))
  .catch((erro: unknown) => console.error(`hooks das sessões fora do ar: ${String(erro)}`));

// A casca fechou o stdin: ela saiu, então o serviço sai junto.
process.stdin.on("end", () => {
  banco.close();
  process.exit(0);
});
