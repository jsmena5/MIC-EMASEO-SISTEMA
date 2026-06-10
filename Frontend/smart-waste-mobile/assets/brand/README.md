# Marca EMASEO EP IA — ícono y assets

Identidad sobria institucional: azul `#005BAC`/`#003F7A`, verde `#00A859`, blanco.
Emblema = hoja eco inclinada (con nervaduras) + chip "IA".

## Archivos de esta carpeta
- `gen_icons.py` — **generador real** de los PNG (Pillow, sin rasterizador SVG).
  Dibuja el emblema con supersampling 4x y exporta a `assets/images/`.
- `emaseo-ep-ia-icon.svg` — versión vectorial de referencia del emblema.

## Regenerar los íconos
```bash
cd Frontend/smart-waste-mobile
python assets/brand/gen_icons.py
```
Genera/sobrescribe en `assets/images/`:

| Archivo                          | Tamaño    | Uso                                  |
|----------------------------------|-----------|--------------------------------------|
| `icon.png`                       | 1024×1024 | Ícono principal (fondo navy).        |
| `splash-icon.png`                | 512×512   | Splash (badge verde).                |
| `android-icon-foreground.png`    | 1024×1024 | Adaptive icon — capa frontal (transp.). |
| `android-icon-background.png`    | 1024×1024 | Adaptive icon — fondo navy sólido.   |
| `android-icon-monochrome.png`    | 1024×1024 | Íconos temáticos (silueta blanca).   |
| `favicon.png`                    | 48×48     | Web.                                 |

El logo **dentro de la app** (splash/login) está en `src/components/BrandLogo.tsx`
y se actualiza por OTA. El **ícono y el nombre del SO** solo cambian con un build
EAS (no por OTA). El nombre ya está en `app.json` (`expo.name = "EMASEO EP IA"`)
y `adaptiveIcon.backgroundColor = #003F7A`.

## Build con el ícono nuevo
```bash
eas build --platform android --profile preview
eas build --platform ios --profile preview
```
