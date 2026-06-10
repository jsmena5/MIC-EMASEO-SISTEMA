# Marca EMASEO EP IA — ícono y exportación

`emaseo-ep-ia-icon.svg` es el ícono maestro vectorial (1024×1024). Paleta sobria
institucional: azul `#005BAC`/`#003F7A`, verde `#00A859`, blanco.

El logo **dentro de la app** (splash y login) ya está implementado de forma
vectorial nativa en `src/components/BrandLogo.tsx` y se actualiza por OTA. Lo que
NO se puede cambiar por OTA es el **ícono y el nombre a nivel del sistema
operativo**: eso requiere exportar este SVG a PNG y hacer un build nuevo (EAS).

## Cómo exportar el SVG a los PNG que pide `app.json`

Necesitas estos archivos en `assets/images/`:

| Archivo                              | Tamaño      | Notas                                              |
|--------------------------------------|-------------|----------------------------------------------------|
| `icon.png`                           | 1024×1024   | Ícono principal (fondo incluido).                  |
| `splash-icon.png`                    | ~512×512    | Marca centrada; fondo del splash es `#001828`.     |
| `android-icon-foreground.png`        | 1024×1024   | Solo la marca, **fondo transparente**, centrada en el 66% central (zona segura del adaptive icon). |
| `android-icon-background.png`        | 1024×1024   | Color/relleno de fondo (puede ser un PNG sólido `#003F7A`). |
| `favicon.png`                        | 48×48       | Web.                                               |

### Opción A — Inkscape (CLI)
```bash
inkscape emaseo-ep-ia-icon.svg -w 1024 -h 1024 -o ../images/icon.png
```

### Opción B — navegador / herramienta online
Abre el SVG, expórtalo a PNG 1024×1024 y reemplaza `assets/images/icon.png`.
Para el `foreground` transparente, borra el `<rect ... fill="url(#bg)"/>` del SVG
antes de exportar.

## Después de reemplazar los PNG
1. `eas build --platform android --profile preview` (y/o `ios`) — el ícono y el
   nombre "EMASEO EP IA" solo aparecen tras un build nuevo, no por OTA.
2. El nombre ya está puesto en `app.json` (`expo.name = "EMASEO EP IA"`).
