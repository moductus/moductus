# Como escrever um módulo

Este documento é o contrato. Se o seu módulo o respeita, ele vai parecer parte da suíte sem que você precise decidir nada de visual.

## O princípio

**Um módulo novo não desenha UI nova.** Ele escolhe um dos quatro arquétipos de janela e preenche o conteúdo.

Isso é o que torna a suíte viável: não existem dezoito interfaces para desenhar, existem quatro, e cada módulo passa a ser um problema de lógica em vez de um problema de design. É também o que faz tudo parecer da mesma família.

## Os quatro arquétipos

| Arquétipo | Onde aparece | Rouba foco | Quando usar |
|---|---|---|---|
| **Palette** | Centro, terço superior, 640px | Sim | Busca com lista de resultados |
| **HUD** | Pílula pequena, ancorada | Não | Feedback transitório, some sozinho em ~1,5s |
| **Panel** | Flutuante, redimensionável | Não | Conteúdo que fica aberto durante o trabalho |
| **Canvas** | Tela cheia, topmost | Sim | Operação sobre o desktop congelado |

HUD e Panel usam `WS_EX_NOACTIVATE` e nunca roubam foco. Palette guarda o `HWND` anterior e devolve o foco ao fechar.

As janelas dos arquétipos são **singletons criadas e escondidas no startup**, não construídas sob demanda. Isso não é otimização: é o que impede que a primeira invocação de cada módulo pague a construção da árvore visual do WPF, que custa os mesmos ~300ms que o produto inteiro promete não gastar.

## A interface

```csharp
public interface IModule
{
    string Id { get; }                  // "ports"
    string Name { get; }                // "Ports"
    string Description { get; }
    ModuleArchetype Archetype { get; }

    char SuggestedLeaderKey { get; }    // letra padrão; o usuário pode trocar
    bool HasSurface { get; }            // false em módulo puro de estado (Awake)

    void Enable();                      // barato: registra letra e hotkey. Startup.
    void Disable();
    void Invoke();                      // mostra ou alterna a superfície. Atalho.

    UserControl? BuildSettings();       // painel de config, ou null
}
```

### `Enable` não é `Invoke`

Essa separação é a regra mais fácil de violar por engano, e a mais cara.

`Enable` roda **para todo módulo ativo, no startup**. Ele registra a letra e a hotkey, e nada mais. Ele não pode tocar em UI, não pode ler arquivo grande, não pode consultar o sistema.

`Invoke` roda **quando o usuário aperta o atalho**. É o único lugar onde a superfície aparece.

Se você fizer trabalho de `Invoke` dentro de `Enable`, o startup do Moductus passa a carregar a UI de todos os módulos ativos — e é assim que um app de bandeja começa a demorar três segundos para subir.

### O que o módulo recebe

O construtor recebe um `ModuleContext`, e é tudo que ele tem:

| | Para quê |
|---|---|
| `Archetypes` | Os quatro singletons. `Archetypes.Hud.Flash("texto")` é o feedback mais barato que existe. |
| `ConfigScope(id)` | O `JsonObject` sob `modules.<id>`. O módulo não enxerga a raiz. |
| `SaveConfig()` | Grava tudo, atomicamente. |
| `Theme` | Modo atual e evento de mudança. |

**O módulo não registra letra nem hotkey.** O host faz isso a partir de `SuggestedLeaderKey`, respeitando o que o usuário configurou, e mostra colisão na tela de configurações. O módulo só implementa `Invoke`.

O `AwakeModule` em `src/Moductus.Modules/Awake/` é o exemplo mínimo: dez linhas de lógica, um `Flash` no HUD, e nada no `Enable`.

### Usando o Panel

O Panel é um singleton compartilhado. O padrão que Peek, Ports e Scratch seguem:

```csharp
var panel = context.Archetypes.Panel;

// Toggle: só fecha se for nosso e não estiver fixado.
if (panel.IsVisible && panel.Owner == Id && !panel.IsPinned) { panel.Dismiss(); return; }

panel.Owner = Id;
panel.Heading = "Ports";
panel.Placement = PanelPlacement.Center;   // ou Top, para deslizar de cima
panel.SlotContent = corpo;
panel.Dismissed += Soltar;                 // miniatura, timer, arquivo
panel.Present();
panel.TakeFocus(_filtro);                  // só se o módulo tem digitação
```

