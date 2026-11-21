# RumboNav — Navegación Vertical Heading-Up

Web app de navegación GPS diseñada para mantener **siempre el mapa orientado en vertical hacia tu dirección de marcha** (Heading-Up / Track-Up), con un HUD ultra-translúcido que no tapa el mapa y guía por voz en español **sin bucles de recálculo**.

## Características principales

- **Orientación Heading-Up vertical**: Usa MapLibre GL JS (tiles vectoriales) para rotar el mapa suavemente (`bearing` + `pitch` 3D) de modo que la calle por la que avanzás apunte siempre hacia arriba y los nombres de las calles sigan siendo legibles.
- **HUD translúcido y modo Mapa Limpio**: Controles compactos con `backdrop-filter: blur` y botón de transparencia mínima para despejar más del 90% de la pantalla.
- **Guía por voz sin bucles ("no loop")**:
  - En modo libre, detecta y anuncia cambios de calle (con throttling y deduplicación).
  - En ruta guiada (OSRM), exige 3 lecturas consecutivas fuera de ruta (> 50 m durante > 5 s), bloqueo en vuelo y cooldown de 25–30 s antes de volver a anunciar *"Recalculando ruta"*.
- **Simulador integrado (`▶`)**: Permite probar la rotación vertical y la voz al instante sin salir a la calle.

## Despliegue en Netlify

El repositorio incluye `netlify.toml` listo para publicar (`publish = "."` sin paso de build):

1. Entrá a [app.netlify.com](https://app.netlify.com/) → **Add new site** → **Import an existing project**.
2. Conectá **GitHub** y seleccioná `juanmsf/rumbo-nav`.
3. Dejá el directorio de publicación en `.` y hacé clic en **Deploy site**.
