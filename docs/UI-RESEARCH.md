# Documentação UI / UX - Moductus

## 1. Windows 11 Fluent Design e Materiais
A Microsoft define três materiais principais no Windows 11 para profundidade e hierarquia:
*   **Mica:** Superfície opaca que incorpora a cor do papel de parede do desktop. Usado para o fundo principal de janelas de vida longa (app background). [Fonte](https://learn.microsoft.com/en-us/windows/apps/design/style/materials)
*   **Mica Alt:** Variação do Mica com tintura mais forte do desktop. Usado quando o app tem hierarquia profunda (ex: abas + painéis laterais). [Fonte](https://learn.microsoft.com/en-us/windows/apps/design/style/materials#mica-alt)
*   **Acrylic:** Efeito de vidro jateado, semitransparente. Desenvolvido exclusivamente para superfícies transitórias (light-dismiss) que sobrepõem o conteúdo. [Fonte](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic)

**Recomendação para o Moductus:**
*   **Paleta de Comandos (transitória):** Acrylic. Ela aparece rapidamente e sobrepõe o sistema/janelas; o Acrylic sinaliza que é descartável (light-dismiss).
*   **Painel flutuante (persistente):** Mica. Como ele fica ativo na tela e não desaparece ao perder o foco, a Microsoft orienta usar Mica.
*   **Pílula de notificação (HUD):** Acrylic. É uma sobreposição transitória e rápida.
*   **Canvas (tela cheia):** Mica. É a base opaca recomendada para a janela principal.

## 2. Como aplicar Mica e Acrylic no WPF (.NET 10)
O WPF foi feito para desenhar janelas opacas no CPU/DirectX. Para usar materiais DWM modernos, a abordagem clássica de `AllowsTransparency="True"` **não pode** ser usada.
*   **Por que não usar AllowsTransparency=True:** Ele altera a janela para WS_EX_LAYERED, forçando composição por software em muitos cenários (mata aceleração de hardware do fundo), desativa o shadow padrão do Windows, quebra os cantos arredondados nativos do DWM, e as APIs do Windows 11 (Mica/Acrylic) simplesmente ignoram janelas LAYERED. [Fonte - Comunidade e GitHub WPF](https://github.com/dotnet/wpf/issues/4825)

**A abordagem correta:**
1.  Manter `AllowsTransparency="False"`.
2.  Expandir o frame do Windows (DWM) para cobrir a área de cliente usando `WindowChrome` com `GlassFrameThickness="-1"`.
3.  Fazer um interop Win32 chamando `DwmSetWindowAttribute` com `DWMWA_SYSTEMBACKDROP_TYPE` (Mica = 2, Acrylic = 3, Mica Alt = 4) e `DWMWA_USE_IMMERSIVE_DARK_MODE` (1 para forçar dark). [Fonte](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute)

**Trade-offs de fazer à mão:**
Se fizer manualmente, você precisará tratar falhas do `WindowChrome` (a janela sangra para outros monitores ao maximizar) e hit-testing das bordas de redimensionamento na área customizada.

**Recomendação:**
**Adote uma dependência.** Use [WPF-UI](https://github.com/lepoco/wpfui) ou ModernWpf. A biblioteca WPF-UI é altamente recomendada para Windows 11 pois já encapsula as chamadas DWM perfeitamente, mantém a aceleração de hardware e resolve o hit-testing. Fazer isso à mão exige recriar o DWM handling do zero, o que não vale a pena.

## 3. Cantos Arredondados e Sombras no Windows 11
O DWM (Desktop Window Manager) controla os cantos via `DWMWA_WINDOW_CORNER_PREFERENCE`. [Fonte](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/apply-rounded-corners)
*   **Round:** Raio padrão (8px). Usado em janelas principais (Canvas, Painéis persistentes).
*   **RoundSmall:** Raio menor (4px). Usado para overlays, tooltips e pílulas transitórias (Paleta, HUD).

**Sombras e Borderless:**
No Windows 11, o DWM desenha a sombra automaticamente acompanhando a curvatura do canto — *desde que* a janela seja reconhecida pelo DWM.
Se você usar `WindowStyle="None"` no WPF para esconder a barra de título, o DWM entende que não há borda e remove a sombra. Para devolver a sombra em uma janela borderless, você **deve** estender o frame usando `WindowChrome.GlassFrameThickness="-1"`. Isso devolve a sombra nativa perfeita do Windows sem precisar hackear `DropShadowEffect` (que destrói a performance do WPF).

## 4. Movimento (Fluent Motion)
A UI deve parecer ágil e intencional. As animações Fluent não são lineares. [Fonte](https://learn.microsoft.com/en-us/windows/apps/design/motion/timing-and-easing)

**Durações exatas:**
*   **167ms (Fast):** Feedback rápido. Troca de estados, Hover em botões, seleção de item na lista.
*   **250ms (Normal):** Mudança de contexto menor. Entrada da Paleta flutuante ou da Pílula HUD.

**Curvas de Easing (Bezier):**
*   **Entrada de janela (Entrance / Decelerate):** Começa rápido, termina devagar. Spline/Bezier: `0.0, 0.0, 0.0, 1.0` (EaseOut).
*   **Saída de janela (Exit / Accelerate):** Começa devagar, sai rápido. Spline/Bezier: `0.7, 0.0, 1.0, 0.5` (EaseIn).
*   **Movimento na tela (Standard):** `0.4, 0.0, 0.2, 1.0` (EaseInOut).

**Acessibilidade (Reduced Motion):**
O Windows permite ao usuário desativar animações. No WPF, você deve ler a propriedade estática `SystemParameters.ClientAreaAnimation` (que mapeia para a API Win32 `SPI_GETCLIENTAREAANIMATION`). Se for `false`, suas Storyboards de transição de janela devem ter duração 0ms. [Fonte](https://learn.microsoft.com/dotnet/api/system.windows.systemparameters.clientareaanimation)

## 5. Análise de Nicho (O que copiar dos melhores)
Análise prática da concorrência, focada em acabamento da Command Palette:

*   **Raycast (macOS):** É o padrão ouro atual. O segredo deles é o **estado vazio nulo**. Ao abrir, ele nunca mostra uma tela vazia, mostra os apps favoritos ou recentes imediatamente. Altura da linha generosa (aprox. 40px, garantindo respiro). Os atalhos de teclado ficam estritamente alinhados à margem direita com um estilo de pílula distinto.
*   **VS Code Command Palette:** Excelência em agrupamento. Eles usam pequenas seções de texto maiúsculo (ex: "RECENTES") para quebrar os itens. Atalhos aparecem discretos e perfeitamente legíveis à direita.
*   **PowerToys Run:** Design oficial Fluent, mas visualmente pesado. Eles cometem o erro de mostrar um texto cinza inútil "Comece a digitar..." no meio de um estado vazio. Tem boa integração da sombra nativa, mas o espaçamento das linhas é denso demais.
*   **Flow Launcher / Everything / Ueli:** Focam na função, sacrificam o acabamento. Flow e Ueli parecem web apps inseridos no desktop (erram espessuras de fonte e raios de borda). Everything tem zero preenchimento, maximizando densidade visual ao extremo.

**Ações para o Moductus:**
1.  Nunca inicie a Palette vazia. Mostre recentes, favoritos ou comandos padrão.
2.  Alinhe todos os atalhos de teclado à extrema direita das linhas, formatados em "tags" (raio de 4px, fundo cinza 10% de opacidade).
3.  Utilize altura de linha (RowHeight) de pelo menos 36px (seguindo a grade de 4px).
4.  Exiba agrupamentos claros separando os tipos de resultados (Aplicativos, Comandos, Arquivos).

## 6. Checklist Prático: Os erros que gritam "Amador"
*   **Borda invisível no Escuro (Missing Stroke):** Um painel escuro flutuando sobre um terminal ou papel de parede escuro some completamente se tiver apenas sombra. **Regra Fluent:** Janelas e flyouts flutuantes precisam de uma borda interna de 1px com cor clara sutil (ex: Branco com 8% a 10% de opacidade) para garantir contraste. O Windows 11 chama isso de "Stroke". [Fonte](https://learn.microsoft.com/en-us/windows/apps/design/style/color#stroke)
*   **Alinhamento Geométrico vs. Óptico:** Centralizar o bounding box de um ícone SVG assímétrico o deixa visualmente torto. Deve-se alinhar o peso óptico.
*   **Ícones Inconsistentes:** Usar ícones com espessuras de linha misturadas (1px e 2px na mesma tela). **Regra:** Adote uma única iconografia rigorosa (ex: Fluent System Icons). Dica: use versões "Filled" (sólidas) para o item selecionado e "Regular" (contorno de 1.5px) para itens inativos.
*   **Densidade Extrema:** Texto encostando nas laterais. Mantenha preenchimentos laterais de pelo menos 12px ou 16px na lista de busca.
*   **Estado de Carregamento Bruto:** Congelar a interface ou mostrar um spinner gigante. **Regra:** A barra de busca deve continuar respondendo imediatamente. Mostre o carregamento de forma sutil — um progress bar linear indeterminado grudado embaixo da TextBox (apenas 2px de espessura, usando o tom âmbar #FFB224) ou um skeleton loader na lista.
*   **Estado Vazio (Empty State):** Mostrar apenas tela preta se a busca falhar. É necessário exibir um texto sutil de feedback ("Nada encontrado") e um ícone opaco de ilustração, mantendo o usuário engajado.
