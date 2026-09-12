using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Moductus.Core.Interop;
using Moductus.Core.Modules;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Kill;

/// <summary>
/// Mira que encerra a janela clicada. Desligado por padrão: anti-cheat de
/// jogo marca quem faz isto, e o usuário liga na configuração sabendo.
/// </summary>
/// <remarks>
/// Encerrar é irreversível de verdade, então o clique não mata: mostra o
/// que vai morrer e pede Enter. Esc cancela. Inline, sem diálogo.
/// </remarks>
public sealed class KillModule(ModuleContext context) : IModule
{
    private readonly Canvas _camada = new() { Cursor = Cursors.Cross, Background = Brushes.Transparent };
    private readonly Border _cartao = new() { Visibility = Visibility.Collapsed };
    private readonly TextBlock _titulo = new();
    private readonly TextBlock _detalhe = new();
    private readonly TextBlock _dica = new();

    private MonitorArea _area;
    private TopLevelWindow? _alvo;
    private bool _assinado;

    /// <summary>A árvore visual só é construída uma vez, por mais que Enable repita.</summary>
    private bool _montado;

    public string Id => "kill";

    public string Name => "Kill";

    public string Description => "Encerra a janela clicada";

    public ModuleArchetype Archetype => ModuleArchetype.Canvas;

    public char SuggestedLeaderKey => 'x';

    public bool HasSurface => true;

    public bool EnabledByDefault => false;

    public void Enable()
    {
        // Enable roda de novo toda vez que o módulo é religado nas configurações.
        // A árvore visual já está montada, e readicionar um filho que já tem pai
        // derruba o processo inteiro — ver docs/MODULES.md, "Armadilhas conhecidas".
        if (_montado)
        {
            return;
        }

        _montado = true;

        _titulo.SetResourceReference(FrameworkElement.StyleProperty, "style.title");
        _titulo.TextTrimming = TextTrimming.CharacterEllipsis;
        _titulo.TextWrapping = TextWrapping.NoWrap;
        _titulo.MaxWidth = 520;

        _detalhe.SetResourceReference(FrameworkElement.StyleProperty, "style.secondary");
        _detalhe.Margin = new Thickness(0, 4, 0, 12);

        var pilha = new StackPanel();
        pilha.Children.Add(_titulo);
        pilha.Children.Add(_detalhe);
        pilha.Children.Add(Rotulo("Enter encerra   ·   Esc cancela"));

        _cartao.Child = pilha;
        _cartao.SetResourceReference(Border.BackgroundProperty, "bg.raised");
        _cartao.SetResourceReference(Border.BorderBrushProperty, "danger");
        _cartao.BorderThickness = new Thickness(2);
        _cartao.SetResourceReference(Border.CornerRadiusProperty, "radius.window");
        _cartao.SetResourceReference(Border.PaddingProperty, "inset.24");

        _dica.Text = "clique na janela travada   ·   Esc: cancelar";
        _dica.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        var dica = Cartao(_dica);

        _camada.Children.Add(dica);
        _camada.Children.Add(_cartao);
        _camada.MouseLeftButtonDown += OnClick;
        _camada.SizeChanged += (_, _) =>
        {
            Canvas.SetLeft(dica, (_camada.ActualWidth - dica.ActualWidth) / 2);
            Canvas.SetTop(dica, _camada.ActualHeight - 64);
            Centralizar();
        };
    }

    public void Disable()
    {
        _alvo = null;

        // Só toca a Canvas se já assinou: a propriedade constrói a janela.
        if (_assinado)
        {
            var canvas = context.Archetypes.Canvas;
            canvas.PreviewKeyDown -= OnKey;
            canvas.Dismissed -= LimparAlvo;
            _assinado = false;
        }
    }

