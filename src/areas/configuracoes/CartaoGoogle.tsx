import type { AutorizacaoGoogle, Calendario, Conexao } from "@moductus/contrato";
import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { Caixa } from "../../componentes/Caixa.tsx";
import { Campo } from "../../componentes/Campo.tsx";
import { FalaAgente } from "../../componentes/FalaAgente.tsx";
import { Icone } from "../../componentes/Icone.tsx";
import type { TomSelo } from "../../componentes/Selo.tsx";
import { abrirEndereco, useAbrir } from "../../nativo/abrir.ts";
import { useAgora } from "../tempo.ts";
import { CartaoConexao, Dado } from "./CartaoConexao.tsx";
import {
  autorizadoEm,
  avisoDeAprovacao,
  esperandoNaFila,
  filaGoogle,
  leituraGoogle,
  prazoRestante,
  resumoConectado,
  sobreCalendario,
} from "./google.ts";
import type { ConexoesDaTela } from "./useConexoes.ts";

/** O que o Google Agenda faz, antes de conectar (ConfigConexoesGoogleAutorizar.dc.html). */
const DESCRICAO =
  'Lê seus calendários e cria o calendário "Moductus", onde os lembretes viram eventos que tocam no celular.';

/** O guia do Google para criar um cliente OAuth do tipo "App para computador". */
const PASSO_A_PASSO = "https://developers.google.com/workspace/guides/create-credentials#desktop-app";

const PERMISSOES: readonly { rotulo: string; tom: TomSelo | "texto"; texto: string }[] = [
  {
    rotulo: "Faz sem perguntar",
    tom: "sucesso",
    texto: 'Criar o calendário "Moductus" e escrever nele: tarefas com hora e lembretes.',
  },
  {
    rotulo: "Lê",
    tom: "texto",
    texto:
      "Os calendários que você marcar: título, horário e local dos eventos, para o briefing e o horário livre.",
  },
  { rotulo: "Pergunta antes", tom: "aviso", texto: "Criar ou mudar evento nos seus outros calendários." },
  { rotulo: "Nunca", tom: "perigo", texto: "Apagar evento seu, ler e-mail, contatos ou arquivos do Drive." },
];

const O_QUE_SAI: readonly { rotulo: string; texto: string }[] = [
  {
    rotulo: "Para o Google",
    texto: 'Título, horário e alerta do que tem hora, só no calendário "Moductus".',
  },
  { rotulo: "Do Google para cá", texto: "Os eventos dos calendários marcados, guardados neste PC." },
  {
    rotulo: "No meio",
    texto:
      "Nada. A conversa é direta entre este PC e o Google, e a autorização fica no Gerenciador de Credenciais do Windows.",
  },
];

/** O que o cartão desligado mostra: só a linha, o que a Alba pode fazer ou o cliente próprio. */
type Vista = "fechado" | "autorizar" | "cliente";

interface PropsCartaoGoogle {
  conexoes: ConexoesDaTela;
  /** No primeiro uso, o "Conectar" da lista já abre o que a Alba pode fazer. */
  abertoAoMontar?: boolean;
  /** "Agora não" fechou: no primeiro uso, o cartão volta a ser a linha da lista. */
  aoFechar?: () => void;
}

/**
 * Configurações › Conexões › Google Agenda (ConfigConexoesGoogle, ConfigConexoesGoogleAutorizar e
 * ConfigConexoesGoogleEstados.dc.html): antes de conectar, o que a Alba pode fazer e o que sai do
 * PC; esperando o navegador, com o prazo; conectado, os calendários que ela lê e o resumo; os
 * erros (não conectou, reconectar, leitura), o cliente próprio e a confirmação de desconectar.
 */
