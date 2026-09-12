using System.Windows.Media.Imaging;
using Moductus.Core.Interop;
using Moductus.Core.Theme;

namespace Moductus.Core.Tray;

/// <summary>Como um módulo desenha o ícone no tamanho que a bandeja pediu.</summary>
/// <param name="size">16, 20, 24 ou 32.</param>
/// <param name="onLightTaskbar">Barra de tarefas clara pede mark escuro.</param>
public delegate BitmapSource TrayRender(int size, bool onLightTaskbar);

/// <summary>
/// Dono do ícone de bandeja. Aceita reivindicações de módulos por prioridade
/// e resolve a disputa — o Timer pinta o progresso, o Mic troca o ícone
/// quando está mudo, e os dois podem querer ao mesmo tempo.
/// </summary>
/// <remarks>
/// A regra: vence a prioridade mais alta; empate resolve por ordem de
/// chegada; quem perde fica registrado e assume quando o vencedor liberar.
/// Ninguém reivindicando, volta ao mark base.
/// </remarks>
public sealed class TrayHost : IDisposable
{
    private readonly TrayIcon _icon;
    private readonly ISystemThemeSource _theme;
    private readonly List<Reivindicacao> _claims = [];

    private nint _handle;
    private int _ordem;

    public TrayHost(MessageWindow window, ISystemThemeSource theme, string tooltip)
    {
        _theme = theme ?? throw new ArgumentNullException(nameof(theme));
        BaseTooltip = tooltip;

        _handle = Render(null);
        _icon = new TrayIcon(window, _handle, tooltip);
    }

    public string BaseTooltip { get; }

    public event Action? LeftClick
    {
        add => _icon.LeftClick += value;
        remove => _icon.LeftClick -= value;
    }

    public event Action? RightClick
    {
        add => _icon.RightClick += value;
        remove => _icon.RightClick -= value;
    }

    /// <summary>
    /// Reivindica o ícone. Descartar o retorno libera. Prioridade maior
    /// ganha; o Mic mudo (100) fica acima do progresso do Timer (50), porque
    /// microfone aberto sem querer é pior que perder a contagem de vista.
    /// </summary>
    public IDisposable Claim(string owner, int priority, TrayRender render, string tooltip)
    {
        ArgumentNullException.ThrowIfNull(tooltip);
        return Claim(owner, priority, render, () => tooltip);
    }

    /// <summary>
    /// Igual, mas com a dica avaliada a cada redesenho. É o que o Timer
    /// precisa: dica fixa congela em "faltam 25:00" pela contagem inteira, e
    /// passar o mouse no ícone vira a forma mais rápida de desconfiar que o
    /// módulo travou.
    /// </summary>
    public IDisposable Claim(string owner, int priority, TrayRender render, Func<string> tooltip)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(owner);
        ArgumentNullException.ThrowIfNull(render);
        ArgumentNullException.ThrowIfNull(tooltip);

        _claims.RemoveAll(c => c.Owner == owner);

        var claim = new Reivindicacao(owner, priority, render, tooltip, ++_ordem);
        _claims.Add(claim);
        Apply();

        return new Release(this, owner);
    }

    /// <summary>Redesenha, se este dono for quem está no ar. É o tique do Timer.</summary>
    public void Refresh(string owner)
    {
        if (Vencedor()?.Owner == owner)
        {
            Apply();
        }
    }

    public void ReleaseClaim(string owner)
    {
        if (_claims.RemoveAll(c => c.Owner == owner) > 0)
        {
            Apply();
        }
    }

    /// <summary>Chamado quando o tema do sistema muda: o mark inverte.</summary>
    public void Invalidate() => Apply();

    public void PrepareForMenu() => _icon.PrepareForMenu();

    private Reivindicacao? Vencedor() => _claims
        .OrderByDescending(c => c.Priority)
        .ThenBy(c => c.Ordem)
        .FirstOrDefault();

    private void Apply()
    {
        var vencedor = Vencedor();
        var novo = Render(vencedor?.Render);

        _icon.SetIcon(novo);
        _icon.SetTooltip(vencedor is null ? BaseTooltip : vencedor.Tooltip());

        // Só depois de o Windows já ter o novo: destruir antes pisca.
        IconFactory.Destroy(_handle);
        _handle = novo;
    }

    private nint Render(TrayRender? render)
    {
        var tamanho = IconFactory.TraySize();
        var claro = _theme.TaskbarIsLight;

        var bitmap = render is null
            ? Mark.Render(tamanho, claro)
            : render(tamanho, claro);

        return IconFactory.FromBitmap(bitmap);
    }

    public void Dispose()
    {
        _claims.Clear();
        _icon.Dispose();
        IconFactory.Destroy(_handle);
        _handle = 0;
    }

    private sealed record Reivindicacao(string Owner, int Priority, TrayRender Render, Func<string> Tooltip, int Ordem);

    private sealed class Release(TrayHost host, string owner) : IDisposable
    {
        private bool _liberado;

        public void Dispose()
        {
            if (!_liberado)
            {
                _liberado = true;
                host.ReleaseClaim(owner);
            }
        }
    }
}
