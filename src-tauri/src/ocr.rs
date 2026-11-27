//! Texto de uma imagem pelo OCR do Windows (`Windows.Media.Ocr`, ADR-0043), para o comprovante virar
//! lançamento. Só o serviço pede, pelo canal do sidecar (`{"tipo":"ocr","id","op":"ler_texto_imagem",
//! "caminho"}`), e só com o caminho que ele autorizou (ADR-0044): nenhuma janela tem comando para isso
//! e nenhuma ferramenta de agente recebe caminho. A casca confere de novo o que dá para conferir aqui:
//! caminho completo numa unidade local, arquivo comum e extensão de imagem, no nome pedido e no
//! resolvido.
//!
//! O motor é sempre o pt-BR (`TryCreateFromLanguage`), nunca o do perfil: com o en-US os acentos saem
//! errados. Sem o pt-BR instalado, a resposta é `sem_idioma` e nada cai para outro idioma. Imagem
//! maior que `MaxImageDimension` (10.000 px) é reduzida no próprio decodificador antes da leitura.
//! O registro leva quantas linhas e quanto tempo, nunca o caminho nem o texto.

use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    thread,
    time::Instant,
};

use serde::{Deserialize, Serialize};
use windows::{
    core::HSTRING,
    Globalization::Language,
    Graphics::Imaging::{
        BitmapAlphaMode, BitmapDecoder, BitmapInterpolationMode, BitmapPixelFormat, BitmapTransform, ColorManagementMode,
        ExifOrientationMode, SoftwareBitmap,
    },
    Media::Ocr::OcrEngine,
    Storage::{FileAccessMode, StorageFile},
    Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
};

use crate::{abrir::caminho_local, servico::sem_prefixo_verbatim};

/// O idioma do motor: o do Moductus, não o do perfil do Windows.
pub const IDIOMA: &str = "pt-BR";

/// As imagens que o decodificador do Windows lê e o comprovante aceita (`EXTENSOES_ARQUIVO` do
/// contrato). PDF fica para depois.
pub const EXTENSOES: &[&str] = &["png", "jpg", "jpeg", "bmp", "gif", "tif", "tiff"];

/// Acima disso a imagem nem é decodificada: 200 megapixels já passam de qualquer print ou foto de
/// comprovante, e um PNG pequeno pode dizer que tem 100.000 × 100.000 px.
const LIMITE_PIXELS: u64 = 200_000_000;

/// Por que a leitura não saiu. Os textos vão à janela como vieram, na voz do produto.
#[derive(Debug, PartialEq)]
pub enum Falha {
    /// O Windows não tem o reconhecimento de texto em português.
    SemIdioma,
    /// O caminho não é de uma imagem que a casca lê.
    Recusado(String),
    /// A imagem não abriu ou o OCR falhou.
    Ilegivel(String),
}

/// Caminho completo numa unidade local, de um arquivo que existe, com extensão de imagem no nome
/// pedido e no resolvido (um link `a.png` que leva a `segredo.env` não passa). Devolve o resolvido.
pub fn validar_caminho(caminho: &str) -> Result<PathBuf, String> {
    let pedido = Path::new(caminho);
    caminho_local(pedido).map_err(|_| "só imagem numa unidade do PC é lida".to_string())?;
    let real = std::fs::canonicalize(pedido).map_err(|_| "a imagem não foi encontrada".to_string())?;
    let real = sem_prefixo_verbatim(real);
    if !real.is_file() {
        return Err("só um arquivo de imagem é lido".into());
    }
    if caminho_local(&real).is_err() || !de_imagem(pedido) || !de_imagem(&real) {
        return Err("o Moductus só lê PNG, JPEG, BMP, GIF ou TIFF".into());
    }
    Ok(real)
}

fn de_imagem(caminho: &Path) -> bool {
    caminho
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|e| EXTENSOES.contains(&e.to_ascii_lowercase().as_str()))
}

/// A medida que cabe no OCR: o lado maior vira `maximo` e o outro acompanha, nunca abaixo de 1 px.
/// `None` quando a imagem já cabe.
pub fn medida_reduzida(largura: u32, altura: u32, maximo: u32) -> Option<(u32, u32)> {
    let maior = largura.max(altura);
    if maior <= maximo || maior == 0 {
        return None;
    }
    let reduzir = |lado: u32| ((u64::from(lado) * u64::from(maximo) / u64::from(maior)) as u32).max(1);
    Some((reduzir(largura), reduzir(altura)))
}

/// O motor do idioma pedido, ou `SemIdioma` se o Windows não o tem.
fn motor(idioma: &str) -> Result<OcrEngine, Falha> {
    let idioma = Language::CreateLanguage(&HSTRING::from(idioma)).map_err(|_| Falha::SemIdioma)?;
    if !OcrEngine::IsLanguageSupported(&idioma).unwrap_or(false) {
        return Err(Falha::SemIdioma);
    }
    OcrEngine::TryCreateFromLanguage(&idioma).map_err(|_| Falha::SemIdioma)
}

