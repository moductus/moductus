import type { DatabaseSync } from "node:sqlite";
import type { Conexao } from "@moductus/contrato";
import { novoId } from "../../banco/ulid.ts";
import { ENDERECOS_GOOGLE, type EnderecosGoogle } from "./cliente.ts";
import {
  ErroCalendario,
  lerEvento,
  paginaDeCalendarios,
  paginaDeEventos,
  type CalendarioLido,
  type EventoLido,
  type PontoDeLeitura,
} from "./calendario.ts";
import { CORPO_LEITURA_FALHOU, TITULO_LEITURA_FALHOU, type ServicoGoogleAgenda } from "./google-agenda.ts";

/** A leitura dos calendários é a cada 10 minutos (ADR-0035), com variação de 25% para cada lado. */
export const INTERVALO_LEITURA_MS = 10 * 60_000;
export const VARIACAO_LEITURA = 0.25;

/** O cache guarda de 7 dias atrás em diante: o "ontem" do briefing e a semana que passou. */
export const DIAS_PARA_TRAS = 7;

/** Abrir a área lê de novo, mas não se a última leitura terminou há menos disso. */
export const FOLGA_AO_ABRIR_MS = 60_000;

/** Quanto esperar quando o Google responde que passou da cota, antes de tentar o mesmo pedido. */
export const ESPERAS_DA_COTA_MS = [2_000, 4_000, 8_000] as const;

/** Páginas de uma leitura: o que passa disso é o Google repetindo a mesma página, não agenda. */
const MAXIMO_PAGINAS = 100;

const MS_DIA = 86_400_000;

/** Linhas gravadas pela leitura do Google levam a origem `conexao` (DATA.md §1). */
const ORIGEM = "conexao";

const mensagem = (erro: unknown) => (erro instanceof Error ? erro.message : String(erro));

interface LinhaCalendarioGoogle {
  id: string;
  id_externo: string;
  nome: string;
  cor: string | null;
  espelho: number;
  ler: number;
  token_sincronizacao: string | null;
}

/** O que mudou no cache numa leitura: os eventos gravados e os que saíram, pelos ids daqui. */
export interface MudancaCache {
  mudados: string[];
  apagados: string[];
}

/**
 * Os calendários do Google e o cache dos eventos deles (`calendarios` e `eventos` da migração 014,
 * com as exceções da 020). Evento que sai do Google sai do cache de vez, sem lixeira: a fonte é o
 * Google, e a linha não viaja para outro PC. O "Moductus" (o espelho) não é lido por aqui.
 */
export class RepositorioLeituraGoogle {
  constructor(private readonly db: DatabaseSync) {}

  /** Os calendários do Google que estão vivos, inclusive o espelho. */
  calendarios(): LinhaCalendarioGoogle[] {
    return this.db
      .prepare(
        `SELECT id, id_externo, nome, cor, espelho, ler, token_sincronizacao FROM calendarios
          WHERE fonte = 'google' AND apagado_em IS NULL ORDER BY id`,
      )
      .all() as unknown as LinhaCalendarioGoogle[];
  }

  /** Os que a Alba lê: os que você escolheu, fora o espelho. */
  paraLer(): LinhaCalendarioGoogle[] {
    return this.calendarios().filter((c) => c.ler === 1 && c.espelho === 0);
  }

