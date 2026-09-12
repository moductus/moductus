using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using Moductus.Core.Interop;
using Moductus.Core.Modules;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Ports;

/// <summary>
/// Portas TCP locais em escuta, com o processo dono, e um botão para
/// encerrar. O maior retorno para o público de dev.
/// </summary>
/// <remarks>
/// Invoke retorna rápido: o Panel aparece com "carregando" e a tabela é lida
/// em <c>Task.Run</c>. Encerrar é irreversível de verdade, então pede uma
/// segunda pressão no mesmo botão — inline, sem diálogo.
/// </remarks>
public sealed class PortsModule(ModuleContext context) : IModule
{
    private readonly TextBox _filtro = new();
    private readonly StackPanel _linhas = new();
    private readonly TextBlock _estado = new();
    private readonly DockPanel _corpo = new();
    private IReadOnlyList<Linha> _todas = [];

    /// <summary>A árvore visual só é construída uma vez, por mais que Enable repita.</summary>
    private bool _montado;

    public string Id => "ports";

    public string Name => "Ports";

    public string Description => "Portas locais ocupadas, e quem as ocupa";

    public ModuleArchetype Archetype => ModuleArchetype.Panel;

    public char SuggestedLeaderKey => 'o';

    public bool HasSurface => true;

    /// <summary>
    /// Endereço cru não responde a pergunta que a pessoa tem. "0.0.0.0" e "::"
    /// são a mesma coisa dita em duas pilhas, e o que importa é se a porta está
    /// exposta na rede ou presa na máquina.
    /// </summary>
    private static string Onde(string address) => address switch
    {
        "0.0.0.0" or "::" => "todas",
        "127.0.0.1" or "::1" => "local",
        _ => address,
    };

    private sealed record Linha(TcpListener Porta, string Processo, bool Desconhecido, string Enderecos);

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

        _filtro.SetResourceReference(FrameworkElement.MarginProperty, "inset.8");
        _filtro.Tag = "Filtrar por número da porta ou nome do processo";
        _filtro.TextChanged += (_, _) => Render();
        _filtro.PreviewKeyDown += (_, e) =>
        {
            if (e.Key == Key.F5)
            {
                e.Handled = true;
                Carregar();
            }
        };

        _estado.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        _estado.HorizontalAlignment = HorizontalAlignment.Center;
        _estado.Margin = new Thickness(0, 16, 0, 16);

        // Construído uma vez: um elemento só pode ter um pai lógico.
        var atualizar = new Button { Content = "Atualizar (F5)" };
        atualizar.SetResourceReference(FrameworkElement.MarginProperty, "inset.8");
        atualizar.Click += (_, _) => Carregar();

        var topo = new DockPanel();
        DockPanel.SetDock(atualizar, Dock.Right);
        topo.Children.Add(atualizar);
        topo.Children.Add(_filtro);

        var rolagem = new ScrollViewer { Content = _linhas, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };

