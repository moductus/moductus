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