export function CartaoGoogle({ conexoes, abertoAoMontar, aoFechar }: PropsCartaoGoogle) {
  const agora = useAgora();
  const [vista, setVista] = useState<Vista>(abertoAoMontar ? "autorizar" : "fechado");
  const [confirmando, setConfirmando] = useState(false);
  const { google, situacaoGoogle: situacao, andamento, calendarios } = conexoes;
  if (!google) return null;
  const passo = andamento["google-agenda"];
  const ocupado = passo !== undefined || !conexoes.conectado;
  const erroDoPedido = conexoes.erros["google-agenda"] ?? null;
  const conectar = () => void conexoes.ligar("google-agenda");
  // Salvo o cliente, o formulário sai: o que vier do conectar aparece no cartão, não nele.
  const conectarComOCliente = () => {
    setVista("autorizar");
    conectar();
  };
  const desconectar = () =>
    void conexoes.desligar("google-agenda").then(() => {
      setConfirmando(false);
      setVista("fechado");
    });
  const fechar = () => {
    setVista("fechado");
    aoFechar?.();
  };
  const botaoDesconectar = (
    <Botao
      variante="fantasma"
      aria-expanded={confirmando}
      data-ativo={confirmando || undefined}
      disabled={ocupado}
      onClick={() => setConfirmando((v) => !v)}
    >
      Desconectar
    </Botao>
  );
  const confirmacao = confirmando && (
    <ConfirmarDesconectar
      ocupado={ocupado}
      desligando={passo === "desligando"}
      aoManter={() => setConfirmando(false)}
      aoDesconectar={desconectar}
    />
  );
  const fila = esperandoNaFila(situacao?.fila ?? 0);

  // Esperando a volta do Google no navegador; cancelar fecha só o receptor e a conexão fica como
  // estava antes (uma nova continua desconectada).
  if (situacao?.autorizacao || passo === "ligando") {
    return (
      <Esperando
        autorizacao={situacao?.autorizacao ?? null}
        desativado={passo === "desligando" || !conexoes.conectado}
        aoCancelar={conexoes.cancelarGoogle}
      />
    );
  }

  if (google.estado === "ligada") {
    return (
      <CartaoConexao
        nome="Google Agenda"
        agente="alba"
        destacado
        estado={{ texto: "conectado", tom: "sucesso" }}
        descricao={resumoConectado(google, calendarios)}
        acoes={
          <>
            {botaoDesconectar}
            <Botao disabled={ocupado} onClick={() => void conexoes.lerGoogle()}>
              {passo === "lendo" ? "Lendo…" : "Ler agora"}
            </Botao>
          </>
        }
      >
        {confirmacao || (
          <>
            <FalaAgente agente="alba" tamanho="lista">
              {falaConectado(google, calendarios)}
            </FalaAgente>
            <ListaCalendarios
              calendarios={calendarios}
              desativado={!conexoes.conectado}
              aoMudar={(id, ler) => void conexoes.lerCalendario(id, ler)}
            />
            <dl className="config-conexao-dados config-google-dados">
              <Dado rotulo="Conta">{google.conta ?? "—"}</Dado>
              <Dado rotulo="Leitura">{leituraGoogle(situacao?.lidaEm ?? null, agora)}</Dado>
              <Dado rotulo="Fila para o Google">{filaGoogle(situacao?.fila ?? 0)}</Dado>
              <Dado rotulo="Autorizado">{autorizadoEm(google.conectadaEm, agora)}</Dado>
            </dl>
            {erroDoPedido && <ErroDoPedido>{erroDoPedido}</ErroDoPedido>}
          </>
        )}
      </CartaoConexao>
    );
  }

  if (google.estado === "erro") {
    const problema = situacao?.problema ?? "conectar";
    if (problema === "reconectar") {
      return (
        <CartaoConexao
          nome="Google Agenda"
          agente="alba"
          destacado
          estado={{ texto: "precisa reconectar", tom: "perigo" }}
          descricao={resumoConectado(google, calendarios)}
          acoes={
            <>
              {botaoDesconectar}
              <Botao variante="primario" disabled={ocupado} onClick={conectar}>
                Reconectar
              </Botao>
            </>
          }
        >
          {confirmacao || <MensagemDeErro erro={google.ultimoErro} fila={fila} pedido={erroDoPedido} />}
        </CartaoConexao>
      );
    }
    if (problema === "leitura") {
      return (
        <CartaoConexao
          nome="Google Agenda"
          agente="alba"
          destacado
          estado={{ texto: "leitura falhou", tom: "aviso" }}
          descricao={
            situacao?.lidaEm
              ? `${google.conta ?? "Conta do Google"} · última leitura ${autorizadoEm(situacao.lidaEm, agora)}.`
              : resumoConectado(google, calendarios)
          }
          acoes={
            <>
              {botaoDesconectar}
              <Botao disabled={ocupado} onClick={() => void conexoes.lerGoogle()}>
                {passo === "lendo" ? "Lendo…" : "Tentar agora"}
              </Botao>
            </>
          }
        >
          {confirmacao || <MensagemDeErro erro={google.ultimoErro} fila={fila} pedido={erroDoPedido} />}
        </CartaoConexao>
      );
    }
    // Desconectar não apagou a credencial: o botão principal repete o desconectar, já confirmado.
    if (problema === "desconectar") {
      return (
        <CartaoConexao
          nome="Google Agenda"
          agente="alba"
          destacado
          estado={{ texto: "não desconectou", tom: "perigo" }}
          descricao={resumoConectado(google, calendarios)}
          acoes={
            <Botao variante="primario" disabled={ocupado} onClick={desconectar}>
              {passo === "desligando" ? "Desconectando…" : "Desconectar de novo"}
            </Botao>
          }
        >
          <MensagemDeErro erro={google.ultimoErro} fila={null} pedido={erroDoPedido} />
        </CartaoConexao>
      );
    }
    // Conectar não chegou ao fim: nada mudou, e dá para tentar de novo.
    const conectadaAntes = google.conectadaEm !== null;
    return vista === "cliente" && !conectadaAntes ? (
      <ClienteProprio
        conexoes={conexoes}
        aoVoltar={() => setVista("fechado")}
        aoConectar={conectarComOCliente}
      />
    ) : (
      <CartaoConexao
        nome="Google Agenda"
        agente="alba"
        destacado
        estado={{ texto: "não conectou", tom: "perigo" }}
        descricao={DESCRICAO}
        acoes={
          <>
            {conectadaAntes && botaoDesconectar}
            <Botao variante="primario" disabled={ocupado} onClick={conectar}>
              Tentar de novo
            </Botao>
          </>
        }
      >
        {confirmacao || (
          <>
            <MensagemDeErro erro={google.ultimoErro} fila={null} pedido={erroDoPedido} />
            {!conectadaAntes && (
              <button type="button" className="config-link" onClick={() => setVista("cliente")}>
                {situacao?.clienteProprio ? "Trocar o meu cliente" : "Usar meu próprio cliente"}
              </button>
            )}
          </>
        )}
      </CartaoConexao>
    );
  }

  if (vista === "cliente") {
    return (
      <ClienteProprio
        conexoes={conexoes}
        aoVoltar={() => setVista("autorizar")}
        aoConectar={conectarComOCliente}
      />
    );
  }

  if (vista === "autorizar") {
    return (
      <CartaoConexao
        nome="Google Agenda"
        agente="alba"
        destacado
        estado={{ texto: "desconectado", tom: "apagado" }}
        descricao={DESCRICAO}
      >
        <Autorizar
          ocupado={ocupado}
          clienteProprio={situacao?.clienteProprio ?? false}
          erro={erroDoPedido}
          aoAgoraNao={fechar}
          aoConectar={conectar}
          aoUsarCliente={() => setVista("cliente")}
        />
      </CartaoConexao>
    );
  }

  return (
    <CartaoConexao
      nome="Google Agenda"
      agente="alba"
      estado={{ texto: "desconectado", tom: "apagado" }}
      descricao={DESCRICAO}
      acoes={
        <Botao disabled={ocupado} onClick={() => setVista("autorizar")}>
          Conectar
        </Botao>
      }
    >
      {/* Desconectado, mas o Google não confirmou a revogação: o aviso diz onde tirar à mão. */}
      {google.ultimoErro && <p className="config-nota">{google.ultimoErro}</p>}
      {erroDoPedido && <ErroDoPedido>{erroDoPedido}</ErroDoPedido>}
    </CartaoConexao>
  );
}

