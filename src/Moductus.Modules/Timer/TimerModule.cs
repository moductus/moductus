using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Moductus.Core.Commands;
using Moductus.Core.Modules;
using Moductus.Core.Tray;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Timer;

/// <summary>
/// Pomodoro desenhado dentro do ícone da bandeja. O arco fecha conforme o
/// tempo passa; nenhuma janela fica aberta.
/// </summary>
/// <remarks>
/// <para>
/// O ícone é redesenhado só quando o arco mudaria de verdade — um por cento
/// de 25 minutos são 15 segundos, então uma volta inteira custa cem
/// redesenhos, não mil e quinhentos.
/// </para>
/// <para>
/// A bandeja é o mostrador, mas o Windows 11 esconde ícone novo atrás da
/// setinha de estouro, e aí o mostrador não existe. Por isso a tecla líder
/// com contagem em andamento <b>informa quanto falta</b> em vez de cancelar
/// em silêncio: é a única resposta à pergunta "isso ainda está rodando?" que
/// não depende de o ícone estar visível.
/// </para>
/// </remarks>
public sealed class TimerModule(ModuleContext context) : IModule
{
    /// <summary>Abaixo do Mic (100): perder a contagem de vista custa menos.</summary>
    public const int TrayPriority = 50;

    private const string ChaveFoco = "focusMinutes";
    private const string ChavePausa = "breakMinutes";
    private const string ChaveAutoPausa = "autoBreak";

    private const int FocoPadrao = 25;
    private const int PausaPadrao = 5;

    /// <summary>Janela em que repetir o atalho cancela em vez de consultar.</summary>
    private static readonly TimeSpan JanelaDeCancelamento = TimeSpan.FromSeconds(2);

    private readonly DispatcherTimer _tique = new() { Interval = TimeSpan.FromSeconds(1) };

    /// <summary>
    /// Guardado em campo porque Enable roda de novo a cada vez que o módulo é
    /// religado. Lambda anônima não dá para remover, e o Tique passaria a rodar
    /// N vezes por segundo depois de N idas e vindas nas configurações.
    /// </summary>
    private EventHandler? _aoTique;
    private IDisposable? _claim;
    private DateTimeOffset _fim;
    private DateTimeOffset _ultimaConsulta = DateTimeOffset.MinValue;
    private TimeSpan _total;
    private string _rotulo = string.Empty;
    private bool _emPausa;

    /// <summary>
    /// Quanto faltava quando pausou. Enquanto isso não for nulo, `_fim` está
    /// congelado e não significa mais nada — retomar recalcula a partir daqui.
    /// </summary>
    private TimeSpan? _congelado;

    private int _ultimoPercentual = -1;

    public string Id => "timer";

    public string Name => "Timer";

    public string Description => "Pomodoro no ícone da bandeja";

    public ModuleArchetype Archetype => ModuleArchetype.Hud;

    public char SuggestedLeaderKey => 't';

    public bool HasSurface => false;

    private bool Rodando => _claim is not null;

    private bool Pausado => _congelado is not null;

    /// <summary>Quanto o botão "+" acrescenta. Cinco minutos é o passo do método.</summary>
    private static readonly TimeSpan Esticada = TimeSpan.FromMinutes(5);

    private TimeSpan Foco => TimeSpan.FromMinutes(Minutos(ChaveFoco, FocoPadrao));

    private TimeSpan Pausa => TimeSpan.FromMinutes(Minutos(ChavePausa, PausaPadrao));

    private bool PausaAutomatica => context.ConfigScope(Id)[ChaveAutoPausa]?.GetValue<bool>() ?? false;

    public void Enable()
    {
        _aoTique ??= (_, _) => Tique();
        _tique.Tick -= _aoTique;
        _tique.Tick += _aoTique;

        context.Commands.Register(Id, new PaletteCommand(
            "timer:focus", "Pomodoro: iniciar foco", "O arco na bandeja mostra quanto falta", null,
            () => Iniciar(Foco, "Foco", pausa: false)));

        context.Commands.Register(Id, new PaletteCommand(
            "timer:break", "Pomodoro: iniciar pausa", null, null,
            () => Iniciar(Pausa, "Pausa", pausa: true)));

        context.Commands.Register(Id, new PaletteCommand(
            "timer:status", "Pomodoro: quanto falta", "Mostra a contagem em andamento", null, Consultar));

        context.Commands.Register(Id, new PaletteCommand(
            "timer:pause", "Pomodoro: pausar ou retomar", "Congela a contagem sem descartar", null,
            () => { if (Pausado) { Retomar(); } else { Pausar(); } }));

        context.Commands.Register(Id, new PaletteCommand(
            "timer:extend", "Pomodoro: +5 minutos", "Estica o bloco em andamento", null, Esticar));

        context.Commands.Register(Id, new PaletteCommand(
            "timer:stop", "Pomodoro: parar", "Cancela a contagem em andamento", null, Parar));
    }