  /**
   * Põe a lista de calendários da conta no banco: o novo entra lido só se for o principal, o que
   * já existia guarda a sua escolha e só troca nome e cor, e o que sumiu da conta vai para a
   * lixeira sem os eventos. Devolve se a lista mudou e os eventos que saíram.
   */
  gravarCalendarios(lidos: readonly CalendarioLido[], agora: string): { mudou: boolean; apagados: string[] } {
    const existentes = new Map(this.calendarios().map((c) => [c.id_externo, c]));
    let mudou = false;
    const apagados: string[] = [];
    for (const lido of lidos) {
      const atual = existentes.get(lido.idExterno);
      existentes.delete(lido.idExterno);
      if (!atual) {
        this.db
          .prepare(
            `INSERT INTO calendarios (id, nome, fonte, id_externo, cor, ler, criado_em, atualizado_em, origem)
             VALUES (?, ?, 'google', ?, ?, ?, ?, ?, ?)`,
          )
          .run(novoId(), lido.nome, lido.idExterno, lido.cor, lido.principal ? 1 : 0, agora, agora, ORIGEM);
        mudou = true;
        continue;
      }
      // O espelho é do Moductus: o que vem na lista não muda o que ele guarda dele (F3-24).
      if (atual.espelho === 1 || (atual.nome === lido.nome && atual.cor === lido.cor)) continue;
      this.db
        .prepare("UPDATE calendarios SET nome = ?, cor = ?, atualizado_em = ?, origem = ? WHERE id = ?")
        .run(lido.nome, lido.cor, agora, ORIGEM, atual.id);
      mudou = true;
    }
    for (const sumiu of existentes.values()) {
      if (sumiu.espelho === 1) continue;
      apagados.push(...this.tirarCalendario(sumiu.id, agora));
      mudou = true;
    }
    return { mudou, apagados };
  }

  /** Esquece o Google: os calendários lidos vão para a lixeira e os eventos deles saem (o espelho fica). */
  esquecer(agora: string): { mudou: boolean; apagados: string[] } {
    const apagados: string[] = [];
    let mudou = false;
    for (const c of this.calendarios()) {
      if (c.espelho === 1) continue;
      apagados.push(...this.tirarCalendario(c.id, agora));
      mudou = true;
    }
    return { mudou, apagados };
  }

  private tirarCalendario(id: string, agora: string): string[] {
    const apagados = this.limparCache(id);
    this.db
      .prepare(
        `UPDATE calendarios SET apagado_em = ?, token_sincronizacao = NULL, atualizado_em = ?, origem = ?
          WHERE id = ?`,
      )
      .run(agora, agora, ORIGEM, id);
    return apagados;
  }

  /** Tira todo o cache de um calendário e o token: a próxima leitura dele é do zero (o 410). */
  limparCache(calendarioId: string): string[] {
    const ids = (
      this.db.prepare("SELECT id FROM eventos WHERE calendario_id = ?").all(calendarioId) as { id: string }[]
    ).map((l) => l.id);
    this.db.prepare("DELETE FROM eventos WHERE calendario_id = ?").run(calendarioId);
    this.db.prepare("UPDATE calendarios SET token_sincronizacao = NULL WHERE id = ?").run(calendarioId);
    return ids;
  }

