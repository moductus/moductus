using System.Text.Json.Nodes;
using Moductus.UI.Archetypes;

namespace Moductus.UI.Modules;

/// <summary>
/// O que um módulo recebe do host. Tudo que ele precisa e nada mais: as
/// superfícies, seu escopo de configuração e o tema.
/// </summary>
/// <param name="ConfigScope">
/// O escopo <c>modules.&lt;id&gt;</c> do módulo. Ele não enxerga a raiz.
/// </param>
/// <param name="SaveConfig">Grava a configuração inteira, atomicamente.</param>
public sealed record ModuleContext(
    ArchetypeHost Archetypes,
    Func<string, JsonObject> ConfigScope,
    Action SaveConfig,
    Theme Theme);
