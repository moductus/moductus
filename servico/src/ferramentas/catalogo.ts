import type { Capacidade } from "@moductus/contrato";
import type {
  ChamadaDeFerramenta,
  FerramentaOferecida,
  ResultadoDeFerramenta,
} from "../provedores/provedor.ts";
import { capacidade, oferecida, type ContextoFerramenta, type Ferramenta } from "./ferramenta.ts";

/**
 * O catálogo único (AGENTS.md §4, ADR-0008): todas as ferramentas do serviço, e o recorte de cada
 * agente. O agente só recebe as ferramentas da lista dele (`tarefas.criar`, `sessoes.*`); o resto
 * do catálogo não aparece para ele nem roda se ele chamar pelo nome.
 */

/** `dominio.*` cobre o domínio inteiro; qualquer outro padrão, só o nome exato. */
export function cobre(padrao: string, nome: string): boolean {
  if (padrao.endsWith(".*")) return nome.startsWith(padrao.slice(0, -1));
  return padrao === nome;
}

/** Uma ação `externo` prestes a rodar: o que a aprovação precisa para montar o cartão. */
export interface PedidoAutorizacao {
  ferramenta: Ferramenta;
  /** A entrada já validada. */
  entrada: unknown;
  contexto: ContextoFerramenta;
}

export type Autorizacao = { permitida: true } | { permitida: false; motivo: string };

/** Quem dá o sim de uma ação `externo`: o cartão de aprovação ou uma regra do usuário. */
export type Autorizar = (pedido: PedidoAutorizacao) => Promise<Autorizacao>;

export class Catalogo {
  private readonly porNome = new Map<string, Ferramenta>();
  private readonly porNomeModelo = new Map<string, Ferramenta>();

  constructor(ferramentas: readonly Ferramenta[] = []) {
    this.registrar(...ferramentas);
  }

  /** Cada domínio registra as suas na subida; nome repetido é erro de montagem. */
  registrar(...ferramentas: readonly Ferramenta[]): this {
    for (const f of ferramentas) {
      if (this.porNome.has(f.nome) || this.porNomeModelo.has(f.nomeModelo)) {
        throw new Error(`ferramenta "${f.nome}" registrada duas vezes`);
      }
      this.porNome.set(f.nome, f);
      this.porNomeModelo.set(f.nomeModelo, f);
    }
    return this;
  }

  /** Todas, em ordem de nome. */
  todas(): Ferramenta[] {
    return [...this.porNome.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  }

  /** Pelo nome do catálogo (`sessoes.listar`) ou pelo que o modelo usa (`sessoes__listar`). */
  obter(nome: string): Ferramenta | null {
    return this.porNome.get(nome) ?? this.porNomeModelo.get(nome) ?? null;
  }

  /** O recorte de um agente pela lista de padrões dele (`agentes.ferramentas`). */
  doAgente(padroes: readonly string[]): EscopoAgente {
    return new EscopoAgente(this.todas().filter((f) => padroes.some((p) => cobre(p, f.nome))));
  }
}

/**
 * O que um agente enxerga do catálogo. Daqui saem as ferramentas oferecidas ao modelo, a lista
 * `/capacidades` e o `executarFerramenta` do pedido ao provedor.
 */
export class EscopoAgente {
  private readonly porNome = new Map<string, Ferramenta>();

  constructor(readonly ferramentas: readonly Ferramenta[]) {
    // O modelo chama pelo nome com `__`; a interface e o MCP, pelo nome do catálogo.
    for (const f of ferramentas) {
      this.porNome.set(f.nome, f);
      this.porNome.set(f.nomeModelo, f);
    }
  }

  /** Só dentro do escopo, por qualquer um dos dois nomes. */
  obter(nome: string): Ferramenta | null {
    return this.porNome.get(nome) ?? null;
  }

  /** Com a entrada em JSON Schema, para o tool calling das APIs e o MCP. */
  oferecidas(): FerramentaOferecida[] {
    return this.ferramentas.map(oferecida);
  }

  capacidades(): Capacidade[] {
    return this.ferramentas.map(capacidade);
  }

  /**
   * O `executarFerramenta` de uma execução. Fora do escopo, entrada inválida e erro da área voltam
   * ao modelo como texto, para ele corrigir. `externo` só roda com o sim de `autorizar`; sem ele,
   * é recusado (segurança: ação fora do Moductus nunca roda sem aprovação). O cancelamento da
   * execução não vira resultado: sobe como exceção.
   */
  executor(
    contexto: ContextoFerramenta,
    autorizar?: Autorizar,
  ): (chamada: ChamadaDeFerramenta) => Promise<ResultadoDeFerramenta> {
    return async (chamada) => {
      // Execução já cancelada não roda nada nem pede aprovação.
      contexto.sinal.throwIfAborted();
      const f = this.obter(chamada.nome);
      if (!f) {
        // A mesma resposta para o que não existe e para o que é de outro agente.
        return {
          ok: false,
          erro: `A ferramenta "${chamada.nome}" não está disponível. Use uma das ferramentas oferecidas.`,
        };
      }
      const validacao = f.validar(chamada.entrada);
      if (!validacao.ok) return { ok: false, erro: validacao.erro };

      if (f.efeito === "externo") {
        if (!autorizar) {
          return {
            ok: false,
            erro: `${f.nome} age fora do Moductus e precisa da aprovação do usuário, que esta execução não pode pedir.`,
          };
        }
        const autorizacao = await autorizar({ ferramenta: f, entrada: validacao.valor, contexto });
        contexto.sinal.throwIfAborted();
        if (!autorizacao.permitida) return { ok: false, erro: autorizacao.motivo };
      }

      try {
        const valor = await f.executar(validacao.valor, contexto);
        return { ok: true, valor: valor ?? null };
      } catch (erro) {
        contexto.sinal.throwIfAborted();
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        return { ok: false, erro: `${f.nome} falhou: ${mensagem}` };
      }
    };
  }
}
