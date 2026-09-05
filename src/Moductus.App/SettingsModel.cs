using Moductus.Core.Config;
using Moductus.Core.Hotkeys;
using Moductus.Core.Leader;
using Moductus.Core.Modules;
using Moductus.Core.Startup;
using Moductus.UI;

namespace Moductus.App;

/// <summary>Tudo que a janela de configurações precisa, e nada que ela não precise.</summary>
internal sealed record SettingsModel(
    Autostart Autostart,
    HotkeyRegistry Hotkeys,
    LeaderRegistry Letters,
    ConfigLocation Location,
    Theme Theme,
    string? ConfigWarning,
    Func<HotkeyRegistration> Leader,
    Func<HotkeyBinding, HotkeyRegistration> RebindLeader,
    IReadOnlyList<IModule> Modules,
    Func<string, bool> IsModuleEnabled,
    Action<string, bool> SetModuleEnabled);
