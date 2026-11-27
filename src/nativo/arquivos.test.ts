import { afterEach, describe, expect, it, vi } from "vitest";
import { escolherArquivoDoUsuario, finalidadeDoCaminho } from "./arquivos.ts";

const dialogo = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => dialogo);

afterEach(() => dialogo.open.mockReset());

describe("arquivo do usuário (ADR-0044)", () => {
  it("a finalidade sai da extensão, sem diferença de maiúsculas", () => {
    expect(finalidadeDoCaminho("C:\\Users\\eu\\extrato.OFX")).toBe("extrato");
    expect(finalidadeDoCaminho("C:\\a\\b.csv")).toBe("extrato");
    expect(finalidadeDoCaminho("C:\\a\\pix.jpeg")).toBe("comprovante");
    expect(finalidadeDoCaminho("C:\\a\\pix.tif")).toBe("comprovante");
    expect(finalidadeDoCaminho("C:\\a\\instalar.exe")).toBeNull();
    expect(finalidadeDoCaminho("C:\\pasta.ofx\\sem-extensao")).toBeNull();
    expect(finalidadeDoCaminho("C:\\a\\extrato")).toBeNull();
  });

  it("o diálogo tem os filtros Extrato e Comprovante, o pedido primeiro, e um arquivo só", async () => {
    dialogo.open.mockResolvedValue("C:\\a\\pix.png");
    expect(await escolherArquivoDoUsuario("comprovante")).toBe("C:\\a\\pix.png");
    expect(dialogo.open).toHaveBeenCalledWith({
      title: "Escolher comprovante",
      multiple: false,
      directory: false,
      filters: [
        { name: "Comprovante", extensions: ["png", "jpg", "jpeg", "bmp", "gif", "tif", "tiff"] },
        { name: "Extrato", extensions: ["ofx", "csv", "xml", "txt"] },
      ],
    });

    dialogo.open.mockResolvedValue(null);
    expect(await escolherArquivoDoUsuario()).toBeNull();
    expect(dialogo.open.mock.calls[1]?.[0]).toMatchObject({
      title: "Escolher extrato",
      filters: [{ name: "Extrato" }, { name: "Comprovante" }],
    });
  });
});
