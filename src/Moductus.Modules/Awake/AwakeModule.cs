using System.Windows.Controls;
using Moductus.Core.Interop;
using Moductus.Core.Modules;
using Moductus.UI.Modules;

namespace Moductus.Modules.Awake;

/// <summary>
/// Impede hibernar e desligar a tela. A lógica cabe em dez linhas de
/// propósito: o primeiro módulo existe para validar o formato, não a
/// funcionalidade.
/// </summary>
public sealed class AwakeModule(ModuleContext context) : IModule
{
    private bool _on;

    public string Id => "awake";

    public string Name => "Awake";

    public string Description => "Impede hibernar e desligar a tela";

    public ModuleArchetype Archetype => ModuleArchetype.Hud;

    public char SuggestedLeaderKey => 'a';

    public bool HasSurface => false;

    public bool IsOn => _on;

    public void Enable()
    {
        // Nada. Awake nunca começa ligado: ninguém quer descobrir que o
        // notebook não hibernou porque uma sessão anterior deixou isto ativo.
    }

    public void Disable()
    {
        if (_on)
        {
            Power.AllowSleep();
            _on = false;
        }
    }

    public void Invoke()
    {
        _on = !_on;

        if (_on)
        {
            Power.KeepAwake(keepDisplayOn: true);
            context.Archetypes.Hud.Flash("Awake ligado — não vai hibernar");
        }
        else
        {
            Power.AllowSleep();
            context.Archetypes.Hud.Flash("Awake desligado");
        }
    }

    public UserControl? BuildSettings() => null;
}
