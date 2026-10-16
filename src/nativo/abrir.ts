import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";

/**
 * Abrir fora do Moductus pela casca (src-tauri/src/abrir.rs, ADR-0038): a casca valida e recusa o
 * que não pode (endereço que não é https://, arquivo fora das raízes, programa). A recusa volta
 * como texto, para a tela dizer onde o botão está.
 */

/** Endereço `https://` no navegador padrão. */
export function abrirEndereco(endereco: string): Promise<void> {
  return invoke("abrir_endereco", { endereco });
}

/** Arquivo ou pasta dentro das raízes autorizadas, no programa padrão ou no Explorer. */
export function abrirArquivo(caminho: string): Promise<void> {
  return invoke("abrir_arquivo", { caminho });
}

/** O `settings.json` do Claude Code: a casca sabe onde ele fica, mesmo sem a ligação de pé. */
export function abrirSettingsClaude(): Promise<void> {
  return invoke("abrir_settings_claude");
}

/** "Não consegui abrir: <motivo>", com o motivo da casca. */
export function erroAoAbrir(erro: unknown): string {
  const motivo = typeof erro === "string" ? erro : erro instanceof Error ? erro.message : String(erro);
  return `Não consegui abrir: ${motivo}.`;
}

/**
 * Para um botão que abre algo: `abrir` dispara e guarda o erro, se houver; o próximo clique limpa.
 * O erro aparece perto do botão, nunca num diálogo do Windows.
 */
export function useAbrir(): { erro: string | null; abrir: (acao: () => Promise<void>) => void } {
  const [erro, setErro] = useState<string | null>(null);
  const abrir = useCallback((acao: () => Promise<void>) => {
    setErro(null);
    acao().catch((e: unknown) => setErro(erroAoAbrir(e)));
  }, []);
  return { erro, abrir };
}
