// Los nombres exigidos por las API y los argumentos de FFmpeg conservan su sintaxis oficial.
let motor;
let ocupado = false;
let cancelado = false;
let duracionActual = 0;
let comunicar = () => {};
export const MAXIMO_FOTOS = 200;
const FOTOS_POR_BLOQUE = 10;
const LIMITE_SECUENCIA = 256 * 1024 * 1024;
let inicioProgreso = 0;
let amplitudProgreso = 100;
let mensajeProgreso = "Procesando…";
const LIMITE_BYTES = 512 * 1024 * 1024;

export function validarArchivo(archivo) {
  if (!archivo || !archivo.size)
    throw new Error("Selecciona un archivo que no esté vacío.");
  if (archivo.size > LIMITE_BYTES)
    throw new Error(
      "El archivo supera el límite de 512 MB para el procesamiento en memoria.",
    );
}

async function inicializar() {
  if (motor?.loaded) return motor;
  if (!globalThis.isSecureContext || !globalThis.crossOriginIsolated) {
    throw new Error(
      "Abre la aplicación mediante HTTPS o localhost con las cabeceras de aislamiento configuradas.",
    );
  }
  comunicar(null, "Cargando el motor multimedia…");
  let instancia;
  try {
    const { FFmpeg: MotorMultimedia } =
      await import("./dependencias/motor-0.12.15/index.js");
    if (cancelado) throw new Error("Operación cancelada.");
    instancia = new MotorMultimedia();
    motor = instancia;
    instancia.on("progress", ({ time: tiempo }) => {
      if (duracionActual > 0) {
        const fraccion = Math.min(
          1,
          Math.max(0, tiempo / (duracionActual * 1000000)),
        );
        comunicar(
          Math.min(99, inicioProgreso + fraccion * amplitudProgreso),
          mensajeProgreso,
        );
      }
    });
    await instancia.load({
      coreURL: new URL(
        "./dependencias/nucleo-0.12.10/ffmpeg-core.js",
        import.meta.url,
      ).href,
      wasmURL: new URL(
        "./dependencias/nucleo-0.12.10/ffmpeg-core.wasm",
        import.meta.url,
      ).href,
    });
  } catch (error) {
    instancia?.terminate();
    if (cancelado) throw new Error("Operación cancelada.");
    throw new Error(
      "No se pudo cargar el motor multimedia. Recarga la página y comprueba que la carpeta dependencias esté completa.",
      { cause: error },
    );
  }
  return instancia;
}

export function cancelarProcesamiento() {
  cancelado = true;
  motor?.terminate();
  motor = undefined;
}

function extension(archivo) {
  const coincidencia = archivo.name.match(/\.([a-z0-9]{1,8})$/i);
  return coincidencia ? coincidencia[1].toLowerCase() : "bin";
}

async function ejecutar(instancia, argumentos) {
  if (cancelado) throw new Error("Operación cancelada.");
  const codigo = await instancia.exec(["-hide_banner", "-y", ...argumentos]);
  if (codigo !== 0)
    throw new Error(
      "No se pudo procesar el archivo. Puede estar dañado o utilizar un formato o códec no compatible con esta operación.",
    );
}

async function inspeccionar(instancia, ruta, temporales) {
  const informe = "informe.json";
  temporales.add(informe);
  const codigo = await instancia.ffprobe([
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type",
    "-of",
    "json",
    ruta,
    "-o",
    informe,
  ]);
  // El núcleo 0.12.10 puede devolver -1 aunque haya escrito un informe válido.
  if (codigo > 0)
    throw new Error(
      "No se reconoce el archivo multimedia. Comprueba su formato.",
    );
  let datos;
  try {
    datos = JSON.parse(
      new TextDecoder().decode(await instancia.readFile(informe)),
    );
  } catch {
    throw new Error("No se pudo leer la información del archivo multimedia.");
  }
  const duracion = Number(datos.format?.duration);
  if (!Number.isFinite(duracion) || duracion <= 0)
    throw new Error("No se pudo determinar la duración del archivo.");
  return {
    duracion,
    pistas: (datos.streams || []).map((pista) => pista.codec_type),
  };
}

