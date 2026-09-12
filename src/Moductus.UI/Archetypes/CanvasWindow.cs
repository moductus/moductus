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
public class CanvasWindow : OwnedWindow
{
    private readonly Image _backdrop = new() { Stretch = Stretch.Fill };
    private readonly Rectangle _veil = new();

    public CanvasWindow() : base(stealsFocus: true)
    {
        // O véu carrega a própria opacidade, por isto é um pincel e não uma
        // cor: o retângulo fica sem nenhum número.
        _veil.SetResourceReference(Shape.FillProperty, "veil.canvas");
    }

    public void SetBackdrop(ImageSource? frozen) => _backdrop.Source = frozen;

    /// <summary>
    /// O cartão que flutua sobre o congelado — a pastilha de medidas do Freeze,
    /// o alvo do Kill. Vive aqui porque é a moldura que dá legibilidade sobre
    /// conteúdo arbitrário, e só quem desenha sobre a Canvas precisa dela.
    /// </summary>
    public static Border Card(UIElement child) => Dress(new Border(), child);

    /// <summary>
    /// O mesmo cartão sobre um <see cref="Border"/> que já existe — o Freeze
    /// reaproveita o dele a cada movimento do mouse.
    /// </summary>
    public static Border Dress(Border border, UIElement child)
    {
        border.Child = child;
        border.SetResourceReference(Border.PaddingProperty, "inset.card");
        border.SetResourceReference(Border.BackgroundProperty, "bg.raised");
        border.SetResourceReference(Border.BorderBrushProperty, "border.strong");
        border.SetResourceReference(Border.BorderThicknessProperty, "border.width");
        border.SetResourceReference(Border.CornerRadiusProperty, "radius.control");
        return border;
    }

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
