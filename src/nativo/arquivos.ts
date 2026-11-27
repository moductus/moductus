import { EXTENSAO_ARQUIVO, EXTENSOES_ARQUIVO, FinalidadeArquivo, NOME_DO_FILTRO } from "@moductus/contrato";
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

/**
 * Extrato ou comprovante pela extensão do caminho, como o serviço confere (ADR-0044); `null` para o
 * que não é nenhum dos dois.
 */
export function finalidadeDoCaminho(caminho: string): FinalidadeArquivo | null {
  const ponto = caminho.lastIndexOf(".");
  if (ponto < 0 || /[\\/]/.test(caminho.slice(ponto))) return null;
  const extensao = caminho.slice(ponto + 1).toLowerCase();
  return FinalidadeArquivo.options.find((f) => EXTENSOES_ARQUIVO[f].includes(extensao)) ?? null;
}

/**
 * Diálogo "Abrir" do Windows para o extrato ou o comprovante, com os filtros "Extrato" e
 * "Comprovante"; a finalidade pedida vem primeiro. Devolve o caminho, que só vai ao
 * `arquivos.autorizar`, ou null se a pessoa cancelar.
 */
export async function escolherArquivoDoUsuario(
  primeiro: FinalidadeArquivo = "extrato",
): Promise<string | null> {
  const ordem = [primeiro, ...FinalidadeArquivo.options.filter((f) => f !== primeiro)];
  const caminho = await open({
    title: primeiro === "extrato" ? "Escolher extrato" : "Escolher comprovante",
    multiple: false,
    directory: false,
    filters: ordem.map((f) => ({ name: NOME_DO_FILTRO[f], extensions: [...EXTENSOES_ARQUIVO[f]] })),
  });
  return typeof caminho === "string" ? caminho : null;
}