/** A fala de quem acabou de conectar: a conta e o calendário "Moductus". */
function falaConectado(google: Conexao, calendarios: readonly Calendario[]): string {
  const como = google.conta ? `Conectei como ${google.conta}` : "Conectei ao Google";
  return calendarios.some((c) => c.espelho)
    ? `${como} e criei o calendário "Moductus". Os lembretes com hora passam a tocar no seu celular.`
    : `${como}. Os lembretes com hora vão para o calendário "Moductus" e passam a tocar no seu celular.`;
}

function ErroDoPedido({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="config-conexao-erro">
      {children}
    </p>
  );
}

/** O motivo que o serviço guardou, a fila que espera e a recusa do último pedido, se houve. */
function MensagemDeErro({
  erro,
  fila,
  pedido,
}: {
  erro: string | null;
  fila: string | null;
  pedido: string | null;
}) {
  return (
    <div className="config-google-mensagem">
      {erro && <p className="config-google-erro">{erro}</p>}
      {fila && <p className="config-conexao-descricao config-google-fila">{fila}</p>}
      {pedido && <ErroDoPedido>{pedido}</ErroDoPedido>}
    </div>
  );
}

interface PropsListaCalendarios {
  calendarios: readonly Calendario[];
  aoMudar: (id: string, ler: boolean) => void;
  desativado?: boolean;
  /** No primeiro uso: duas colunas, sem o "Moductus" e sem os selos (Uso5Conexoes.dc.html). */
  compacta?: boolean;
}

