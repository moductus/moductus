using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using Moductus.Core.Modules;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Links;

/// <summary>
/// Cria junction ou symlink de pasta, arrastando ou digitando o caminho.
/// </summary>
/// <remarks>
/// Junction por padrão: não exige admin nem Modo Desenvolvedor, e 95% do uso
/// real é mover pasta pesada de disco — <c>node_modules</c>, jogo, cache.
/// Symlink fica como opção avançada, e quando o Windows recusa, o motivo
/// aparece inline. Isso tira o UAC do caminho.
/// </remarks>
public sealed class LinksModule(ModuleContext context) : IModule
{
    private readonly TextBox _origem = new();
    private readonly TextBox _destino = new();
    private readonly ToggleButton _symlink = new();
    private readonly TextBlock _estado = new();
    private readonly DockPanel _corpo = new();
    private readonly Border _zona = new();

    /// <summary>A árvore visual só é construída uma vez, por mais que Enable repita.</summary>
    private bool _montado;

    public string Id => "links";

    public string Name => "Links";

    public string Description => "Junction ou symlink de pasta, arrastando";

    public ModuleArchetype Archetype => ModuleArchetype.Panel;

    public char SuggestedLeaderKey => 'l';

    public bool HasSurface => true;

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

        var zonaTexto = new TextBlock
        {
            Text = "Arraste a pasta de origem aqui, ou cole o caminho abaixo.",
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };
        zonaTexto.SetResourceReference(FrameworkElement.StyleProperty, "style.secondary");

        _zona.Child = zonaTexto;
        _zona.Height = 72;
        _zona.AllowDrop = true;
        _zona.SetResourceReference(Border.BackgroundProperty, "bg.raised");
        _zona.SetResourceReference(Border.BorderBrushProperty, "border.strong");
        _zona.BorderThickness = new Thickness(1);
        _zona.SetResourceReference(Border.CornerRadiusProperty, "radius.card");
        _zona.SetResourceReference(FrameworkElement.MarginProperty, "inset.8");
        _zona.DragOver += (_, e) =>
        {
            e.Effects = PastaArrastada(e) is not null ? DragDropEffects.Link : DragDropEffects.None;
            e.Handled = true;
        };
        _zona.Drop += (_, e) =>
        {
            if (PastaArrastada(e) is { } pasta)
            {
                _origem.Text = pasta;
                if (string.IsNullOrWhiteSpace(_destino.Text))
                {
                    _destino.Text = Path.Combine(Path.GetDirectoryName(pasta) ?? pasta, Path.GetFileName(pasta) + "-link");
                }

                _estado.Text = string.Empty;
                context.Archetypes.Panel.TakeFocus(_destino);
            }
        };

        _origem.Tag = "Pasta de origem — arraste ela para cá";
        _origem.SetResourceReference(FrameworkElement.MarginProperty, "inset.8");
        _destino.Tag = "Onde o atalho vai aparecer";
        _destino.SetResourceReference(FrameworkElement.MarginProperty, "inset.8");

        _symlink.Content = "Symlink (avançado)";
        _symlink.Height = 26;
        _symlink.Padding = new Thickness(10, 0, 10, 0);
        _symlink.ToolTip = "Symlink exige Modo Desenvolvedor ou admin. Junction, o padrão, não exige nada.";

        var criar = new Button { Content = "Criar", Height = 26, Padding = new Thickness(14, 0, 14, 0), Margin = new Thickness(8, 0, 0, 0) };
        criar.Click += (_, _) => Criar();

        var acoes = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        acoes.SetResourceReference(FrameworkElement.MarginProperty, "inset.8");
        acoes.Children.Add(_symlink);
        acoes.Children.Add(criar);

        _estado.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        _estado.Margin = new Thickness(12, 0, 12, 8);

        var rotuloOrigem = Rotulo("Origem — a pasta que existe");
        var rotuloDestino = Rotulo("Link — o caminho novo que vai apontar para ela");