// Cada trabajo posee sus archivos y los elimina incluso si falla o se cancela.
export async function procesarMultimedia(opciones, notificar) {
  if (ocupado) throw new Error("Ya hay una operación en curso.");
  ocupado = true;
  cancelado = false;
  comunicar = notificar;
  const temporales = new Set();
  let instancia;
  try {
    instancia = await inicializar();
    const guardar = async (archivo, nombre) => {
      validarArchivo(archivo);
      temporales.add(nombre);
      await instancia.writeFile(
        nombre,
        new Uint8Array(await archivo.arrayBuffer()),
      );
      return nombre;
    };
    let argumentos;
    let salida;
    let tipo;
    let nombre;
    comunicar(null, "Preparando los archivos…");
    if (opciones.bloque === "creador") {
      return await crearSecuencia(opciones, instancia);
    } else {
      const entrada = await guardar(
        opciones.archivo,
        `entrada.${extension(opciones.archivo)}`,
      );
      const datos = await inspeccionar(instancia, entrada, temporales);
      const pista = opciones.bloque === "sonido" ? "audio" : "video";
      if (!datos.pistas.includes(pista))
        throw new Error(
          `El archivo no contiene una pista de ${pista === "audio" ? "sonido" : "vídeo"}.`,
        );
      duracionActual = datos.duracion;
      const cortar = opciones.operacion === "cortar";
      if (cortar) {
        if (
          !Number.isFinite(opciones.inicio) ||
          !Number.isFinite(opciones.fin) ||
          opciones.inicio < 0 ||
          opciones.fin <= opciones.inicio ||
          opciones.fin > datos.duracion + 0.05
        )
          throw new Error(
            `El intervalo debe estar entre 0 y ${datos.duracion.toFixed(2)} segundos, con el fin después del inicio.`,
          );
        duracionActual =
          Math.min(opciones.fin, datos.duracion) - opciones.inicio;
      }
      argumentos = cortar
        ? [
            "-ss",
            String(opciones.inicio),
            "-i",
            entrada,
            "-t",
            String(duracionActual),
          ]
        : ["-i", entrada];
      if (opciones.bloque === "sonido") {
        if (!["mp3", "wav"].includes(opciones.formato))
          throw new Error("Elige MP3 o WAV.");
        argumentos.push("-map", "0:a:0", "-vn");
        argumentos.push(
          ...(opciones.formato === "mp3"
            ? ["-c:a", "libmp3lame", "-b:a", "192k"]
            : ["-c:a", "pcm_s16le"]),
        );
        salida = `resultado.${opciones.formato}`;
        tipo = opciones.formato === "mp3" ? "audio/mpeg" : "audio/wav";
        nombre = `sonido-${cortar ? "recortado" : "convertido"}.${opciones.formato}`;
      } else {
        // Matroska admite los códecs originales sin forzar una recodificación.
        salida = "resultado.mkv";
        tipo = "video/x-matroska";
        if (opciones.operacion === "sustituir") {
          const banda = await guardar(
            opciones.banda,
            `banda.${extension(opciones.banda)}`,
          );
          argumentos.push(
            "-i",
            banda,
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-af",
            "apad",
            "-t",
            String(datos.duracion),
          );
          nombre = "video-con-banda-sonora.mkv";
        } else if (cortar && opciones.tipoCorte === "preciso") {
          salida = "resultado.mp4";
          tipo = "video/mp4";
          nombre = "video-recortado-preciso.mp4";
          argumentos.push(
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-threads",
            "1",
            "-preset",
            "ultrafast",
            "-crf",
            "18",
            "-vf",
            "pad=ceil(iw/2)*2:ceil(ih/2)*2",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
          );
        } else {
          argumentos.push("-map", "0:v:0");
          if (cortar) argumentos.push("-map", "0:a?");
          argumentos.push("-c", "copy", "-avoid_negative_ts", "make_zero");
          if (!cortar) argumentos.push("-an");
          nombre = cortar ? "video-recortado.mkv" : "video-sin-sonido.mkv";
        }
      }
    }
    temporales.add(salida);
    comunicar(0, "Procesando…");
    await ejecutar(instancia, [...argumentos, salida]);
    comunicar(null, "Preparando la descarga…");
    const contenido = await instancia.readFile(salida);
    if (!contenido.length)
      throw new Error(
        "El resultado está vacío. Revisa los archivos de origen.",
      );
    return { contenido: new Blob([contenido], { type: tipo }), nombre };
  } catch (error) {
    if (cancelado) throw new Error("Operación cancelada.");
    throw error;
  } finally {
    if (instancia?.loaded) {
      for (const archivo of temporales) {
        try {
          await instancia.deleteFile(archivo);
        } catch {
          /* Una cancelación puede haber destruido ya el sistema de archivos. */
        }
      }
    }
    // Libera también la memoria lineal reservada por WebAssembly entre trabajos.
    (instancia || motor)?.terminate();
    motor = undefined;
    duracionActual = 0;
    inicioProgreso = 0;
    amplitudProgreso = 100;
    mensajeProgreso = "Procesando…";
    ocupado = false;
    comunicar = () => {};
  }
}