        DockPanel.SetDock(topo, Dock.Top);
        DockPanel.SetDock(_estado, Dock.Top);
        _corpo.Children.Add(topo);
        _corpo.Children.Add(_estado);
        _corpo.Children.Add(rolagem);
    }

    public void Disable()
    {
        // O Panel continuaria na tela operando um módulo desligado — e o botão
        // "Encerrar" continuaria matando processo.
        var panel = context.Archetypes.Panel;
        if (panel.Owner == Id && panel.IsVisible)
        {
            panel.Dismiss();
        }
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
        panel.Heading = "Ports";
        panel.Placement = PanelPlacement.Center;
        panel.SlotContent = _corpo;
        panel.Present();
        panel.TakeFocus(_filtro);

        Carregar();
    }

    private async void Carregar()
    {
        _estado.Text = "Lendo a tabela TCP…";
        _estado.Visibility = Visibility.Visible;

        IReadOnlyList<TcpListener> portas;

        try
        {
            portas = await Task.Run(TcpListeners.Listening);
        }
        catch (Exception e)
        {
            _estado.Text = $"Não deu para ler a tabela TCP: {e.Message}";
            return;
        }

        // Uma porta em escuta nas duas pilhas aparece duas vezes na tabela do
        // Windows — 0.0.0.0 e ::. São a mesma porta do mesmo processo, e listar
        // as duas só faz a lista parecer o dobro do tamanho.
        _todas = portas
            .GroupBy(p => (p.Port, p.ProcessId))
            .Select(g =>
            {
                var p = g.First();
                var (nome, desconhecido) = NomeDoProcesso(p.ProcessId);
                var enderecos = string.Join(", ", g.Select(x => Onde(x.Address)).Distinct(StringComparer.Ordinal));
                return new Linha(p, nome, desconhecido, enderecos);
            })
            .OrderBy(l => l.Porta.Port)
            .ToList();

        Render();
    }

    private void Render()
    {
        _linhas.Children.Clear();

        var q = _filtro.Text.Trim();
        var visiveis = _todas.Where(l =>
            q.Length == 0
            || l.Porta.Port.ToString().Contains(q, StringComparison.Ordinal)
            || l.Processo.Contains(q, StringComparison.OrdinalIgnoreCase)).ToList();

        if (visiveis.Count == 0)
        {
            _estado.Text = _todas.Count == 0
                ? "Nenhuma porta TCP em escuta."
                : $"Nada com \"{q}\". Filtra por número da porta ou nome do processo.";
            _estado.Visibility = Visibility.Visible;
            return;
        }

        _estado.Visibility = Visibility.Collapsed;

        foreach (var l in visiveis)
        {
            _linhas.Children.Add(BuildLinha(l));
        }
    }

    private FrameworkElement BuildLinha(Linha l)
    {
        var porta = new TextBlock { Text = l.Porta.Port.ToString(), Width = 64, VerticalAlignment = VerticalAlignment.Center };
        porta.SetResourceReference(TextBlock.FontFamilyProperty, "font.mono");
        porta.SetResourceReference(TextBlock.FontWeightProperty, "weight.semibold");

        var processo = new TextBlock
        {
            Text = $"{l.Processo} · pid {l.Porta.ProcessId}",
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        if (l.Desconhecido)
        {
            processo.SetResourceReference(TextBlock.ForegroundProperty, "text.muted");
        }

        var endereco = new TextBlock { Text = l.Enderecos, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8, 0, 8, 0) };
        endereco.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");

        var encerrar = new Button { Content = "Encerrar", IsEnabled = !l.Desconhecido };
        encerrar.SetResourceReference(FrameworkElement.StyleProperty, "style.button.compact");
        var confirmando = false;
        var volta = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        volta.Tick += (_, _) =>
        {
            volta.Stop();
            confirmando = false;
            encerrar.Content = "Encerrar";
            encerrar.SetResourceReference(Control.BackgroundProperty, "bg.raised");
            encerrar.SetResourceReference(Control.ForegroundProperty, "text.primary");
        };
        encerrar.Click += (_, _) =>
        {
            if (!confirmando)
            {
                confirmando = true;
                encerrar.Content = "Confirmar";
                encerrar.SetResourceReference(Control.BackgroundProperty, "danger");
                encerrar.SetResourceReference(Control.ForegroundProperty, "accent.fg");
                volta.Start();
                return;
            }

            volta.Stop();
            Encerrar(l);
        };

        var linha = new DockPanel { MinHeight = 32, Margin = new Thickness(8, 0, 8, 0) };
        DockPanel.SetDock(porta, Dock.Left);
        DockPanel.SetDock(encerrar, Dock.Right);
        DockPanel.SetDock(endereco, Dock.Right);
        linha.Children.Add(porta);
        linha.Children.Add(encerrar);
        linha.Children.Add(endereco);
        linha.Children.Add(processo);
        return linha;
    }

    private void Encerrar(Linha l)
    {
        try
        {
            Process.GetProcessById((int)l.Porta.ProcessId).Kill();
            context.Archetypes.Hud.Flash(
                $"{l.Processo} encerrado",
                $"A porta {l.Porta.Port} está livre.",
                HudTone.Sucesso);
        }
        catch (Exception e)
        {
            _estado.Text = $"Não deu para encerrar {l.Processo}: {e.Message}";
            _estado.Visibility = Visibility.Visible;
            return;
        }

        // A tabela demora um instante para refletir.
        var depois = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
        depois.Tick += (_, _) => { depois.Stop(); Carregar(); };
        depois.Start();
    }

    private static (string Nome, bool Desconhecido) NomeDoProcesso(uint pid)
    {
        if (pid == 0)
        {
            return ("sistema", true);
        }

        try
        {
            return (Process.GetProcessById((int)pid).ProcessName, false);
        }
        catch
        {
            // Serviço do sistema: sem elevação não dá para ler. Dito na
            // interface, não escondido.
            return ("requer elevação", true);
        }
    }

    public UserControl? BuildSettings() => null;
}
