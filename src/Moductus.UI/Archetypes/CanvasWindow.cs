using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;
using Moductus.Core.Interop;

namespace Moductus.UI.Archetypes;

/// <summary>
/// Canvas: tela cheia, topmost, rouba foco. O desktop congelado como bitmap
/// por baixo e um véu preto a 40%. Régua, lupa, conta-gotas operam sobre o
/// bitmap em memória — preciso e independente do que se movia na tela.
/// </summary>
/// <remarks>
/// A captura (<c>BitBlt</c>) é responsabilidade de quem invoca, porque é
/// ela que decide o instante do congelamento. Este arquétipo só exibe.
/// </remarks>
public class CanvasWindow : ArchetypeWindow
{
    private const double Veil = 0.40;

    private readonly Image _backdrop = new() { Stretch = Stretch.Fill };
    private readonly Rectangle _veil = new() { Fill = Brushes.Black, Opacity = Veil };

    public CanvasWindow() : base(stealsFocus: true)
    {
    }

    /// <summary>Quem está usando a Canvas agora. Módulos checam antes de alternar.</summary>
    public string? Owner { get; set; }

    public void SetBackdrop(ImageSource? frozen) => _backdrop.Source = frozen;

    /// <summary>
    /// Sem material: a Canvas cobre a tela inteira com o bitmap congelado, e
    /// material atrás de imagem opaca é custo de composição sem efeito.
    /// </summary>
    protected override Dwm.Backdrop Material => Dwm.Backdrop.None;

    protected override FrameworkElement BuildChrome(ContentPresenter slot)
    {
        var camadas = new Grid();
        camadas.Children.Add(_backdrop);
        camadas.Children.Add(_veil);
        camadas.Children.Add(slot);
        return camadas;
    }

    protected override void OnHandleCreated()
    {
        WindowStyles.MakeToolWindow(Handle);
        // Sem canto arredondado: cobre o monitor inteiro.
    }

    protected override void Place(MonitorArea a) =>
        PlacePhysical(a, a.Left, a.Top, a.Width, a.Height);

    protected override void OnDismissed()
    {
        Owner = null;
        _backdrop.Source = null;
        base.OnDismissed();
    }
}
