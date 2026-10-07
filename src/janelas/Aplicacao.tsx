import type { Janela } from "./rotas.ts";
import { Captura } from "./captura/Captura.tsx";
import { Dock } from "./dock/Dock.tsx";
import { Painel } from "./painel/Painel.tsx";
import { Sistema } from "./sistema/Sistema.tsx";

export function Aplicacao({ janela }: { janela: Janela }) {
  switch (janela) {
    case "dock":
      return <Dock />;
    case "painel":
      return <Painel />;
    case "sistema":
      return <Sistema />;
    case "captura":
      return <Captura />;
  }
}