// Hasta diez fotografías por bloque y una de enlace con transición. Cada trabajador se destruye
// al terminar su bloque; fuera de WebAssembly se conservan vídeos comprimidos.
async function crearSecuencia(
  {
    fotos,
    segundos,
    musica,
    transicion = "ninguna",
    duracionTransicion = 0.5,
    calidad = "alta",
    formato = "mp4",
    prepararFoto = async (foto) => foto,
    ancho = 1280,
    alto = 720,
  },
  primeraInstancia,
) {
  if (
    !Array.isArray(fotos) ||
    !fotos.length ||
    fotos.length > MAXIMO_FOTOS ||
    !Number.isFinite(segundos) ||
    segundos < 0.1 ||
    segundos > 60
  ) {
    throw new Error(
      `Añade entre 1 y ${MAXIMO_FOTOS} fotos y elige entre 0,1 y 60 segundos por foto.`,
    );
  }
  if (musica) validarArchivo(musica);
  const efectos = {
    ninguna: null,
    fundido: "fade",
    negro: "fadeblack",
    barrido: "wipeleft",
    deslizamiento: "slideleft",
  };
  if (!Object.hasOwn(efectos, transicion))
    throw new Error("Selecciona una transición válida.");
  const efecto = efectos[transicion];
  const fotogramasPorFoto = Math.max(1, Math.round(segundos * 30));
  const segundosReales = fotogramasPorFoto / 30;
  if (!["equilibrada", "alta", "sin-perdidas"].includes(calidad))
    throw new Error("Selecciona una calidad válida.");
  if (!["mp4", "mkv"].includes(formato))
    throw new Error("Selecciona MP4 o MKV.");
  if (
    ![ancho, alto].every(
      (valor) => Number.isInteger(valor) && valor > 0 && valor <= 3840,
    ) ||
    ancho * alto > 3840 * 2160
  )
    throw new Error(
      "El tamaño de salida no puede superar 8,3 millones de píxeles ni 3840 píxeles por lado.",
    );
  if (
    efecto &&
    (!Number.isFinite(duracionTransicion) ||
      duracionTransicion < 0.1 ||
      duracionTransicion > segundosReales)
  )
    throw new Error(
      "La transición debe durar entre 0,1 segundos y la duración de una foto.",
    );
  const segundosTransicion =
    Math.min(fotogramasPorFoto, Math.round(duracionTransicion * 30)) / 30;
  const sinPerdidas = calidad === "sin-perdidas";
  const formatoPixeles = sinPerdidas ? "rgb24" : "yuv420p";
  // A mayor resolución, menos imágenes residentes en el sistema de archivos del trabajador.
  const fotosPorBloque = Math.min(
    FOTOS_POR_BLOQUE,
    Math.max(1, Math.floor((10 * 1280 * 720) / (ancho * alto))),
  );
  const duracionTotal = fotos.length * segundosReales;
  const bloques = [];
  let bytesAcumulados = 0;
  let instancia = primeraInstancia;
  let temporales = new Set();
  const limpiar = async () => {
    if (instancia?.loaded) {
      for (const ruta of temporales) {
        try {
          await instancia.deleteFile(ruta);
        } catch {
          /* El trabajador puede haberse cancelado. */
        }
      }
    }
    temporales.clear();
    (instancia || motor)?.terminate();
    motor = undefined;
    instancia = undefined;
  };
  const guardar = async (contenido, ruta) => {
    if (cancelado) throw new Error("Operación cancelada.");
    validarArchivo(contenido);
    temporales.add(ruta);
    await instancia.writeFile(
      ruta,
      new Uint8Array(await contenido.arrayBuffer()),
    );
  };
  try {
    // Comprueba la música antes de invertir tiempo en codificar las fotografías.
    if (musica) {
      const ruta = `musica.${extension(musica)}`;
      await guardar(musica, ruta);
      comunicar(null, "Comprobando la pista de sonido…");
      try {
        // Decodifica una muestra real. No depende de los metadatos de duración ni de ffprobe.
        await ejecutar(instancia, [
          "-i",
          ruta,
          "-map",
          "0:a:0",
          "-t",
          "0.1",
          "-vn",
          "-f",
          "null",
          "-",
        ]);
      } catch (error) {
        if (cancelado) throw error;
        throw new Error(
          "No se pudo leer la música. Elige un archivo de sonido válido, por ejemplo MP3, WAV, M4A u OGG.",
          { cause: error },
        );
      }
      for (const temporal of temporales) await instancia.deleteFile(temporal);
      temporales.clear();
    }
    for (let inicio = 0; inicio < fotos.length; inicio += fotosPorBloque) {
      if (cancelado) throw new Error("Operación cancelada.");
      if (!instancia) instancia = await inicializar();
      const cantidad = Math.min(fotosPorBloque, fotos.length - inicio);
      const numeroBloque = bloques.length + 1;
      const totalBloques = Math.ceil(fotos.length / fotosPorBloque);
      inicioProgreso = (inicio / fotos.length) * 90;
      amplitudProgreso = (cantidad / fotos.length) * 90;
      mensajeProgreso = `Creando bloque ${numeroBloque} de ${totalBloques}…`;
      comunicar(inicioProgreso, mensajeProgreso);
      duracionActual = cantidad * segundosReales;
      for (let indice = 0; indice < cantidad; indice++) {
        await guardar(
          await prepararFoto(fotos[inicio + indice]),
          `foto-${String(indice).padStart(3, "0")}.png`,
        );
      }
      const salida = "bloque.mp4";
      temporales.add(salida);
      const codificacion = [
        "-c:v",
        sinPerdidas ? "libx264rgb" : "libx264",
        "-threads",
        "1",
        "-preset",
        "ultrafast",
        "-crf",
        sinPerdidas ? "0" : calidad === "alta" ? "18" : "23",
        "-pix_fmt",
        formatoPixeles,
        "-video_track_timescale",
        "15360",
      ];
      if (!efecto || fotos.length === 1) {
        await ejecutar(instancia, [
          "-framerate",
          `30/${fotogramasPorFoto}`,
          "-i",
          "foto-%03d.png",
          "-map",
          "0:v:0",
          "-an",
          "-vf",
          "fps=30",
          "-frames:v",
          String(cantidad * fotogramasPorFoto),
          ...codificacion,
          salida,
        ]);
      } else {
        // Cada transición solo abre dos imágenes. La foto siguiente al bloque
        // permite conservar el efecto también entre las fotos 10 y 11, 20 y 21…
        if (inicio + cantidad < fotos.length)
          await guardar(
            await prepararFoto(fotos[inicio + cantidad]),
            "siguiente.png",
          );
        const fragmentos = [];
        for (let indice = 0; indice < cantidad; indice++) {
          const actual = `foto-${String(indice).padStart(3, "0")}.png`;
          const siguiente =
            indice + 1 < cantidad
              ? `foto-${String(indice + 1).padStart(3, "0")}.png`
              : "siguiente.png";
          const haySiguiente = inicio + indice + 1 < fotos.length;
          const fragmento = `fragmento-${indice}.mp4`;
          temporales.add(fragmento);
          inicioProgreso = ((inicio + indice) / fotos.length) * 90;
          amplitudProgreso = 90 / fotos.length;
          duracionActual = segundosReales;
          mensajeProgreso = `Creando foto ${inicio + indice + 1} de ${fotos.length} con transición…`;
          comunicar(inicioProgreso, mensajeProgreso);
          const argumentos = [
            "-loop",
            "1",
            "-framerate",
            "30",
            "-t",
            String(segundosReales),
            "-i",
            actual,
          ];
          if (haySiguiente) {
            argumentos.push(
              "-loop",
              "1",
              "-framerate",
              "30",
              "-t",
              String(segundosTransicion + 1 / 30),
              "-i",
              siguiente,
              "-filter_complex_threads",
              "1",
              "-filter_complex",
              `[0:v]settb=AVTB,setpts=PTS-STARTPTS[a];[1:v]settb=AVTB,setpts=PTS-STARTPTS[b];[a][b]xfade=transition=${efecto}:duration=${segundosTransicion}:offset=${segundosReales - segundosTransicion},format=${formatoPixeles}[v]`,
              "-map",
              "[v]",
            );
          } else argumentos.push("-map", "0:v:0");
          argumentos.push(
            "-an",
            "-frames:v",
            String(fotogramasPorFoto),
            ...codificacion,
            fragmento,
          );
          await ejecutar(instancia, argumentos);
          fragmentos.push(`file '${fragmento}'`);
        }
        await guardar(new Blob([fragmentos.join("\n")]), "fragmentos.txt");
        duracionActual = cantidad * segundosReales;
        amplitudProgreso = 0;
        inicioProgreso = ((inicio + cantidad) / fotos.length) * 90;
        await ejecutar(instancia, [
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          "fragmentos.txt",
          "-map",
          "0:v:0",
          "-c",
          "copy",
          salida,
        ]);
      }
      const datos = await instancia.readFile(salida);
      if (!datos.length)
        throw new Error("No se pudo generar uno de los bloques de vídeo.");
      bytesAcumulados += datos.length;
      if (bytesAcumulados > LIMITE_SECUENCIA)
        throw new Error(
          "La secuencia supera 256 MB de vídeo temporal. Reduce la resolución, la calidad o los segundos por foto para continuar.",
        );
      bloques.push(new Blob([datos], { type: "video/mp4" }));
      await limpiar();
    }
    if (cancelado) throw new Error("Operación cancelada.");
    instancia = await inicializar();
    inicioProgreso = 90;
    amplitudProgreso = 10;
    duracionActual = duracionTotal;
    mensajeProgreso = musica
      ? "Uniendo bloques y añadiendo música…"
      : "Uniendo bloques…";
    comunicar(90, mensajeProgreso);
    const listado = [];
    for (let indice = 0; indice < bloques.length; indice++) {
      const ruta = `bloque-${indice}.mp4`;
      await guardar(bloques[indice], ruta);
      listado.push(`file '${ruta}'`);
      bloques[indice] = null;
    }
    await guardar(new Blob([listado.join("\n")]), "secuencia.txt");
    const argumentos = ["-f", "concat", "-safe", "0", "-i", "secuencia.txt"];
    if (musica) {
      const ruta = `musica.${extension(musica)}`;
      await guardar(musica, ruta);
      argumentos.push("-stream_loop", "-1", "-i", ruta);
    }
    argumentos.push("-map", "0:v:0", "-c:v", "copy");
    if (musica) {
      argumentos.push(
        "-map",
        "1:a:0",
        "-af",
        `afade=t=out:st=${Math.max(0, duracionTotal - 3)}:d=${Math.min(3, duracionTotal)}`,
        "-c:a",
        "aac",
        "-b:a",
        "192k",
      );
    }
    const salida = `resultado.${formato}`;
    argumentos.push("-t", String(duracionTotal));
    if (formato === "mp4") argumentos.push("-movflags", "+faststart");
    argumentos.push(salida);
    temporales.add(salida);
    await ejecutar(instancia, argumentos);
    comunicar(null, "Preparando la descarga…");
    const datos = await instancia.readFile(salida);
    if (!datos.length) throw new Error("El vídeo final está vacío.");
    return {
      contenido: new Blob([datos], {
        type: formato === "mp4" ? "video/mp4" : "video/x-matroska",
      }),
      nombre: `secuencia-de-fotos.${formato}`,
    };
  } finally {
    await limpiar();
    bloques.length = 0;
  }
}
