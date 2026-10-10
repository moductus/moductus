import {
  TIPOS_PROVEDOR_CLI,
  type Agente,
  type Provedor,
  type ProvedorDetectado,
  type TipoProvedorCli,
} from "@moductus/contrato";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { Campo } from "../../componentes/Campo.tsx";
import { FalaAgente } from "../../componentes/FalaAgente.tsx";
import { Icone } from "../../componentes/Icone.tsx";
import { eAgente, type Agente as IdAgente } from "../../componentes/personagem/agentes.ts";
import { Personagem } from "../../componentes/personagem/Personagem.tsx";
import { fraseDaSituacao, lerSituacao, modeloDoAgente } from "../../componentes/personagem/situacao.ts";
import { Seletor, type OpcaoSeletor } from "../../componentes/Seletor.tsx";
import { Selo, type TomSelo } from "../../componentes/Selo.tsx";
import {
  CLIS,
  FORMULARIO_API_VAZIO,
  novoDaApi,
  situacaoDoCli,
  type FormularioApi,
  type TipoApi,
} from "../../janelas/sistema/primeiro-uso/modelo.ts";
import { comArtigo, deAgente } from "../agentes/nomes.ts";
import { useAgora } from "../tempo.ts";
import {
  contarDeHoje,
  descreverProvedor,
  estadoDoProvedor,
  execucoesEmTexto,
  falaDaTroca,
  temChaveTrocavel,
  escolhaInicial,
  mudancaDoPainel,
  type EscolhaModelo,
  type EstadoProvedor,
} from "./modelos.ts";
import { Aviso, Carregando } from "./Partes.tsx";
import { Secao } from "./Secao.tsx";
import { useModelos, type ModelosDaSecao } from "./useModelos.ts";

/** O que cada agente faz, curto, como a coluna do quadro (ConfigModelos.dc.html). */
const PAPEL: Readonly<Record<IdAgente, string>> = {
  alba: "o dia a dia",
  tula: "finanças",
  faina: "o serviço pesado",
  nuno: "dev e sessões de IA",
};

const TIPOS_API: readonly OpcaoSeletor<TipoApi>[] = [
  { valor: "openai", rotulo: "OpenAI" },
  { valor: "openai-compativel", rotulo: "Compatível com OpenAI" },
];

const ehCli = (tipo: string): tipo is TipoProvedorCli =>
  (TIPOS_PROVEDOR_CLI as readonly string[]).includes(tipo);

/** "no Nuno", "na Alba": para o botão dizer em quem a troca vale. */
const emAgente = (agente: Agente) => (eAgente(agente.id) ? `n${comArtigo(agente.id)}` : `em ${agente.nome}`);
const doAgente = (agente: Agente) => (eAgente(agente.id) ? deAgente(agente.id) : `de ${agente.nome}`);

/** O painel de troca aberto: de qual agente e o que foi escolhido na tabela antes de abrir. */
interface PainelAberto {
  agenteId: string;
  escolha: EscolhaModelo;
}

/**
 * Configurações › Modelos (ConfigModelos, ConfigModelosAgente e ConfigModelosVazio.dc.html): os
 * provedores conectados com o teste de verdade, e o principal, a reserva e o teto de cada agente.
 * Trocar vale na próxima execução; quem grava e decide é o serviço.
 */
