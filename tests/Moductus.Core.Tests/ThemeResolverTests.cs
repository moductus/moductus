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
}