/// A imagem decodificada em BGRA, já reduzida se passa de `maximo`.
fn imagem(caminho: &Path, maximo: u32) -> Result<SoftwareBitmap, Falha> {
    let ilegivel = |_| Falha::Ilegivel("não foi possível abrir a imagem".into());
    let arquivo = StorageFile::GetFileFromPathAsync(&HSTRING::from(caminho.as_os_str())).and_then(|o| o.join()).map_err(ilegivel)?;
    let fluxo = arquivo.OpenAsync(FileAccessMode::Read).and_then(|o| o.join()).map_err(ilegivel)?;
    let decodificador = BitmapDecoder::CreateAsync(&fluxo).and_then(|o| o.join()).map_err(ilegivel)?;
    let (largura, altura) =
        (decodificador.PixelWidth().map_err(ilegivel)?, decodificador.PixelHeight().map_err(ilegivel)?);
    if u64::from(largura) * u64::from(altura) > LIMITE_PIXELS {
        return Err(Falha::Recusado("a imagem é grande demais para ler".into()));
    }
    let transformacao = BitmapTransform::new().map_err(ilegivel)?;
    if let Some((l, a)) = medida_reduzida(largura, altura, maximo) {
        transformacao.SetScaledWidth(l).map_err(ilegivel)?;
        transformacao.SetScaledHeight(a).map_err(ilegivel)?;
        transformacao.SetInterpolationMode(BitmapInterpolationMode::Fant).map_err(ilegivel)?;
    }
    decodificador
        .GetSoftwareBitmapTransformedAsync(
            BitmapPixelFormat::Bgra8,
            BitmapAlphaMode::Premultiplied,
            &transformacao,
            ExifOrientationMode::RespectExifOrientation,
            ColorManagementMode::DoNotColorManage,
        )
        .and_then(|o| o.join())
        .map_err(ilegivel)
}

fn ler(caminho: &Path, idioma: &str) -> Result<Vec<String>, Falha> {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    // O idioma antes da imagem: sem ele, nem vale decodificar.
    let motor = motor(idioma)?;
    let maximo = OcrEngine::MaxImageDimension().map_err(|_| Falha::SemIdioma)?;
    let bitmap = imagem(caminho, maximo)?;
    let falhou = |_| Falha::Ilegivel("o Windows não conseguiu ler o texto da imagem".into());
    let resultado = motor.RecognizeAsync(&bitmap).and_then(|o| o.join()).map_err(falhou)?;
    let linhas = resultado.Lines().map_err(falhou)?;
    Ok((&linhas).into_iter().filter_map(|l| l.Text().ok()).map(|t| t.to_string()).collect())
}

/// As linhas de texto da imagem, de cima para baixo, pelo motor pt-BR.
pub fn ler_texto_imagem(caminho: &str) -> Result<Vec<String>, Falha> {
    let real = validar_caminho(caminho).map_err(Falha::Recusado)?;
    ler(&real, IDIOMA)
}