export function SecaoModelos() {
  const m = useModelos();
  const agora = useAgora();
  // O agente com o painel aberto e o que foi escolhido na tabela; grava só com o sim no painel.
  const [painel, setPainel] = useState<PainelAberto | null>(null);
  const [formulario, setFormulario] = useState<TipoApi | null>(null);
  const vazio = m.provedores !== null && m.provedores.length === 0;
  const { procurar } = m;

  // Sem nenhum provedor, a tela já procura os CLIs: é o caminho mais curto até o primeiro modelo.
  useEffect(() => {
    if (vazio && m.conectado) void procurar();
  }, [vazio, m.conectado, procurar]);

  if (!m.provedores || !m.agentes) {
    return (
      <Secao titulo="Modelos">
        <Carregando />
      </Secao>
    );
  }
  const { provedores, agentes } = m;
  const travado = !m.conectado;

  return (
    <Secao titulo="Modelos">
      <div className="config-modelos-topo">
        <p className="config-intro">
          Cada agente usa um provedor principal e, se quiser, uma reserva para quando o principal falhar.
        </p>
        {!vazio && (
          <div className="config-modelos-botoes">
            <Botao disabled={travado || m.procurando} onClick={() => void m.procurar()}>
              Procurar no PC
            </Botao>
            <Botao variante="primario" disabled={travado} onClick={() => setFormulario("openai")}>
              Adicionar provedor
            </Botao>
          </div>
        )}
      </div>
      {m.erro && <Aviso>{m.erro}</Aviso>}
      {vazio && <SemModelo aoProcurar={() => void m.procurar()} aoChave={setFormulario} travado={travado} />}
      {formulario && (
        <FormularioChave
          tipoInicial={formulario}
          aoFechar={() => setFormulario(null)}
          aoConectar={async (novo) => {
            if (await m.conectar(novo)) setFormulario(null);
          }}
        />
      )}
      {(m.procurando || m.detectados) && (
        <Detectados
          detectados={m.detectados}
          provedores={provedores}
          travado={travado}
          aoConectar={(tipo, nome) => void m.conectar({ tipo, nome })}
        />
      )}
      {!vazio && (
        <>
          <TabelaProvedores modelos={m} provedores={provedores} agentes={agentes} agora={agora} />
          <TabelaAgentes
            modelos={m}
            provedores={provedores}
            agentes={agentes}
            agora={agora}
            painel={painel}
            aoAbrir={setPainel}
          />
          <p className="config-nota">
            A execução que está rodando termina no modelo de antes. No teto do dia, o agente dorme até a
            meia-noite e os pedidos esperam na fila.
          </p>
          <p className="config-nota config-modelos-escopo">
            <Icone nome="escudo" tamanho={14} />
            Trocar o modelo não muda o que o agente pode fazer: ferramentas e permissões ficam na página dele,
            em Agentes.
          </p>
        </>
      )}
    </Secao>
  );
}

/* ---------- Nenhum modelo (ConfigModelosVazio.dc.html) ---------- */

function SemModelo({
  aoProcurar,
  aoChave,
  travado,
}: {
  aoProcurar: () => void;
  aoChave: (tipo: TipoApi) => void;
  travado: boolean;
}) {
  return (
    <>
      <section className="config-modelos-vazio" aria-label="Nenhum modelo conectado">
        <span className="config-modelos-vazio-time" aria-hidden="true">
          {(["alba", "tula", "faina", "nuno"] as const).map((a) => (
            <Personagem key={a} agente={a} modo="cabeca" tamanho="dock" estado="dormindo" />
          ))}
        </span>
        <span className="config-modelos-vazio-textos">
          <h3 className="config-modelos-vazio-titulo">Nenhum modelo conectado</h3>
          <span className="config-modelos-texto">
            Os quatro estão dormindo. Lembretes e vigias continuam; o que precisa de modelo espera na fila até
            você conectar um.
          </span>
        </span>
      </section>
      <div className="config-modelos-rotulos">
        <span>Conectar um provedor</span>
        <span>dá para trocar por agente depois</span>
      </div>
      <ul className="config-modelos-caminhos" aria-label="Conectar um provedor">
        <Caminho
          titulo="Assinatura que você já tem"
          quais="Claude Code, Codex, Gemini CLI"
          texto="Usa o CLI instalado no PC e o login dele. Sem custo além da assinatura."
          acao={
            <Botao variante="primario" disabled={travado} onClick={aoProcurar}>
              Procurar no PC
            </Botao>
          }
        />
        <Caminho
          titulo="Chave de API"
          quais="OpenAI"
          texto="Paga por uso. A chave fica no Gerenciador de Credenciais do Windows, nunca no banco."
          acao={
            <Botao disabled={travado} onClick={() => aoChave("openai")}>
              Colar chave
            </Botao>
          }
        />
        <Caminho
          titulo="Compatível com OpenAI"
          quais="OpenRouter, Ollama, LM Studio"
          texto="Por endereço, com chave se o serviço pedir. Modelo local roda sem internet."
          acao={
            <Botao disabled={travado} onClick={() => aoChave("openai-compativel")}>
              Informar endereço
            </Botao>
          }
        />
      </ul>
    </>
  );
}