        var pilha = new StackPanel();
        pilha.Children.Add(_zona);
        pilha.Children.Add(rotuloOrigem);
        pilha.Children.Add(_origem);
        pilha.Children.Add(rotuloDestino);
        pilha.Children.Add(_destino);
        pilha.Children.Add(acoes);
        pilha.Children.Add(_estado);

        _corpo.Children.Add(new ScrollViewer { Content = pilha, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
    }

    public void Disable()
    {
    }

    public void Invoke()
    {
        var panel = context.Archetypes.Panel;

        if (panel.IsVisible && panel.Owner == Id && !panel.IsPinned)
        {
            panel.Dismiss();
            return;
        }

        panel.Owner = Id;
        panel.Heading = "Links";
        panel.Placement = PanelPlacement.Center;
        panel.SlotContent = _corpo;
        panel.Present();
        panel.TakeFocus(_origem);
    }

    private void Criar()
    {
        var origem = _origem.Text.Trim().Trim('"');
        var destino = _destino.Text.Trim().Trim('"');

        if (!Directory.Exists(origem))
        {
            Falha("A origem precisa ser uma pasta que existe.");
            return;
        }

        if (string.IsNullOrWhiteSpace(destino))
        {
            Falha("Diga o caminho do link.");
            return;
        }

        if (Directory.Exists(destino) || File.Exists(destino))
        {
            Falha("Já existe algo nesse caminho. O link precisa de um caminho novo.");
            return;
        }

        var pai = Path.GetDirectoryName(destino);
        if (string.IsNullOrEmpty(pai) || !Directory.Exists(pai))
        {
            Falha("A pasta onde o link vai ficar precisa existir.");
            return;
        }

        try
        {
            if (_symlink.IsChecked == true)
            {
                Directory.CreateSymbolicLink(destino, origem);
                Sucesso("Symlink criado", $"{destino} → {origem}");
            }
            else
            {
                Junction(destino, origem);
                Sucesso("Junction criada", $"{destino} → {origem}");
            }
        }
        catch (UnauthorizedAccessException)
        {
            Falha("O Windows recusou: symlink exige Modo Desenvolvedor ou admin. Junction não exige — desmarque a opção.");
        }
        catch (Exception e)
        {
            Falha(e.Message);
        }
    }

    // Não há API gerenciada para junction. mklink /J não exige privilégio
    // nenhum, e roda sem janela.
    private static void Junction(string link, string alvo)
    {
        var info = new ProcessStartInfo("cmd.exe", $"/c mklink /J \"{link}\" \"{alvo}\"")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        using var p = Process.Start(info) ?? throw new InvalidOperationException("cmd.exe não iniciou");
        var erro = p.StandardError.ReadToEnd();
        var saida = p.StandardOutput.ReadToEnd();
        p.WaitForExit();

        if (p.ExitCode != 0)
        {
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(erro) ? saida.Trim() : erro.Trim());
        }
    }

    private void Sucesso(string titulo, string detalhe)
    {
        _estado.Text = $"{titulo}: {detalhe}";
        _estado.SetResourceReference(TextBlock.ForegroundProperty, "success");
        context.Archetypes.Hud.Flash(titulo, detalhe, HudTone.Sucesso);
    }

    private void Falha(string mensagem)
    {
        _estado.Text = mensagem;
        _estado.SetResourceReference(TextBlock.ForegroundProperty, "danger");
    }

    private static string? PastaArrastada(DragEventArgs e)
    {
        if (!e.Data.GetDataPresent(DataFormats.FileDrop))
        {
            return null;
        }

        var caminhos = e.Data.GetData(DataFormats.FileDrop) as string[];
        var primeiro = caminhos?.FirstOrDefault();
        return primeiro is not null && Directory.Exists(primeiro) ? primeiro : null;
    }

    private static TextBlock Rotulo(string texto)
    {
        var t = new TextBlock { Text = texto, Margin = new Thickness(12, 8, 12, 0) };
        t.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        return t;
    }

    public UserControl? BuildSettings() => null;
}
