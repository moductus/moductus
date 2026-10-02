using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Documents;
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
    /// O cartão que flutua sobre o congelado — o alvo do Kill, a dica do pé da
    /// tela. Vive aqui porque é a moldura que dá legibilidade sobre conteúdo
    /// arbitrário, e só quem desenha sobre a Canvas precisa dela.
    /// </summary>
    public static Border Card(UIElement child) => Dress(new Border(), child, "inset.card");

    /// <summary>
    /// A moldura de toda superfície flutuante sobre a Canvas: fundo elevado,
    /// borda forte e o brilho de 1px no topo interno. O brilho é camada
    /// própria por cima do conteúdo, e por isso o filho vai dentro de uma
    /// grade e o recuo num Border de dentro — no de fora, ele afastaria o
    /// brilho da borda junto com o conteúdo.
    /// </summary>
    public static Border Dress(Border border, UIElement child, string inset)
    {
        var miolo = new Border { Child = child };
        miolo.SetResourceReference(Border.PaddingProperty, inset);

        var brilho = new Border();
        brilho.SetResourceReference(FrameworkElement.StyleProperty, "style.surface.highlight");
        brilho.SetResourceReference(Border.CornerRadiusProperty, "radius.card");

        var camadas = new Grid();
        camadas.Children.Add(miolo);
        camadas.Children.Add(brilho);

        border.Child = camadas;
        border.SetResourceReference(Border.BackgroundProperty, "bg.raised");
        border.SetResourceReference(Border.BorderBrushProperty, "border.strong");
        border.SetResourceReference(Border.BorderThicknessProperty, "border.width");
        border.SetResourceReference(Border.CornerRadiusProperty, "radius.card");
        return border;
    }

    /// <summary>
    /// A barra de ferramentas da Canvas: flutua centrada no topo, com os
    /// grupos separados por um divisor vertical. A posição é do arquétipo, e
    /// não de cada módulo, para o Freeze e o Kill porem a barra no mesmo lugar.
    /// </summary>
    /// <remarks>
    /// Vai numa grade POR CIMA da camada de desenho, não dentro dela: o clique
    /// na barra não chega à camada e não vira o começo de um recorte.
    /// </remarks>
    public static Border Toolbar(params UIElement[] grupos)
    {
        var linha = new StackPanel { Orientation = Orientation.Horizontal };

        for (var i = 0; i < grupos.Length; i++)
        {
            if (i > 0)
            {
                var divisor = new Border();
                divisor.SetResourceReference(Border.BorderBrushProperty, "border.subtle");
                divisor.SetResourceReference(Border.BorderThicknessProperty, "border.width.start");
                divisor.SetResourceReference(FrameworkElement.MarginProperty, "inset.toolbar.divider");
                linha.Children.Add(divisor);
            }

            linha.Children.Add(grupos[i]);
        }

        var barra = Dress(new Border(), linha, "inset.4");
        barra.HorizontalAlignment = HorizontalAlignment.Center;
        barra.VerticalAlignment = VerticalAlignment.Top;
        barra.SetResourceReference(FrameworkElement.MarginProperty, "inset.canvas.toolbar");
        return barra;
    }

    /// <summary>A dica de uso, centrada no pé da tela.</summary>
    public static Border Hint(UIElement child)
    {
        var dica = Card(child);
        dica.HorizontalAlignment = HorizontalAlignment.Center;
        dica.VerticalAlignment = VerticalAlignment.Bottom;
        dica.SetResourceReference(FrameworkElement.MarginProperty, "inset.canvas.hint");
        return dica;
    }

    /// <summary>
    /// Uma ferramenta da barra: ícone, nome e a keycap da letra que a escolhe.
    /// Não recebe foco: o foco tem de ficar na camada de desenho, ou a
    /// digitação do texto anotado iria para o botão.
    /// </summary>
    public static ToggleButton Tool(string glifo, string nome, string tecla)
    {
        var icone = new TextBlock { Text = glifo, TextWrapping = TextWrapping.NoWrap, VerticalAlignment = VerticalAlignment.Center };
        icone.SetResourceReference(TextBlock.FontFamilyProperty, "font.icon");
        icone.SetResourceReference(FrameworkElement.MarginProperty, "inset.end.8");

        // Medida de legenda, como "Traço", "copiar" e "salvar" ao lado: com o
        // corpo e a altura de linha solta do estilo vazio, o nome centrava
        // numa caixa mais alta e assentava 2–3px abaixo da linha de base dos
        // vizinhos. A cor continua herdada do botão.
        var rotulo = new TextBlock
        {
            Text = nome,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
            LineStackingStrategy = LineStackingStrategy.BlockLineHeight,
        };
        rotulo.SetResourceReference(TextBlock.FontSizeProperty, "type.caption");
        rotulo.SetResourceReference(TextBlock.LineHeightProperty, "type.caption.line");
        rotulo.SetResourceReference(FrameworkElement.MarginProperty, "inset.end.8");

        var conteudo = new StackPanel { Orientation = Orientation.Horizontal };

        // Ver a armadilha no Button, em Controls.xaml: sem o estilo vazio o
        // implícito fixa text.primary, e a ferramenta inativa não atenua.
        conteudo.Resources.Add(typeof(TextBlock), new Style(typeof(TextBlock)));
        conteudo.Children.Add(icone);
        conteudo.Children.Add(rotulo);
        conteudo.Children.Add(Keycap(tecla));

        var botao = new ToggleButton { Content = conteudo, Focusable = false };
        botao.SetResourceReference(FrameworkElement.StyleProperty, "style.tool");
        return botao;
    }

    /// <summary>Uma tecla desenhada, em <c>style.keycap</c>.</summary>
    public static Border Keycap(string tecla)
    {
        var texto = new TextBlock { Text = tecla };
        texto.SetResourceReference(FrameworkElement.StyleProperty, "style.keycap.text");

        var keycap = new Border { Child = texto };
        keycap.SetResourceReference(FrameworkElement.StyleProperty, "style.keycap");
        return keycap;
    }

    /// <summary>
    /// Atalho com o que ele faz: <c>[Ctrl] [S] salvar</c>. As teclas em
    /// keycap, a ação em legenda — é o rodapé de dicas do resto do app, na
    /// barra da Canvas.
    /// </summary>
    public static StackPanel Shortcut(string acao, params string[] teclas)
    {
        var atalho = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        atalho.SetResourceReference(FrameworkElement.MarginProperty, "inset.8.h");

        foreach (var tecla in teclas)
        {
            var keycap = Keycap(tecla);
            keycap.SetResourceReference(FrameworkElement.MarginProperty, "inset.canvas.keycap");
            atalho.Children.Add(keycap);
        }

        var rotulo = new TextBlock { Text = acao, TextWrapping = TextWrapping.NoWrap, VerticalAlignment = VerticalAlignment.Center };
        rotulo.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        atalho.Children.Add(rotulo);
        return atalho;
    }

    /// <summary>
    /// O chip que acompanha o cursor ou a seleção — a medida do recorte, a
    /// cor sob a lupa. Opaco, ao contrário do <c>style.chip</c> de véu: aqui
    /// o fundo é a tela congelada, e véu sobre conteúdo arbitrário não lê.
    /// </summary>
    public static Border Chip(UIElement child)
    {
        var chip = new Border { Child = child };
        chip.SetResourceReference(FrameworkElement.StyleProperty, "style.chip");
        chip.SetResourceReference(Border.BackgroundProperty, "bg.raised");
        chip.SetResourceReference(Border.BorderBrushProperty, "border.strong");
        chip.SetResourceReference(Border.BorderThicknessProperty, "border.width");
        chip.SetResourceReference(TextElement.ForegroundProperty, "text.primary");

        // Raio de controle, não de pílula: com borda, o WPF desenha o raio 999
        // como elipse, e o texto mono encostava na curva.
        chip.SetResourceReference(Border.CornerRadiusProperty, "radius.control");
        return chip;
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
