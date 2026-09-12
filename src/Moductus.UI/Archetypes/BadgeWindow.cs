using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using Moductus.Core.Interop;

namespace Moductus.UI.Archetypes;

/// <summary>
/// Badge: pastilha pequena e permanente no canto da tela, uma por módulo,
/// que fica enquanto o estado durar e desfaz o estado quando clicada.
/// </summary>
/// <remarks>
/// <para>
/// É a resposta a um buraco do produto: módulos de estado — Mic mudo, Awake
/// ligado, Timer contando — comunicavam pelo ícone da bandeja, e o Windows 11
/// esconde ícone novo atrás da setinha de estouro. O estado existia e ninguém
/// via. Pior: desfazer exigia repetir a tecla líder inteira, quando o gesto
/// natural é clicar no aviso que está na tela.
/// </para>
/// <para>
/// Empilha: mic mudo e pomodoro rodando ao mesmo tempo são duas pastilhas,
/// não uma disputa. Isso é o oposto do ícone de bandeja, que é único e
/// resolvido por prioridade — e é por isso que os dois existem.
/// </para>
/// <para>
/// Não rouba foco nem entra no Alt+Tab. Clique funciona mesmo sem ativação,
/// que é o ponto de <c>WS_EX_NOACTIVATE</c>.
/// </para>
/// </remarks>
public class BadgeWindow : ArchetypeWindow
{
    private readonly StackPanel _pilha = new();
    private readonly List<Entrada> _entradas = [];

    public BadgeWindow() : base(stealsFocus: false)
    {
    }

    /// <summary>Há alguma pastilha no ar?</summary>
    public bool TemAlguma => _entradas.Count > 0;

    /// <summary>
    /// Mostra ou atualiza a pastilha de um dono. Chamar de novo com o mesmo
    /// dono troca o texto no lugar, sem piscar.
    /// </summary>
    /// <param name="owner">Id do módulo. Uma pastilha por dono.</param>
    /// <param name="texto">Curto: cabe numa pastilha, não numa frase.</param>
    /// <param name="dica">O que o clique faz. Aparece menor, embaixo.</param>
    /// <param name="tom">Cor do ponto.</param>
    /// <param name="aoClicar">
    /// O que desfaz o estado. Nulo deixa a pastilha só informativa.
    /// </param>
    public void Fixar(string owner, string texto, string? dica, HudTone tom, Action? aoClicar)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(owner);

        var entrada = _entradas.FirstOrDefault(e => e.Owner == owner);

        if (entrada is null)
        {
            entrada = new Entrada(owner, Construir());
            _entradas.Add(entrada);
            _pilha.Children.Add(entrada.Raiz);
        }