`Present` nunca rouba foco. `TakeFocus` é opt-in e deliberado: o usuário pediu esta superfície, então focar o campo dela não é interrupção. Peek não chama; Ports e Scratch chamam.

**Trabalho lento não entra no `Invoke`.** O Ports mostra o Panel com "lendo…" e lê a tabela TCP em `Task.Run`. A superfície aparece antes do dado, sempre.

### Oferecendo comandos à Palette

Utilitário pequeno **não vira módulo**: vira comando da Palette. O `CommandRegistry` do contexto é onde qualquer módulo registra o que oferece, e a Palette lista sem conhecer ninguém:

```csharp
context.Commands.Register("meu-modulo", new PaletteCommand(
    id: "json",
    text: "Clipboard: formatar JSON",
    detail: "Indenta o JSON copiado",
    hint: null,
    execute: () => { /* ... */ }));

// No Disable:
context.Commands.Unregister("meu-modulo");
```

O host registra "Abrir X" para cada módulo ativo, com a letra como dica. O ranking da busca é prefixo, depois início de palavra, depois trecho — previsível de propósito, sem fuzzy. `PasteFlow` e `RunNotify` em `src/Moductus.Modules/Palette/` são os exemplos.

## Nomeação

Substantivo curto, um só, em inglês. Lê bem como `Moductus · Ports` e é digitável na paleta.

A letra do líder **não é derivada da inicial** — três módulos disputam o `p`. Ela é dado explícito, registrado centralmente e configurável pelo usuário, e a colisão é detectada no startup.

## Interop

