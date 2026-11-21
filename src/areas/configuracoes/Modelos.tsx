import {
  enderecoAceitaChave,
  MENSAGEM_CHAVE_SEM_HTTPS,
  MOEDAS_TETO,
  TIPOS_PROVEDOR_CLI,
  type Agente,
  type CotacaoBuscada,
  type ModeloDoProvedor,
  type MoedaComCotacao,
  type MoedaTeto,
  type PedidoModelosProvedor,
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
import { Progresso } from "../../componentes/Progresso.tsx";
import { fraseDaSituacao, lerSituacao, modeloDoAgente } from "../../componentes/personagem/situacao.ts";
import { Seletor, type OpcaoSeletor } from "../../componentes/Seletor.tsx";
import { Selo, type TomSelo } from "../../componentes/Selo.tsx";
import { abrirEndereco, abrirTerminalDeLogin, useAbrir } from "../../nativo/abrir.ts";
import {
  CLIS,
  COMO_INSTALAR,
  FORMULARIO_API_VAZIO,
  nomeSugerido,
  novoDaApi,
  precisaEntrar,
  precisaInstalar,
  situacaoDoCli,
  type FormularioApi,
  type TipoApi,
} from "../../janelas/sistema/primeiro-uso/modelo.ts";
import {
  cotacaoAcimaDoMaximo,
  cotacaoEmTexto,
  cotacaoNoCampo,
  diaCurto,
  diaDeHoje,
  dinheiro,
  fonteDaEstimativa,
  gastoContraOTeto,
  lerCotacao,
  lerTeto,
  MENSAGEM_COTACAO_ALTA,
  NOME_DA_MOEDA,
  origemDaCotacao,
  SIMBOLO,
  valorNoCampo,
} from "../../servico/teto.ts";
import { comArtigo, deAgente } from "../agentes/nomes.ts";
import { useAgora } from "../tempo.ts";
import {
  AVISO_MODELO_SEM_FERRAMENTAS,
  contarDeHoje,
  descreverProvedor,
  edicaoInicial,
  estadoDoProvedor,
  execucoesEmTexto,
  falaDaTroca,
  temChaveTrocavel,
  escolhaInicial,
  mudancaDaEdicao,
  mudancaDoPainel,
  mudancaPedeTeste,
  textoDaRemocao,
  trocaApagaChave,
  usosDoProvedor,
  type EdicaoProvedor,
  type EscolhaModelo,
  type EstadoProvedor,
  type UsoDoProvedor,
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

/** As moedas do teto pelo símbolo, na ordem do contrato (o real primeiro). */
const OPCOES_MOEDA: readonly OpcaoSeletor<MoedaTeto>[] = MOEDAS_TETO.map((m) => ({
  valor: m,
  rotulo: SIMBOLO[m],
}));

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
    <Secao
      titulo="Modelos"
      intro="Cada agente usa um provedor principal e, se quiser, uma reserva para quando o principal falhar."
      acoes={
        !vazio && (
          <>
            <Botao disabled={travado || m.procurando} onClick={() => void m.procurar()}>
              Procurar no PC
            </Botao>
            <Botao variante="primario" disabled={travado} onClick={() => setFormulario("openai")}>
              Adicionar provedor
            </Botao>
          </>
        )
      }
    >
      {m.erro && <Aviso>{m.erro}</Aviso>}
      {vazio && <SemModelo aoProcurar={() => void m.procurar()} aoChave={setFormulario} travado={travado} />}
      {formulario && (
        <FormularioNovo
          tipoInicial={formulario}
          listar={m.listarModelos}
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
          <TabelaProvedores
            modelos={m}
            provedores={provedores}
            agentes={agentes}
            agora={agora}
            aoTrocarModelo={(agenteId) => setPainel({ agenteId, escolha: {} })}
          />
          <TabelaAgentes
            modelos={m}
            provedores={provedores}
            agentes={agentes}
            agora={agora}
            painel={painel}
            aoAbrir={setPainel}
          />
          <Cotacoes modelos={m} agentes={agentes} agora={agora} />
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
          quais="Roteador local, Ollama, LM Studio"
          texto="Pelo endereço da API, com chave se o serviço pedir. Modelo local roda sem internet."
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
  const { erro, abrir } = useAbrir();
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
                {detectados !== null && precisaEntrar(achado) && (
                  <Botao
                    tamanho="pequeno"
                    aria-label={`Entrar no ${c.nome} pelo terminal`}
                    onClick={() => abrir(() => abrirTerminalDeLogin(c.tipo))}
                  >
                    Entrar
                  </Botao>
                )}
                {detectados !== null && precisaInstalar(achado) && (
                  <Botao
                    tamanho="pequeno"
                    variante="fantasma"
                    aria-label={`Como instalar o ${c.nome}`}
                    onClick={() => abrir(() => abrirEndereco(COMO_INSTALAR[c.tipo]))}
                  >
                    Como instalar
                  </Botao>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {erro && (
        <p role="alert" className="config-modelos-erro">
          {erro}
        </p>
      )}
    </section>
  );
}

/* ---------- Chave de API e endereço compatível com OpenAI ---------- */

const DICA_ENDERECO =
  "O endereço da API, quase sempre terminando em /v1. Roteador local, Ollama e LM Studio mostram o deles na própria tela.";
const DICA_MODELO = "Testar lista os modelos que o endereço oferece; escolha um na lista ou digite o nome.";
const DICA_NOME = "Como ele aparece nas listas dos agentes.";
const DICA_CHAVE_SEM_HTTPS = `${MENSAGEM_CHAVE_SEM_HTTPS} Sem chave, este endereço funciona.`;

/** Esc fecha o formulário sem gravar; Enter num campo de texto grava (contrato de interação). */
function teclasDoFormulario(aoFechar: () => void, aoEnviar: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      aoFechar();
    } else if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type !== "radio") {
      e.preventDefault();
      aoEnviar();
    }
  };
}

function FormularioNovo({
  tipoInicial,
  listar,
  aoFechar,
  aoConectar,
}: {
  tipoInicial: TipoApi;
  listar: ModelosDaSecao["listarModelos"];
  aoFechar: () => void;
  aoConectar: (novo: ReturnType<typeof novoDaApi>) => Promise<void>;
}) {
  const [formulario, setFormulario] = useState<FormularioApi>({
    ...FORMULARIO_API_VAZIO,
    nome: "",
    tipo: tipoInicial,
  });
  const [enviando, setEnviando] = useState(false);
  const mudar = (parte: Partial<FormularioApi>) => setFormulario((f) => ({ ...f, ...parte }));
  const compativel = formulario.tipo === "openai-compativel";
  const enviar = async () => {
    if (enviando) return;
    setEnviando(true);
    await aoConectar(novoDaApi(formulario));
    setEnviando(false);
  };
  return (
    <section
      className="config-modelos-formulario"
      aria-label="Conectar por chave de API ou endereço"
      onKeyDown={teclasDoFormulario(aoFechar, () => void enviar())}
    >
      {compativel && (
        <p className="config-modelos-texto">
          Para um roteador local ou um modelo neste PC (Ollama, LM Studio): o endereço da API e, se o serviço
          pedir, a chave. Depois, Testar mostra os modelos para escolher.
        </p>
      )}
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
        <Campo
          rotulo="Nome"
          placeholder={nomeSugerido(formulario.tipo, formulario.baseUrl)}
          dica={DICA_NOME}
          value={formulario.nome ?? ""}
          disabled={enviando}
          onChange={(e) => mudar({ nome: e.target.value })}
        />
        {compativel && (
          <Campo
            rotulo="Endereço (base_url)"
            placeholder="http://localhost:11434/v1"
            dica={DICA_ENDERECO}
            value={formulario.baseUrl}
            disabled={enviando}
            onChange={(e) => mudar({ baseUrl: e.target.value })}
          />
        )}
        <Campo
          rotulo="Chave"
          type="password"
          autoComplete="off"
          dica={
            !compativel
              ? "Fica no Gerenciador de Credenciais do Windows."
              : enderecoAceitaChave(formulario.baseUrl.trim())
                ? "Só se o serviço pedir; modelo local costuma rodar sem. Fica no Gerenciador de Credenciais do Windows."
                : DICA_CHAVE_SEM_HTTPS
          }
          value={formulario.chave}
          disabled={enviando}
          onChange={(e) => mudar({ chave: e.target.value })}
        />
        <CampoModelo
          // Outro provedor, outra lista: a de antes não vale.
          key={formulario.tipo}
          tipo={formulario.tipo}
          valor={formulario.modelo}
          desativado={enviando}
          aoMudar={(modelo) => mudar({ modelo })}
          listar={listar}
          origem={`${formulario.baseUrl.trim()}\n${formulario.chave.trim()}`}
          pedido={() => {
            const chave = formulario.chave.trim();
            const base = { tipo: formulario.tipo, ...(chave ? { chave } : {}) };
            if (!compativel) return base;
            const baseUrl = formulario.baseUrl.trim();
            return baseUrl ? { ...base, baseUrl } : null;
          }}
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

/** O que o "Testar" do campo de modelo achou no endereço. */
type BuscaModelos =
  | { fase: "parado" }
  | { fase: "buscando" }
  | { fase: "lista"; modelos: readonly ModeloDoProvedor[] }
  | { fase: "falhou"; mensagem: string };

/**
 * O modelo, digitado ou escolhido da lista que o endereço oferece (`GET /models`): "Testar" pede a
 * lista ao serviço com o endereço e a chave escritos agora. O que o endereço disser sobre
 * ferramentas aparece na lista, e o modelo escolhido sem elas leva o aviso.
 */
function CampoModelo({
  tipo,
  valor,
  desativado,
  aoMudar,
  listar,
  pedido,
  origem,
}: {
  tipo: TipoApi;
  valor: string;
  desativado: boolean;
  aoMudar: (modelo: string) => void;
  listar: ModelosDaSecao["listarModelos"];
  /** Montado na hora do clique; `null` quando falta o endereço. */
  pedido: () => PedidoModelosProvedor | null;
  /** Endereço e chave escritos: mudou um deles, a lista de antes já não vale. */
  origem: string;
}) {
  const [busca, setBusca] = useState<BuscaModelos>({ fase: "parado" });
  const [origemDaBusca, setOrigemDaBusca] = useState(origem);
  if (origem !== origemDaBusca) {
    setOrigemDaBusca(origem);
    setBusca({ fase: "parado" });
  }
  // A resposta que chega depois de o endereço ou a chave mudarem é de outra lista: fica de fora.
  const origemAtual = useRef(origem);
  useEffect(() => {
    origemAtual.current = origem;
  }, [origem]);
  const buscar = async () => {
    const p = pedido();
    if (!p) {
      setBusca({ fase: "falhou", mensagem: "Informe o endereço antes de testar." });
      return;
    }
    setBusca({ fase: "buscando" });
    const pedidaPara = origem;
    const r = await listar(p);
    if (origemAtual.current !== pedidaPara) return;
    if (!r.ok) {
      setBusca({ fase: "falhou", mensagem: r.falha.mensagem });
      return;
    }
    setBusca({ fase: "lista", modelos: r.modelos });
    // Um modelo só: já fica escolhido.
    if (!valor.trim() && r.modelos.length === 1 && r.modelos[0]) aoMudar(r.modelos[0].id);
  };
  const modelos = busca.fase === "lista" ? busca.modelos : [];
  const escolhido = modelos.find((m) => m.id === valor.trim());
  return (
    <div className="config-modelos-campo-modelo">
      <Campo
        rotulo="Modelo"
        placeholder={tipo === "openai" ? "gpt-5-mini" : "qwen3:8b"}
        dica={DICA_MODELO}
        value={valor}
        disabled={desativado}
        onChange={(e) => aoMudar(e.target.value)}
      />
      <span className="config-modelos-modelos">
        <Botao
          tamanho="pequeno"
          disabled={desativado || busca.fase === "buscando"}
          aria-label="Testar o endereço e listar os modelos"
          onClick={() => void buscar()}
        >
          {busca.fase === "buscando" ? "Testando…" : "Testar"}
        </Botao>
        {modelos.length > 0 && (
          <span className="config-lista">
            <select
              aria-label="Modelos do endereço"
              value={escolhido ? escolhido.id : ""}
              disabled={desativado}
              onChange={(e) => e.target.value && aoMudar(e.target.value)}
            >
              {!escolhido && (
                <option value="" disabled>
                  Escolha um modelo
                </option>
              )}
              {modelos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.ferramentas === false ? `${m.id} · sem ferramentas` : m.id}
                </option>
              ))}
            </select>
            <Icone nome="abrirLista" tamanho={12} />
          </span>
        )}
      </span>
      {busca.fase === "lista" && (
        <span className="config-modelos-sub" role="status">
          {modelos.length === 0
            ? "O endereço respondeu sem nenhum modelo. Digite o nome do modelo."
            : `${modelos.length} ${modelos.length === 1 ? "modelo" : "modelos"} no endereço.`}
        </span>
      )}
      {busca.fase === "falhou" && (
        <span className="config-modelos-sub" data-tom="perigo" role="alert">
          {busca.mensagem}
        </span>
      )}
      {escolhido?.ferramentas === false && (
        <span className="config-modelos-sub" data-tom="aviso" role="alert">
          {AVISO_MODELO_SEM_FERRAMENTAS}
        </span>
      )}
    </div>
  );
}

