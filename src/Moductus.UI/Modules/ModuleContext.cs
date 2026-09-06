using System.Text.Json.Nodes;
using Moductus.Core.Commands;
using Moductus.UI.Archetypes;

namespace Moductus.UI.Modules;

/// <summary>
/// O que um módulo recebe do host. Tudo que ele precisa e nada mais: as
/// superfícies, seu escopo de configuração, onde guardar arquivos, o tema
/// e o registro de comandos da Palette.
/// </summary>
/// <param name="ConfigScope">
/// O escopo <c>modules.&lt;id&gt;</c> do módulo. Ele não enxerga a raiz.
/// </param>
/// <param name="SaveConfig">Grava a configuração inteira, atomicamente.</param>
/// <param name="DataDirectory">
/// A pasta do <c>config.json</c> — ao lado do executável em modo portable.
/// Módulo que guarda arquivo grava aqui, para que o portable continue
/// portable.
/// </param>
/// <param name="Commands">
/// Onde qualquer módulo registra ações para a Palette listar. O host
/// registra "Abrir X" para cada módulo ativo.
/// </param>
public sealed record ModuleContext(
    ArchetypeHost Archetypes,
    Func<string, JsonObject> ConfigScope,
    Action SaveConfig,
    string DataDirectory,
    Theme Theme,
    CommandRegistry Commands);