Use o [CsWin32](https://github.com/microsoft/CsWin32). Adicione o nome exato da função ao `NativeMethods.txt` e deixe o gerador escrever a assinatura P/Invoke.

Nunca escreva `[DllImport]` à mão. Assinatura de struct errada compila, roda, e corrompe memória em silêncio numa versão específica do Windows — é o bug mais caro de achar neste tipo de projeto.

## Prompt base para geração assistida

Cole no topo de todo prompt de módulo novo. É isso que mantém o código gerado dentro do sistema.

```
Contexto: projeto Moductus, C# .NET 10, WPF, processo único.
WPF puro — não use WinForms, nem para o ícone de bandeja.
Usar CsWin32 para todo P/Invoke — cite a API do Windows pelo nome exato.

Regras obrigatórias:
- Implementar IModule (Id, Name, Description, Archetype, SuggestedLeaderKey,
  HasSurface, Enable, Disable, Invoke, BuildSettings)
- Enable é barato e roda no startup; Invoke é quem mostra a superfície
- Usar EXCLUSIVAMENTE um dos quatro arquétipos: Palette, HUD, Panel, Canvas
- Nenhuma cor, tamanho, raio ou duração literal no código — só chaves do Tokens.xaml
- Esc fecha; Enter é a ação primária; a hotkey é toggle
- HUD e Panel usam WS_EX_NOACTIVATE e não roubam foco
- Nenhuma chamada de rede
- Nenhum MessageBox: erro vai inline no overlay
- Estado vazio precisa de texto explicativo
- Nenhuma dependência NuGet nova sem eu aprovar

Módulo a construir: <nome>
Arquétipo: <um dos quatro>
API principal: <nome exato da função Win32>
Comportamento: <descrição>
```

**Nomeie a API pelo nome exato.** A diferença de acerto entre pedir `DwmRegisterThumbnail` e pedir "uma miniatura ao vivo da janela" é grande.

## Armadilhas conhecidas

Anotações que economizam dias de depuração, por módulo:

- **Clips** — gerenciadores de senha marcam o clipboard com `ExcludeClipboardContentFromMonitorProcessing` e `CanIncludeInClipboardHistory`. Respeitar isso é obrigatório, ou o módulo vira algo que grava senha em disco.
- **Links** — symlink exige admin ou Modo Desenvolvedor, mas **junction de pasta não exige nada**. Como quase todo uso real é mover pasta pesada de disco, use junction por padrão e deixe symlink como opção avançada. Isso tira o UAC do caminho.
- **Ports** — ver o processo dono de portas de serviço do sistema exige elevação. Sem admin, alguns aparecem como desconhecidos: mostre isso na interface em vez de esconder.
- **Timer** — a bandeja pede o ícone em 16, 20, 24 ou 32px conforme o scaling do monitor. Gere o bitmap no tamanho solicitado, nunca fixo em 16.
- **Freeze** — capture o desktop como bitmap, jogue numa janela fullscreen borderless topmost, e opere régua, lupa e conta-gotas sobre esse bitmap em memória. Fica preciso e independe do que estava se movendo na tela.
- **Kill** — pode ser marcado por anti-cheat de jogo. Fica desligado por padrão e documentado no README.
- **Todo módulo, sem exceção** — `Enable()` **roda de novo** toda vez que o módulo é religado nas configurações. Se ele monta a árvore visual, monte uma vez só e guarde a flag; readicionar um filho que já tem pai lança `ArgumentException` e derruba o processo inteiro, sem janela de erro. Registro de comando fica **fora** da guarda, porque `Disable()` o remove e religar precisa recolocá-lo.
- **Todo módulo com Panel** — um elemento do WPF só pode ter um pai lógico. Construir um `DockPanel` novo a cada `Invoke` e adicionar nele o mesmo `TextBox` de sempre derruba o app com "já é o filho lógico de outro elemento" — e só na **segunda** abertura, que é quando ninguém está testando. Construa o conteúdo uma vez, no `Enable`, e reutilize.

### Estado que dura: a pastilha

O ícone de bandeja comunica estado, mas o Windows 11 esconde ícone novo atrás
da setinha de estouro — na prática o estado existe e ninguém vê. Para estado
que dura e que o usuário vai querer desfazer, use o badge:

```csharp
// Fica no canto enquanto durar. O clique desfaz.
context.Archetypes.Badge.Fixar(Id, "Microfone mudo",
    "Clique para voltar a captar", HudTone.Alerta, () => Alternar());

// Some.
context.Archetypes.Badge.Soltar(Id);
```

**Pastilha empilha, ícone de bandeja não.** Mic mudo e pomodoro contando ao
mesmo tempo são duas pastilhas; no ícone eles disputam por prioridade. Por
isso os dois existem, e um módulo de estado costuma usar os dois.

**Badge não é HUD.** HUD é transitório e some sozinho; badge fica até o estado
acabar. Avisar "microfone mudo" por 1,6 segundo e sumir é o que fazia a pessoa
esquecer que está mudo.

### Desenhando estado no ícone de bandeja

O ícone é disputado: Timer pinta o progresso, Mic troca quando está mudo. `context.Tray` resolve por prioridade.

```csharp
// Reivindica enquanto há estado a comunicar.
_claim = context.Tray.Claim(Id, prioridade,
    (tamanho, barraClara) => Mark.Render(tamanho, barraClara, progress: 0.42),
    "Moductus — faltam 14:30");

// Redesenha (o tique do Timer). Só age se este dono estiver no ar.
context.Tray.Refresh(Id);

// Libera: o ícone volta para quem estiver abaixo, ou para o mark base.
_claim?.Dispose();
```

**O tamanho vem por parâmetro e não se discute.** A bandeja pede 16, 20, 24 ou 32 conforme o scaling do monitor; renderizar fixo em 16 e deixar o Windows escalar borra o ativo visual mais visível do produto. `Mark.Render` já faz tudo proporcional.

**`barraClara` não é o tema dos aplicativos.** A barra de tarefas tem tema próprio (`SystemUsesLightTheme`), e ícone branco em barra clara desaparece.

Prioridades em uso: **Mic mudo 100**, **progresso do Timer 50**. A regra é qual erro custa mais caro — microfone aberto sem querer bate perder a contagem de vista.

