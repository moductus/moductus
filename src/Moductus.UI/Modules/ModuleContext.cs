using System.Text.Json.Nodes;
using Moductus.Core.Commands;
using Moductus.Core.Interop;
using Moductus.Core.Tray;
using Moductus.UI.Archetypes;

namespace Moductus.UI.Modules;

/// <summary>
/// O que um módulo recebe do host. Tudo que ele precisa e nada mais.
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
/// <param name="Messages">
/// A janela oculta, para módulos que precisam assinar mensagens do Windows
/// — o Clips assina o aviso de mudança do clipboard.
/// </param>
/// <param name="Tray">
/// Onde Mic e Timer reivindicam o ícone de bandeja, por prioridade.
/// </param>
public sealed record ModuleContext(
    ArchetypeHost Archetypes,
    Func<string, JsonObject> ConfigScope,
    Action SaveConfig,
    string DataDirectory,
    Theme Theme,
    CommandRegistry Commands,
    MessageWindow Messages,
    TrayHost Tray);
