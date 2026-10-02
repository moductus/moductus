using Moductus.Core.Config;
using Moductus.Core.Hotkeys;
using Moductus.Core.Leader;
using Moductus.Core.Modules;
using Moductus.Core.Startup;
using Moductus.Core.Theme;
using Moductus.UI;

namespace Moductus.App;

/// <summary>Tudo que as janelas do host precisam, e nada que elas não precisem.</summary>
internal sealed record SettingsModel(
    Autostart Autostart,
    HotkeyRegistry Hotkeys,
    LeaderRegistry Letters,
    ConfigLocation Location,
    Theme Theme,
    string? ConfigWarning,
    Func<HotkeyRegistration> Leader,
    Func<HotkeyBinding, HotkeyRegistration> RebindLeader,
    Func<int> Opacidade,
    Action<int> SetOpacidade,
    Func<string> ThemeId,
    Action<string> SetTheme,
    Func<ThemeModePreference> ThemeMode,
    Action<ThemeModePreference> SetThemeMode,
    IReadOnlyList<IModule> Modules,
    Func<string, bool> IsModuleEnabled,
    Action<string, bool> SetModuleEnabled,
    Func<string, char?> ConfiguredLetter);
