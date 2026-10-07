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