    public void Disable()
    {
        context.Commands.Unregister(Id);
        _tique.Stop();
        context.Archetypes.Badge.Soltar(Id);

        if (_aoTique is not null)
        {
            _tique.Tick -= _aoTique;
        }

        _claim?.Dispose();
        _claim = null;
    }

    /// <summary>
    /// Parado, começa o foco. Rodando, diz quanto falta — e repetir o atalho
    /// logo em seguida cancela. Cancelar na primeira batida era o
    /// comportamento antigo, e transformava "só queria conferir" em perder a
    /// contagem.
    /// </summary>
    public void Invoke()
    {
        if (!Rodando)
        {
            Iniciar(Foco, "Foco", pausa: false);
            return;
        }

        if (DateTimeOffset.Now - _ultimaConsulta <= JanelaDeCancelamento)
        {
            Parar();
            return;
        }

        Consultar();
    }

    private void Iniciar(TimeSpan duracao, string rotulo, bool pausa, bool avisar = true)
    {
        _total = duracao;
        _fim = DateTimeOffset.Now + duracao;
        _rotulo = rotulo;
        _emPausa = pausa;
        _congelado = null;
        _ultimoPercentual = -1;
        _ultimaConsulta = DateTimeOffset.MinValue;

        // A dica vai como função: avaliada a cada redesenho, ela acompanha a
        // contagem em vez de congelar no valor do começo.
        _claim ??= context.Tray.Claim(Id, TrayPriority, Desenhar, Tooltip);
        _tique.Start();

        Redesenhar();
        Repintar();

        if (avisar)
        {
            context.Archetypes.Hud.Flash(
                $"{rotulo} — {duracao.TotalMinutes:F0} min",
                $"Termina às {_fim.LocalDateTime:HH:mm}. Repita o atalho para ver quanto falta.");
        }
    }

    private void Consultar()
    {
        if (!Rodando)
        {
            context.Archetypes.Hud.Flash("Nenhuma contagem em andamento.", "Aperte o atalho de novo para começar o foco.", HudTone.Alerta);
            return;
        }

        _ultimaConsulta = DateTimeOffset.Now;

        var falta = Restante();
        context.Archetypes.Hud.Flash(
            $"{_rotulo} — faltam {Relogio(falta)}",
            "Repita o atalho agora para cancelar.");
    }

    private void Parar()
    {
        if (!Rodando)
        {
            context.Archetypes.Hud.Flash("Nenhuma contagem em andamento.", null, HudTone.Alerta);
            return;
        }

        _tique.Stop();
        _claim?.Dispose();
        _claim = null;
        _congelado = null;
        _ultimaConsulta = DateTimeOffset.MinValue;
        context.Archetypes.Badge.Soltar(Id);

        context.Archetypes.Hud.Flash("Contagem cancelada.", $"{_rotulo} parado com {Relogio(Restante())} restando.", HudTone.Alerta);
    }

    /// <summary>
    /// Congela a contagem. Pomodoro sem pausa é cronômetro: a interrupção
    /// acontece, e obrigar a cancelar e recomeçar é o que faz a pessoa
    /// abandonar o método no terceiro dia.
    /// </summary>
    private void Pausar()
    {
        if (!Rodando || Pausado)
        {
            return;
        }

        _congelado = Restante();
        _tique.Stop();

        // O ícone continua com o arco parado onde estava: some seria pior,
        // porque some é o que "acabou" faz.
        context.Tray.Refresh(Id);
        Repintar();
    }

    private void Retomar()
    {
        // O padrão captura o valor: Pausado sozinho não convence o compilador
        // de que _congelado tem conteúdo.
        if (!Rodando || _congelado is not { } parado)
        {
            return;
        }

        _fim = DateTimeOffset.Now + parado;
        _congelado = null;
        _tique.Start();

        Redesenhar();
        Repintar();
    }

    /// <summary>
    /// Acrescenta tempo ao bloco em andamento. Some no total também, senão o
    /// arco voltaria para trás e o ícone passaria a mentir.
    /// </summary>
    private void Esticar()
    {
        if (!Rodando)
        {
            return;
        }

        _total += Esticada;

        if (_congelado is { } parado)
        {
            _congelado = parado + Esticada;
        }
        else
        {
            _fim += Esticada;
        }

        _ultimoPercentual = -1;
        Redesenhar();
        Repintar();
    }