  /**
   * Aplica uma leitura de um calendário, na ordem em que o Google mandou. A completa substitui o
   * cache dele (o que não veio sai, e as exceções são só as que vieram); a incremental mexe só no
   * que veio. Por último, cada ocorrência tirada da regra vira exceção do recorrente, que a essa
   * altura já está no cache. O que acabou antes de `limite` não entra: o cache começa ali.
   * Grava o token novo e a data da leitura.
   */
  aplicar(
    calendarioId: string,
    lidos: readonly EventoLido[],
    completa: boolean,
    sincronizacao: string,
    limite: string,
    agora: string,
  ): MudancaCache {
    const existentes = new Map(
      (
        this.db
          .prepare("SELECT id, id_externo FROM eventos WHERE calendario_id = ? AND id_externo IS NOT NULL")
          .all(calendarioId) as { id: string; id_externo: string }[]
      ).map((l) => [l.id_externo, l.id]),
    );
    const mudados = new Set<string>();
    const apagados = new Set<string>();
    const vistos = new Set<string>();
    const tirar = (idExterno: string) => {
      const id = existentes.get(idExterno);
      if (id === undefined) return;
      this.db.prepare("DELETE FROM eventos WHERE id = ?").run(id);
      existentes.delete(idExterno);
      mudados.delete(id);
      apagados.add(id);
    };
    const gravar = this.db.prepare(
      `INSERT INTO eventos (id, calendario_id, titulo, descricao, inicio, fim, dia_inteiro, local, recorrencia,
         id_externo, etag_externo, alertas, excecoes, criado_em, atualizado_em, origem)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)
       ON CONFLICT (calendario_id, id_externo) WHERE id_externo IS NOT NULL DO UPDATE SET
         titulo = excluded.titulo, descricao = excluded.descricao, inicio = excluded.inicio, fim = excluded.fim,
         dia_inteiro = excluded.dia_inteiro, local = excluded.local, recorrencia = excluded.recorrencia,
         etag_externo = excluded.etag_externo,
         excecoes = CASE WHEN ? THEN excluded.excecoes
           ELSE (SELECT json_group_array(value) FROM (
             SELECT value FROM json_each(eventos.excecoes) UNION SELECT value FROM json_each(excluded.excecoes)))
           END,
         atualizado_em = excluded.atualizado_em, origem = excluded.origem, apagado_em = NULL`,
    );
    for (const lido of lidos) {
      vistos.add(lido.idExterno);
      if (lido.tipo === "tirar" || antesDoCache(lido.campos, limite)) {
        tirar(lido.idExterno);
        continue;
      }
      const c = lido.campos;
      const id = existentes.get(lido.idExterno) ?? novoId();
      gravar.run(
        id,
        calendarioId,
        c.titulo,
        c.descricao,
        c.inicio,
        c.fim,
        c.diaInteiro ? 1 : 0,
        c.local,
        c.recorrencia,
        lido.idExterno,
        lido.etag,
        JSON.stringify(c.excecoes),
        agora,
        agora,
        ORIGEM,
        completa ? 1 : 0,
      );
      existentes.set(lido.idExterno, id);
      apagados.delete(id);
      mudados.add(id);
    }
    if (completa) {
      for (const idExterno of [...existentes.keys()]) if (!vistos.has(idExterno)) tirar(idExterno);
    }
    const juntar = this.db.prepare(
      `UPDATE eventos SET excecoes = json_insert(excecoes, '$[#]', ?), atualizado_em = ?
        WHERE id = ? AND recorrencia IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM json_each(eventos.excecoes) WHERE value = ?)`,
    );
    for (const lido of lidos) {
      if (lido.excecao === null) continue;
      const recorrente = existentes.get(lido.excecao.doRecorrente);
      if (recorrente === undefined) continue;
      const { inicioOriginal } = lido.excecao;
      if (Number(juntar.run(inicioOriginal, agora, recorrente, inicioOriginal).changes) > 0)
        mudados.add(recorrente);
    }
    this.db
      .prepare(
        `UPDATE calendarios SET token_sincronizacao = ?, sincronizado_em = ?, atualizado_em = ?, origem = ?
          WHERE id = ?`,
      )
      .run(sincronizacao, agora, agora, ORIGEM, calendarioId);
    return { mudados: [...mudados], apagados: [...apagados] };
  }

  /**
   * Tira do cache dos calendários lidos o que acabou antes de `limite` (o recorrente fica: a regra
   * ainda pode cair na janela). Devolve os ids que saíram.
   */
  podar(limite: string): string[] {
    const dia = limite.slice(0, 10);
    const condicao = `recorrencia IS NULL AND calendario_id IN (
        SELECT id FROM calendarios WHERE fonte = 'google' AND espelho = 0)
      AND ((dia_inteiro = 0 AND fim < ?) OR (dia_inteiro = 1 AND fim <= ?))`;
    const ids = (
      this.db.prepare(`SELECT id FROM eventos WHERE ${condicao}`).all(limite, dia) as { id: string }[]
    ).map((l) => l.id);
    if (ids.length > 0) this.db.prepare(`DELETE FROM eventos WHERE ${condicao}`).run(limite, dia);
    return ids;
  }

  transacao<T>(fazer: () => T): T {
    this.db.exec("BEGIN");
    try {
      const resultado = fazer();
      this.db.exec("COMMIT");
      return resultado;
    } catch (erro) {
      this.db.exec("ROLLBACK");
      throw erro;
    }
  }
}

/** O evento que não é recorrente e já acabou antes do começo do cache. */
function antesDoCache(
  c: { recorrencia: string | null; diaInteiro: boolean; fim: string },
  limite: string,
): boolean {
  if (c.recorrencia !== null) return false;
  return c.diaInteiro ? c.fim <= limite.slice(0, 10) : c.fim < limite;
}

/** Como terminou uma leitura. */
export type ResultadoLeitura = "lida" | "desligada" | "cota" | "erro";

