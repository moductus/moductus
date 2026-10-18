import type { Lista } from "@moductus/contrato";
import type { EstadoConexao } from "@moductus/contrato/cliente";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useConfig } from "../../areas/configuracoes/useConfig.ts";
import { Atalho } from "../../componentes/Atalho.tsx";
import { Botao } from "../../componentes/Botao.tsx";
import { textoDoAtalho } from "../../componentes/CampoAtalho.tsx";
import { Icone } from "../../componentes/Icone.tsx";
import { useServico } from "../../nativo/eventos.ts";
import { servico, useCanal } from "../../servico/conexao.ts";
import {
  alternativasPara,
  camposDoTipo,
  ehLancavel,
  exemploDoCampo,
  formatarCampo,
  hojeNoFuso,
  lancado,
  NOME_DO_TIPO,
  quemEntendeu,
  type CampoEditavel,
  type CampoMostrado,
  type Contexto,
} from "./previa.ts";
import { useCaptura, type EstadoCaptura } from "./useCaptura.ts";
import "./Captura.css";

/** As teclas do "Na verdade é", na ordem das alternativas (Alt, para o número ficar na frase). */
const TECLAS_ALTERNATIVAS = ["1", "2", "3"] as const;

/** As listas das Tarefas, para o campo Lista mostrar o nome e trocar de lista. */
function useListas(canal: EstadoConexao): Lista[] {
  const [listas, setListas] = useState<Lista[]>([]);
  useEffect(() => servico.ouvir("listas.mudou", setListas), []);
  useEffect(() => {
    if (canal !== "conectado") return;
    let vivo = true;
    servico
      .pedir("listas.listar")
      .then((lidas) => {
        if (vivo) setListas(lidas);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [canal]);
  return listas;
}

/**
 * Captura rápida (Captura.dc.html; PRODUCT.md §3): a frase, o "entendeu como" com os campos, o "Na
 * verdade é" e o Lançar. Enter lança, Tab corrige um campo, Esc fecha, e o lançado dá para desfazer
 * por 10 s. A janela tem a altura do cartão: cresce quando a prévia chega.
 */
export function Captura() {
  const canal = useCanal(useServico({ silencioso: true }));
  const { estado: config } = useConfig();
  const listas = useListas(canal);
  const fuso = config?.config.dia.fuso ?? null;
  const hoje = hojeNoFuso(new Date(), fuso);
  const contexto = useMemo<Contexto>(
    () => ({ hoje, listas: listas.filter((l) => !l.arquivada) }),
    [hoje, listas],
  );
  const c = useCaptura(canal, contexto);
  const atalho = textoDoAtalho(config?.config.atalhos.captura ?? "Ctrl+Alt+Space");

  const cartao = useRef<HTMLElement>(null);
  const frase = useRef<HTMLInputElement>(null);
  const idDicas = useId();

  const lancavel = c.tipo !== null && ehLancavel(c.tipo);
  const alternativas = c.previa && c.tipo ? alternativasPara(c.previa, c.tipo) : [];
  const errosCampos = Object.values(c.errosCampos);
  const pronto = c.atual && lancavel && errosCampos.length === 0 && !c.lancando;

  // A janela acompanha a altura do cartão.
  useEffect(() => {
    const el = cartao.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const observador = new ResizeObserver(() => {
      void invoke("captura_altura", { altura: Math.ceil(el.getBoundingClientRect().height) }).catch(
        () => undefined,
      );
    });
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  // Teclado da janela: Esc fecha, Alt+1..3 troca o tipo, Ctrl+Z desfaz com a frase vazia.
  const teclado = useRef({ c, alternativas });
  useEffect(() => {
    teclado.current = { c, alternativas };
  });
  useEffect(() => {
    const aoFocar = () => frase.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      const { c: agora, alternativas: opcoes } = teclado.current;
      if (e.key === "Escape") {
        e.preventDefault();
        agora.limpar();
        void invoke("captura_fechar");
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const indice = TECLAS_ALTERNATIVAS.indexOf(e.key as (typeof TECLAS_ALTERNATIVAS)[number]);
        const escolhida = opcoes[indice];
        if (indice >= 0 && escolhida) {
          e.preventDefault();
          agora.escolherTipo(escolhida);
        }
        return;
      }
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === "z" && agora.texto === "" && agora.lancamento) {
        e.preventDefault();
        void agora.desfazer();
      }
    };
    window.addEventListener("focus", aoFocar);
    window.addEventListener("keydown", aoTeclar);
    frase.current?.focus();
    return () => {
      window.removeEventListener("focus", aoFocar);
      window.removeEventListener("keydown", aoTeclar);
    };
  }, []);

  const aoEnviar = (e: FormEvent) => {
    e.preventDefault();
    void c.lancar().then((lancou) => {
      if (lancou) frase.current?.focus();
    });
  };

  // O aviso do tipo (gasto, memória, lembrete que vira tarefa) vale para o tipo que o serviço deu.
  const aviso = c.previa && c.tipo === c.previa.tipo ? c.previa.aviso : null;

  return (
    <main ref={cartao} className="captura" aria-label="Captura">
      <form className="captura-formulario" onSubmit={aoEnviar} aria-describedby={idDicas}>
        <div className="captura-cabecalho">
          <Icone nome="mais" tamanho={18} className="captura-icone" />
          <input
            ref={frase}
            className="captura-frase"
            aria-label="Captura rápida"
            placeholder="Capture uma tarefa, gasto ou nota"
            autoComplete="off"
            spellCheck={false}
            maxLength={1000}
            value={c.texto}
            onChange={(e) => c.mudarTexto(e.target.value)}
          />
          <Atalho teclas={atalho} />
        </div>

        {c.previa && c.tipo && c.campos && (
          <div className="captura-corpo">
            <p className="captura-entendeu" aria-live="polite">
              <span>{quemEntendeu(c.previa, c.tipo)}</span>
              <span className="captura-tipo">{NOME_DO_TIPO[c.tipo]}</span>
            </p>
            <Campos estado={c} contexto={contexto} />
            {c.erro ? (
              <p className="captura-linha captura-linha--erro" role="alert">
                {c.erro}
              </p>
            ) : (
              aviso && (
                <p className="captura-linha" role="status">
                  {aviso}
                </p>
              )
            )}
            {errosCampos.length > 0 && (
              <p className="captura-linha captura-linha--erro" role="alert">
                {errosCampos.join(" ")}
              </p>
            )}
          </div>
        )}

        {!c.previa && (c.erro || c.aviso || c.lancamento) && (
          <div className="captura-corpo captura-corpo--estado">
            {c.lancamento && (
              <p className="captura-lancado" role="status">
                <span className="captura-lancado-texto">
                  {lancado(c.lancamento.lancamento.tipo)}: {c.lancamento.titulo}
                </span>
                <Botao tamanho="pequeno" aria-keyshortcuts="Control+Z" onClick={() => void c.desfazer()}>
                  Desfazer
                  <span aria-hidden="true">
                    <Atalho teclas="Ctrl+Z" />
                  </span>
                </Botao>
              </p>
            )}
            {c.aviso && (
              <p className="captura-linha" role="status">
                {c.aviso}
              </p>
            )}
            {c.erro && (
              <p className="captura-linha captura-linha--erro" role="alert">
                {c.erro}
              </p>
            )}
          </div>
        )}

        {c.previa && c.tipo && (
          <div className="captura-rodape">
            {alternativas.length > 0 && (
              <>
                <span className="captura-na-verdade" id={`${idDicas}-alt`}>
                  Na verdade é
                </span>
                <div className="captura-alternativas" role="group" aria-labelledby={`${idDicas}-alt`}>
                  {alternativas.map((tipo, i) => (
                    <Botao
                      key={tipo}
                      tamanho="pequeno"
                      aria-keyshortcuts={`Alt+${TECLAS_ALTERNATIVAS[i]}`}
                      onClick={() => c.escolherTipo(tipo)}
                    >
                      {NOME_DO_TIPO[tipo]}
                      <span aria-hidden="true">
                        <Atalho teclas={`Alt+${TECLAS_ALTERNATIVAS[i]}`} />
                      </span>
                    </Botao>
                  ))}
                </div>
              </>
            )}
            <span className="captura-espaco" />
            <Botao
              type="submit"
              variante="primario"
              className="captura-lancar"
              aria-disabled={!pronto}
              aria-keyshortcuts="Enter"
            >
              Lançar
              <span className="captura-lancar-tecla" aria-hidden="true">
                Enter
              </span>
            </Botao>
          </div>
        )}

        <p className="captura-dicas" id={idDicas}>
          <span>Esc fecha</span>
          <span aria-hidden="true">·</span>
          <span>Tab edita um campo</span>
          <span aria-hidden="true">·</span>
          <span>dá para desfazer por 10 s depois de lançar</span>
        </p>
      </form>
    </main>
  );
}

/** Os campos da prévia: Tab entra em cada um, e o que se digita corrige o que vai no Enter. */
function Campos({ estado: c, contexto }: { estado: EstadoCaptura; contexto: Contexto }) {
  const id = useId();
  if (!c.tipo || !c.campos) return null;
  const mostrados = camposDoTipo(c.tipo, c.campos);
  // Com poucos campos, o título ocupa o que sobra da linha de quatro.
  const larguraTitulo = mostrados.length < 4 ? 5 - mostrados.length : 1;
  return (
    <div className="captura-campos">
      {mostrados.map((m) => (
        <Campo
          key={m.campo}
          id={`${id}-${m.campo}`}
          mostrado={m}
          estado={c}
          contexto={contexto}
          largura={m.campo === "titulo" ? larguraTitulo : 1}
        />
      ))}
    </div>
  );
}

function Campo({
  id,
  mostrado,
  estado: c,
  contexto,
  largura,
}: {
  id: string;
  mostrado: CampoMostrado;
  estado: EstadoCaptura;
  contexto: Contexto;
  largura: number;
}) {
  const { campo, rotulo, editavel } = mostrado;
  const tipo = c.tipo!;
  const classe = `captura-campo captura-campo--${largura}`;
  const mono = campo === "valorCentavos" || campo === "hora";
  const classeValor = mono ? "captura-campo-valor captura-campo-valor--mono" : "captura-campo-valor";
  const daPrevia = formatarCampo(campo, c.previa!.campos, contexto);

  if (!editavel) {
    return (
      <div className={classe}>
        <span className="captura-campo-rotulo">{rotulo}</span>
        <span className={classeValor}>{formatarCampo(campo, c.campos!, contexto) || "—"}</span>
      </div>
    );
  }

  const editado = campo as CampoEditavel;
  const erro = c.errosCampos[editado];

  if (editado === "listaId") {
    const valor = c.edicoes.listaId ?? c.previa!.campos.listaId ?? "";
    return (
      <div className={classe}>
        <label className="captura-campo-rotulo" htmlFor={id}>
          {rotulo}
        </label>
        <select
          id={id}
          className={classeValor}
          value={valor}
          onChange={(e) => c.editar("listaId", e.target.value)}
        >
          <option value="">Entrada</option>
          {contexto.listas.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome}
            </option>
          ))}
          {valor !== "" && !contexto.listas.some((l) => l.id === valor) && (
            <option value={valor}>Outra lista</option>
          )}
        </select>
      </div>
    );
  }

  return (
    <div className={classe} data-erro={erro ? true : undefined}>
      <label className="captura-campo-rotulo" htmlFor={id}>
        {rotulo}
      </label>
      <input
        id={id}
        className={classeValor}
        autoComplete="off"
        spellCheck={false}
        maxLength={editado === "titulo" ? 500 : 40}
        placeholder={exemploDoCampo(campo, tipo)}
        aria-invalid={erro ? true : undefined}
        value={c.edicoes[editado] ?? daPrevia}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => c.editar(editado, e.target.value)}
      />
    </div>
  );
}
