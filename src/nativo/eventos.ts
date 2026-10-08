import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

/** Registra no moductus.log o que a interface recebeu da casca. */
export function registrar(linha: string): void {
  void invoke("interface_registro", { linha }).catch(() => undefined);
}

/** Estado de tela cheia vindo do vigia da casca. */
export function useTelaCheia(): boolean {
  const [cheia, setCheia] = useState(false);
  useEffect(() => {
    const parar = listen<boolean>("tela-cheia", (evento) => {
      setCheia(evento.payload);
      registrar(`tela-cheia ${evento.payload}`);
    });
    return () => {
      void parar.then((f) => f());
    };
  }, []);
  return cheia;
}

export interface EstadoMidia {
  app: string;
  titulo: string;
  artista: string;
  tocando: boolean;
  pode_anterior: boolean;
  pode_proxima: boolean;
  capa: string | null;
}

/** Mídia tocando no Windows; `null` quando não há sessão (o controle some). */
export function useMidia(): EstadoMidia | null {
  const [midia, setMidia] = useState<EstadoMidia | null>(null);
  useEffect(() => {
    void invoke<EstadoMidia | null>("midia_estado").then(setMidia);
    const parar = listen<EstadoMidia | null>("midia", (evento) => {
      setMidia(evento.payload);
      const m = evento.payload;
      registrar(m ? `midia ${m.titulo} ${m.tocando ? "tocando" : "pausada"}` : "midia sem sessão");
    });
    return () => {
      void parar.then((f) => f());
    };
  }, []);
  return midia;
}

/** Estado de um controle nativo: lido ao montar e atualizado pelo evento da casca. */
function useEstadoNativo<T>(comandoEstado: string, evento: string, rotulo: (v: T) => string): T | null {
  const [valor, setValor] = useState<T | null>(null);
  useEffect(() => {
    void invoke<T>(comandoEstado).then(setValor);
    const parar = listen<T>(evento, (e) => {
      setValor(e.payload);
      registrar(`${evento} ${rotulo(e.payload)}`);
    });
    return () => {
      void parar.then((f) => f());
    };
  }, [comandoEstado, evento, rotulo]);
  return valor;
}

const rotuloMic = (mudo: boolean | null) => (mudo === null ? "sem microfone" : mudo ? "mudo" : "aberto");
const rotuloAwake = (ligado: boolean) => (ligado ? "ligado" : "desligado");

/** Microfone mudo (`true`), aberto (`false`) ou ausente (`null`). */
export function useMic(): boolean | null {
  return useEstadoNativo<boolean | null>("mic_estado", "mic", rotuloMic);
}

export function useAwake(): boolean {
  return useEstadoNativo<boolean>("awake_estado", "awake", rotuloAwake) ?? false;
}

export type EstadoServico =
  | { estado: "iniciando" }
  | { estado: "pronto"; porta: number; token: string }
  | { estado: "reiniciando"; tentativa: number; espera_ms: number }
  | { estado: "parado" };

/**
 * Estado do serviço em Node, como a casca vê: o dock mostra enquanto ele reinicia.
 * `silencioso` não registra no log (o tema também escuta, e o dock já registra).
 */
export function useServico({ silencioso = false }: { silencioso?: boolean } = {}): EstadoServico {
  const [estado, setEstado] = useState<EstadoServico>({ estado: "iniciando" });
  useEffect(() => {
    void invoke<EstadoServico>("servico_estado").then(setEstado);
    const parar = listen<EstadoServico>("servico", (e) => {
      setEstado(e.payload);
      if (!silencioso) registrar(`servico ${e.payload.estado}`);
    });
    return () => {
      void parar.then((f) => f());
    };
  }, [silencioso]);
  return estado;
}