export interface AvisosLeitura {
  /** Os eventos do cache que mudaram, pelos ids daqui. */
  eventos: (mudanca: MudancaCache) => void;
  /** A lista de calendários mudou (entrou, saiu, trocou de nome ou de cor). */
  calendarios: () => void;
  /** A leitura falhou e a conexão acabou de entrar em erro: a Alba fala (AGENTS.md §2, "Erro"). */
  erro: (aviso: { titulo: string; corpo: string }) => void;
}

export interface DependenciasLeitura {
  google: Pick<ServicoGoogleAgenda, "conexao" | "tokenDeAcesso" | "acessoRecusado" | "marcarLeitura">;
  repo: RepositorioLeituraGoogle;
  /** O fuso de `config`, para data e hora do Google sem fuso nenhum. */
  lerFuso: () => string;
  avisos: AvisosLeitura;
  enderecos?: Pick<EnderecosGoogle, "calendario">;
  buscar?: typeof fetch;
  agora?: () => Date;
  /** De 0 a 1, para a variação do intervalo e da espera; o teste fixa. */
  aleatorio?: () => number;
  /** A espera da cota; o teste não espera de verdade. */
  esperar?: (ms: number) => Promise<void>;
}

const esperarDeVerdade = (ms: number) =>
  new Promise<void>((pronto) => {
    setTimeout(pronto, ms).unref();
  });

/**
 * A leitura dos calendários do Google da Alba (F3-23, ADR-0035): a lista de calendários da conta
 * (o principal entra lido; os outros você escolhe em `agenda.definirCalendario`), depois os eventos
 * de cada um lido, pelo `nextSyncToken`, no cache `eventos`. Lê ao subir e a cada 10 minutos com
 * variação, na retomada, ao abrir a área, ao conectar e ao escolher ler um calendário. O 410 apaga
 * o cache daquele calendário e lê do zero; 403 de cota e 429 esperam e tentam de novo, e se o
 * Google continuar recusando, a leitura para sem erro e volta no próximo ciclo. Qualquer outra
 * falha põe a conexão em erro e a Alba avisa uma vez. Desconectar esquece os calendários lidos.
 */
export class LeituraGoogleAgenda {
  private readonly agora: () => Date;
  private readonly aleatorio: () => number;
  private readonly esperar: (ms: number) => Promise<void>;
  private readonly enderecos: Pick<EnderecosGoogle, "calendario">;
  private readonly buscar: typeof fetch;
  private emAndamento: Promise<ResultadoLeitura> | null = null;
  /** Muda a cada desconectar: a leitura que começou antes não grava depois. */
  private geracao = 0;
  private terminouEm: number | null = null;
  /** A conexão que esta leitura conhece: outra `conectadaEm` é uma conta conectada agora. */
  private conectadaEm: string | null;

  constructor(private readonly deps: DependenciasLeitura) {
    this.agora = deps.agora ?? (() => new Date());
    this.aleatorio = deps.aleatorio ?? Math.random;
    this.esperar = deps.esperar ?? esperarDeVerdade;
    this.enderecos = deps.enderecos ?? ENDERECOS_GOOGLE;
    this.buscar = deps.buscar ?? fetch;
    this.conectadaEm = deps.google.conexao().conectadaEm;
  }

  /** Lê agora; duas chamadas juntas viram uma leitura só. Nunca rejeita: o resultado diz como foi. */
  atualizar(): Promise<ResultadoLeitura> {
    if (this.emAndamento) return this.emAndamento;
    const leitura = this.ler(this.geracao).finally(() => {
      this.terminouEm = this.agora().getTime();
      if (this.emAndamento === leitura) this.emAndamento = null;
    });
    this.emAndamento = leitura;
    return leitura;
  }

  /** Abrir a área da agenda: lê, a não ser que a última leitura tenha acabado de terminar. */
  aoAbrirArea(): void {
    if (this.terminouEm !== null && this.agora().getTime() - this.terminouEm < FOLGA_AO_ABRIR_MS) return;
    void this.atualizar();
  }

  /** A conexão mudou: conectou agora (lê), desligou (esquece). O resto é a própria leitura. */
  aoMudarConexao(conexao: Conexao): void {
    if (conexao.estado === "desligada") {
      this.conectadaEm = null;
      this.esquecer();
      return;
    }
    if (conexao.estado === "ligada" && conexao.conectadaEm !== this.conectadaEm) {
      this.conectadaEm = conexao.conectadaEm;
      void this.atualizar();
    }
  }

