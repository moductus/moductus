using System.Windows;
using Microsoft.Win32;

namespace Moductus.Core.Theme;

public enum ThemeMode
{
    Dark,
    Light,

    /// <summary>
    /// Alto contraste do Windows. Os tokens são ignorados e as cores do
    /// sistema assumem — usar a paleta própria aqui anularia a acessibilidade
    /// que o usuário pediu explicitamente.
    /// </summary>
    HighContrast,
}

/// <summary>O que o sistema diz sobre aparência e movimento.</summary>
public interface ISystemThemeSource
{
    /// <summary><c>AppsUseLightTheme</c> em Personalize. Ausente conta como escuro.</summary>
    bool AppsUseLightTheme { get; }

    bool HighContrast { get; }

    /// <summary>
    /// <c>SPI_GETCLIENTAREAANIMATION</c>: falso quando o usuário desligou
    /// animações na acessibilidade. Aí toda transição vai a zero.
    /// </summary>
    bool ClientAreaAnimation { get; }
}

/// <summary>Decide o modo a partir do que o sistema diz. Puro, testável.</summary>
public static class ThemeResolver
{
    public static ThemeMode Resolve(bool appsUseLightTheme, bool highContrast)
    {
        // Alto contraste ganha de tudo: é a única das três que o usuário
        // liga por necessidade e não por gosto.
        if (highContrast)
        {
            return ThemeMode.HighContrast;
        }

        return appsUseLightTheme ? ThemeMode.Light : ThemeMode.Dark;
    }

    public static ThemeMode Resolve(ISystemThemeSource source)
    {
        ArgumentNullException.ThrowIfNull(source);
        return Resolve(source.AppsUseLightTheme, source.HighContrast);
    }
}

/// <summary>A fonte real: registro do usuário e <see cref="SystemParameters"/>.</summary>
public sealed class Win32SystemThemeSource : ISystemThemeSource
{
    private const string PersonalizeKey = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
    private const string LightValue = "AppsUseLightTheme";

    public bool AppsUseLightTheme
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(PersonalizeKey);
            return key?.GetValue(LightValue) is int valor && valor != 0;
        }
    }

    public bool HighContrast => SystemParameters.HighContrast;

    public bool ClientAreaAnimation => SystemParameters.ClientAreaAnimation;
}
