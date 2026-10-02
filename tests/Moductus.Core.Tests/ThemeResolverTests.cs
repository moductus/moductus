using Moductus.Core.Theme;

namespace Moductus.Core.Tests;

public class ThemeResolverTests
{
    [Theory]
    [InlineData(false, false, ThemeMode.Dark)]
    [InlineData(true, false, ThemeMode.Light)]
    [InlineData(false, true, ThemeMode.HighContrast)]
    [InlineData(true, true, ThemeMode.HighContrast)]
    public void Alto_contraste_vence_e_o_resto_segue_o_registro(bool light, bool highContrast, ThemeMode esperado)
        => Assert.Equal(esperado, ThemeResolver.Resolve(light, highContrast));

    /// <summary>
    /// A tabela inteira: cada preferência contra os dois valores do registro e
    /// os dois do alto contraste. "Sistema" segue o registro; "Claro" e
    /// "Escuro" o ignoram; alto contraste ignora as três.
    /// </summary>
    [Theory]
    [InlineData(ThemeModePreference.System, false, false, ThemeMode.Dark)]
    [InlineData(ThemeModePreference.System, true, false, ThemeMode.Light)]
    [InlineData(ThemeModePreference.System, false, true, ThemeMode.HighContrast)]
    [InlineData(ThemeModePreference.System, true, true, ThemeMode.HighContrast)]
    [InlineData(ThemeModePreference.Light, false, false, ThemeMode.Light)]
    [InlineData(ThemeModePreference.Light, true, false, ThemeMode.Light)]
    [InlineData(ThemeModePreference.Light, false, true, ThemeMode.HighContrast)]
    [InlineData(ThemeModePreference.Light, true, true, ThemeMode.HighContrast)]
    [InlineData(ThemeModePreference.Dark, false, false, ThemeMode.Dark)]
    [InlineData(ThemeModePreference.Dark, true, false, ThemeMode.Dark)]
    [InlineData(ThemeModePreference.Dark, false, true, ThemeMode.HighContrast)]
    [InlineData(ThemeModePreference.Dark, true, true, ThemeMode.HighContrast)]
    public void Preferencia_decide_o_modo_e_alto_contraste_ainda_vence(
        ThemeModePreference preferencia, bool light, bool highContrast, ThemeMode esperado)
    {
        Assert.Equal(esperado, ThemeResolver.Resolve(light, highContrast, preferencia));
        Assert.Equal(esperado, ThemeResolver.Resolve(new FakeSystemTheme(light, highContrast), preferencia));
    }

    [Theory]
    [InlineData(null, ThemeModePreference.System)]
    [InlineData("", ThemeModePreference.System)]
    [InlineData("system", ThemeModePreference.System)]
    [InlineData("light", ThemeModePreference.Light)]
    [InlineData("dark", ThemeModePreference.Dark)]
    [InlineData(" Dark ", ThemeModePreference.Dark)]
    [InlineData("LIGHT", ThemeModePreference.Light)]
    [InlineData("escuro", ThemeModePreference.System)]
    public void Preferencia_lida_da_config_nunca_quebra(string? valor, ThemeModePreference esperado)
        => Assert.Equal(esperado, ThemeModePreferences.Parse(valor));

    [Theory]
    [InlineData(ThemeModePreference.System)]
    [InlineData(ThemeModePreference.Light)]
    [InlineData(ThemeModePreference.Dark)]
    public void Preferencia_volta_igual_depois_de_ida_e_volta_pela_config(ThemeModePreference preferencia)
        => Assert.Equal(preferencia, ThemeModePreferences.Parse(ThemeModePreferences.ToConfig(preferencia)));

    private sealed class FakeSystemTheme(bool light, bool highContrast) : ISystemThemeSource
    {
        public bool AppsUseLightTheme => light;

        public bool HighContrast => highContrast;

        public bool ClientAreaAnimation => true;

        public bool TaskbarIsLight => false;
    }
}
