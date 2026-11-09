# Mutatio

Herramientas de sonido, vídeo e imagen con procesamiento local en el navegador. Preparado para ordenador y para servirse directamente con Caddy.

## Despliegue

1. Coloca el proyecto completo en `/srv/Mutatio`, incluida la carpeta `dependencias/`.
2. Añade el bloque de `Caddyfile.ejemplo` a tu configuración de Caddy. Cambia `mutatio.tudominio.com` por tu dominio y ajusta `root` si utilizas otra ruta.
3. Valida y recarga la configuración:

   ```sh
   sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   sudo systemctl reload caddy
   ```

El dominio debe apuntar a la VPS y el usuario de Caddy debe poder leer la carpeta. Caddy gestiona HTTPS. No hay instalación de paquetes, compilación ni procesos adicionales de la aplicación: todas las dependencias necesarias están incluidas.

La configuración aporta las cabeceras de aislamiento requeridas por la aplicación, compresión de JavaScript y WebAssembly y caché para las dependencias versionadas. Solo publica los archivos de la web; la configuración y los archivos internos del repositorio quedan fuera de las rutas públicas.

Para actualizar, reemplaza los archivos del proyecto y recarga la página. No hace falta recargar Caddy salvo que cambies su configuración. Conserva `dependencias/` en el repositorio: el archivo `.wasm`, de unos 31 MB, forma parte de la aplicación.

## Estructura

```text
Mutatio/
├── index.html
├── estilos.css
├── app.js
├── multimedia.js
├── favicon.svg
├── Caddyfile.ejemplo
├── LEEME.md
└── dependencias/
    ├── LEEME.md
    ├── motor-0.12.15/
    └── nucleo-0.12.10/
```

`app.js` gestiona la interfaz, imágenes y descargas. `multimedia.js` ejecuta FFmpeg en un trabajador del navegador. Las dependencias oficiales se conservan sin modificar y con sus licencias.

## Uso

- **Sonido:** cortar y convertir a MP3 o WAV.
- **Vídeo:** cortar sin recodificar, silenciar o sustituir la pista de sonido. Salida Matroska (`.mkv`) para conservar los códecs originales. Los cortes dependen de los fotogramas clave y pueden variar ligeramente respecto al intervalo elegido.
- **Imágenes:** recortar, pixelar y comprimir a WebP o JPEG. Primero aplica la selección y después descarga. JPEG utiliza fondo blanco para las transparencias.
- **Crear vídeo:** hasta 200 fotos, orden editable, duración por foto y por transición, cuatro efectos y música opcional. Salida MP4 o MKV a 30 fotogramas por segundo, con tamaños de 720p, 1080p, 2160p o el de la primera foto. Calidad equilibrada, alta o sin pérdidas de codificación. Las transiciones no alargan el vídeo; la música se repite si es necesario y se desvanece al final.

Cada herramienta conserva su propio resultado hasta reemplazarlo o recargar la página. El enlace permite repetir una descarga si el navegador no la inicia automáticamente.

## Límites

- 512 MB por archivo y 40 millones de píxeles por imagen.
- Hasta 200 fotografías por vídeo, con exposiciones entre 0,1 y 60 segundos, ajustadas a fotogramas completos.
- Salida de hasta 8,3 millones de píxeles y 3840 píxeles por lado. Conservar el tamaño de la primera foto añade como máximo un píxel de borde para obtener dimensiones pares.
- Transiciones de 0,1 segundos hasta la duración de una foto, ajustadas a fotogramas completos.
- 256 MB de vídeo temporal comprimido. Si se supera, reduce la resolución, la calidad o los segundos por foto.

Se conservan los archivos originales y solo se crean miniaturas al incorporarlos. Las fotos se preparan una a una al crear el vídeo, en PNG sin compresión con pérdidas, adaptándolas al tamaño elegido sin recortar. Se procesan en bloques de hasta diez imágenes, menores a resoluciones altas; con transiciones se añade una foto de enlace. Se liberan los archivos temporales y el trabajador entre bloques. El tiempo de procesamiento depende del ordenador, del contenido y de la duración elegida.

El modo sin pérdidas conserva los píxeles del fotograma preparado mediante H.264 RGB; no deshace el redimensionado ni recupera detalle ausente en el original. Genera archivos mayores y su reproducción depende del reproductor. La opción de calidad afecta a la imagen; la música se codifica en AAC y se desvanece al final.

Los archivos seleccionados nunca se envían a la VPS. La web no utiliza analítica, fuentes remotas ni servicios externos durante su funcionamiento. Necesita HTTPS, o localhost para desarrollo; no se puede abrir mediante `file://`.
