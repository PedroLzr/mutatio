// Los nombres exigidos por las API y los argumentos de FFmpeg conservan su sintaxis oficial.
let motor;
let ocupado = false;
let cancelado = false;
let duracionActual = 0;
let comunicar = () => {};
export const MAXIMO_FOTOS = 150;
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
  const { FFmpeg: MotorMultimedia } = await import(
    "./dependencias/motor-0.12.15/index.js"
  );
  if (cancelado) throw new Error("Operación cancelada.");
  const instancia = new MotorMultimedia();
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
    if (/fetch|load|import|network/i.test(error.message))
      throw new Error(
        "No se pudo cargar el motor multimedia. Comprueba que las dependencias estén instaladas y vuelve a intentarlo.",
      );
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

// Diez fotografías por bloque y una de enlace cuando hay transición. Cada trabajador se destruye
// al terminar su bloque; fuera de WebAssembly se conservan vídeos comprimidos.
async function crearSecuencia(
  { fotos, segundos, musica, transicion = "ninguna" },
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
  const segundosTransicion =
    Math.min(15, Math.max(2, Math.floor(fotogramasPorFoto / 2))) / 30;
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
      const datos = await inspeccionar(instancia, ruta, temporales);
      if (!datos.pistas.includes("audio"))
        throw new Error(
          "El archivo de música no contiene una pista de sonido.",
        );
      for (const temporal of temporales) await instancia.deleteFile(temporal);
      temporales.clear();
    }
    for (let inicio = 0; inicio < fotos.length; inicio += FOTOS_POR_BLOQUE) {
      if (cancelado) throw new Error("Operación cancelada.");
      if (!instancia) instancia = await inicializar();
      const cantidad = Math.min(FOTOS_POR_BLOQUE, fotos.length - inicio);
      const numeroBloque = bloques.length + 1;
      const totalBloques = Math.ceil(fotos.length / FOTOS_POR_BLOQUE);
      inicioProgreso = (inicio / fotos.length) * 90;
      amplitudProgreso = (cantidad / fotos.length) * 90;
      mensajeProgreso = `Creando bloque ${numeroBloque} de ${totalBloques}…`;
      comunicar(inicioProgreso, mensajeProgreso);
      duracionActual = cantidad * segundosReales;
      for (let indice = 0; indice < cantidad; indice++) {
        await guardar(
          fotos[inicio + indice],
          `foto-${String(indice).padStart(3, "0")}.jpg`,
        );
      }
      const salida = "bloque.mp4";
      temporales.add(salida);
      const codificacion = [
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-video_track_timescale",
        "15360",
      ];
      if (!efecto || fotos.length === 1) {
        await ejecutar(instancia, [
          "-framerate",
          `30/${fotogramasPorFoto}`,
          "-i",
          "foto-%03d.jpg",
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
          await guardar(fotos[inicio + cantidad], "siguiente.jpg");
        const fragmentos = [];
        for (let indice = 0; indice < cantidad; indice++) {
          const actual = `foto-${String(indice).padStart(3, "0")}.jpg`;
          const siguiente =
            indice + 1 < cantidad
              ? `foto-${String(indice + 1).padStart(3, "0")}.jpg`
              : "siguiente.jpg";
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
              `[0:v]settb=AVTB,setpts=PTS-STARTPTS[a];[1:v]settb=AVTB,setpts=PTS-STARTPTS[b];[a][b]xfade=transition=${efecto}:duration=${segundosTransicion}:offset=${segundosReales - segundosTransicion},format=yuv420p[v]`,
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
          "La secuencia supera 256 MB de vídeo temporal. Reduce los segundos por foto para continuar.",
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
    argumentos.push(
      "-t",
      String(duracionTotal),
      "-movflags",
      "+faststart",
      "resultado.mp4",
    );
    temporales.add("resultado.mp4");
    await ejecutar(instancia, argumentos);
    comunicar(null, "Preparando la descarga…");
    const datos = await instancia.readFile("resultado.mp4");
    if (!datos.length) throw new Error("El vídeo final está vacío.");
    return {
      contenido: new Blob([datos], { type: "video/mp4" }),
      nombre: "secuencia-de-fotos.mp4",
    };
  } finally {
    await limpiar();
    bloques.length = 0;
  }
}
