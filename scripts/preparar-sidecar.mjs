// Copia o node.exe que roda este script para src-tauri/binaries com o sufixo do alvo,
// como o Tauri pede para externalBin. O binário não vai para o Git (~80 MB).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const destino = join(raiz, "src-tauri", "binaries", "node-x86_64-pc-windows-msvc.exe");
mkdirSync(dirname(destino), { recursive: true });
copyFileSync(process.execPath, destino);
console.log(`sidecar: ${process.execPath} (Node ${process.versions.node}) -> ${destino}`);
