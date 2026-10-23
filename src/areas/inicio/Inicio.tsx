import type { ConfigInicio } from "@moductus/contrato";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Botao } from "../../componentes/Botao.tsx";
import { Selo } from "../../componentes/Selo.tsx";
import { useAcoesSistema } from "../../janelas/sistema/primeiro-uso/estado.ts";
import { useServico } from "../../nativo/eventos.ts";
import { useCanal } from "../../servico/conexao.ts";
import { useConfig } from "../configuracoes/useConfig.ts";
import { EstadoVazio, Pagina } from "../Pagina.tsx";
import { useAgora } from "../tempo.ts";
import { BlocosDoInicio } from "./Blocos.tsx";
import { EditarBlocos } from "./EditarBlocos.tsx";
import { INICIO_PADRAO, visiveis } from "./inicio.ts";
import "./Inicio.css";

const PRONTO = "Cada mudança vale na hora.";
const NAO_GRAVOU = "Não consegui guardar a mudança. Tente de novo.";

/**
 * Os blocos como você deixou, gravados a cada mudança em `config.inicio`. Enquanto o serviço não
 * respondeu a última, a tela já mostra a mudança; se ele recusar, volta ao que está gravado e diz.
 */
function useBlocosDoInicio() {
  const { estado, definir } = useConfig();
  const [local, setLocal] = useState<ConfigInicio | null>(null);
  const [erro, setErro] = useState(false);
  const ultimo = useRef(0);
  const gravado = estado?.config.inicio ?? null;

  const aplicar = useCallback(
    (novo: ConfigInicio) => {
      const pedido = ++ultimo.current;
      setLocal(novo);
      setErro(false);
      void definir({ inicio: novo }).then((ok) => {
        // Só a resposta do último pedido decide: uma mais velha não desfaz a mudança seguinte.
        if (pedido !== ultimo.current) return;
        setLocal(null);
        if (!ok) setErro(true);
      });
    },
    [definir],
  );

  return { inicio: local ?? gravado, aplicar, erro };
}

/** `antes`: o que vem acima dos blocos do dia (os Primeiros passos, enquanto pendentes). */
export function Inicio({ antes }: { antes?: ReactNode }) {
  const canal = useCanal(useServico({ silencioso: true }));
  const agora = useAgora();
  const { ir } = useAcoesSistema();
  const { inicio, aplicar, erro } = useBlocosDoInicio();
  const [editando, setEditando] = useState(false);
  const [status, setStatus] = useState(PRONTO);
  const refTarefas = useRef<HTMLElement>(null);
  const refEditar = useRef<HTMLButtonElement>(null);
  const voltarFoco = useRef(false);

  const mudar = (novo: ConfigInicio, texto: string) => {
    aplicar(novo);
    setStatus(texto);
  };

  const comecar = () => {
    setStatus(PRONTO);
    setEditando(true);
  };
  const concluir = useCallback(() => {
    voltarFoco.current = true;
    setEditando(false);
  }, []);

  // Concluir devolve o foco ao "Editar blocos", de onde a edição começou.
  useEffect(() => {
    if (editando || !voltarFoco.current) return;
    voltarFoco.current = false;
    refEditar.current?.focus();
  }, [editando]);

  // Esc conclui, como fecha qualquer modo (contrato de interação).
  useEffect(() => {
    if (!editando) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      concluir();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [editando, concluir]);

  // A frase do bloco de tarefas, se ele aparece; escondido, a área Tarefas.
  const novaTarefa = () => {
    const campo = refTarefas.current?.querySelector("input");
    if (campo) campo.focus();
    else ir({ area: "tarefas" });
  };

  const acao = editando ? (
    <div className="inicio-acoes">
      <Selo>editando os blocos</Selo>
      <Botao
        variante="fantasma"
        onClick={() => mudar(INICIO_PADRAO, `Os blocos voltaram ao padrão. ${PRONTO}`)}
      >
        Voltar ao padrão
      </Botao>
      <Botao variante="primario" onClick={concluir}>
        Concluir
      </Botao>
    </div>
  ) : (
    <div className="inicio-acoes">
      <Botao ref={refEditar} disabled={inicio === null} onClick={comecar}>
        Editar blocos
      </Botao>
      <Botao variante="primario" onClick={novaTarefa}>
        Nova tarefa
      </Botao>
    </div>
  );

  const lista = inicio ? visiveis(inicio) : [];
  return (
    <Pagina titulo="Início" acao={acao}>
      {antes}
      {inicio === null ? (
        <p className="area-carregando" role="status">
          Esperando o serviço responder.
        </p>
      ) : editando ? (
        <EditarBlocos inicio={inicio} aplicar={mudar} status={erro ? NAO_GRAVOU : status} erro={erro} />
      ) : lista.length === 0 ? (
        <EstadoVazio
          agentes={["alba"]}
          titulo="Todos os blocos estão escondidos"
          texto="Em Editar blocos, cada um volta com Mostrar, no lugar em que estava."
        />
      ) : (
        <BlocosDoInicio canal={canal} agora={agora} lista={lista} refTarefas={refTarefas} />
      )}
    </Pagina>
  );
}