    public void Invoke()
    {
        var canvas = context.Archetypes.Canvas;

        // Assinado aqui, e não no Enable: ler a propriedade Canvas constrói a
        // janela, e o Enable roda no caminho crítico do startup.
        if (!_assinado)
        {
            canvas.PreviewKeyDown += OnKey;
            canvas.Dismissed += LimparAlvo;
            _assinado = true;
        }

        if (canvas.IsVisible && canvas.Owner == Id)
        {
            canvas.Dismiss();
            return;
        }

        _area = Monitors.Around(ForegroundWindow.Capture());
        _alvo = null;
        _cartao.Visibility = Visibility.Collapsed;

        try
        {
            canvas.SetBackdrop(ScreenCapture.Capture(_area));
        }
        catch
        {
            canvas.SetBackdrop(null);
        }

        canvas.Owner = Id;
        canvas.SlotContent = _camada;
        canvas.Present(_area);
    }

    /// <summary>Canvas fechada por qualquer motivo — Esc, outro módulo — desarma a mira.</summary>
    private void LimparAlvo() => _alvo = null;

    private void OnClick(object sender, MouseButtonEventArgs e)
    {
        if (_alvo is not null)
        {
            return; // já mirado; Enter ou Esc decidem
        }

        var pos = e.GetPosition(_camada);
        var x = _area.Left + (int)Math.Round(pos.X * _area.Scale);
        var y = _area.Top + (int)Math.Round(pos.Y * _area.Scale);

        var janela = WindowList.TopLevelAt(x, y);
        if (janela is null)
        {
            context.Archetypes.Hud.Flash(
                "Nenhuma janela aí",
                "Clique em cima da janela que você quer encerrar, ou Esc para sair.",
                HudTone.Alerta);
            return;
        }

        _alvo = janela;

        string processo;
        try
        {
            processo = Process.GetProcessById((int)janela.ProcessId).ProcessName;
        }
        catch
        {
            processo = "processo desconhecido";
        }

        _titulo.Text = string.IsNullOrWhiteSpace(janela.Title) ? "(sem título)" : janela.Title;
        _detalhe.Text = $"{processo} · pid {janela.ProcessId}";
        _cartao.Visibility = Visibility.Visible;
        Centralizar();
    }

    private void OnKey(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter || _alvo is null || !context.Archetypes.Canvas.IsVisible)
        {
            return;
        }

        e.Handled = true;
        var alvo = _alvo;
        _alvo = null;
        context.Archetypes.Canvas.Dismiss();

        try
        {
            Process.GetProcessById((int)alvo.ProcessId).Kill();
            context.Archetypes.Hud.Flash(
                "Janela encerrada",
                $"{alvo.Title} — processo morto, o que não estava salvo se perdeu.",
                HudTone.Sucesso);
        }
        catch (Exception ex)
        {
            context.Archetypes.Hud.Flash("Não deu para encerrar", Resumo(ex.Message, 80), HudTone.Alerta);
        }
    }

    private void Centralizar()
    {
        _cartao.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        Canvas.SetLeft(_cartao, (_camada.ActualWidth - _cartao.DesiredSize.Width) / 2);
        Canvas.SetTop(_cartao, (_camada.ActualHeight - _cartao.DesiredSize.Height) / 2);
    }

    private static string Resumo(string t, int max)
    {
        var linha = t.ReplaceLineEndings(" ").Trim();
        return linha.Length > max ? linha[..max] + "…" : linha;
    }

    private static TextBlock Rotulo(string texto)
    {
        var t = new TextBlock { Text = texto };
        t.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        return t;
    }

    private static Border Cartao(UIElement filho)
    {
        var b = new Border { Child = filho, Padding = new Thickness(10, 5, 10, 5) };
        b.SetResourceReference(Border.BackgroundProperty, "bg.raised");
        b.SetResourceReference(Border.BorderBrushProperty, "border.strong");
        b.SetResourceReference(Border.BorderThicknessProperty, "border.width");
        b.SetResourceReference(Border.CornerRadiusProperty, "radius.control");
        return b;
    }

    public UserControl? BuildSettings() => null;
}
