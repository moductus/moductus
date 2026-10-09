import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  EVENTOS,
  METODOS,
  PARAMETRO_PROTOCOLO,
  PARAMETRO_TOKEN,
  Pedido,
  VERSAO_PROTOCOLO,
  type DadosDe,
  type EntradaDe,
  type NomeEvento,
  type NomeMetodo,
  type SaidaDe,
} from "@moductus/contrato";
import { WebSocketServer, type WebSocket } from "ws";

export type Atendentes = { [M in NomeMetodo]: (entrada: EntradaDe<M>) => SaidaDe<M> | Promise<SaidaDe<M>> };

export interface ServidorWs {
  porta: number;
  emitir<N extends NomeEvento>(nome: N, dados: DadosDe<N>): void;
  fechar(): Promise<void>;
}

function tokenConfere(recebido: string | null, esperado: string): boolean {
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Versão que a janela diz falar; sem o parâmetro, é uma janela da versão 1, que não o mandava. */
function protocoloDaJanela(url: URL): string {
  const valor = url.searchParams.get(PARAMETRO_PROTOCOLO) ?? "1";
  // Volta no texto do erro e no log: só número passa como veio.
  return /^\d{1,6}$/.test(valor) ? valor : "desconhecida";
}

/** O que a janela de outra versão recebe em cada pedido, em vez de uma resposta fora de forma. */
function erroDeProtocolo(daJanela: string): string {
  return (
    `protocolo incompatível: a janela fala a versão ${daJanela} e o serviço, a ${VERSAO_PROTOCOLO}. ` +
    "Feche e abra o Moductus de novo."
  );
}

/**
 * Atende, com um erro claro, os métodos que o contrato já tem e o serviço ainda não implementa.
 * Cada tarefa que implementa um deles o tira da lista; o tipo de `Atendentes` cobra o resto.
 */
export function semAtendente<M extends NomeMetodo>(nomes: readonly M[]): Pick<Atendentes, M> {
  const naoDisponivel = (nome: string) => () => {
    throw new Error(`${nome} ainda não está disponível nesta versão do serviço`);
  };
  const atendentes: Record<string, () => never> = Object.fromEntries(
    nomes.map((nome) => [nome, naoDisponivel(nome)]),
  );
  return atendentes as unknown as Pick<Atendentes, M>;
}

/**
 * Canal WebSocket com as janelas, em 127.0.0.1 numa porta aleatória. Conexão sem o
 * token certo é recusada com 401 antes do upgrade. Cada pedido é validado pelo schema do
 * contrato antes de chegar ao atendente; a regra fica no atendente, nunca aqui.
 */
export function abrirServidorWs(token: string, atendentes: Atendentes, porta = 0): Promise<ServidorWs> {
  const http: Server = createServer((_req, res) => {
    res.statusCode = 426;
    res.end();
  });
  const wss = new WebSocketServer({ noServer: true });

  http.on("upgrade", (req, socket, cabeca) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!tokenConfere(url.searchParams.get(PARAMETRO_TOKEN), token)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      console.error("canal: conexão sem token válido recusada");
      return;
    }
    const protocolo = protocoloDaJanela(url);
    if (protocolo !== String(VERSAO_PROTOCOLO)) {
      console.error(`canal: janela no protocolo ${protocolo}, serviço no ${VERSAO_PROTOCOLO}`);
    }
    wss.handleUpgrade(req, socket, cabeca, (ws) => wss.emit("connection", ws, protocolo));
  });

  /**
   * Janela de outra versão continua conectada (recusar só a faria reconectar sem parar), mas cada
   * pedido dela, menos o `sistema.ping`, volta com o erro de versão.
   */
  wss.on("connection", (ws: WebSocket, protocolo: string) => {
    ws.on("message", (bruto) => void atender(ws, String(bruto), protocolo));
    ws.send(JSON.stringify({ tipo: "evento", nome: "sistema.ola", dados: { protocolo: VERSAO_PROTOCOLO } }));
  });

  async function atender(ws: WebSocket, texto: string, protocolo: string): Promise<void> {
    let json: unknown;
    try {
      json = JSON.parse(texto);
    } catch {
      return;
    }
    const pedido = Pedido.safeParse(json);
    if (!pedido.success) return;
    const { id, metodo, dados } = pedido.data;
    const responder = (r: object) => ws.send(JSON.stringify({ tipo: "resposta", id, ...r }));
    if (protocolo !== String(VERSAO_PROTOCOLO) && metodo !== "sistema.ping") {
      responder({ ok: false, erro: erroDeProtocolo(protocolo) });
      return;
    }
    if (!(metodo in METODOS)) {
      responder({ ok: false, erro: `método desconhecido: ${metodo}` });
      return;
    }
    const nome = metodo as NomeMetodo;
    const entrada = METODOS[nome].entrada.safeParse(dados);
    if (!entrada.success) {
      responder({
        ok: false,
        erro: `entrada inválida para ${metodo}: ${entrada.error.issues[0]?.message ?? ""}`,
      });
      return;
    }
    try {
      const atendente = atendentes[nome] as (e: unknown) => unknown;
      responder({ ok: true, dados: await atendente(entrada.data) });
    } catch (erro) {
      responder({ ok: false, erro: erro instanceof Error ? erro.message : String(erro) });
    }
  }

  return new Promise((resolver) => {
    http.listen(porta, "127.0.0.1", () => {
      const endereco = http.address();
      resolver({
        porta: typeof endereco === "object" && endereco ? endereco.port : 0,
        emitir(nome, dados) {
          const valido = EVENTOS[nome].parse(dados);
          const texto = JSON.stringify({ tipo: "evento", nome, dados: valido });
          for (const cliente of wss.clients) cliente.send(texto);
        },
        fechar: () =>
          new Promise((pronto) => {
            for (const c of wss.clients) c.terminate();
            wss.close();
            http.close(() => pronto());
          }),
      });
    });
  });
}