function Caminho({
  titulo,
  quais,
  texto,
  acao,
}: {
  titulo: string;
  quais: string;
  texto: string;
  acao: ReactNode;
}) {
  return (
    <li className="config-modelos-caminho">
      <span className="config-modelos-nome">{titulo}</span>
      <span className="config-modelos-sub">{quais}</span>
      <span className="config-modelos-texto">{texto}</span>
      <span className="config-modelos-caminho-acao">{acao}</span>
    </li>
  );
}

/* ---------- Os CLIs achados no PC ---------- */

function Detectados({
  detectados,
  provedores,
  travado,
  aoConectar,
}: {
  detectados: ProvedorDetectado[] | null;
  provedores: readonly Provedor[];
  travado: boolean;
  aoConectar: (tipo: TipoProvedorCli, nome: string) => void;
}) {
  return (
    <section className="config-modelos-grupo" aria-label="CLIs no PC" aria-busy={detectados === null}>
      <div className="config-modelos-rotulos">
        <span>{detectados === null ? "Procurando no PC" : "Achados no PC"}</span>
        <span>CLIs no PATH</span>
      </div>
      <ul className="config-modelos-lista">
        {CLIS.map((c) => {
          const achado = detectados?.find((d) => d.tipo === c.tipo);
          const situacao =
            detectados === null
              ? {
                  estado: "procurando",
                  tom: "neutro" as const,
                  texto: "Procurando no PATH…",
                  escolhivel: false,
                }
              : situacaoDoCli(c.nome, achado);
          const conectado = provedores.some((p) => p.tipo === c.tipo);
          return (
            <li key={c.tipo} className="config-modelos-linha">
              <span className="config-modelos-textos">
                <span className="config-modelos-nome">{c.nome}</span>
                <span className="config-modelos-sub">{situacao.texto}</span>
              </span>
              <Selo forma="ponto" tom={conectado ? "sucesso" : situacao.tom}>
                {conectado ? "conectado" : situacao.estado}
              </Selo>
              <span className="config-modelos-acoes">
                {situacao.escolhivel && !conectado && (
                  <Botao
                    tamanho="pequeno"
                    disabled={travado}
                    aria-label={`Conectar ${c.nome} e testar`}
                    onClick={() => aoConectar(c.tipo, c.nome)}
                  >
                    Conectar
                  </Botao>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------- Chave de API ---------- */

function FormularioChave({
  tipoInicial,
  aoFechar,
  aoConectar,
}: {
  tipoInicial: TipoApi;
  aoFechar: () => void;
  aoConectar: (novo: ReturnType<typeof novoDaApi>) => Promise<void>;
}) {
  const [formulario, setFormulario] = useState<FormularioApi>({ ...FORMULARIO_API_VAZIO, tipo: tipoInicial });
  const [enviando, setEnviando] = useState(false);
  const mudar = (parte: Partial<FormularioApi>) => setFormulario((f) => ({ ...f, ...parte }));
  const enviar = async () => {
    setEnviando(true);
    await aoConectar(novoDaApi(formulario));
    setEnviando(false);
  };
  const aoTeclar = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      aoFechar();
    }
  };
  return (
    <section
      className="config-modelos-formulario"
      aria-label="Conectar por chave de API"
      onKeyDown={aoTeclar}
    >
      <div className="config-modelos-formulario-campos">
        <div className="config-modelos-campo">
          <span className="config-modelos-sub">Provedor</span>
          <Seletor
            rotulo="Provedor da chave"
            opcoes={TIPOS_API}
            valor={formulario.tipo}
            aoMudar={(tipo) => mudar({ tipo })}
          />
        </div>
        {formulario.tipo === "openai-compativel" && (
          <Campo
            rotulo="Endereço (base_url)"
            placeholder="http://localhost:11434/v1"
            value={formulario.baseUrl}
            disabled={enviando}
            onChange={(e) => mudar({ baseUrl: e.target.value })}
          />
        )}
        <Campo
          rotulo="Modelo"
          placeholder={formulario.tipo === "openai" ? "gpt-5-mini" : "qwen3:8b"}
          value={formulario.modelo}
          disabled={enviando}
          onChange={(e) => mudar({ modelo: e.target.value })}
        />
        <Campo
          rotulo="Chave"
          type="password"
          autoComplete="off"
          dica={
            formulario.tipo === "openai"
              ? "Fica no Gerenciador de Credenciais do Windows."
              : "Opcional para modelo local. Fica no Gerenciador de Credenciais do Windows."
          }
          value={formulario.chave}
          disabled={enviando}
          onChange={(e) => mudar({ chave: e.target.value })}
        />
      </div>
      <div className="config-rodape">
        <Botao variante="fantasma" disabled={enviando} aria-keyshortcuts="Escape" onClick={aoFechar}>
          Cancelar
        </Botao>
        <Botao variante="primario" disabled={enviando} onClick={() => void enviar()}>
          Conectar e testar
        </Botao>
      </div>
    </section>
  );
}

/* ---------- Provedores ---------- */

function TabelaProvedores({
  modelos,
  provedores,
  agentes,
  agora,
}: {
  modelos: ModelosDaSecao;
  provedores: readonly Provedor[];
  agentes: readonly Agente[];
  agora: Date;
}) {
  return (
    <section className="config-modelos-grupo" aria-label="Provedores">
      <div className="config-modelos-rotulos">
        <span>Provedores</span>
        <span>
          {provedores.length} {provedores.length === 1 ? "conectado" : "conectados"}
        </span>
      </div>
      <div className="config-tabela">
        <table>
          <caption className="so-leitor">Provedores</caption>
          <thead>
            <tr>
              <th scope="col">Provedor</th>
              <th scope="col" className="config-tabela-estado">
                Estado
              </th>
              <th scope="col" className="config-tabela-resposta">
                Resposta
              </th>
              <th scope="col">
                <span className="so-leitor">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {provedores.map((p) => (
              <LinhaProvedor
                key={p.id}
                provedor={p}
                estado={estadoDoProvedor(p, modelos.testes[p.id], agentes, agora)}
                travado={!modelos.conectado}
                testando={modelos.testes[p.id]?.fase === "testando"}
                aoTestar={() => void modelos.testar(p.id)}
                aoTrocarChave={(chave) => modelos.trocarChave(p.id, chave)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LinhaProvedor({
  provedor,
  estado,
  travado,
  testando,
  aoTestar,
  aoTrocarChave,
}: {
  provedor: Provedor;
  estado: EstadoProvedor;
  travado: boolean;
  testando: boolean;
  aoTestar: () => void;
  aoTrocarChave: (chave: string) => Promise<boolean>;
}) {
  const [trocando, setTrocando] = useState(false);
  const [chave, setChave] = useState("");
  const guardar = async () => {
    if (!chave.trim()) return;
    if (await aoTrocarChave(chave.trim())) {
      setChave("");
      setTrocando(false);
    }
  };
  const extra = estado.erro || trocando;
  return (
    <>
      <tr data-com-extra={extra || undefined}>
        <th scope="row">
          <span className="config-modelos-textos">
            <span className="config-modelos-nome">{provedor.nome}</span>
            <span className="config-modelos-sub">{descreverProvedor(provedor)}</span>
          </span>
        </th>
        <td>
          <span className="config-modelos-estado">
            <Selo forma="ponto" tom={estado.tom}>
              {estado.texto}
            </Selo>
            {testando && <span className="config-modelos-trilho" aria-hidden="true" />}
          </span>
        </td>
        <td>
          <span className="config-modelos-textos">
            <span className="config-modelos-numero">{estado.resposta}</span>
            {estado.quando && <span className="config-modelos-sub">{estado.quando}</span>}
          </span>
        </td>
        <td>
          <span className="config-modelos-acoes">
            <Botao
              tamanho="pequeno"
              disabled={travado || testando}
              aria-label={`Testar ${provedor.nome}`}
              onClick={aoTestar}
            >
              {testando ? "Testando…" : "Testar"}
            </Botao>
            {temChaveTrocavel(provedor) && (
              <Botao
                tamanho="pequeno"
                variante={estado.tom === "perigo" ? "primario" : "secundario"}
                disabled={travado || testando}
                aria-label={`Trocar a chave de ${provedor.nome}`}
                aria-expanded={trocando}
                onClick={() => setTrocando((t) => !t)}
              >
                Trocar chave
              </Botao>
            )}
          </span>
        </td>
      </tr>
      {extra && (
        <tr className="config-tabela-extra">
          <td colSpan={4}>
            {estado.erro && (
              <p className="config-modelos-erro">
                {estado.erro}
                {estado.comando && <code className="config-conexao-comando">{estado.comando}</code>}
              </p>
            )}
            {trocando && (
              <div className="config-modelos-chave">
                <Campo
                  rotulo={`Chave nova de ${provedor.nome}`}
                  type="password"
                  autoComplete="off"
                  dica="Fica no Gerenciador de Credenciais do Windows."
                  value={chave}
                  onChange={(e) => setChave(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void guardar();
                    if (e.key === "Escape") setTrocando(false);
                  }}
                />
                <Botao variante="fantasma" onClick={() => setTrocando(false)}>
                  Cancelar
                </Botao>
                <Botao variante="primario" disabled={!chave.trim()} onClick={() => void guardar()}>
                  Guardar e testar
                </Botao>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/* ---------- Agentes ---------- */

function TabelaAgentes({
  modelos,
  provedores,
  agentes,
  agora,
  painel,
  aoAbrir,
}: {
  modelos: ModelosDaSecao;
  provedores: readonly Provedor[];
  agentes: readonly Agente[];
  agora: Date;
  painel: PainelAberto | null;
  aoAbrir: (aberto: PainelAberto | null) => void;
}) {
  const tomDe = (id: string | null) => tomDoProvedor(id, provedores, modelos, agora, agentes);
  const travado = !modelos.conectado;
  return (
    <section className="config-modelos-grupo" aria-label="Agentes">
      <div className="config-modelos-rotulos">
        <span>Agentes</span>
        <span className="config-modelos-pendencia">
          trocar vale na próxima execução
          <span className="config-pendente">moeda do teto a decidir</span>
        </span>
      </div>
      <div className="config-tabela">
        <table>
          <caption className="so-leitor">Modelo de cada agente</caption>
          <thead>
            <tr>
              <th scope="col">Agente</th>
              <th scope="col" className="config-tabela-lista">
                Principal
              </th>
              <th scope="col" className="config-tabela-lista">
                Reserva
              </th>
              <th scope="col" className="config-tabela-teto">
                Teto por dia
              </th>
              <th scope="col">Hoje</th>
            </tr>
          </thead>
          <tbody>
            {agentes.map((a) =>
              painel?.agenteId === a.id ? (
                <tr key={a.id} className="config-tabela-extra">
                  <td colSpan={5}>
                    <PainelAgente
                      agente={a}
                      provedores={provedores}
                      modelos={modelos}
                      agora={agora}
                      escolha={painel.escolha}
                      aoFechar={() => aoAbrir(null)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={a.id}>
                  <th scope="row">
                    <CabecaAgente
                      agente={a}
                      provedores={provedores}
                      agora={agora}
                      aoAbrir={() => aoAbrir({ agenteId: a.id, escolha: {} })}
                    />
                  </th>
                  <td>
                    <ListaProvedor
                      rotulo={`Principal ${doAgente(a)}`}
                      valor={a.provedorId}
                      provedores={provedores}
                      tom={tomDe(a.provedorId)}
                      desativada={travado}
                      // Escolher não grava (a seta numa lista nativa muda a cada toque): abre o
                      // painel do agente com a escolha, e só o sim lá grava.
                      aoMudar={(id) => {
                        if (id) aoAbrir({ agenteId: a.id, escolha: { principal: id } });
                      }}
                    />
                  </td>
                  <td>
                    <ListaProvedor
                      rotulo={`Reserva ${doAgente(a)}`}
                      valor={a.provedorReservaId}
                      provedores={provedores.filter((p) => p.id !== a.provedorId)}
                      tom={tomDe(a.provedorReservaId)}
                      nenhuma
                      desativada={travado || a.provedorId === null}
                      aoMudar={(id) => aoAbrir({ agenteId: a.id, escolha: { reserva: id } })}
                    />
                  </td>
                  <td>
                    <Teto />
                  </td>
                  <td>
                    <Hoje lidas={modelos.execucoes[a.id]} agora={agora} />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A cabeça, o nome e o papel; parado (sem modelo, dormindo, pausado), a frase do estado. */
function CabecaAgente({
  agente,
  provedores,
  agora,
  aoAbrir,
}: {
  agente: Agente;
  provedores: readonly Provedor[];
  agora: Date;
  aoAbrir: () => void;
}) {
  // O modelo diz se a credencial recusada é login no terminal (CLI) ou chave (API).
  const modelo = modeloDoAgente(agente.provedorId, provedores);
  const leitura = lerSituacao(agente.situacao, agora, modelo);
  const parado = fraseDaSituacao(agente.situacao, agora, modelo);
  return (
    <button
      type="button"
      className="config-modelos-agente"
      aria-label={`Modelo ${doAgente(agente)}: abrir as opções`}
      onClick={aoAbrir}
    >
      {eAgente(agente.id) && (
        <Personagem agente={agente.id} modo="cabeca" tamanho="notificacoes" estado={leitura.expressao} />
      )}
      <span className="config-modelos-textos">
        <span className="config-modelos-nome">{agente.nome}</span>
        {parado ? (
          <span className="config-modelos-sub" data-tom={leitura.tom}>
            {parado}
          </span>
        ) : (
          <span className="config-modelos-sub">{eAgente(agente.id) ? PAPEL[agente.id] : agente.funcao}</span>
        )}
      </span>
    </button>
  );
}

interface PropsListaProvedor {
  rotulo: string;
  valor: string | null;
  provedores: readonly Provedor[];
  /** O ponto do provedor escolhido, com a cor do estado dele (o nome diz qual é). */
  tom: TomSelo;
  /** Oferece "Nenhuma" (a reserva). */
  nenhuma?: boolean;
  desativada: boolean;
  aoMudar: (id: string | null) => void;
}

/** Lista suspensa nativa (teclado e Esc do Windows) com o ponto do estado e a seta do campo. */
function ListaProvedor({ rotulo, valor, provedores, tom, nenhuma, desativada, aoMudar }: PropsListaProvedor) {
  return (
    <span className="config-lista config-lista--ponto" data-desativada={desativada || undefined}>
      <span className="config-lista-ponto" data-tom={valor ? tom : "apagado"} aria-hidden="true" />
      <select
        aria-label={rotulo}
        value={valor ?? ""}
        disabled={desativada}
        onChange={(e) => aoMudar(e.target.value || null)}
      >
        {nenhuma ? (
          <option value="">Nenhuma</option>
        ) : (
          valor === null && (
            <option value="" disabled hidden>
              Escolha um modelo
            </option>
          )
        )}
        {provedores.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome}
          </option>
        ))}
      </select>
      <Icone nome="abrirLista" tamanho={12} />
    </span>
  );
}

/**
 * O teto por dia: a moeda ainda não foi decidida, então o serviço não grava valor que vale como
 * limite. A linha diz "sem teto" e o "Definir" fica travado, com o motivo ao lado.
 */
function Teto() {
  const id = useId();
  return (
    <span className="config-modelos-teto">
      <span className="config-modelos-sub">sem teto</span>
      <Botao tamanho="pequeno" variante="fantasma" disabled aria-describedby={id}>
        Definir
      </Botao>
      <span id={id} className="so-leitor">
        A moeda do teto ainda não foi decidida.
      </span>
    </span>
  );
}

function Hoje({ lidas, agora }: { lidas: ModelosDaSecao["execucoes"][string] | undefined; agora: Date }) {
  if (!lidas) return <span className="config-modelos-sub">—</span>;
  const quantas = contarDeHoje(lidas.itens, agora);
  // Com mais páginas e todas as lidas de hoje, pode haver mais do que a tela leu.
  const temMais = lidas.temMais && quantas === lidas.itens.length;
  return <span className="config-modelos-numero">{execucoesEmTexto(quantas, temMais)}</span>;
}

/* ---------- Trocar o modelo de um agente (ConfigModelosAgente.dc.html) ---------- */

function PainelAgente({
  agente,
  provedores,
  modelos,
  agora,
  escolha,
  aoFechar,
}: {
  agente: Agente;
  provedores: readonly Provedor[];
  modelos: ModelosDaSecao;
  agora: Date;
  /** O que foi escolhido numa lista da tabela, já marcado ao abrir. */
  escolha: EscolhaModelo;
  aoFechar: () => void;
}) {
  const idTitulo = useId();
  const [inicial] = useState(() => escolhaInicial(agente, escolha));
  const [principal, setPrincipal] = useState<string | null>(inicial.principal);
  const [reserva, setReserva] = useState<string | null>(inicial.reserva);
  const [gravando, setGravando] = useState(false);
  const marcado = useRef<HTMLInputElement>(null);
  const modelo = modeloDoAgente(agente.provedorId, provedores);
  const leitura = lerSituacao(agente.situacao, agora, modelo);
  const parado = fraseDaSituacao(agente.situacao, agora, modelo);
  const nome = (id: string | null) => provedores.find((p) => p.id === id)?.nome ?? null;
  // A lista da tabela saiu de cena ao abrir: o foco vem para a escolha marcada no painel.
  useEffect(() => marcado.current?.focus(), []);
  // A reserva não pode ser o principal: escolher o principal que era a reserva troca os dois.
  const escolherPrincipal = (id: string) => {
    if (id === reserva) setReserva(principal);
    setPrincipal(id);
  };
  const mudanca = mudancaDoPainel(agente, { principal, reserva });
  const mudouPrincipal = principal !== agente.provedorId;
  const confirmar = async () => {
    if (!mudanca) return;
    setGravando(true);
    const ok = await modelos.definir(mudanca);
    setGravando(false);
    if (ok) aoFechar();
  };
  const aoTeclar = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      aoFechar();
    }
  };
  const travado = !modelos.conectado || gravando;

  return (
    <section className="config-modelos-painel" aria-labelledby={idTitulo} onKeyDown={aoTeclar}>
      <div className="config-modelos-painel-topo">
        {eAgente(agente.id) && (
          <Personagem agente={agente.id} modo="cabeca" tamanho="dock" estado={leitura.expressao} />
        )}
        <span className="config-modelos-textos">
          <span className="config-modelos-painel-titulo">
            <h3 id={idTitulo}>Modelo {doAgente(agente)}</h3>
            {parado && (
              <Selo forma="ponto" tom={leitura.tom}>
                {parado}
              </Selo>
            )}
          </span>
          <span className="config-modelos-sub">
            {agente.provedorId
              ? `Usa o ${nome(agente.provedorId) ?? "provedor escolhido"}${
                  agente.provedorReservaId
                    ? `; a reserva é o ${nome(agente.provedorReservaId) ?? "outro"}`
                    : ""
                }.`
              : "Sem modelo: escolha um para ele acordar."}
          </span>
        </span>
        <Botao
          variante="fantasma"
          tamanho="pequeno"
          icone="fechar"
          aria-label="Fechar"
          aria-keyshortcuts="Escape"
          onClick={aoFechar}
        />
      </div>
      <div className="config-modelos-painel-grade">
        <fieldset className="config-modelos-opcoes">
          <legend className="config-modelos-sub">Principal</legend>
          {provedores.map((p) => {
            const estado = estadoDoProvedor(p, modelos.testes[p.id], [agente], agora);
            return (
              <label key={p.id} className="config-modelos-opcao" data-marcada={principal === p.id}>
                <input
                  ref={principal === p.id ? marcado : undefined}
                  type="radio"
                  name={`principal-${agente.id}`}
                  checked={principal === p.id}
                  disabled={travado}
                  onChange={() => escolherPrincipal(p.id)}
                />
                <span className="config-modelos-textos">
                  <span className="config-modelos-nome">
                    {p.nome}
                    {p.id === agente.provedorId && <span className="config-modelos-atual">atual</span>}
                  </span>
                  <span className="config-modelos-sub">
                    {ehCli(p.tipo) ? "sua assinatura" : "por uso"}
                    {p.id === agente.provedorReservaId ? " · é a reserva hoje" : ""}
                  </span>
                </span>
                <Selo forma="ponto" tom={estado.tom}>
                  {estado.texto}
                </Selo>
                <span className="config-modelos-numero">{estado.resposta}</span>
              </label>
            );
          })}
        </fieldset>
        <div className="config-modelos-coluna">
          <span className="config-modelos-sub">Reserva</span>
          <ListaProvedor
            rotulo={`Reserva ${doAgente(agente)}`}
            valor={reserva}
            provedores={provedores.filter((p) => p.id !== principal)}
            tom={tomDoProvedor(reserva, provedores, modelos, agora)}
            nenhuma
            desativada={travado || principal === null}
            aoMudar={setReserva}
          />
          <span className="config-modelos-texto">
            Entra quando o principal falha. Enquanto ela responder, {comArtigoOuNome(agente)} não dorme.
          </span>
        </div>
        <div className="config-modelos-coluna">
          <span className="config-modelos-pendencia">
            <span className="config-modelos-sub">Teto por dia</span>
            <span className="config-pendente">moeda a decidir</span>
          </span>
          <Teto />
          <span className="config-modelos-texto">
            Sem teto por enquanto: o custo é medido em dólar e a moeda do teto ainda não foi decidida.
          </span>
        </div>
      </div>
      {mudanca && principal && (
        <div className="config-modelos-painel-fala">
          {eAgente(agente.id) ? (
            <FalaAgente agente={agente.id} tamanho="fala">
              {mudouPrincipal
                ? falaDaTroca(nome(principal) ?? "modelo novo", nome(agente.provedorId))
                : "A reserva nova vale a partir da próxima execução."}
            </FalaAgente>
          ) : (
            <p className="config-modelos-texto">A troca vale a partir da próxima execução.</p>
          )}
          <div className="config-rodape">
            <Botao variante="fantasma" disabled={gravando} onClick={aoFechar}>
              Agora não
            </Botao>
            <Botao variante="primario" disabled={travado} onClick={() => void confirmar()}>
              {mudouPrincipal
                ? `Usar ${nome(principal) ?? "o novo"} ${emAgente(agente)}`
                : "Guardar a reserva"}
            </Botao>
          </div>
        </div>
      )}
    </section>
  );
}

/** A cor do ponto do provedor escolhido numa lista; nenhum escolhido, apagado. */
function tomDoProvedor(
  id: string | null,
  provedores: readonly Provedor[],
  modelos: ModelosDaSecao,
  agora: Date,
  agentes: readonly Agente[] = modelos.agentes ?? [],
): TomSelo {
  const provedor = id ? provedores.find((p) => p.id === id) : undefined;
  return provedor ? estadoDoProvedor(provedor, modelos.testes[provedor.id], agentes, agora).tom : "apagado";
}

function comArtigoOuNome(agente: Agente): string {
  return eAgente(agente.id) ? comArtigo(agente.id) : agente.nome;
}