        entrada.Atualizar(texto, dica, tom, aoClicar);
        Mostrar();
    }

    /// <summary>Tira a pastilha do dono. Sem nenhuma sobrando, a janela some.</summary>
    public void Soltar(string owner)
    {
        var entrada = _entradas.FirstOrDefault(e => e.Owner == owner);

        if (entrada is null)
        {
            return;
        }

        _entradas.Remove(entrada);
        _pilha.Children.Remove(entrada.Raiz);

        if (_entradas.Count == 0)
        {
            Dismiss();
            return;
        }

        Mostrar();
    }

    /// <summary>O dono tem pastilha no ar?</summary>
    public bool TemDe(string owner) => _entradas.Any(e => e.Owner == owner);

    private void Mostrar()
    {
        // Present recoloca e redimensiona; com a janela já visível ele não
        // reanima, que é o que queremos ao trocar só o texto.
        Present();
    }

    protected override FrameworkElement BuildChrome(ContentPresenter slot)
    {
        _pilha.Orientation = Orientation.Vertical;

        var raiz = new StackPanel();
        raiz.Children.Add(_pilha);
        raiz.Children.Add(slot);
        return raiz;
    }

    protected override void Place(MonitorArea a)
    {
        SizeToContent = SizeToContent.WidthAndHeight;
        UpdateLayout();

        var w = a.Px(ActualWidth);
        var h = a.Px(ActualHeight);

        // Canto inferior direito, acima da barra: é onde o olho já procura
        // notificação no Windows, e é longe do centro, onde o trabalho está.
        var folga = a.Px(Token("space.16"));
        var x = a.WorkLeft + a.WorkWidth - w - folga;
        var y = a.WorkTop + a.WorkHeight - h - folga;

        PlacePhysical(a, x, y, w, h);
    }

    private static Pastilha Construir() => new();

    private sealed class Entrada(string owner, Pastilha pastilha)
    {
        public string Owner { get; } = owner;

        public FrameworkElement Raiz => pastilha.Raiz;

        public void Atualizar(string texto, string? dica, HudTone tom, Action? aoClicar) =>
            pastilha.Atualizar(texto, dica, tom, aoClicar);
    }

    /// <summary>Uma pastilha: ponto colorido, texto, dica, e o clique que desfaz.</summary>
    private sealed class Pastilha
    {
        private readonly Ellipse _ponto = new() { Width = 8, Height = 8, VerticalAlignment = VerticalAlignment.Center };
        private readonly TextBlock _texto = new() { TextWrapping = TextWrapping.NoWrap };
        private readonly TextBlock _dica = new() { TextWrapping = TextWrapping.NoWrap };
        private readonly Border _moldura;

        private Action? _aoClicar;

        public Pastilha()
        {
            _ponto.Margin = new Thickness(0, 0, 12, 0);

            _texto.SetResourceReference(TextBlock.FontSizeProperty, "type.body");
            _texto.SetResourceReference(TextBlock.LineHeightProperty, "type.body.line");
            _texto.SetResourceReference(TextBlock.FontWeightProperty, "weight.semibold");
            _texto.TextTrimming = TextTrimming.CharacterEllipsis;

            _dica.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
            _dica.TextTrimming = TextTrimming.CharacterEllipsis;
            _dica.Visibility = Visibility.Collapsed;

            var coluna = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            coluna.Children.Add(_texto);
            coluna.Children.Add(_dica);

            var linha = new StackPanel { Orientation = Orientation.Horizontal };
            linha.Children.Add(_ponto);
            linha.Children.Add(coluna);

            _moldura = new Border
            {
                Child = linha,
                Padding = new Thickness(12, 8, 16, 8),
                Cursor = Cursors.Hand,
                Margin = new Thickness(0, 4, 0, 0),
                MaxWidth = 320,
            };

            _moldura.SetResourceReference(Border.BackgroundProperty, "bg.raised");
            _moldura.SetResourceReference(Border.BorderBrushProperty, "border.strong");
            _moldura.SetResourceReference(Border.BorderThicknessProperty, "border.width");
            _moldura.SetResourceReference(Border.CornerRadiusProperty, "radius.pill");

            _moldura.MouseLeftButtonUp += (_, e) =>
            {
                e.Handled = true;
                _aoClicar?.Invoke();
            };

            _moldura.MouseEnter += (_, _) => _moldura.SetResourceReference(Border.BackgroundProperty, "bg.hover");
            _moldura.MouseLeave += (_, _) => _moldura.SetResourceReference(Border.BackgroundProperty, "bg.raised");
        }

        public FrameworkElement Raiz => _moldura;

        public void Atualizar(string texto, string? dica, HudTone tom, Action? aoClicar)
        {
            _texto.Text = texto;
            _dica.Text = dica ?? string.Empty;
            _dica.Visibility = string.IsNullOrEmpty(dica) ? Visibility.Collapsed : Visibility.Visible;

            _aoClicar = aoClicar;
            _moldura.Cursor = aoClicar is null ? Cursors.Arrow : Cursors.Hand;

            _ponto.SetResourceReference(Shape.FillProperty, tom switch
            {
                HudTone.Sucesso => "success",
                HudTone.Alerta => "danger",
                _ => "accent",
            });
        }
    }
}