  /**
   * Lê ao subir e depois de {@link INTERVALO_LEITURA_MS} com variação de {@link VARIACAO_LEITURA},
   * contado do fim de cada leitura. Não segura o processo aberto; devolve como parar.
   */
  vigiar(): () => void {
    let relogio: ReturnType<typeof setTimeout> | null = null;
    let parado = false;
    const ciclo = () => {
      void this.atualizar().finally(() => {
        if (parado) return;
        const variacao = 1 + VARIACAO_LEITURA * (2 * this.aleatorio() - 1);
        relogio = setTimeout(ciclo, Math.round(INTERVALO_LEITURA_MS * variacao));
        relogio.unref();
      });
    };
    ciclo();
    return () => {
      parado = true;
      if (relogio) clearTimeout(relogio);
    };
  }

  /** Tira do banco os calendários lidos e o cache deles; uma leitura no meio é descartada. */
  esquecer(): void {
    this.geracao++;
    const { mudou, apagados } = this.deps.repo.transacao(() =>
      this.deps.repo.esquecer(this.agora().toISOString()),
    );
    this.avisarMudanca({ mudados: [], apagados }, mudou);
  }

  private async ler(geracao: number): Promise<ResultadoLeitura> {
    if (this.deps.google.conexao().estado === "desligada") {
      // Calendário de uma conexão que já não existe (o serviço caiu no meio do desconectar) sai.
      if (this.deps.repo.calendarios().some((c) => c.espelho === 0)) this.esquecer();
      return "desligada";
    }
    try {
      await this.lerTudo(geracao);
      if (geracao !== this.geracao) return "desligada";
      this.deps.google.marcarLeitura({ ok: true });
      return "lida";
    } catch (erro) {
      if (geracao !== this.geracao) return "desligada";
      if (erro instanceof ErroCalendario && erro.falha === "cota") {
        console.error("google: a leitura da agenda passou da cota do Google; volta no próximo ciclo");
        return "cota";
      }
      console.error(`google: leitura da agenda falhou: ${mensagem(erro)}`);
      if (this.deps.google.marcarLeitura({ ok: false })) {
        this.deps.avisos.erro({ titulo: TITULO_LEITURA_FALHOU, corpo: CORPO_LEITURA_FALHOU });
      }
      return "erro";
    }
  }

  private async lerTudo(geracao: number): Promise<void> {
    const acesso = this.acesso();
    const lidos: CalendarioLido[] = [];
    let pagina: string | null = null;
    for (let n = 0; ; n++) {
      if (n >= MAXIMO_PAGINAS) throw new ErroCalendario("rede", "páginas demais na lista de calendários");
      const atual: string | null = pagina;
      const resposta: Awaited<ReturnType<typeof paginaDeCalendarios>> = await acesso((token) =>
        paginaDeCalendarios(this.buscar, this.enderecos, token, atual),
      );
      lidos.push(...resposta.calendarios);
      pagina = resposta.proxima;
      if (pagina === null) break;
    }
    if (geracao !== this.geracao) return;
    const agora = this.agora().toISOString();
    const lista = this.deps.repo.transacao(() => this.deps.repo.gravarCalendarios(lidos, agora));
    this.avisarMudanca({ mudados: [], apagados: lista.apagados }, lista.mudou);

    for (const calendario of this.deps.repo.paraLer()) {
      if (geracao !== this.geracao) return;
      try {
        await this.lerCalendario(calendario, geracao, acesso);
      } catch (erro) {
        // Calendário que sumiu entre a lista e os eventos: a próxima lista o tira.
        if (erro instanceof ErroCalendario && erro.status === 404) continue;
        throw erro;
      }
    }
    if (geracao !== this.geracao) return;
    const apagados = this.deps.repo.transacao(() => this.deps.repo.podar(this.limite()));
    this.avisarMudanca({ mudados: [], apagados }, false);
  }

  /** De onde o cache começa: 7 dias antes de agora. */
  private limite(): string {
    return new Date(this.agora().getTime() - DIAS_PARA_TRAS * MS_DIA).toISOString();
  }

