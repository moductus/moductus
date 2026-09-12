using System.Windows.Controls;
using Moductus.Core.Audio;
using Moductus.Core.Commands;
using Moductus.Core.Modules;
using Moductus.Core.Tray;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Mic;

/// <summary>
/// Mudo de microfone, com indicador na bandeja. É mudo no endpoint do
/// Windows, não um filtro por aplicativo: qualquer chamada em andamento
/// para de receber som.
/// </summary>
/// <remarks>
/// Reivindica a bandeja com prioridade alta — microfone aberto sem querer é
/// pior que perder de vista a contagem do Timer, então o risco no ícone
/// ganha do arco de progresso.
/// </remarks>
public sealed class MicModule(ModuleContext context) : IModule
{
    /// <summary>Acima do Timer (50): esquecer o microfone aberto custa mais caro.</summary>
    public const int TrayPriority = 100;

    private readonly MicrophoneMute _mute = new();
    private IDisposable? _claim;

    public string Id => "mic";

    public string Name => "Mic";

    public string Description => "Muta o microfone e mostra na bandeja";

    public ModuleArchetype Archetype => ModuleArchetype.Hud;

    public char SuggestedLeaderKey => 'm';

    public bool HasSurface => false;

    public void Enable()
    {
        context.Commands.Register(Id, new PaletteCommand(
            "mic:toggle", "Mutar ou desmutar o microfone", "Mudo de verdade, no endpoint do Windows", null, Invoke));

        // Se o microfone já estava mudo de uma sessão anterior, o ícone
        // precisa dizer isso desde o startup.
        Sincronizar();
    }

    public void Disable()
    {
        context.Commands.Unregister(Id);
        _claim?.Dispose();
        _claim = null;
        _mute.Dispose();
    }

    public void Invoke()
    {
        if (!_mute.Available)
        {
            context.Archetypes.Hud.Flash(
                "Nenhum microfone padrão",
                "O Windows não tem entrada de áudio ativa. Escolha uma em Configurações de som.",
                HudTone.Alerta);
            return;
        }

        var estado = _mute.Toggle();

        if (estado is not { } mudo)
        {
            context.Archetypes.Hud.Flash(
                "O Windows recusou o mudo",
                "Algum app está segurando o endpoint. Tente de novo em alguns segundos.",
                HudTone.Alerta);
            return;
        }

        Aplicar(mudo);

        if (mudo)
        {
            context.Archetypes.Hud.Flash(
                "Microfone mudo",
                "Mudo no endpoint, ninguém te ouve. O ícone da bandeja fica marcado.",
                HudTone.Neutro);
        }
        else
        {
            context.Archetypes.Hud.Flash(
                "Microfone aberto",
                "Voltou a captar. Repita o atalho para mutar.",
                HudTone.Neutro);
        }
    }

    private void Sincronizar()
    {
        if (_mute.IsMuted is { } mudo)
        {
            Aplicar(mudo);
        }
    }

    private void Aplicar(bool mudo)
    {
        if (mudo)
        {
            _claim = context.Tray.Claim(Id, TrayPriority,
                (tamanho, claro) => Mark.Render(tamanho, claro, slashed: true),
                "Moductus — microfone mudo");
        }
        else
        {
            _claim?.Dispose();
            _claim = null;
        }
    }

    public UserControl? BuildSettings() => null;
}
