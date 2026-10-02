using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;
using Moductus.Core.Interop;
using Moductus.Core.Modules;
using Moductus.Core.Text;
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
    private const string ChaveGentil = "graceful";

    /// <summary>Quanto a janela tem para sair sozinha antes de a mira insistir.</summary>
    private static readonly TimeSpan Prazo = TimeSpan.FromSeconds(3);

    private readonly Canvas _camada = new() { Cursor = Cursors.Cross, Background = Brushes.Transparent };
    private readonly Border _cartao = new() { Visibility = Visibility.Collapsed };
    private readonly TextBlock _titulo = new();
    private readonly TextBlock _detalhe = new();

    /// <summary>A camada da mira com a barra e o cartão por cima, centrados pela grade.</summary>
    private readonly Grid _raiz = new();

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

    private bool Gentil => context.ConfigScope(Id)[ChaveGentil]?.GetValue<bool>() ?? true;

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

        // O chip diz o que o Enter vai fazer antes do nome da vítima. É o
        // único vermelho da tela, e só aparece quando já há um alvo.
        var aviso = new TextBlock { Text = "Encerrar janela" };
        aviso.SetResourceReference(FrameworkElement.StyleProperty, "style.chip.text");
        var chip = new Border { Child = aviso };
        chip.SetResourceReference(FrameworkElement.StyleProperty, "style.chip.danger");
        chip.SetResourceReference(FrameworkElement.MarginProperty, "inset.bottom.8");

        _titulo.SetResourceReference(FrameworkElement.StyleProperty, "style.title");
        _titulo.TextTrimming = TextTrimming.CharacterEllipsis;
        _titulo.TextWrapping = TextWrapping.NoWrap;
        _titulo.SetResourceReference(FrameworkElement.MaxWidthProperty, "size.card.maxwidth");

        // Processo e pid em mono: é o que se confere contra o Gerenciador de
        // Tarefas, e número em mono se lê de relance.
        _detalhe.SetResourceReference(FrameworkElement.StyleProperty, "style.secondary");
        _detalhe.SetResourceReference(TextBlock.FontFamilyProperty, "font.mono");
        _detalhe.SetResourceReference(FrameworkElement.MarginProperty, "inset.detail");

        var atalhos = new StackPanel { Orientation = Orientation.Horizontal };
        atalhos.SetResourceReference(FrameworkElement.MarginProperty, "inset.top.8");
        atalhos.Children.Add(CanvasWindow.Shortcut("encerra", "Enter"));
        atalhos.Children.Add(CanvasWindow.Shortcut("cancela", "Esc"));

        var pilha = new StackPanel();
        pilha.Children.Add(chip);
        pilha.Children.Add(_titulo);
        pilha.Children.Add(_detalhe);
        pilha.Children.Add(new Separator());
        pilha.Children.Add(atalhos);

        // Centrado pela grade, não por conta: o cartão muda de largura com o
        // título, e a grade recentra sozinha a cada medida.
        CanvasWindow.Dress(_cartao, pilha, "inset.16");
        _cartao.HorizontalAlignment = HorizontalAlignment.Center;
        _cartao.VerticalAlignment = VerticalAlignment.Center;

        // A mesma barra do topo do Freeze. A mira é a única ferramenta e já
        // está ativa, então a barra só diz onde clicar e como sair.
        var instrucao = new TextBlock { Text = "Clique na janela travada", TextWrapping = TextWrapping.NoWrap, VerticalAlignment = VerticalAlignment.Center };
        instrucao.SetResourceReference(FrameworkElement.MarginProperty, "inset.8.h");
        var ponto = new Ellipse();
        ponto.SetResourceReference(FrameworkElement.StyleProperty, "style.dot.accent");
        ponto.SetResourceReference(FrameworkElement.MarginProperty, "inset.start.8");
        var mira = new StackPanel { Orientation = Orientation.Horizontal };
        mira.Children.Add(ponto);
        mira.Children.Add(instrucao);

        _raiz.Children.Add(_camada);
        _raiz.Children.Add(CanvasWindow.Toolbar(mira, CanvasWindow.Shortcut("cancelar", "Esc")));
        _raiz.Children.Add(_cartao);
        _camada.MouseLeftButtonDown += OnClick;
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

        if (canvas.DismissIfShowing(Id))
        {
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
        canvas.SlotContent = _raiz;
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

        var processo = Processes.NameOf(janela.ProcessId) ?? "processo desconhecido";

        _titulo.Text = string.IsNullOrWhiteSpace(janela.Title) ? "(sem título)" : janela.Title;
        _detalhe.Text = $"{processo} · pid {janela.ProcessId}";
        _cartao.Visibility = Visibility.Visible;
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

        Encerrar(alvo);
    }

    private void Encerrar(TopLevelWindow alvo)
    {
        Process processo;

        try
        {
            processo = Process.GetProcessById((int)alvo.ProcessId);
        }
        catch (Exception ex)
        {
            context.Archetypes.Hud.Flash("Não deu para encerrar", Summary.OneLine(ex.Message, 80), HudTone.Alerta);
            return;
        }

        if (Gentil && PedirParaFechar(processo))
        {
            context.Archetypes.Hud.Flash(
                "Pedi para a janela fechar",
                $"{alvo.Title} — se ela travar de vez, o processo morre em {Prazo.TotalSeconds:F0} s.",
                HudTone.Neutro);

            var prazo = new DispatcherTimer { Interval = Prazo };
            prazo.Tick += (_, _) => { prazo.Stop(); Insistir(processo, alvo); };
            prazo.Start();
            return;
        }

        Matar(processo, alvo);
    }

    private static bool PedirParaFechar(Process processo)
    {
        try
        {
            // WM_CLOSE pela API gerenciada: a janela decide, e é a diferença
            // entre salvar o trabalho e perdê-lo.
            return processo.CloseMainWindow();
        }
        catch
        {
            return false;
        }
    }

    private void Insistir(Process processo, TopLevelWindow alvo)
    {
        try
        {
            if (processo.HasExited)
            {
                processo.Dispose();
                return;
            }

            // Vivo e respondendo é o aplicativo perguntando "salvar antes de
            // sair?". Matar em cima desse diálogo joga fora exatamente o que a
            // opção existe para proteger.
            if (processo.Responding)
            {
                context.Archetypes.Hud.Flash(
                    "A janela ainda está aberta",
                    $"{alvo.Title} continua respondendo — deve estar pedindo confirmação.",
                    HudTone.Alerta);
                processo.Dispose();
                return;
            }
        }
        catch (Exception ex)
        {
            context.Archetypes.Hud.Flash("Não deu para encerrar", Summary.OneLine(ex.Message, 80), HudTone.Alerta);
            return;
        }

        Matar(processo, alvo);
    }

    private void Matar(Process processo, TopLevelWindow alvo)
    {
        try
        {
            processo.Kill();
            context.Archetypes.Hud.Flash(
                "Janela encerrada",
                $"{alvo.Title} — processo morto, o que não estava salvo se perdeu.",
                HudTone.Sucesso);
        }
        catch (Exception ex)
        {
            context.Archetypes.Hud.Flash("Não deu para encerrar", Summary.OneLine(ex.Message, 80), HudTone.Alerta);
        }
        finally
        {
            processo.Dispose();
        }
    }

    // ---- Configuração ---------------------------------------------------------

    public UserControl? BuildSettings()
    {
        var corpo = new StackPanel();

        var gentil = new CheckBox
        {
            Content = "Tentar fechar pela janela antes de matar o processo",
            IsChecked = Gentil,
        };
        gentil.SetResourceReference(FrameworkElement.MarginProperty, "inset.4");
        gentil.Checked += (_, _) => Gravar(ChaveGentil, true);
        gentil.Unchecked += (_, _) => Gravar(ChaveGentil, false);
        corpo.Children.Add(gentil);

        corpo.Children.Add(SettingsUI.Note("A janela recebe o pedido de fechar e pode salvar o que estava aberto. Só se ela parar de responder o processo é morto."));
        corpo.Children.Add(SettingsUI.Note("Desmarcado, o Enter mata na hora e o que não estava salvo se perde."));

        return new UserControl { Content = corpo };
    }

    private void Gravar(string chave, bool valor)
    {
        context.ConfigScope(Id)[chave] = valor;
        context.SaveConfig();
    }
}
