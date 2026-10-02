namespace Moductus.Core.Theme;

/// <summary>
/// O modo que a pessoa escolheu, que não é o modo em vigor: <see cref="System"/>
/// segue o Windows, e alto contraste ganha de qualquer escolha. Quem decide o
/// modo final é o <see cref="ThemeResolver"/>.
/// </summary>
public enum ThemeModePreference
{
    /// <summary>Segue o <c>AppsUseLightTheme</c>. O padrão: instalou, combina.</summary>
    System,
    Light,
    Dark,
}

/// <summary>Como a preferência vai e volta da config. Puro, testável.</summary>
/// <remarks>
/// A config guarda texto minúsculo, e não o número do enum: um JSON editado à
/// mão com <c>"dark"</c> é legível, e reordenar o enum não pode trocar o modo
/// de quem já escolheu.
/// </remarks>
public static class ThemeModePreferences
{
    public const string SystemValue = "system";
    public const string LightValue = "light";
    public const string DarkValue = "dark";

    /// <summary>
    /// Lê da config. Ausente ou desconhecido vira <see cref="ThemeModePreference.System"/>:
    /// valor estranho num arquivo editado à mão não pode impedir o app de subir.
    /// </summary>
    public static ThemeModePreference Parse(string? valor) => valor?.Trim().ToLowerInvariant() switch
    {
        LightValue => ThemeModePreference.Light,
        DarkValue => ThemeModePreference.Dark,
        _ => ThemeModePreference.System,
    };

    public static string ToConfig(ThemeModePreference preferencia) => preferencia switch
    {
        ThemeModePreference.Light => LightValue,
        ThemeModePreference.Dark => DarkValue,
        _ => SystemValue,
    };
}
