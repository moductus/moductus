import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

/** Painel lateral genérico: a casca diz qual área abrir; o conteúdo de cada área vem depois. */
export function Painel() {
  // O contador muda a cada abertura, mesmo quando a área é a mesma.
  const [abertura, setAbertura] = useState<{ area: string; n: number } | null>(null);
  const area = abertura?.area ?? null;

  useEffect(() => {
    let n = 0;
    const parar = listen<string>("painel:area", (evento) => setAbertura({ area: evento.payload, n: ++n }));
    return () => {
      void parar.then((f) => f());
    };
  }, []);

  // Fecha a medição de abertura depois que o navegador pintou a área nova.
  useEffect(() => {
    if (!abertura) return;
    const { area } = abertura;
    requestAnimationFrame(() => requestAnimationFrame(() => void invoke("painel_pronto", { area })));
  }, [abertura]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") void invoke("painel_fechar");
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  return (
    <main aria-label={`Painel ${area ?? ""}`}>
      <h1>{area}</h1>
      <input
        aria-label="Pesquisar"
        onFocus={() => void invoke("painel_foco", { quer: true })}
        onBlur={() => void invoke("painel_foco", { quer: false })}
      />
    </main>
  );
}
