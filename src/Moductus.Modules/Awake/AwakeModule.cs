using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Moductus.Core.Interop;
using Moductus.Core.Modules;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Awake;

/// <summary>
/// Impede hibernar e desligar a tela. A lógica cabe em dez linhas de
/// propósito: o primeiro módulo existe para validar o formato, não a
/// funcionalidade.
/// </summary>
public sealed class AwakeModule(ModuleContext context) : IModule
{
    private const string ChaveTela = "keepDisplayOn";
    private const string ChaveHoras = "autoOffHours";

    private const int HorasPadrao = 0;
    private const int HorasMaximo = 24;

    private bool _on;

    /// <summary>Só existe enquanto há prazo para cumprir.</summary>
    private DispatcherTimer? _prazo;

    public string Id => "awake";

    public string Name => "Awake";

    public string Description => "Impede hibernar e desligar a tela";

    public ModuleArchetype Archetype => ModuleArchetype.Hud;

    public char SuggestedLeaderKey => 'a';

    public bool HasSurface => false;

    public bool IsOn => _on;

    private bool MantemTela => context.ConfigScope(Id)[ChaveTela]?.GetValue<bool>() ?? true;

    private int HorasAteDesligar => Horas(context.ConfigScope(Id)[ChaveHoras]?.GetValue<int>() ?? HorasPadrao);

    public void Enable()
    {
        // Nada. Awake nunca começa ligado: ninguém quer descobrir que o
        // notebook não hibernou porque uma sessão anterior deixou isto ativo.
    }

    public void Disable()
    {
        Cancelar();

        if (_on)
        {
            Power.AllowSleep();
            _on = false;
            context.Archetypes.Badge.Soltar(Id);
        }
    }

    public void Invoke()
    {
        _on = !_on;

        if (_on)
        {
            var tela = MantemTela;
            Power.KeepAwake(keepDisplayOn: tela);
            Agendar();

            // Estado que dura e some da vista: sem a pastilha, a máquina fica
            // acordada a noite inteira porque ninguém lembrou de desligar.
            context.Archetypes.Badge.Fixar(Id, "Awake ligado",
                "Clique para soltar a máquina", HudTone.Neutro, Invoke);

            context.Archetypes.Hud.Flash("Awake ligado", Explicacao(tela), HudTone.Neutro);
        }
        else
        {
            Cancelar();
            Power.AllowSleep();
            context.Archetypes.Badge.Soltar(Id);
            context.Archetypes.Hud.Flash(
                "Awake desligado",
                "O plano de energia do Windows volta a valer.",
                HudTone.Neutro);
        }
    }

    private string Explicacao(bool tela)
    {
        var inicio = tela
            ? "A máquina não hiberna e a tela não apaga"
            : "A máquina não hiberna, mas a tela apaga no tempo de sempre";

        var horas = HorasAteDesligar;
        return horas > 0
            ? $"{inicio}. Desliga sozinho em {horas} h."
            : $"{inicio} até você repetir o atalho.";
    }

    /// <summary>
    /// Esquecer ligado é o modo de falha do módulo: com prazo configurado, o
    /// próprio módulo repete o atalho no fim dele.
    /// </summary>
    private void Agendar()
    {
        Cancelar();

        var horas = HorasAteDesligar;
        if (horas <= 0)
        {
            return;
        }

        _prazo = new DispatcherTimer { Interval = TimeSpan.FromHours(horas) };
        _prazo.Tick += (_, _) =>
        {
            if (_on)
            {
                Invoke();
            }
        };
        _prazo.Start();
    }

    private void Cancelar()
    {
        _prazo?.Stop();
        _prazo = null;
    }

    // ---- Configuração ---------------------------------------------------------

    private static int Horas(int valor) => Math.Clamp(valor, 0, HorasMaximo);

    public UserControl? BuildSettings()
    {
        var corpo = new StackPanel();

        var tela = new CheckBox { Content = "Manter a tela ligada", IsChecked = MantemTela };
        tela.SetResourceReference(FrameworkElement.MarginProperty, "inset.4");
        tela.Checked += (_, _) => Gravar(ChaveTela, true);
        tela.Unchecked += (_, _) => Gravar(ChaveTela, false);
        corpo.Children.Add(tela);

        corpo.Children.Add(SettingsUI.Note("Desmarcado, só a hibernação é impedida — o monitor apaga como sempre num download longo."));

        corpo.Children.Add(Campo("Desligar em", "horas até soltar a máquina sozinho; 0 nunca desliga", ChaveHoras, HorasPadrao));

        corpo.Children.Add(SettingsUI.Note("Mudança vale na próxima vez que o Awake for ligado."));

        return new UserControl { Content = corpo };
    }

    private FrameworkElement Campo(string rotulo, string dica, string chave, int padrao)
    {
        var caixa = SettingsUI.NumberBox(HorasAteDesligar.ToString());

        // Grava no que sair do campo, não a cada tecla: "1" a caminho de "12"
        // não pode virar uma hora gravada.
        caixa.LostFocus += (_, _) =>
        {
            var horas = int.TryParse(caixa.Text, out var n) ? Horas(n) : padrao;
            caixa.Text = horas.ToString();
            Gravar(chave, horas);
        };

        return SettingsUI.Row(rotulo, dica, caixa);
    }

    private void Gravar(string chave, int valor)
    {
        context.ConfigScope(Id)[chave] = valor;
        context.SaveConfig();
    }

    private void Gravar(string chave, bool valor)
    {
        context.ConfigScope(Id)[chave] = valor;
        context.SaveConfig();
    }
}
