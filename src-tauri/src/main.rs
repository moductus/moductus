// Sem console também no debug: a janela de console roubaria o primeiro plano nos
// roteiros do verificar.ps1. O registro vai para moductus.log.
#![windows_subsystem = "windows"]

fn main() {
    moductus_lib::run()
}