/**
 * Os calendários da conta, para marcar o que a Alba lê. O "Moductus" é dela: aparece marcado e
 * fixo, com o selo "escreve". Mudar evento nos outros sempre pede aprovação.
 */
export function ListaCalendarios({ calendarios, aoMudar, desativado, compacta }: PropsListaCalendarios) {
  const lista = compacta ? calendarios.filter((c) => !c.espelho) : calendarios;
  const linhas = (
    <ul
      className="config-google-calendarios"
      data-compacta={compacta || undefined}
      aria-label="Calendários do Google"
    >
      {lista.map((c) => (
        <li key={c.id} className="config-google-calendario" data-lido={c.ler || c.espelho || undefined}>
          <Caixa
            marcado={c.espelho || c.ler}
            desativado={desativado || c.espelho}
            aoMudar={(ler) => aoMudar(c.id, ler)}
            className="config-google-caixa"
          >
            {c.nome}
          </Caixa>
          <span className="config-google-sobre">{sobreCalendario(c)}</span>
          {!compacta && (c.espelho || c.ler) && (
            <span className="config-google-papel" data-escreve={c.espelho || undefined}>
              {c.espelho ? "escreve" : "lê"}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
  if (compacta) return linhas;
  return (
    <div className="config-google-lista">
      <div className="config-google-lista-topo">
        <span>Calendários</span>
        <span>eu leio os marcados para montar o dia e achar horário livre</span>
      </div>
      {lista.length > 0 ? (
        linhas
      ) : (
        <p className="config-conexao-descricao">Lendo a lista de calendários da sua conta.</p>
      )}
      <p className="config-google-lista-pe">{avisoDeAprovacao(calendarios)}</p>
    </div>
  );
}

/** Antes do navegador: o que a Alba pode fazer, o que sai do PC e o aviso de app não verificado. */
function Autorizar({
  ocupado,
  clienteProprio,
  erro,
  aoAgoraNao,
  aoConectar,
  aoUsarCliente,
}: {
  ocupado: boolean;
  clienteProprio: boolean;
  erro: string | null;
  aoAgoraNao: () => void;
  aoConectar: () => void;
  aoUsarCliente: () => void;
}) {
  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    // O Esc fecha só o cartão: no primeiro uso, não volta um passo.
    e.stopPropagation();
    aoAgoraNao();
  };
  return (
    <div className="config-google-autorizar" onKeyDown={aoTeclar}>
      <FalaAgente agente="alba" tamanho="lista">
        Com o Google, eu monto o seu dia com os compromissos que já estão lá. Os lembretes vão para um
        calendário só meu, o "Moductus", e o celular avisa mesmo com o PC desligado.
      </FalaAgente>
      <div className="config-google-colunas">
        <div className="config-google-coluna">
          <span className="config-google-rotulo">O que a Alba pode fazer</span>
          {PERMISSOES.map((p) => (
            <div key={p.rotulo} className="config-google-item">
              <span className="config-google-item-titulo" data-tom={p.tom}>
                {p.rotulo}
              </span>
              <span className="config-google-item-texto">{p.texto}</span>
            </div>
          ))}
        </div>
        <div className="config-google-coluna">
          <span className="config-google-rotulo">O que sai deste PC</span>
          {O_QUE_SAI.map((f) => (
            <div key={f.rotulo} className="config-google-item">
              <span className="config-google-item-titulo">{f.rotulo}</span>
              <span className="config-google-item-texto">{f.texto}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="config-nota config-google-aviso">
        <Icone nome="escudo" tamanho={16} />
        <span>
          O Google vai avisar que não verificou o app. É esperado, porque o Moductus não tem servidor: clique
          em <b>Avançado</b> e depois em <b>Acessar Moductus</b>.
        </span>
      </p>
      {erro && <ErroDoPedido>{erro}</ErroDoPedido>}
      <div className="config-google-rodape">
        <button type="button" className="config-link" onClick={aoUsarCliente}>
          {clienteProprio ? "Trocar o meu cliente" : "Usar meu próprio cliente"}
        </button>
        <span className="config-google-espaco" />
        <Botao variante="fantasma" aria-keyshortcuts="Escape" onClick={aoAgoraNao}>
          Agora não
        </Botao>
        <Botao variante="primario" disabled={ocupado} onClick={aoConectar}>
          Conectar com o Google
        </Botao>
      </div>
    </div>
  );
}

/** Esperando o navegador: a Alba diz o que fazer, o prazo corre e dá para abrir ou copiar de novo. */
function Esperando({
  autorizacao,
  desativado,
  aoCancelar,
}: {
  autorizacao: AutorizacaoGoogle | null;
  desativado: boolean;
  aoCancelar: () => Promise<void>;
}) {
  const agora = useAgora(1000);
  const [copiado, setCopiado] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const cancelar = () => {
    setCancelando(true);
    void aoCancelar().finally(() => setCancelando(false));
  };
  const abrir = useAbrir();
  const copiar = (endereco: string) => {
    void navigator.clipboard
      ?.writeText(endereco)
      .then(() => setCopiado(true))
      .catch(() => setCopiado(false));
  };
  return (
    <CartaoConexao
      nome="Google Agenda"
      agente="alba"
      destacado
      estado={{ texto: "esperando você no navegador", tom: "neutro" }}
      descricao={DESCRICAO}
      acoes={
        <Botao variante="fantasma" disabled={desativado || cancelando} onClick={cancelar}>
          {cancelando ? "Cancelando…" : "Cancelar"}
        </Botao>
      }
    >
      <FalaAgente agente="alba" tamanho="lista">
        Abri a página do Google no seu navegador. Autorize por lá e eu termino aqui sozinha.
      </FalaAgente>
      <div className="config-google-esperando">
        <span className="config-conexao-trilho" aria-hidden="true" />
        <span className="config-google-prazo">
          {autorizacao
            ? `esperando · o prazo acaba em ${prazoRestante(autorizacao.venceEm, agora)}`
            : "esperando"}
        </span>
        <span className="config-google-espaco" />
        {autorizacao && (
          <>
            <button type="button" className="config-link" onClick={() => copiar(autorizacao.endereco)}>
              {copiado ? "Endereço copiado" : "Copiar o endereço"}
            </button>
            <Botao tamanho="pequeno" onClick={() => abrir.abrir(() => abrirEndereco(autorizacao.endereco))}>
              Abrir de novo
            </Botao>
          </>
        )}
      </div>
      {abrir.erro && <ErroDoPedido>{abrir.erro}</ErroDoPedido>}
    </CartaoConexao>
  );
}

/** A confirmação no lugar, logo abaixo do botão (ConfigConexoesGoogleEstados.dc.html, 6). */
function ConfirmarDesconectar({
  ocupado,
  desligando,
  aoManter,
  aoDesconectar,
}: {
  ocupado: boolean;
  desligando: boolean;
  aoManter: () => void;
  aoDesconectar: () => void;
}) {
  const aoTeclar = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || desligando) return;
    e.preventDefault();
    e.stopPropagation();
    aoManter();
  };
  return (
    <section
      className="config-google-confirmar"
      aria-label="Desconectar o Google Agenda"
      onKeyDown={aoTeclar}
    >
      <FalaAgente agente="alba" tamanho="lista">
        Paro de ler seus calendários e de escrever no "Moductus". Tarefas e lembretes continuam aqui e tocam
        no PC.
      </FalaAgente>
      <p className="config-conexao-descricao">
        O calendário "Moductus" e os eventos dele ficam na sua conta Google; apague por lá se quiser. Dá para
        conectar de novo depois.
      </p>
      <div className="config-rodape">
        <Botao disabled={desligando} aria-keyshortcuts="Escape" onClick={aoManter}>
          Manter conectado
        </Botao>
        <Botao variante="primario" disabled={ocupado} onClick={aoDesconectar}>
          {desligando ? "Desconectando…" : "Desconectar o Google"}
        </Botao>
      </div>
    </section>
  );
}

/**
 * "Usar meu próprio cliente" (ConfigConexoesGoogleEstados.dc.html, 5; ADR-0031): client ID e
 * secret vão ao serviço, que guarda no Gerenciador de Credenciais; o secret não fica na tela
 * depois de salvar. Salvar conecta em seguida.
 */
function ClienteProprio({
  conexoes,
  aoVoltar,
  aoConectar,
}: {
  conexoes: ConexoesDaTela;
  aoVoltar: () => void;
  aoConectar: () => void;
}) {
  const [id, setId] = useState("");
  const [segredo, setSegredo] = useState("");
  const abrir = useAbrir();
  const ocupado = conexoes.andamento["google-agenda"] !== undefined || !conexoes.conectado;
  const erro = conexoes.erros["google-agenda"] ?? null;
  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (!id.trim() || ocupado) return;
    const salvou = await conexoes.definirClienteGoogle({ id: id.trim(), segredo: segredo.trim() || null });
    setSegredo("");
    if (salvou) aoConectar();
  };
  const usarDoMoductus = async () => {
    if (conexoes.situacaoGoogle?.clienteProprio && !(await conexoes.definirClienteGoogle(null))) return;
    aoVoltar();
  };
  const aoTeclar = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    aoVoltar();
  };
  return (
    <CartaoConexao
      nome="Google Agenda"
      agente="alba"
      destacado
      estado={{ texto: "desconectado", tom: "apagado" }}
      descricao="Com o seu cliente OAuth no lugar do cliente do Moductus."
    >
      <form className="config-google-cliente" onSubmit={(e) => void salvar(e)} onKeyDown={aoTeclar}>
        <p className="config-conexao-descricao">
          Crie um cliente OAuth do tipo "App para computador" no Google Cloud e cole aqui. Os dois ficam no
          Gerenciador de Credenciais do Windows.
        </p>
        <div className="config-google-campos">
          <Campo
            rotulo="Client ID"
            className="config-google-campo"
            value={id}
            autoComplete="off"
            spellCheck={false}
            maxLength={512}
            onChange={(e) => setId(e.target.value)}
          />
          <Campo
            rotulo="Client secret"
            className="config-google-campo"
            type="password"
            value={segredo}
            autoComplete="off"
            maxLength={512}
            onChange={(e) => setSegredo(e.target.value)}
          />
        </div>
        {erro && <ErroDoPedido>{erro}</ErroDoPedido>}
        {abrir.erro && <ErroDoPedido>{abrir.erro}</ErroDoPedido>}
        <div className="config-google-rodape">
          <button
            type="button"
            className="config-link"
            onClick={() => abrir.abrir(() => abrirEndereco(PASSO_A_PASSO))}
          >
            Passo a passo
          </button>
          <span className="config-google-espaco" />
          <Botao
            variante="fantasma"
            disabled={ocupado}
            aria-keyshortcuts="Escape"
            onClick={() => void usarDoMoductus()}
          >
            Usar o cliente do Moductus
          </Botao>
          <Botao type="submit" variante="primario" disabled={ocupado || !id.trim()}>
            {conexoes.andamento["google-agenda"] === "cliente" ? "Salvando…" : "Salvar e conectar"}
          </Botao>
        </div>
      </form>
    </CartaoConexao>
  );
}