/* ---------- Canal do serviço ---------- */

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Pedido {
    LerTextoImagem { caminho: String },
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Resposta {
    Texto { linhas: Vec<String> },
    Erro { codigo: &'static str, erro: String },
}

impl From<Falha> for Resposta {
    fn from(falha: Falha) -> Self {
        let (codigo, erro) = match falha {
            Falha::SemIdioma => ("sem_idioma", "o reconhecimento de texto em português não está instalado no Windows".into()),
            Falha::Recusado(motivo) => ("recusado", motivo),
            Falha::Ilegivel(motivo) => ("ilegivel", motivo),
        };
        Resposta::Erro { codigo, erro }
    }
}

pub fn atender(pedido: Pedido) -> Resposta {
    let Pedido::LerTextoImagem { caminho } = pedido;
    let inicio = Instant::now();
    match ler_texto_imagem(&caminho) {
        Ok(linhas) => {
            crate::registro::info(&format!("ocr: {} linhas em {} ms", linhas.len(), inicio.elapsed().as_millis()));
            Resposta::Texto { linhas }
        }
        Err(falha) => {
            crate::registro::info(&format!("ocr: {falha:?} em {} ms", inicio.elapsed().as_millis()));
            falha.into()
        }
    }
}

/// Uma linha `ocr` do canal. A leitura vai numa thread: decodificar e ler leva dezenas de
/// milissegundos, e o canal não espera.
pub fn receber(linha: &str, responder: impl FnOnce(serde_json::Value) + Send + 'static) {
    match serde_json::from_str::<Pedido>(linha) {
        Ok(pedido) => {
            thread::spawn(move || responder(serde_json::to_value(atender(pedido)).unwrap_or_default()));
        }
        Err(e) => responder(serde_json::json!({ "erro": format!("pedido inválido: {e}") })),
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use std::{ffi::c_void, fs};
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::COLORREF,
            Graphics::Gdi::{
                CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject, GdiFlush, SelectObject,
                SetBkMode, SetTextColor, TextOutW, ANTIALIASED_QUALITY, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
                CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DIB_RGB_COLORS, FW_NORMAL, OUT_DEFAULT_PRECIS, TRANSPARENT,
            },
        },
    };

    const TEXTO: [&str; 2] = ["Transferência concluída", "Valor: R$ 1.234,56"];

    fn pasta(nome: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("moductus-ocr-{nome}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    /// Desenha as linhas com a fonte do Windows (GDI) e grava um BMP de 24 bits: a imagem nasce no
    /// teste, sem arquivo de fixture nem biblioteca nova.
    fn bmp_com_texto(destino: &Path, largura: i32, altura: i32, fundo: [u8; 3], tinta: [u8; 3]) {
        let mut pixels = vec![0u8; (largura * altura * 4) as usize];
        unsafe {
            let dc = CreateCompatibleDC(None);
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: largura,
                    biHeight: -altura,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits: *mut c_void = std::ptr::null_mut();
            let dib = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0).unwrap();
            let memoria = std::slice::from_raw_parts_mut(bits as *mut u8, pixels.len());
            for px in memoria.as_chunks_mut::<4>().0 {
                px.copy_from_slice(&[fundo[2], fundo[1], fundo[0], 0]);
            }
            let antigo = SelectObject(dc, dib.into());
            let fonte = CreateFontW(
                -40,
                0,
                0,
                0,
                FW_NORMAL.0 as i32,
                0,
                0,
                0,
                DEFAULT_CHARSET,
                OUT_DEFAULT_PRECIS,
                CLIP_DEFAULT_PRECIS,
                ANTIALIASED_QUALITY,
                0,
                PCWSTR(HSTRING::from("Segoe UI").as_ptr()),
            );
            let fonte_antiga = SelectObject(dc, fonte.into());
            SetBkMode(dc, TRANSPARENT);
            SetTextColor(dc, COLORREF(u32::from(tinta[0]) | u32::from(tinta[1]) << 8 | u32::from(tinta[2]) << 16));
            for (i, linha) in TEXTO.iter().enumerate() {
                let largos: Vec<u16> = linha.encode_utf16().collect();
                let _ = TextOutW(dc, 40, 30 + i as i32 * 60, &largos);
            }
            let _ = GdiFlush();
            pixels.copy_from_slice(memoria);
            SelectObject(dc, fonte_antiga);
            SelectObject(dc, antigo);
            let _ = DeleteObject(fonte.into());
            let _ = DeleteObject(dib.into());
            let _ = DeleteDC(dc);
        }
        // BMP de 24 bits, de baixo para cima, cada linha alinhada em 4 bytes.
        let passo = ((largura * 3 + 3) & !3) as usize;
        let tamanho = 54 + passo * altura as usize;
        let mut arquivo = Vec::with_capacity(tamanho);
        arquivo.extend_from_slice(b"BM");
        arquivo.extend_from_slice(&(tamanho as u32).to_le_bytes());
        arquivo.extend_from_slice(&[0; 4]);
        arquivo.extend_from_slice(&54u32.to_le_bytes());
        arquivo.extend_from_slice(&40u32.to_le_bytes());
        arquivo.extend_from_slice(&largura.to_le_bytes());
        arquivo.extend_from_slice(&altura.to_le_bytes());
        arquivo.extend_from_slice(&1u16.to_le_bytes());
        arquivo.extend_from_slice(&24u16.to_le_bytes());
        arquivo.extend_from_slice(&[0; 24]);
        for y in (0..altura as usize).rev() {
            let linha = &pixels[y * largura as usize * 4..(y + 1) * largura as usize * 4];
            let inicio = arquivo.len();
            for px in linha.as_chunks::<4>().0 {
                arquivo.extend_from_slice(&px[..3]);
            }
            arquivo.resize(inicio + passo, 0);
        }
        fs::write(destino, arquivo).unwrap();
    }

    fn pt_br_instalado() -> bool {
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        motor(IDIOMA).is_ok()
    }

    /// Com o pt-BR, as duas linhas saem certas, com acento e o valor no formato brasileiro. Sem ele
    /// (o runner do CI só tem en-US), a casca responde `sem_idioma` e não lê em outro idioma.
    fn confere_leitura(caminho: &Path) {
        let lido = ler_texto_imagem(&caminho.to_string_lossy());
        if !pt_br_instalado() {
            eprintln!("OCR pt-BR ausente nesta máquina: conferido só o sem_idioma");
            assert_eq!(lido, Err(Falha::SemIdioma));
            return;
        }
        let linhas = lido.unwrap();
        let texto = linhas.join("\n");
        assert!(texto.contains("Transferência concluída"), "lido: {texto:?}");
        assert!(texto.contains("R$ 1.234,56"), "lido: {texto:?}");
    }

    #[test]
    fn le_texto_com_acento_e_valor() {
        let p = pasta("claro");
        let imagem = p.join("comprovante.bmp");
        bmp_com_texto(&imagem, 900, 160, [255, 255, 255], [0, 0, 0]);
        confere_leitura(&imagem);
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn le_print_no_tema_escuro() {
        let p = pasta("escuro");
        let imagem = p.join("print.bmp");
        bmp_com_texto(&imagem, 900, 160, [18, 18, 20], [230, 230, 230]);
        confere_leitura(&imagem);
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn imagem_de_12_mil_px_e_reduzida_e_lida() {
        let p = pasta("grande");
        let imagem = p.join("larga.bmp");
        bmp_com_texto(&imagem, 12_000, 200, [255, 255, 255], [0, 0, 0]);
        assert_eq!(medida_reduzida(12_000, 200, 10_000), Some((10_000, 166)));
        confere_leitura(&imagem);
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn medida_reduzida_so_quando_passa_do_maximo() {
        assert_eq!(medida_reduzida(10_000, 10_000, 10_000), None);
        assert_eq!(medida_reduzida(1080, 2400, 10_000), None);
        assert_eq!(medida_reduzida(1080, 24_000, 10_000), Some((450, 10_000)));
        assert_eq!(medida_reduzida(20_000, 10, 10_000), Some((10_000, 5)));
        assert_eq!(medida_reduzida(100_000, 1, 10_000), Some((10_000, 1)));
    }

    #[test]
    fn sem_o_idioma_nao_cai_para_outro() {
        let p = pasta("idioma");
        let imagem = p.join("comprovante.bmp");
        bmp_com_texto(&imagem, 900, 160, [255, 255, 255], [0, 0, 0]);
        // Islandês não tem motor de OCR no Windows: faz o papel do pt-BR ausente.
        assert_eq!(ler(&imagem, "is-IS"), Err(Falha::SemIdioma));
        let resposta = serde_json::to_value(Resposta::from(Falha::SemIdioma)).unwrap();
        assert_eq!(resposta["codigo"], "sem_idioma");
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn recusa_o_que_nao_e_imagem_local() {
        let p = pasta("recusa");
        let texto = p.join("segredo.env");
        fs::write(&texto, "x").unwrap();
        let disfarce = p.join("segredo.png");
        assert!(matches!(ler_texto_imagem(&texto.to_string_lossy()), Err(Falha::Recusado(_))));
        assert!(matches!(ler_texto_imagem(&disfarce.to_string_lossy()), Err(Falha::Recusado(_))));
        assert!(matches!(ler_texto_imagem(&p.to_string_lossy()), Err(Falha::Recusado(_))));
        assert!(matches!(ler_texto_imagem("comprovante.png"), Err(Falha::Recusado(_))));
        assert!(matches!(ler_texto_imagem(r"\\servidor\pasta\a.png"), Err(Falha::Recusado(_))));
        assert!(matches!(ler_texto_imagem(&format!("{}\\..\\a.png", p.display())), Err(Falha::Recusado(_))));
        // Pasta com nome de imagem também não é arquivo.
        let pasta_png = p.join("pasta.png");
        fs::create_dir_all(&pasta_png).unwrap();
        assert!(matches!(ler_texto_imagem(&pasta_png.to_string_lossy()), Err(Falha::Recusado(_))));
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn imagem_corrompida_e_ilegivel() {
        let p = pasta("corrompida");
        let quebrada = p.join("quebrada.png");
        fs::write(&quebrada, b"isto nao e um png").unwrap();
        // Direto no decodificador: sem o pt-BR, a leitura pararia antes, no idioma.
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        assert!(matches!(imagem(&quebrada, 10_000), Err(Falha::Ilegivel(_))));
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn pedidos_do_canal() {
        let p: Pedido =
            serde_json::from_str(r#"{"tipo":"ocr","id":3,"op":"ler_texto_imagem","caminho":"C:\\a.png"}"#).unwrap();
        let Pedido::LerTextoImagem { caminho } = p;
        assert_eq!(caminho, "C:\\a.png");
        assert!(serde_json::from_str::<Pedido>(r#"{"tipo":"ocr","id":4,"op":"outro","caminho":"C:\\a.png"}"#).is_err());
        let texto = serde_json::to_value(Resposta::Texto { linhas: vec!["a".into()] }).unwrap();
        assert_eq!(texto, serde_json::json!({ "linhas": ["a"] }));
    }
}
