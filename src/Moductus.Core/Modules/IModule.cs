using System.Windows.Controls;

namespace Moductus.Core.Modules;

/// <summary>Os quatro, e só os quatro. Módulo não desenha UI nova.</summary>
public enum ModuleArchetype
{
    Palette,
    Hud,
    Panel,
    Canvas,
}

/// <summary>O contrato de um módulo.</summary>
/// <remarks>
/// <para>
/// <see cref="Enable"/> e <see cref="Invoke"/> são separados e isso é a regra
/// mais fácil de violar. <c>Enable</c> roda para todo módulo ativo durante o
/// startup, dentro do orçamento de 300ms: sem UI, sem I/O, sem consulta ao
/// sistema. <c>Invoke</c> roda no atalho e é o único lugar onde a superfície
/// aparece.
/// </para>
/// <para>
/// O host registra a letra e a hotkey por conta própria a partir de
/// <see cref="SuggestedLeaderKey"/>; o módulo não toca em registro nenhum.
/// </para>
/// </remarks>
public interface IModule
{
    /// <summary>Minúsculo, ASCII, sem espaço. É chave de config.</summary>
    string Id { get; }

    /// <summary>Substantivo curto, um só, em inglês.</summary>
    string Name { get; }

    string Description { get; }

    ModuleArchetype Archetype { get; }

    /// <summary>Letra padrão. O usuário pode trocar.</summary>
    char SuggestedLeaderKey { get; }

    /// <summary>Falso em módulo puro de estado, como o Awake.</summary>
    bool HasSurface { get; }

    /// <summary>
    /// Falso para o que precisa de consentimento explícito — o Kill, que
    /// anti-cheat marca. O usuário liga na configuração.
    /// </summary>
    bool EnabledByDefault => true;

    /// <summary>Barato. Roda no startup.</summary>
    void Enable();

    void Disable();

    /// <summary>Mostra ou alterna a superfície. Roda no atalho.</summary>
    void Invoke();

    /// <summary>Painel de configuração, ou <c>null</c>.</summary>
    UserControl? BuildSettings();
}