    private void Tique()
    {
        if (Restante() > TimeSpan.Zero)
        {
            // O ícone é redesenhado só quando o arco mudaria de verdade, mas a
            // pastilha mostra segundos: presa na mesma guarda, ela ficava
            // quinze segundos parada no mesmo número e parecia travada.
            Redesenhar();
            Repintar();
            return;
        }

        var rotulo = _rotulo;
        var eraFoco = !_emPausa;

        _tique.Stop();
        _claim?.Dispose();
        _claim = null;
        _ultimaConsulta = DateTimeOffset.MinValue;
        context.Archetypes.Badge.Soltar(Id);

        if (eraFoco && PausaAutomatica)
        {
            // Iniciar tem Flash próprio, e ele seria substituído no mesmo tique.
            // Silencioso aqui, e a mensagem abaixo diz as duas coisas de uma vez.
            Iniciar(Pausa, "Pausa", pausa: true, avisar: false);
            context.Archetypes.Hud.Flash($"{rotulo} concluído.", $"A pausa de {Pausa.TotalMinutes:F0} min já começou.", HudTone.Sucesso);
            return;
        }

        context.Archetypes.Hud.Flash(
            $"{rotulo} concluído.",
            eraFoco ? $"Atalho de novo começa outro foco de {Foco.TotalMinutes:F0} min." : null,
            HudTone.Sucesso);
    }

    private TimeSpan Restante()
    {
        if (_congelado is { } parado)
        {
            return parado;
        }

        var falta = _fim - DateTimeOffset.Now;
        return falta > TimeSpan.Zero ? falta : TimeSpan.Zero;
    }

    private static string Relogio(TimeSpan t) => $"{(int)t.TotalMinutes:00}:{t.Seconds:00}";

    private double Fracao() => _total <= TimeSpan.Zero
        ? 0
        : Math.Clamp(1 - Restante().TotalSeconds / _total.TotalSeconds, 0, 1);

    private void Redesenhar()
    {
        var percentual = (int)(Fracao() * 100);
        if (percentual == _ultimoPercentual)
        {
            return;
        }

        _ultimoPercentual = percentual;
        context.Tray.Refresh(Id);
    }

    /// <summary>
    /// Redesenha a pastilha. O corpo não é clicável de propósito: com botões
    /// ali, clique no corpo vira cancelamento sem querer.
    /// </summary>
    private void Repintar()
    {
        if (!Rodando)
        {
            return;
        }

        var titulo = Pausado
            ? $"{_rotulo} pausado — {Relogio(Restante())}"
            : $"{_rotulo} — {Relogio(Restante())}";

        List<BadgeAction> acoes =
        [
            Pausado
                ? new BadgeAction("Retomar", "Continua de onde parou", Retomar)
                : new BadgeAction("Pausar", "Congela a contagem", Pausar),
            new BadgeAction($"+{Esticada.TotalMinutes:F0}", "Acrescenta cinco minutos a este bloco", Esticar),
            new BadgeAction("Parar", "Cancela e descarta a contagem", Parar),
        ];

        context.Archetypes.Badge.Fixar(
            Id,
            titulo,
            $"Termina às {_fim.LocalDateTime:HH:mm}",
            Pausado ? HudTone.Alerta : _emPausa ? HudTone.Sucesso : HudTone.Neutro,
            aoClicar: null,
            acoes);
    }

    private System.Windows.Media.Imaging.BitmapSource Desenhar(int tamanho, bool claro) =>
        Mark.Render(tamanho, claro, progress: Math.Max(Fracao(), 0.001));

    private string Tooltip() => Pausado
        ? $"Moductus — {_rotulo} pausado, faltam {Relogio(Restante())}"
        : $"Moductus — {_rotulo}, faltam {Relogio(Restante())}";

    // ---- Configuração ---------------------------------------------------------

    private int Minutos(string chave, int padrao)
    {
        var valor = context.ConfigScope(Id)[chave]?.GetValue<int>() ?? padrao;
        return Math.Clamp(valor, 1, 180);
    }

    public UserControl? BuildSettings()
    {
        var corpo = new StackPanel();

        corpo.Children.Add(Campo("Foco", "minutos por bloco de trabalho", ChaveFoco, FocoPadrao));
        corpo.Children.Add(Campo("Pausa", "minutos de descanso", ChavePausa, PausaPadrao));

        var auto = new CheckBox { Content = "Começar a pausa sozinha quando o foco terminar", IsChecked = PausaAutomatica };
        auto.SetResourceReference(FrameworkElement.MarginProperty, "inset.4");
        auto.Checked += (_, _) => Gravar(ChaveAutoPausa, true);
        auto.Unchecked += (_, _) => Gravar(ChaveAutoPausa, false);
        corpo.Children.Add(auto);

        var nota = new TextBlock
        {
            Text = "Mudança vale para a próxima contagem; a que estiver rodando termina com a duração de quando começou.",
        };
        nota.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        nota.SetResourceReference(FrameworkElement.MarginProperty, "inset.4");
        corpo.Children.Add(nota);

        return new UserControl { Content = corpo };
    }

    private FrameworkElement Campo(string rotulo, string dica, string chave, int padrao)
    {
        var caixa = SettingsUI.NumberBox(Minutos(chave, padrao).ToString());

        // Grava no que sair do campo, não a cada tecla: "5" a caminho de "50"
        // não pode virar cinco minutos gravados.
        caixa.LostFocus += (_, _) =>
        {
            var minutos = int.TryParse(caixa.Text, out var n) ? Math.Clamp(n, 1, 180) : padrao;
            caixa.Text = minutos.ToString();
            Gravar(chave, minutos);
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