/* ---------- Provedores ---------- */

function TabelaProvedores({
  modelos,
  provedores,
  agentes,
  agora,
  aoTrocarModelo,
}: {
  modelos: ModelosDaSecao;
  provedores: readonly Provedor[];
  agentes: readonly Agente[];
  agora: Date;
  /** Abre o painel de troca de um agente (antes de remover o provedor que ele usa). */
  aoTrocarModelo: (agenteId: string) => void;
}) {
  const corpo = useRef<HTMLTableSectionElement>(null);
  // Removido um provedor, o foco vai à linha que ficou no lugar dele (ou à de cima, se era a última).
  // Um objeto novo por remoção: o efeito roda uma vez para cada uma, já com a lista sem a linha.
  const [focarLinha, setFocarLinha] = useState<{ indice: number } | null>(null);
  useEffect(() => {
    if (!focarLinha) return;
    const linhas = corpo.current?.querySelectorAll<HTMLElement>("tr[data-provedor]") ?? [];
    const alvo = linhas[Math.min(focarLinha.indice, linhas.length - 1)];
    alvo?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [focarLinha]);
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
          <tbody ref={corpo}>
            {provedores.map((p, i) => (
              <LinhaProvedor
                key={p.id}
                provedor={p}
                estado={estadoDoProvedor(p, modelos.testes[p.id], agentes, agora)}
                usos={usosDoProvedor(p.id, agentes)}
                modelos={modelos}
                travado={!modelos.conectado}
                testando={modelos.testes[p.id]?.fase === "testando"}
                aoTrocarModelo={aoTrocarModelo}
                aoRemovido={() => setFocarLinha({ indice: i })}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** O que está aberto embaixo da linha do provedor. */
type AbertoNaLinha = "chave" | "editar" | "remover" | null;

function LinhaProvedor({
  provedor,
  estado,
  usos,
  modelos,
  travado,
  testando,
  aoTrocarModelo,
  aoRemovido,
}: {
  provedor: Provedor;
  estado: EstadoProvedor;
  usos: readonly UsoDoProvedor[];
  modelos: ModelosDaSecao;
  travado: boolean;
  testando: boolean;
  aoTrocarModelo: (agenteId: string) => void;
  /** A linha saiu da tabela: a tabela leva o foco para a próxima. */
  aoRemovido: () => void;
}) {
  const [aberto, setAberto] = useState<AbertoNaLinha>(null);
  const botaoEditar = useRef<HTMLButtonElement>(null);
  const botaoRemover = useRef<HTMLButtonElement>(null);
  // Fechou o que estava aberto: o foco volta ao botão que abriu.
  const fechar = (botao: typeof botaoEditar) => {
    setAberto(null);
    botao.current?.focus();
  };
  const trocando = aberto === "chave";
  const [chave, setChave] = useState("");
  const alternar = (qual: Exclude<AbertoNaLinha, null>) => setAberto((a) => (a === qual ? null : qual));
  const guardar = async () => {
    if (!chave.trim()) return;
    if (await modelos.trocarChave(provedor.id, chave.trim())) {
      setChave("");
      setAberto(null);
    }
  };
  const aoTestar = () => void modelos.testar(provedor.id);
  const extra = estado.erro || estado.aviso || aberto;
  return (
    <>
      <tr data-provedor={provedor.id} data-com-extra={extra || undefined}>
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
                onClick={() => alternar("chave")}
              >
                Trocar chave
              </Botao>
            )}
            <Botao
              ref={botaoEditar}
              tamanho="pequeno"
              variante="fantasma"
              disabled={travado}
              aria-label={`Editar ${provedor.nome}`}
              aria-expanded={aberto === "editar"}
              onClick={() => alternar("editar")}
            >
              Editar
            </Botao>
            <Botao
              ref={botaoRemover}
              tamanho="pequeno"
              variante="fantasma"
              disabled={travado}
              aria-label={`Remover ${provedor.nome}`}
              aria-expanded={aberto === "remover"}
              onClick={() => alternar("remover")}
            >
              Remover
            </Botao>
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
            {estado.aviso && (
              <p className="config-modelos-erro" data-tom="aviso">
                {estado.aviso}
              </p>
            )}
            {aberto === "editar" && (
              <FormularioEdicao provedor={provedor} modelos={modelos} aoFechar={() => fechar(botaoEditar)} />
            )}
            {aberto === "remover" && (
              <ConfirmarRemocao
                provedor={provedor}
                usos={usos}
                travado={travado}
                aoTrocarModelo={aoTrocarModelo}
                aoRemover={async () => {
                  const ok = await modelos.remover(provedor.id);
                  if (ok) aoRemovido();
                  return ok;
                }}
                aoFechar={() => fechar(botaoRemover)}
              />
            )}
            {trocando && (
              <div className="config-modelos-chave">
                <Campo
                  rotulo={`Chave nova de ${provedor.nome}`}
                  type="password"
                  autoComplete="off"
                  dica={
                    enderecoAceitaChave(provedor.baseUrl)
                      ? "Fica no Gerenciador de Credenciais do Windows."
                      : `${MENSAGEM_CHAVE_SEM_HTTPS} Troque o endereço em Editar.`
                  }
                  value={chave}
                  onChange={(e) => setChave(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void guardar();
                    if (e.key === "Escape") setAberto(null);
                  }}
                />
                <Botao variante="fantasma" onClick={() => setAberto(null)}>
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

/**
 * Editar um provedor gravado: nome, endereço, modelo e chave nova (a guardada nunca volta à tela).
 * CLI só muda o nome. Grava só o que mudou e, com endereço, modelo ou chave novos, testa de novo.
 */
function FormularioEdicao({
  provedor,
  modelos,
  aoFechar,
}: {
  provedor: Provedor;
  modelos: ModelosDaSecao;
  aoFechar: () => void;
}) {
  const [edicao, setEdicao] = useState<EdicaoProvedor>(() => edicaoInicial(provedor));
  const [gravando, setGravando] = useState(false);
  const primeiro = useRef<HTMLDivElement>(null);
  const mudar = (parte: Partial<EdicaoProvedor>) => setEdicao((e) => ({ ...e, ...parte }));
  const cli = ehCli(provedor.tipo);
  const compativel = provedor.tipo === "openai-compativel";
  const mudanca = mudancaDaEdicao(provedor, edicao);
  const apagaChave = trocaApagaChave(provedor, edicao);
  useEffect(() => primeiro.current?.querySelector("input")?.focus(), []);
  const guardar = async () => {
    if (!mudanca || gravando) return;
    setGravando(true);
    const ok = await modelos.editar(mudanca);
    setGravando(false);
    if (ok) aoFechar();
  };
  const travado = !modelos.conectado || gravando;
  return (
    <section
      className="config-modelos-formulario"
      aria-label={`Editar ${provedor.nome}`}
      onKeyDown={teclasDoFormulario(aoFechar, () => void guardar())}
    >
      <div className="config-modelos-formulario-campos">
        <div ref={primeiro}>
          <Campo
            rotulo="Nome"
            dica={DICA_NOME}
            value={edicao.nome}
            disabled={travado}
            onChange={(e) => mudar({ nome: e.target.value })}
          />
        </div>
        {compativel && (
          <Campo
            rotulo="Endereço (base_url)"
            placeholder="http://localhost:11434/v1"
            dica={DICA_ENDERECO}
            value={edicao.baseUrl}
            disabled={travado}
            onChange={(e) => mudar({ baseUrl: e.target.value })}
          />
        )}
        {!cli && (
          <Campo
            rotulo="Chave nova"
            type="password"
            autoComplete="off"
            dica={
              !enderecoAceitaChave(edicao.baseUrl.trim() || provedor.baseUrl)
                ? apagaChave
                  ? `${MENSAGEM_CHAVE_SEM_HTTPS} Vazio, o provedor fica sem chave.`
                  : DICA_CHAVE_SEM_HTTPS
                : apagaChave
                  ? "Endereço novo pede a chave de novo: vazio, o provedor fica sem chave."
                  : provedor.temChave
                    ? "Vazio mantém a chave guardada no Gerenciador de Credenciais."
                    : "Só se o serviço pedir. Fica no Gerenciador de Credenciais do Windows."
            }
            value={edicao.chave}
            disabled={travado}
            onChange={(e) => mudar({ chave: e.target.value })}
          />
        )}
        {!cli && (
          <CampoModelo
            tipo={compativel ? "openai-compativel" : "openai"}
            valor={edicao.modelo}
            desativado={travado}
            aoMudar={(modelo) => mudar({ modelo })}
            listar={modelos.listarModelos}
            origem={`${edicao.baseUrl.trim()}\n${edicao.chave.trim()}`}
            pedido={() => {
              const chave = edicao.chave.trim();
              const tipo = compativel ? ("openai-compativel" as const) : ("openai" as const);
              const base = { id: provedor.id, tipo, ...(chave ? { chave } : {}) };
              if (!compativel) return base;
              const baseUrl = edicao.baseUrl.trim();
              return baseUrl ? { ...base, baseUrl } : null;
            }}
          />
        )}
      </div>
      {cli && (
        <p className="config-modelos-texto">
          O {provedor.nome} usa o login e o modelo do próprio CLI: aqui só muda o nome.
        </p>
      )}
      <div className="config-rodape">
        <Botao variante="fantasma" disabled={gravando} aria-keyshortcuts="Escape" onClick={aoFechar}>
          Cancelar
        </Botao>
        <Botao variante="primario" disabled={travado || !mudanca} onClick={() => void guardar()}>
          {mudanca && mudancaPedeTeste(mudanca) ? "Guardar e testar" : "Guardar"}
        </Botao>
      </div>
    </section>
  );
}

/**
 * Remover pede o sim: diz quem usa o provedor e como fica sem ele, e oferece trocar o modelo de
 * cada um antes. Removido, vai para a lixeira e a chave sai do Gerenciador de Credenciais.
 */
function ConfirmarRemocao({
  provedor,
  usos,
  travado,
  aoTrocarModelo,
  aoRemover,
  aoFechar,
}: {
  provedor: Provedor;
  usos: readonly UsoDoProvedor[];
  travado: boolean;
  aoTrocarModelo: (agenteId: string) => void;
  aoRemover: () => Promise<boolean>;
  aoFechar: () => void;
}) {
  const [removendo, setRemovendo] = useState(false);
  const cancelar = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelar.current?.focus(), []);
  const remover = async () => {
    setRemovendo(true);
    // Removido, a linha sai e a tabela leva o foco à próxima; recusado, fica aberto com o motivo.
    if (!(await aoRemover())) setRemovendo(false);
  };
  return (
    <section
      className="config-modelos-remover"
      role="alertdialog"
      aria-label={`Remover ${provedor.nome}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          aoFechar();
        }
      }}
    >
      <p className="config-modelos-texto">{textoDaRemocao(provedor, usos)}</p>
      {usos.length > 0 && (
        <span className="config-modelos-acoes">
          {usos.map((u) => (
            <Botao
              key={u.agente.id}
              tamanho="pequeno"
              disabled={travado || removendo}
              onClick={() => aoTrocarModelo(u.agente.id)}
            >
              Trocar o modelo {doAgente(u.agente)}
            </Botao>
          ))}
        </span>
      )}
      <div className="config-rodape">
        <Botao
          ref={cancelar}
          variante="fantasma"
          disabled={removendo}
          aria-keyshortcuts="Escape"
          onClick={aoFechar}
        >
          Agora não
        </Botao>
        <Botao variante="primario" disabled={travado || removendo} onClick={() => void remover()}>
          Remover o {provedor.nome}
        </Botao>
      </div>
    </section>
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
        <span>trocar vale na próxima execução</span>
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
                    <TetoNaTabela
                      agente={a}
                      desativado={travado}
                      aoAbrir={() => aoAbrir({ agenteId: a.id, escolha: {} })}
                    />
                  </td>
                  <td>
                    <Hoje agente={a} lidas={modelos.execucoes[a.id]} agora={agora} />
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
 * O teto por dia na tabela, na moeda dele (ADR-0040): o valor, ou "sem teto". "Definir" e "Mudar"
 * abrem o painel do agente, onde o teto se escreve e só grava com o sim.
 */
function TetoNaTabela({
  agente,
  desativado,
  aoAbrir,
}: {
  agente: Agente;
  desativado: boolean;
  aoAbrir: () => void;
}) {
  const teto = agente.tetoDiarioCentavos;
  return (
    <span className="config-modelos-teto">
      {teto === null ? (
        <span className="config-modelos-sub">sem teto</span>
      ) : (
        <span className="config-modelos-numero">{dinheiro(teto, agente.tetoMoeda)}</span>
      )}
      <Botao
        tamanho="pequeno"
        variante="fantasma"
        disabled={desativado}
        aria-label={`${teto === null ? "Definir" : "Mudar"} o teto ${doAgente(agente)}`}
        onClick={aoAbrir}
      >
        {teto === null ? "Definir" : "Mudar"}
      </Botao>
    </span>
  );
}

/**
 * "Hoje": com teto, o gasto contra ele na moeda do teto, sempre como estimativa (sem cotação, o
 * aviso de que o teto não vale); sem teto, quantas execuções o agente fez.
 */
function Hoje({
  agente,
  lidas,
  agora,
}: {
  agente: Agente;
  lidas: ModelosDaSecao["execucoes"][string] | undefined;
  agora: Date;
}) {
  const gasto = gastoContraOTeto(agente.gastoDeHoje, agente.tetoMoeda);
  if (gasto) {
    if (gasto.semCotacao)
      return (
        <span className="config-modelos-sub" data-tom="aviso" aria-label={gasto.rotulo}>
          {gasto.texto}
        </span>
      );
    return (
      <span className="config-modelos-hoje">
        <span className="config-modelos-numero" aria-hidden="true">
          {gasto.texto}
        </span>
        <Progresso
          valor={gasto.pct ?? 0}
          rotulo={`Gasto de hoje ${doAgente(agente)}`}
          textoValor={gasto.rotulo}
          tom={gasto.pct !== null && gasto.pct >= 100 ? "aviso" : "neutro"}
        />
      </span>
    );
  }
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
  const [moeda, setMoeda] = useState<MoedaTeto>(agente.tetoMoeda);
  const [textoTeto, setTextoTeto] = useState(() => valorNoCampo(agente.tetoDiarioCentavos));
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
  const teto = lerTeto(textoTeto);
  const tetoInvalido = teto === undefined;
  const mudanca = tetoInvalido
    ? null
    : mudancaDoPainel(agente, { principal, reserva, teto: { centavos: teto, moeda } });
  const mudouPrincipal = principal !== agente.provedorId;
  const mudouReserva = reserva !== agente.provedorReservaId;
  const mudouTeto = mudanca !== null && "tetoDiarioCentavos" in mudanca;
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
          <span className="config-modelos-sub">Teto por dia</span>
          <span className="config-modelos-teto-campos">
            <Seletor
              rotulo={`Moeda do teto ${doAgente(agente)}`}
              opcoes={travado ? OPCOES_MOEDA.map((o) => ({ ...o, desativada: true })) : OPCOES_MOEDA}
              valor={moeda}
              aoMudar={setMoeda}
            />
            <Campo
              rotulo={`Teto por dia ${doAgente(agente)}, em ${NOME_DA_MOEDA[moeda]}`}
              rotuloOculto
              inputMode="decimal"
              placeholder="sem teto"
              value={textoTeto}
              disabled={travado}
              aria-invalid={tetoInvalido || undefined}
              onChange={(e) => setTextoTeto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmar();
              }}
            />
            {textoTeto && (
              <Botao
                variante="fantasma"
                tamanho="pequeno"
                disabled={travado}
                onClick={() => setTextoTeto("")}
              >
                Tirar
              </Botao>
            )}
          </span>
          <span className="config-modelos-texto" role={tetoInvalido ? "alert" : undefined}>
            {tetoInvalido ? "Use um valor como 10,00." : textoDoTeto(agente)}
          </span>
        </div>
      </div>
      {mudanca && (
        <div className="config-modelos-painel-fala">
          {eAgente(agente.id) ? (
            <FalaAgente agente={agente.id} tamanho="fala">
              {mudouPrincipal && principal
                ? falaDaTroca(nome(principal) ?? "modelo novo", nome(agente.provedorId))
                : mudouReserva
                  ? "A reserva nova vale a partir da próxima execução."
                  : falaDoTeto(teto ?? null, moeda)}
            </FalaAgente>
          ) : (
            <p className="config-modelos-texto">A troca vale a partir da próxima execução.</p>
          )}
          <div className="config-rodape">
            <Botao variante="fantasma" disabled={gravando} onClick={aoFechar}>
              Agora não
            </Botao>
            <Botao variante="primario" disabled={travado} onClick={() => void confirmar()}>
              {rotuloDoSim(
                mudouPrincipal && principal ? (nome(principal) ?? "o novo") : null,
                mudouReserva,
                mudouTeto,
                agente,
              )}
            </Botao>
          </div>
        </div>
      )}
    </section>
  );
}

/** O botão diz o que vai gravar: o modelo novo, a reserva, o teto, ou os dois últimos. */
function rotuloDoSim(principalNovo: string | null, reserva: boolean, teto: boolean, agente: Agente): string {
  if (principalNovo) return `Usar ${principalNovo} ${emAgente(agente)}`;
  if (reserva && teto) return "Guardar a reserva e o teto";
  return reserva ? "Guardar a reserva" : "Guardar o teto";
}

/** O que o teto gravado faz hoje, abaixo do campo (ConfigModelosAgente.dc.html). */
function textoDoTeto(agente: Agente): string {
  const gasto = gastoContraOTeto(agente.gastoDeHoje, agente.tetoMoeda);
  if (!gasto)
    return "Sem teto: o gasto não para o agente. Só conta o que vai pela API; assinatura não gasta.";
  if (gasto.semCotacao)
    return `Sem a cotação do dólar em ${NOME_DA_MOEDA[agente.tetoMoeda]}, o teto não vale. Digite a cotação abaixo da tabela.`;
  return `Hoje: ${gasto.texto}, ${fonteDaEstimativa(agente.gastoDeHoje)}. No teto, ${comArtigoOuNome(agente)} dorme até a meia-noite.`;
}

/** A fala do agente quando só o teto muda (AGENTS.md §2 Voz, até duas frases). */
function falaDoTeto(centavos: number | null, moeda: MoedaTeto): string {
  if (centavos === null) return "Sem teto, o gasto do dia não me para.";
  return `Com o teto de ${dinheiro(centavos, moeda)}, paro quando o gasto de hoje chegar lá. Vale já, para o que eu ainda for fazer.`;
}

/* ---------- Cotação do teto (ADR-0040) ---------- */

/**
 * As cotações que os tetos pedem: uma linha por moeda fora do dólar usada num teto. A cotação é
 * digitada (padrão e reserva) ou buscada na fonte e confirmada; a data gravada é a da fonte.
 */
function Cotacoes({
  modelos,
  agentes,
  agora,
}: {
  modelos: ModelosDaSecao;
  agentes: readonly Agente[];
  agora: Date;
}) {
  const usadas = new Set(agentes.filter((a) => a.tetoDiarioCentavos !== null).map((a) => a.tetoMoeda));
  const moedas = MOEDAS_TETO.filter((m): m is MoedaComCotacao => m !== "USD" && usadas.has(m));
  if (moedas.length === 0) return null;
  return (
    <section className="config-modelos-grupo" aria-label="Cotação do teto">
      <div className="config-modelos-rotulos">
        <span>Cotação do teto</span>
        <span>o custo é medido em dólar; convertido, é estimativa</span>
      </div>
      <ul className="config-cotacoes">
        {moedas.map((moeda) => (
          <LinhaCotacao key={moeda} moeda={moeda} modelos={modelos} agora={agora} />
        ))}
      </ul>
    </section>
  );
}

function LinhaCotacao({
  moeda,
  modelos,
  agora,
}: {
  moeda: MoedaComCotacao;
  modelos: ModelosDaSecao;
  agora: Date;
}) {
  const gravada = modelos.cambio?.cotacoes[moeda] ?? null;
  const [texto, setTexto] = useState(() => (gravada ? cotacaoNoCampo(gravada.milionesimos) : ""));
  // A cotação gravada que chega depois (a configuração respondeu, outra janela gravou) vai ao campo.
  const [vista, setVista] = useState(gravada?.milionesimos);
  if (gravada?.milionesimos !== vista) {
    setVista(gravada?.milionesimos);
    if (gravada) setTexto(cotacaoNoCampo(gravada.milionesimos));
  }
  const [buscando, setBuscando] = useState(false);
  const [buscada, setBuscada] = useState<CotacaoBuscada | null>(null);
  const digitada = lerCotacao(texto);
  const acimaDoMaximo = cotacaoAcimaDoMaximo(texto);
  const travado = !modelos.conectado;
  const nomeMoeda = NOME_DA_MOEDA[moeda];
  const guardar = async () => {
    if (digitada === null) return;
    await modelos.gravarCotacao(moeda, { milionesimos: digitada, data: diaDeHoje(agora), fonte: "digitada" });
  };
  const buscar = async () => {
    setBuscando(true);
    setBuscada(await modelos.buscarCotacao(moeda));
    setBuscando(false);
  };
  const usar = async () => {
    if (!buscada) return;
    const ok = await modelos.gravarCotacao(moeda, {
      milionesimos: buscada.milionesimos,
      data: buscada.data,
      fonte: "frankfurter",
    });
    if (ok) {
      setTexto(cotacaoNoCampo(buscada.milionesimos));
      setBuscada(null);
    }
  };
  return (
    <li className="config-cotacao">
      <span className="config-modelos-textos">
        <span className="config-modelos-nome">Dólar em {nomeMoeda}</span>
        {acimaDoMaximo ? (
          <span className="config-modelos-sub" data-tom="aviso" role="alert">
            {MENSAGEM_COTACAO_ALTA}
          </span>
        ) : gravada ? (
          <span className="config-modelos-sub">
            {cotacaoEmTexto(moeda, gravada.milionesimos)}, {origemDaCotacao(gravada)}
          </span>
        ) : (
          <span className="config-modelos-sub" data-tom="aviso">
            Sem cotação, o teto em {nomeMoeda} não vale. Digite quanto vale US$ 1.
          </span>
        )}
      </span>
      <span className="config-cotacao-campos">
        <Campo
          rotulo={`Quanto vale US$ 1 em ${nomeMoeda}`}
          rotuloOculto
          inputMode="decimal"
          placeholder={`${SIMBOLO[moeda]} por US$ 1`}
          value={texto}
          disabled={travado}
          aria-invalid={acimaDoMaximo || undefined}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void guardar();
          }}
        />
        <Botao
          disabled={travado || digitada === null || digitada === gravada?.milionesimos}
          onClick={() => void guardar()}
        >
          Guardar
        </Botao>
        <Botao variante="fantasma" disabled={travado || buscando} onClick={() => void buscar()}>
          {buscando ? "Buscando" : "Buscar cotação"}
        </Botao>
      </span>
      {buscada && (
        <span className="config-cotacao-buscada" role="status">
          <span className="config-modelos-texto">
            A fonte dá {cotacaoEmTexto(moeda, buscada.milionesimos)}, de {diaCurto(buscada.data)}. É a taxa de
            referência do dia: o que sair dela é estimativa.
          </span>
          <span className="config-rodape">
            <Botao variante="fantasma" onClick={() => setBuscada(null)}>
              Agora não
            </Botao>
            <Botao variante="primario" disabled={travado} onClick={() => void usar()}>
              Usar esta cotação
            </Botao>
          </span>
        </span>
      )}
    </li>
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
