import { EXTENSAO_ARQUIVO } from "@moductus/contrato";
import { open, save } from "@tauri-apps/plugin-dialog";

const FILTRO = [{ name: "Arquivo do Moductus", extensions: [EXTENSAO_ARQUIVO.slice(1)] }];

/** Nome sugerido: o dia de hoje, como no design ("casa-2026-10-08.moductus" sem o PC). */
function nomeSugerido(hoje: Date): string {
  const dia = [hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate()]
    .map((n) => String(n).padStart(2, "0"))
    .join("-");
  return `moductus-${dia}${EXTENSAO_ARQUIVO}`;
}

/** Diálogo "Salvar como" do Windows; null se a pessoa cancelar. Garante a extensão. */
export async function escolherOndeSalvar(hoje = new Date()): Promise<string | null> {
  const caminho = await save({
    title: "Gerar arquivo do Moductus",
    defaultPath: nomeSugerido(hoje),
    filters: FILTRO,
  });
  if (!caminho) return null;
  return caminho.toLowerCase().endsWith(EXTENSAO_ARQUIVO) ? caminho : `${caminho}${EXTENSAO_ARQUIVO}`;
}

/** Diálogo "Abrir" do Windows, só arquivos .moductus; null se a pessoa cancelar. */
export async function escolherArquivo(): Promise<string | null> {
  const caminho = await open({
    title: "Abrir arquivo do Moductus",
    multiple: false,
    directory: false,
    filters: FILTRO,
  });
  return typeof caminho === "string" ? caminho : null;
}
