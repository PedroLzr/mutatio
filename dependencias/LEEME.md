# Dependencias incluidas

| Carpeta           | Paquete oficial  | Versión | Licencia declarada |
| ----------------- | ---------------- | ------- | ------------------ |
| `motor-0.12.15/`  | `@ffmpeg/ffmpeg` | 0.12.15 | MIT                |
| `nucleo-0.12.10/` | `@ffmpeg/core`   | 0.12.10 | GPL-2.0-or-later   |

Copias de los archivos de ejecución de `dist/esm` publicados en npm. Se han retirado las declaraciones de tipos y la entrada vacía destinada a Node; los módulos utilizados por el navegador y el núcleo WebAssembly permanecen sin modificar. Cada carpeta conserva su licencia en `LICENCIA.txt`.

- [Código fuente y archivos de construcción de esta publicación](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15).
- [Paquete del motor](https://www.npmjs.com/package/@ffmpeg/ffmpeg/v/0.12.15).
- [Paquete del núcleo](https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10).

SHA-256 de `nucleo-0.12.10/ffmpeg-core.wasm`:

```text
9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7
```

Estas carpetas deben incluirse completas al desplegar. No se necesitan descargas ni instalaciones en la VPS. Las rutas contienen la versión para que Caddy pueda almacenar los archivos en caché; si se actualiza una dependencia, usa una carpeta con la nueva versión y actualiza sus rutas en `multimedia.js` y en `Caddyfile.ejemplo`.
