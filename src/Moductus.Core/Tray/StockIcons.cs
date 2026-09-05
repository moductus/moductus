using Windows.Win32;
using Windows.Win32.Foundation;

namespace Moductus.Core.Tray;

/// <summary>Ícones do sistema, como <c>HICON</c> em <see cref="nint"/>.</summary>
public static class StockIcons
{
    /// <summary>
    /// O ícone genérico de aplicativo do Windows. Provisório até o mark
    /// existir — ponto em aberto no apêndice 13 do PRODUCT.md. É um recurso
    /// compartilhado do sistema e não precisa ser destruído.
    /// </summary>
    public static unsafe nint Application =>
        (nint)PInvoke.LoadIcon(HINSTANCE.Null, PInvoke.IDI_APPLICATION).Value;
}
