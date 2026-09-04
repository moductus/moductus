using Moductus.Core.Config;

namespace Moductus.Core.Tests;

public class ConfigLocationTests
{
    private const string Exe = @"C:\Apps\Moductus";
    private const string AppData = @"C:\Users\alguem\AppData\Roaming";

    [Fact]
    public void Sem_marcador_usa_o_modo_instalado()
    {
        var local = ConfigLocation.Resolve(Exe, AppData, _ => false);

        Assert.False(local.Portable);
        Assert.Equal(@"C:\Users\alguem\AppData\Roaming\Moductus\config.json", local.Path);
    }

    [Fact]
    public void Marcador_ao_lado_do_executavel_liga_o_modo_portable()
    {
        var local = ConfigLocation.Resolve(Exe, AppData, caminho => caminho == @"C:\Apps\Moductus\portable.txt");

        Assert.True(local.Portable);
        Assert.Equal(@"C:\Apps\Moductus\config.json", local.Path);
    }

    [Fact]
    public void Marcador_em_outro_lugar_nao_liga_o_modo_portable()
    {
        // Um portable.txt no %APPDATA% não pode ligar o modo portable: só vale
        // o que está ao lado do executável.
        var local = ConfigLocation.Resolve(Exe, AppData, caminho => caminho.StartsWith(AppData, StringComparison.Ordinal));

        Assert.False(local.Portable);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Diretorio_vazio_e_recusado(string vazio)
        => Assert.Throws<ArgumentException>(() => ConfigLocation.Resolve(vazio, AppData, _ => false));
}