  /** Lê um calendário pelo token; sem ele, ou com ele vencido (410), do zero. */
  private async lerCalendario(
    calendario: LinhaCalendarioGoogle,
    geracao: number,
    acesso: Acesso,
  ): Promise<void> {
    let ponto: PontoDeLeitura = calendario.token_sincronizacao
      ? { completa: false, sincronizacao: calendario.token_sincronizacao }
      : { completa: true, desde: this.limite() };
    let leitura;
    try {
      leitura = await this.lerEventos(calendario.id_externo, ponto, acesso);
    } catch (erro) {
      if (!(erro instanceof ErroCalendario && erro.falha === "sincronizacao-vencida") || ponto.completa)
        throw erro;
      if (geracao !== this.geracao) return;
      const apagados = this.deps.repo.transacao(() => this.deps.repo.limparCache(calendario.id));
      this.avisarMudanca({ mudados: [], apagados }, false);
      ponto = { completa: true, desde: this.limite() };
      leitura = await this.lerEventos(calendario.id_externo, ponto, acesso);
    }
    if (geracao !== this.geracao) return;
    const fuso = this.deps.lerFuso();
    const eventos = leitura.itens.flatMap((item) => {
      const lido = lerEvento(item, fuso);
      return lido ? [lido] : [];
    });
    const agora = this.agora().toISOString();
    const completa = ponto.completa;
    const mudanca = this.deps.repo.transacao(() =>
      this.deps.repo.aplicar(calendario.id, eventos, completa, leitura.sincronizacao, this.limite(), agora),
    );
    this.avisarMudanca(mudanca, false);
  }

  /** Todas as páginas dos eventos de um calendário, até o `nextSyncToken`. */
  private async lerEventos(
    calendarioId: string,
    ponto: PontoDeLeitura,
    acesso: Acesso,
  ): Promise<{ itens: unknown[]; sincronizacao: string }> {
    const itens: unknown[] = [];
    let pagina: string | null = null;
    for (let n = 0; n < MAXIMO_PAGINAS; n++) {
      const atual: string | null = pagina;
      const resposta: Awaited<ReturnType<typeof paginaDeEventos>> = await acesso((token) =>
        paginaDeEventos(this.buscar, this.enderecos, token, calendarioId, ponto, atual),
      );
      itens.push(...resposta.itens);
      if (resposta.proxima === null) {
        if (resposta.sincronizacao === null) throw new ErroCalendario("rede", "a leitura terminou sem token");
        return { itens, sincronizacao: resposta.sincronizacao };
      }
      pagina = resposta.proxima;
    }
    throw new ErroCalendario("rede", "páginas demais nos eventos");
  }

  /**
   * Quem faz os pedidos de uma leitura com o mesmo token: o 401 renova uma vez e repete; a cota
   * espera {@link ESPERAS_DA_COTA_MS} (com variação) e repete, e depois disso desiste.
   */
  private acesso(): Acesso {
    let token: string | null = null;
    let renovou = false;
    return async <T>(fazer: (token: string) => Promise<T>): Promise<T> => {
      for (let esperas = 0; ;) {
        token ??= await this.deps.google.tokenDeAcesso();
        try {
          return await fazer(token);
        } catch (erro) {
          if (!(erro instanceof ErroCalendario)) throw erro;
          if (erro.falha === "acesso" && !renovou) {
            renovou = true;
            this.deps.google.acessoRecusado(token);
            token = null;
            continue;
          }
          const espera = ESPERAS_DA_COTA_MS[esperas];
          if (erro.falha === "cota" && espera !== undefined) {
            esperas++;
            await this.esperar(Math.round(espera * (0.75 + this.aleatorio() / 2)));
            continue;
          }
          throw erro;
        }
      }
    };
  }

  private avisarMudanca(mudanca: MudancaCache, calendarios: boolean): void {
    if (calendarios) this.deps.avisos.calendarios();
    if (mudanca.mudados.length > 0 || mudanca.apagados.length > 0) this.deps.avisos.eventos(mudanca);
  }
}

type Acesso = <T>(fazer: (token: string) => Promise<T>) => Promise<T>;
