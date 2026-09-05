using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using Moductus.Core.Interop;
using Moductus.UI.Archetypes;

namespace Moductus.UI;

public sealed record LeaderEntry(char Key, string Name, string Description);

/// <summary>
/// A superfície da tecla líder. Não é o módulo Palette: é infraestrutura do
/// host, mostra as letras e dispara módulos.
/// </summary>
/// <remarks>
/// <para>
/// Sem hook global de teclado. É uma janela comum que recebe foco; capturar a
/// próxima tecla vira um <c>KeyDown</c> banal, e nada faz anti-cheat ou
/// antivírus levantar a sobrancelha.
/// </para>
/// <para>
/// Três regras que não são óbvias: o timeout existe e é curto, para não
/// segurar o foco se a pessoa for interrompida; letra desconhecida <b>não</b>
/// fecha, só pisca, porque fechar puniria erro de digitação com a perda do
/// estado inteiro; e o foco volta <b>antes</b> de o módulo ser invocado.
/// </para>
/// </remarks>
public sealed class LeaderOverlay : ArchetypeWindow
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(3);

    private readonly Func<char, bool> _dispatch;
    private readonly WrapPanel _grade = new();
    private readonly TextBlock _empty = new();
    private readonly DispatcherTimer _timer;
    private readonly DispatcherTimer _blink;
    private Border? _moldura;
    private nint _previousForeground;

    public LeaderOverlay(Func<char, bool> dispatch) : base(stealsFocus: true)
    {
        _dispatch = dispatch ?? throw new ArgumentNullException(nameof(dispatch));

        _timer = new DispatcherTimer { Interval = Timeout };
        _timer.Tick += (_, _) => Dismiss();

        _blink = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(140) };
        _blink.Tick += (_, _) =>
        {
            _blink.Stop();
            _moldura?.SetResourceReference(Border.BorderBrushProperty, "border.strong");
        };

        Deactivated += (_, _) => Dismiss();
        PreviewKeyDown += OnKey;
    }

    public void SetEntries(IEnumerable<LeaderEntry> entries)
    {
        _grade.Children.Clear();

        foreach (var e in entries.OrderBy(e => e.Key))
        {
            _grade.Children.Add(BuildEntry(e));
        }

        _empty.Visibility = _grade.Children.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    protected override FrameworkElement BuildChrome(ContentPresenter slot)
    {
        var titulo = new TextBlock { Text = "Tecla líder" };
        titulo.SetResourceReference(StyleProperty, "text.caption");
        titulo.Margin = new Thickness(4, 0, 0, 8);

        _grade.ItemWidth = 200;

        _empty.Text = "Nenhum módulo ativo. Ative um nas configurações.";
        _empty.SetResourceReference(TextBlock.ForegroundProperty, "text.muted");
        _empty.Visibility = Visibility.Collapsed;

        var rodape = new TextBlock { Text = "Esc fecha" };
        rodape.SetResourceReference(StyleProperty, "text.caption");
        rodape.SetResourceReference(TextBlock.ForegroundProperty, "text.muted");
        rodape.Margin = new Thickness(4, 8, 0, 0);

        var corpo = new StackPanel();
        corpo.SetResourceReference(FrameworkElement.MarginProperty, "inset.16");
        corpo.Children.Add(titulo);
        corpo.Children.Add(_grade);
        corpo.Children.Add(_empty);
        corpo.Children.Add(slot);
        corpo.Children.Add(rodape);

        _moldura = (Border)base.BuildChrome(new ContentPresenter { Content = corpo });
        return _moldura;
    }

    private static FrameworkElement BuildEntry(LeaderEntry e)
    {
        var tecla = new TextBlock { Text = e.Key.ToString().ToUpperInvariant() };
        tecla.SetResourceReference(TextBlock.FontFamilyProperty, "font.mono");
        tecla.SetResourceReference(TextBlock.FontWeightProperty, "weight.semibold");
        tecla.HorizontalAlignment = HorizontalAlignment.Center;
        tecla.VerticalAlignment = VerticalAlignment.Center;

        var keycap = new Border { Child = tecla, Width = 28, Height = 28, Margin = new Thickness(0, 0, 10, 0) };
        keycap.SetResourceReference(Border.BackgroundProperty, "accent");
        keycap.SetResourceReference(Border.CornerRadiusProperty, "radius.control");
        tecla.SetResourceReference(TextBlock.ForegroundProperty, "accent.fg");

        var nome = new TextBlock { Text = e.Name };
        var descricao = new TextBlock { Text = e.Description, TextTrimming = TextTrimming.CharacterEllipsis, TextWrapping = TextWrapping.NoWrap };
        descricao.SetResourceReference(StyleProperty, "text.caption");

        var textos = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        textos.Children.Add(nome);
        textos.Children.Add(descricao);

        var linha = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(4, 6, 4, 6) };
        linha.Children.Add(keycap);
        linha.Children.Add(textos);
        return linha;
    }

    protected override void Place(MonitorArea a)
    {
        var w = a.Px(Token("size.palette.width"));
        var x = a.WorkLeft + (a.WorkWidth - w) / 2;
        var y = a.WorkTop + a.WorkHeight / 6;

        SizeToContent = SizeToContent.Height;
        PlacePhysical(a, x, y, w, a.Px(200));
    }

    protected override void OnPresenting(nint foreground) => _previousForeground = foreground;

    protected override void OnPresented()
    {
        Focus();
        _timer.Stop();
        _timer.Start();
    }

    protected override void OnDismissed()
    {
        _timer.Stop();
        _blink.Stop();

        var anterior = _previousForeground;
        _previousForeground = 0;

        // Não limpa o slot: o overlay não tem conteúdo de módulo.
        ForegroundWindow.Restore(anterior);
    }

    private void OnKey(object sender, KeyEventArgs e)
    {
        var key = e.Key == Key.System ? e.SystemKey : e.Key;

        // Só letra ou dígito, sem modificador: o líder já foi apertado.
        if (Keyboard.Modifiers != ModifierKeys.None || !TryChar(key, out var c))
        {
            return;
        }

        e.Handled = true;

        // Foco volta antes de o módulo aparecer. Quem não rouba foco deixa o
        // usuário digitando onde estava; quem rouba parte de um estado limpo.
        Dismiss();

        if (!_dispatch(c))
        {
            // Letra de ninguém: pisca e continua armado.
            Present();
            _moldura?.SetResourceReference(Border.BorderBrushProperty, "danger");
            _blink.Stop();
            _blink.Start();
        }
    }

    private static bool TryChar(Key key, out char c)
    {
        c = key switch
        {
            >= Key.A and <= Key.Z => (char)('a' + (key - Key.A)),
            >= Key.D0 and <= Key.D9 => (char)('0' + (key - Key.D0)),
            >= Key.NumPad0 and <= Key.NumPad9 => (char)('0' + (key - Key.NumPad0)),
            _ => '\0',
        };

        return c != '\0';
    }
}
