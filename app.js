import {
  procesarMultimedia,
  cancelarProcesamiento,
  validarArchivo,
  MAXIMO_FOTOS,
} from "./multimedia.js";

const elemento = (identificador) => document.getElementById(identificador);
const numero = (identificador) => Number(elemento(identificador).value);
let trabajando = false;
let fotos = [];
let preparacionFotos;
let imagenOriginal;
let versionImagen = 0;
let seleccion;
let comienzo;
let panelActivo = "sonido";
let panelEnProceso;
const descargas = new Map();
const estadoElemento = (nombre, bloque = panelEnProceso || panelActivo) =>
  elemento(`${nombre}-${bloque}`);
const lineasTemporales = new Map();
const lienzo = elemento("lienzo");
const contexto = lienzo.getContext("2d");
const imagenTrabajo = document.createElement("canvas");
const contextoTrabajo = imagenTrabajo.getContext("2d");

function avisar(texto, error = false, bloque = panelEnProceso || panelActivo) {
  estadoElemento("estado", bloque).hidden = false;
  estadoElemento("estado", bloque).classList.toggle("error", error);
  estadoElemento("mensaje", bloque).textContent = texto;
}
function progreso(valor, texto) {
  avisar(texto);
  estadoElemento("progreso").hidden = false;
  if (valor === null) estadoElemento("progreso").removeAttribute("value");
  else estadoElemento("progreso").value = valor;
}
function bloquear(valor, permiteCancelar = false) {
  trabajando = valor;
  if (valor) {
    panelEnProceso = panelActivo;
    for (const linea of lineasTemporales.values()) linea.pausar();
  }
  document.querySelectorAll("fieldset, [data-panel]").forEach((control) => {
    control.disabled = valor;
  });
  estadoElemento("cancelar").hidden = !valor || !permiteCancelar;
  document.querySelector("main").setAttribute("aria-busy", String(valor));
  if (!valor) {
    actualizarOperacion("sonido");
    actualizarOperacion("video");
    elemento("proporcion").disabled =
      elemento("operacion-imagen").value === "pixelar";
    panelEnProceso = undefined;
  }
}
function descargar({ contenido, nombre }, bloque) {
  if (descargas.has(bloque)) URL.revokeObjectURL(descargas.get(bloque));
  const direccion = URL.createObjectURL(contenido);
  descargas.set(bloque, direccion);
  const enlace = estadoElemento("descarga", bloque);
  enlace.href = direccion;
  enlace.download = nombre;
  enlace.textContent = `Descargar ${nombre}`;
  estadoElemento("detalle", bloque).textContent =
    `Archivo listo · ${(contenido.size / 1024 / 1024).toFixed(2)} MB`;
  estadoElemento("resultado", bloque).hidden = false;
  avisar("", false, bloque);
  enlace.click();
}
async function realizar(operacion, permiteCancelar = false) {
  if (trabajando) return;
  const bloque = panelActivo;
  bloquear(true, permiteCancelar);
  estadoElemento("resultado", bloque).hidden = true;
  progreso(null, "Preparando…");
  try {
    descargar(await operacion(), bloque);
  } catch (error) {
    avisar(
      error.message ||
        "No se pudo completar la operación. Vuelve a intentarlo.",
      true,
      bloque,
    );
  } finally {
    estadoElemento("progreso", bloque).hidden = true;
    estadoElemento("resultado", bloque).hidden = !descargas.has(bloque);
    bloquear(false);
  }
}
document.querySelectorAll("[data-cancelar]").forEach((boton) =>
  boton.addEventListener("click", () => {
    preparacionFotos?.abort();
    cancelarProcesamiento();
    boton.hidden = true;
  }),
);
document.querySelectorAll("[data-panel]").forEach((boton) =>
  boton.addEventListener("click", () => {
    for (const linea of lineasTemporales.values()) linea.pausar();
    panelActivo = boton.dataset.panel;
    document.querySelectorAll("[data-panel]").forEach((otro) => {
      const activo = otro === boton;
      otro.classList.toggle("activa", activo);
      otro.setAttribute("aria-expanded", String(activo));
      elemento(otro.dataset.panel).hidden = !activo;
    });
  }),
);
function actualizarOperacion(bloque) {
  const operacion = elemento(`operacion-${bloque}`).value;
  elemento(`tiempos-${bloque}`).hidden = operacion !== "cortar";
  for (const extremo of ["inicio", "fin"]) {
    elemento(`${extremo}-${bloque}`).required = operacion === "cortar";
    elemento(`${extremo}-${bloque}`).disabled = operacion !== "cortar";
  }
  if (bloque === "video") {
    elemento("tipo-corte-video").disabled = operacion !== "cortar";
    elemento("banda-sonora").hidden = operacion !== "sustituir";
    elemento("archivo-banda").required = operacion === "sustituir";
    elemento("archivo-banda").disabled = operacion !== "sustituir";
  }
}
for (const bloque of ["sonido", "video"]) {
  elemento(`operacion-${bloque}`).addEventListener("change", () =>
    actualizarOperacion(bloque),
  );
  const linea = crearLineaTemporal(bloque, {
    avisar: (mensaje) => avisar(mensaje, false, bloque),
    estaOcupado: () => trabajando,
  });
  lineasTemporales.set(bloque, linea);
  elemento(`archivo-${bloque}`).addEventListener("change", () => {
    const archivo = elemento(`archivo-${bloque}`).files[0];
    linea.cargar();
    if (!archivo) return;
    try {
      validarArchivo(archivo);
      avisar("", false, bloque);
      linea.cargar(archivo);
    } catch (error) {
      avisar(error.message, true, bloque);
    }
  });
  elemento(`formulario-${bloque}`).addEventListener("submit", (evento) => {
    evento.preventDefault();
    realizar(
      () =>
        procesarMultimedia(
          {
            bloque,
            archivo: elemento(`archivo-${bloque}`).files[0],
            operacion: elemento(`operacion-${bloque}`).value,
            inicio: numero(`inicio-${bloque}`),
            fin: numero(`fin-${bloque}`),
            formato: elemento("formato-sonido").value,
            banda: elemento("archivo-banda").files[0],
            tipoCorte: elemento("tipo-corte-video").value,
          },
          progreso,
        ),
      true,
    );
  });
}

async function abrirImagen(archivo) {
  validarArchivo(archivo);
  if (!/^image\/(jpeg|png|webp|avif|bmp)$/.test(archivo.type))
    throw new Error("Elige una imagen JPEG, PNG, WebP, AVIF o BMP.");
  let imagen;
  try {
    imagen = await createImageBitmap(archivo);
  } catch {
    throw new Error(
      "No se pudo abrir la imagen. Puede estar dañada o no ser compatible con este navegador.",
    );
  }
  if (imagen.width * imagen.height > 40000000) {
    imagen.close();
    throw new Error(
      "La imagen supera los 40 millones de píxeles. Reduce sus dimensiones antes de continuar.",
    );
  }
  return imagen;
}
function dibujar() {
  lienzo.width = imagenTrabajo.width;
  lienzo.height = imagenTrabajo.height;
  contexto.drawImage(imagenTrabajo, 0, 0);
  if (seleccion) {
    const { x, y, ancho, alto } = seleccion;
    contexto.fillStyle = "#c4e6ac22";
    contexto.fillRect(x, y, ancho, alto);
    contexto.strokeStyle = "#c4e6ac";
    contexto.lineWidth = Math.max(2, lienzo.width / 400);
    contexto.strokeRect(x, y, ancho, alto);
  }
}
function actualizarCoordenadas() {
  if (!seleccion) return;
  for (const clave of ["x", "y", "ancho", "alto"])
    elemento(`zona-${clave}`).value = Math.round(seleccion[clave]);
}
function restaurar() {
  if (!imagenOriginal) return;
  imagenTrabajo.width = imagenOriginal.width;
  imagenTrabajo.height = imagenOriginal.height;
  contextoTrabajo.drawImage(imagenOriginal, 0, 0);
  seleccion = undefined;
  dibujar();
  elemento("zona-x").value = 0;
  elemento("zona-y").value = 0;
  elemento("zona-ancho").value = imagenTrabajo.width;
  elemento("zona-alto").value = imagenTrabajo.height;
}
elemento("archivo-imagen").addEventListener("change", async () => {
  const version = ++versionImagen;
  imagenOriginal?.close();
  imagenOriginal = undefined;
  seleccion = undefined;
  elemento("editor").hidden = true;
  const archivo = elemento("archivo-imagen").files[0];
  if (!archivo) return;
  try {
    const nueva = await abrirImagen(archivo);
    if (version !== versionImagen) {
      nueva.close();
      return;
    }
    imagenOriginal = nueva;
    restaurar();
    elemento("editor").hidden = false;
  } catch (error) {
    avisar(error.message, true, "imagen");
  }
});
function punto(evento) {
  const limites = lienzo.getBoundingClientRect();
  return {
    x: Math.max(
      0,
      Math.min(
        lienzo.width,
        ((evento.clientX - limites.left) / limites.width) * lienzo.width,
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        lienzo.height,
        ((evento.clientY - limites.top) / limites.height) * lienzo.height,
      ),
    ),
  };
}
lienzo.addEventListener("pointerdown", (evento) => {
  if (trabajando || !imagenOriginal) return;
  comienzo = punto(evento);
  lienzo.setPointerCapture(evento.pointerId);
});
lienzo.addEventListener("pointermove", (evento) => {
  if (!comienzo || trabajando) return;
  const fin = punto(evento);
  let ancho = Math.abs(fin.x - comienzo.x),
    alto = Math.abs(fin.y - comienzo.y);
  const proporcion =
    elemento("operacion-imagen").value === "recortar"
      ? numero("proporcion")
      : 0;
  if (proporcion) {
    ancho = Math.min(ancho, alto * proporcion);
    alto = ancho / proporcion;
  }
  seleccion = {
    x: Math.round(fin.x < comienzo.x ? comienzo.x - ancho : comienzo.x),
    y: Math.round(fin.y < comienzo.y ? comienzo.y - alto : comienzo.y),
    ancho: Math.round(ancho),
    alto: Math.round(alto),
  };
  actualizarCoordenadas();
  dibujar();
});
for (const suceso of ["pointerup", "pointercancel", "lostpointercapture"])
  lienzo.addEventListener(suceso, () => {
    comienzo = undefined;
  });
elemento("operacion-imagen").addEventListener("change", () => {
  elemento("proporcion").disabled =
    elemento("operacion-imagen").value === "pixelar";
  seleccion = undefined;
  dibujar();
});
function leerSeleccion() {
  const zona = {
    x: numero("zona-x"),
    y: numero("zona-y"),
    ancho: numero("zona-ancho"),
    alto: numero("zona-alto"),
  };
  if (
    Object.values(zona).some((valor) => !Number.isInteger(valor)) ||
    zona.x < 0 ||
    zona.y < 0 ||
    zona.ancho < 1 ||
    zona.alto < 1 ||
    zona.x + zona.ancho > imagenTrabajo.width ||
    zona.y + zona.alto > imagenTrabajo.height
  )
    throw new Error(
      "La selección debe tener dimensiones positivas y quedar dentro de la imagen.",
    );
  const proporcion = numero("proporcion");
  if (elemento("operacion-imagen").value === "recortar" && proporcion) {
    zona.ancho = Math.min(zona.ancho, Math.round(zona.alto * proporcion));
    zona.alto = Math.round(zona.ancho / proporcion);
    if (zona.alto < 1) throw new Error("La selección es demasiado pequeña.");
  }
  return zona;
}
for (const clave of ["x", "y", "ancho", "alto"])
  elemento(`zona-${clave}`).addEventListener("input", () => {
    if (!imagenOriginal) return;
    try {
      seleccion = leerSeleccion();
      dibujar();
    } catch {
      /* Se valida al aplicar para permitir escribir números parciales. */
    }
  });
elemento("aplicar-zona").addEventListener("click", () => {
  try {
    if (!imagenOriginal) throw new Error("Selecciona primero una imagen.");
    const { x, y, ancho, alto } = leerSeleccion();
    const auxiliar = document.createElement("canvas");
    const contextoAuxiliar = auxiliar.getContext("2d");
    if (elemento("operacion-imagen").value === "recortar") {
      auxiliar.width = ancho;
      auxiliar.height = alto;
      contextoAuxiliar.drawImage(
        imagenTrabajo,
        x,
        y,
        ancho,
        alto,
        0,
        0,
        ancho,
        alto,
      );
      imagenTrabajo.width = ancho;
      imagenTrabajo.height = alto;
      contextoTrabajo.drawImage(auxiliar, 0, 0);
    } else {
      auxiliar.width = Math.max(1, Math.ceil(ancho / 18));
      auxiliar.height = Math.max(1, Math.ceil(alto / 18));
      contextoAuxiliar.drawImage(
        imagenTrabajo,
        x,
        y,
        ancho,
        alto,
        0,
        0,
        auxiliar.width,
        auxiliar.height,
      );
      contextoTrabajo.imageSmoothingEnabled = false;
      contextoTrabajo.drawImage(
        auxiliar,
        0,
        0,
        auxiliar.width,
        auxiliar.height,
        x,
        y,
        ancho,
        alto,
      );
      contextoTrabajo.imageSmoothingEnabled = true;
    }
    seleccion = undefined;
    dibujar();
    elemento("zona-x").value = 0;
    elemento("zona-y").value = 0;
    elemento("zona-ancho").value = imagenTrabajo.width;
    elemento("zona-alto").value = imagenTrabajo.height;
    avisar("Selección aplicada.");
  } catch (error) {
    avisar(error.message, true);
  }
});
elemento("restaurar-imagen").addEventListener("click", restaurar);
elemento("calidad").addEventListener("input", () => {
  elemento("valor-calidad").value = `${numero("calidad")}%`;
});
function convertirLienzo(superficie, tipo, calidad) {
  return new Promise((resolver, rechazar) =>
    superficie.toBlob(
      (contenido) => {
        if (!contenido || contenido.type !== tipo)
          rechazar(
            new Error(
              "El navegador no admite la exportación al formato elegido.",
            ),
          );
        else resolver(contenido);
      },
      tipo,
      calidad,
    ),
  );
}
elemento("formulario-imagen").addEventListener("submit", (evento) => {
  evento.preventDefault();
  realizar(async () => {
    if (!imagenOriginal)
      throw new Error("Espera a que se cargue una imagen válida.");
    const formato = elemento("formato-imagen").value;
    const salida = document.createElement("canvas");
    salida.width = imagenTrabajo.width;
    salida.height = imagenTrabajo.height;
    const contextoSalida = salida.getContext("2d");
    if (formato === "jpeg") {
      contextoSalida.fillStyle = "#ffffff";
      contextoSalida.fillRect(0, 0, salida.width, salida.height);
    }
    contextoSalida.drawImage(imagenTrabajo, 0, 0);
    return {
      contenido: await convertirLienzo(
        salida,
        `image/${formato}`,
        numero("calidad") / 100,
      ),
      nombre: `imagen-editada.${formato === "jpeg" ? "jpg" : "webp"}`,
    };
  });
});

function mostrarFotos() {
  actualizarResumenFotos();
  elemento("vaciar-fotos").hidden = !fotos.length;
  elemento("archivos-fotos").parentElement.querySelector(
    ".nombre-archivo",
  ).textContent = fotos.length
    ? "Selección preparada"
    : "Ningún archivo seleccionado";
  const lista = elemento("secuencia");
  lista.replaceChildren();
  fotos.forEach((foto, indice) => {
    const fila = document.createElement("li");
    const vista = document.createElement("img");
    vista.src = foto.direccion;
    vista.loading = "lazy";
    vista.decoding = "async";
    vista.width = 240;
    vista.height = 135;
    vista.alt = `Foto ${indice + 1}`;
    const titulo = document.createElement("p");
    titulo.textContent = `${indice + 1}. ${foto.nombre}`;
    const acciones = document.createElement("div");
    acciones.className = "acciones";
    for (const [texto, etiqueta, desplazamiento] of [
      ["↑", "Adelantar", -1],
      ["↓", "Retrasar", 1],
      ["×", "Eliminar", 0],
    ]) {
      const boton = document.createElement("button");
      boton.type = "button";
      boton.textContent = texto;
      boton.setAttribute("aria-label", `${etiqueta} foto ${indice + 1}`);
      boton.disabled =
        (desplazamiento === -1 && indice === 0) ||
        (desplazamiento === 1 && indice === fotos.length - 1);
      boton.addEventListener("click", () => {
        if (trabajando) return;
        if (!desplazamiento) {
          URL.revokeObjectURL(fotos[indice].direccion);
          fotos.splice(indice, 1);
        } else
          [fotos[indice], fotos[indice + desplazamiento]] = [
            fotos[indice + desplazamiento],
            fotos[indice],
          ];
        mostrarFotos();
      });
      acciones.append(boton);
    }
    fila.append(vista, titulo, acciones);
    lista.append(fila);
  });
}
function actualizarResumenFotos() {
  const segundos = Math.round(numero("duracion-foto") * 30) / 30;
  const total = Number.isFinite(segundos)
    ? Math.round(fotos.length * segundos)
    : 0;
  const duracion = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  elemento("resumen-fotos").textContent =
    `${fotos.length} / ${MAXIMO_FOTOS} fotos · ${duracion} de vídeo`;
}

async function prepararFoto(archivo, senal) {
  senal.throwIfAborted();
  const imagen = await abrirImagen(archivo);
  const miniatura = document.createElement("canvas");
  try {
    senal.throwIfAborted();
    miniatura.width = 240;
    miniatura.height = 135;
    const pincel = miniatura.getContext("2d");
    pincel.fillStyle = "#000000";
    pincel.fillRect(0, 0, 240, 135);
    const escala = Math.min(240 / imagen.width, 135 / imagen.height);
    const ancho = imagen.width * escala,
      alto = imagen.height * escala;
    pincel.drawImage(imagen, (240 - ancho) / 2, (135 - alto) / 2, ancho, alto);
    const vista = await convertirLienzo(miniatura, "image/jpeg", 0.75);
    senal.throwIfAborted();
    return {
      nombre: archivo.name,
      contenido: archivo,
      ancho: imagen.width,
      alto: imagen.height,
      direccion: URL.createObjectURL(vista),
    };
  } finally {
    imagen.close();
    miniatura.width = miniatura.height = 0;
  }
}

async function agregarFotos(archivos) {
  if (trabajando || !archivos.length) return;
  bloquear(true, true);
  preparacionFotos = new AbortController();
  const nuevas = [];
  // Conserva los archivos originales sin decodificarlos todos a la vez.
  elemento("archivos-fotos").value = "";
  try {
    if (fotos.length + archivos.length > MAXIMO_FOTOS)
      throw new Error(`La secuencia admite hasta ${MAXIMO_FOTOS} fotos.`);
    for (let indice = 0; indice < archivos.length; indice++) {
      preparacionFotos.signal.throwIfAborted();
      progreso(
        (indice / archivos.length) * 100,
        `Preparando foto ${indice + 1} de ${archivos.length}…`,
      );
      nuevas.push(
        await prepararFoto(archivos[indice], preparacionFotos.signal),
      );
      archivos[indice] = null;
      // Cede el control para que Cancelar y el progreso respondan durante la carga.
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
    preparacionFotos.signal.throwIfAborted();
    fotos.push(...nuevas);
    nuevas.length = 0;
    avisar(
      fotos.length === 1
        ? "Una foto preparada."
        : `${fotos.length} fotos preparadas.`,
    );
  } catch (error) {
    for (const foto of nuevas) URL.revokeObjectURL(foto.direccion);
    avisar(
      preparacionFotos.signal.aborted
        ? "Preparación cancelada. La selección anterior se conserva."
        : error.message,
      !preparacionFotos.signal.aborted,
    );
  } finally {
    archivos.length = 0;
    preparacionFotos = undefined;
    mostrarFotos();
    estadoElemento("progreso", "creador").hidden = true;
    bloquear(false);
  }
}
elemento("archivos-fotos").addEventListener("change", (evento) =>
  agregarFotos([...evento.target.files]),
);
const zonaFotos = elemento("zona-fotos");
for (const suceso of ["dragenter", "dragover"])
  zonaFotos.addEventListener(suceso, (evento) => {
    evento.preventDefault();
    if (!trabajando) zonaFotos.classList.add("sobre");
  });
for (const suceso of ["dragleave", "drop"])
  zonaFotos.addEventListener(suceso, (evento) => {
    evento.preventDefault();
    zonaFotos.classList.remove("sobre");
  });
zonaFotos.addEventListener("drop", (evento) =>
  agregarFotos([...evento.dataTransfer.files]),
);
elemento("duracion-foto").addEventListener("input", actualizarResumenFotos);
actualizarResumenFotos();
function tamanoSalida() {
  const resolucion = elemento("resolucion-creador").value;
  if (resolucion === "original") {
    if (!fotos.length) throw new Error("Añade al menos una fotografía.");
    // Añade como máximo un píxel de borde para los formatos que exigen dimensiones pares.
    const ancho = Math.ceil(fotos[0].ancho / 2) * 2;
    const alto = Math.ceil(fotos[0].alto / 2) * 2;
    if (ancho > 3840 || alto > 3840 || ancho * alto > 3840 * 2160)
      throw new Error(
        "La primera foto supera el tamaño admitido. Elige una resolución de hasta 3840 × 2160.",
      );
    return { ancho, alto };
  }
  const alto = Number(resolucion);
  return { ancho: Math.round((alto * 16) / 9), alto };
}
async function prepararFotograma(archivo, ancho, alto) {
  const imagen = await abrirImagen(archivo);
  const superficie = document.createElement("canvas");
  try {
    superficie.width = ancho;
    superficie.height = alto;
    const pincel = superficie.getContext("2d");
    pincel.fillStyle = "#000000";
    pincel.fillRect(0, 0, ancho, alto);
    pincel.imageSmoothingQuality = "high";
    const escala = Math.min(ancho / imagen.width, alto / imagen.height);
    const ajustadoAncho = imagen.width * escala,
      ajustadoAlto = imagen.height * escala;
    pincel.drawImage(
      imagen,
      (ancho - ajustadoAncho) / 2,
      (alto - ajustadoAlto) / 2,
      ajustadoAncho,
      ajustadoAlto,
    );
    // PNG evita una compresión con pérdidas antes de codificar el vídeo.
    return await convertirLienzo(superficie, "image/png");
  } finally {
    imagen.close();
    superficie.width = superficie.height = 0;
  }
}
elemento("formulario-creador").addEventListener("submit", (evento) => {
  evento.preventDefault();
  realizar(async () => {
    const { ancho, alto } = tamanoSalida();
    return procesarMultimedia(
      {
        bloque: "creador",
        fotos: fotos.map((foto) => foto.contenido),
        segundos: numero("duracion-foto"),
        musica: elemento("musica").files[0],
        transicion: elemento("transicion").value,
        duracionTransicion: numero("duracion-transicion"),
        calidad: elemento("calidad-creador").value,
        formato: elemento("formato-creador").value,
        ancho,
        alto,
        prepararFoto: (archivo) => prepararFotograma(archivo, ancho, alto),
      },
      progreso,
    );
  }, true);
});
window.addEventListener("pagehide", () => {
  for (const direccion of descargas.values()) URL.revokeObjectURL(direccion);
  for (const linea of lineasTemporales.values()) linea.destruir();
  for (const foto of fotos) URL.revokeObjectURL(foto.direccion);
  imagenOriginal?.close();
  cancelarProcesamiento();
});

// Los selectores propios evitan depender del idioma de los controles nativos.
document.querySelectorAll("input[type=file]").forEach((entrada) => {
  entrada.addEventListener("change", () => {
    if (entrada.id === "archivos-fotos") return;
    const nombres = [...entrada.files].map((archivo) => archivo.name);
    entrada.parentElement.querySelector(".nombre-archivo").textContent =
      nombres.length ? nombres.join(", ") : "Ningún archivo seleccionado";
  });
});

elemento("vaciar-fotos").addEventListener("click", () => {
  if (trabajando) return;
  for (const foto of fotos) URL.revokeObjectURL(foto.direccion);
  fotos.length = 0;
  elemento("archivos-fotos").value = "";
  elemento("archivos-fotos").parentElement.querySelector(
    ".nombre-archivo",
  ).textContent = "Ningún archivo seleccionado";
  mostrarFotos();
});
elemento("musica").addEventListener("change", () => {
  elemento("quitar-musica").hidden = !elemento("musica").files.length;
});
elemento("quitar-musica").addEventListener("click", () => {
  elemento("musica").value = "";
  elemento("musica").parentElement.querySelector(
    ".nombre-archivo",
  ).textContent = "Ningún archivo seleccionado";
  elemento("quitar-musica").hidden = true;
});

function actualizarTransicion() {
  const activa = elemento("transicion").value !== "ninguna";
  elemento("nota-transicion").hidden = !activa;
  elemento("campo-duracion-transicion").hidden = !activa;
  elemento("duracion-transicion").required = activa;
  elemento("duracion-transicion").disabled = !activa;
  elemento("duracion-transicion").max = elemento("duracion-foto").value;
  if (numero("duracion-transicion") > numero("duracion-foto"))
    elemento("duracion-transicion").value = elemento("duracion-foto").value;
}
elemento("transicion").addEventListener("change", actualizarTransicion);
elemento("duracion-foto").addEventListener("input", actualizarTransicion);
elemento("calidad-creador").addEventListener("change", () => {
  const calidad = elemento("calidad-creador").value;
  elemento("nota-calidad").textContent =
    calidad === "sin-perdidas"
      ? "Conserva los píxeles del fotograma preparado, sin pérdidas de codificación. Genera archivos mayores y puede no reproducirse en todos los navegadores. Las fotos se adaptan al tamaño elegido."
      : `Las fotos se adaptan al tamaño elegido sin recortarlas. ${calidad === "alta" ? "Alta calidad aplica compresión suave." : "Calidad equilibrada reduce el peso del vídeo."}`;
});
actualizarTransicion();

elemento("tipo-corte-video").addEventListener("change", () => {
  elemento("nota-corte-video").textContent =
    elemento("tipo-corte-video").value === "preciso"
      ? "El corte preciso recodifica el vídeo para respetar la selección. Tarda más y puede modificar ligeramente la calidad."
      : "El corte rápido conserva la calidad original, pero el inicio puede adelantarse al fotograma clave anterior.";
});

// Vista previa local: comparte los tiempos con los campos numéricos del formulario.
function crearLineaTemporal(bloque, { avisar, estaOcupado }) {
  const buscar = (nombre) => document.getElementById(`${nombre}-${bloque}`);
  const vista = buscar("vista");
  const panel = buscar("reproductor");
  const lienzo = buscar("linea");
  const contexto = lienzo.getContext("2d");
  const inicio = buscar("inicio");
  const fin = buscar("fin");
  const controles = buscar("seleccion");
  let duracion = 0;
  let direccion;
  let version = 0;
  let picos;
  let arrastre;
  let soloSeleccion = false;
  let animacion;
  const tiempo = (valor) => {
    const centesimas = Math.round(Math.max(0, valor || 0) * 100);
    return `${Math.floor(centesimas / 6000)}:${String(Math.floor(centesimas / 100) % 60).padStart(2, "0")}.${String(centesimas % 100).padStart(2, "0")}`;
  };
  const cortar = () => buscar("operacion").value === "cortar";
  function dibujar() {
    const ancho = Math.max(1, lienzo.clientWidth);
    const alto = 100;
    const escala = window.devicePixelRatio || 1;
    if (lienzo.width !== Math.round(ancho * escala)) {
      lienzo.width = Math.round(ancho * escala);
      lienzo.height = Math.round(alto * escala);
    }
    contexto.setTransform(escala, 0, 0, escala, 0, 0);
    contexto.clearRect(0, 0, ancho, alto);
    contexto.fillStyle = "#151a21";
    contexto.fillRect(0, 0, ancho, alto);
    if (!duracion) return;
    const izquierda = (Number(inicio.value) / duracion) * ancho;
    const derecha = (Number(fin.value) / duracion) * ancho;
    if (cortar()) {
      contexto.fillStyle = "#c4e6ac22";
      contexto.fillRect(izquierda, 0, derecha - izquierda, alto);
    }
    contexto.strokeStyle = "#829181";
    contexto.lineWidth = 1;
    contexto.beginPath();
    if (picos) {
      for (let i = 0; i < picos.length; i++) {
        const x = (i / picos.length) * ancho;
        const altura = Math.max(1, picos[i] * 35);
        contexto.moveTo(x, 50 - altura);
        contexto.lineTo(x, 50 + altura);
      }
    } else {
      contexto.moveTo(0, 50);
      contexto.lineTo(ancho, 50);
      for (let i = 0; i <= 10; i++) {
        contexto.moveTo((i * ancho) / 10, 40);
        contexto.lineTo((i * ancho) / 10, 60);
      }
    }
    contexto.stroke();
    if (cortar()) {
      contexto.strokeStyle = "#c4e6ac";
      contexto.lineWidth = 3;
      for (const x of [izquierda, derecha]) {
        contexto.beginPath();
        contexto.moveTo(x, 8);
        contexto.lineTo(x, 92);
        contexto.stroke();
        contexto.fillStyle = "#c4e6ac";
        contexto.fillRect(Math.max(0, Math.min(ancho - 8, x - 4)), 4, 8, 12);
      }
    }
    const posicion = (vista.currentTime / duracion) * ancho;
    contexto.strokeStyle = "#ffffff";
    contexto.lineWidth = 2;
    contexto.beginPath();
    contexto.moveTo(posicion, 20);
    contexto.lineTo(posicion, 85);
    contexto.stroke();
    buscar("posicion").textContent =
      `${tiempo(vista.currentTime)} / ${tiempo(duracion)}`;
    lienzo.setAttribute("aria-valuenow", String(vista.currentTime));
    lienzo.setAttribute("aria-valuetext", tiempo(vista.currentTime));
  }
  function actualizar() {
    for (const extremo of ["inicio", "fin"]) {
      buscar(`marcador-${extremo}`).max = String(duracion);
      buscar(`marcador-${extremo}`).value = buscar(extremo).value;
    }
    const valido = Number(fin.value) > Number(inicio.value);
    fin.setCustomValidity(
      cortar() && !valido ? "El fin debe ser posterior al inicio." : "",
    );
    buscar("fragmento").textContent = valido
      ? `Fragmento: ${tiempo(Number(fin.value) - Number(inicio.value))}`
      : "Ajusta el inicio y el fin.";
    controles.hidden = !cortar() || !duracion;
    dibujar();
  }
  function marcar(extremo, valor) {
    if (estaOcupado() || !duracion) return;
    const minimo = extremo === "fin" ? Number(inicio.value) + 0.01 : 0;
    const maximo = extremo === "inicio" ? Number(fin.value) - 0.01 : duracion;
    buscar(extremo).value = Math.min(maximo, Math.max(minimo, valor)).toFixed(
      2,
    );
    soloSeleccion = false;
    vista.pause();
    vista.currentTime = Number(buscar(extremo).value);
    actualizar();
  }
  async function reproducir(seleccion = false) {
    if (estaOcupado() || !duracion) return;
    if (!vista.paused && !seleccion) {
      vista.pause();
      return;
    }
    if (seleccion) {
      if (!fin.reportValidity()) return;
      vista.currentTime = Number(inicio.value);
    }
    soloSeleccion = seleccion;
    try {
      await vista.play();
    } catch {
      avisar(
        "Este navegador no puede reproducir el archivo. Puedes introducir los tiempos manualmente.",
      );
    }
  }
  function seguir() {
    if (soloSeleccion && vista.currentTime >= Number(fin.value)) {
      vista.pause();
      vista.currentTime = Number(fin.value);
      soloSeleccion = false;
    }
    dibujar();
    if (!vista.paused) animacion = requestAnimationFrame(seguir);
  }
  vista.addEventListener("play", () => {
    buscar("reproducir").textContent = "Pausar";
    cancelAnimationFrame(animacion);
    seguir();
  });
  vista.addEventListener("pause", () => {
    buscar("reproducir").textContent = "Reproducir";
    cancelAnimationFrame(animacion);
    dibujar();
  });
  vista.addEventListener("timeupdate", () => {
    if (soloSeleccion && vista.currentTime >= Number(fin.value)) vista.pause();
    dibujar();
  });
  vista.addEventListener("seeked", dibujar);
  vista.addEventListener("loadedmetadata", () => {
    if (!Number.isFinite(vista.duration) || vista.duration <= 0) return;
    duracion = Math.floor(vista.duration * 100) / 100;
    if (!duracion) return;
    inicio.value = "0";
    fin.value = String(duracion);
    inicio.max = fin.max = String(duracion);
    lienzo.setAttribute("aria-valuemax", String(duracion));
    panel.hidden = false;
    actualizar();
  });
  vista.addEventListener("error", () => {
    if (!direccion) return;
    panel.hidden = true;
    avisar(
      "La vista previa no es compatible con este archivo. Puedes seguir usando los tiempos numéricos para procesarlo.",
    );
  });
  buscar("reproducir").addEventListener("click", () => reproducir());
  buscar("reproducir-seleccion").addEventListener("click", () =>
    reproducir(true),
  );
  for (const extremo of ["inicio", "fin"]) {
    buscar(`marcar-${extremo}`).addEventListener("click", () =>
      marcar(extremo, vista.currentTime),
    );
    buscar(`marcador-${extremo}`).addEventListener("input", (evento) =>
      marcar(extremo, Number(evento.target.value)),
    );
    buscar(extremo).addEventListener("input", () => {
      soloSeleccion = false;
      actualizar();
    });
  }
  buscar("volumen").addEventListener("input", (evento) => {
    vista.volume = Number(evento.target.value);
  });
  buscar("operacion").addEventListener("change", () => {
    vista.pause();
    soloSeleccion = false;
    actualizar();
  });
  const situar = (evento) => {
    const limites = lienzo.getBoundingClientRect();
    return Math.min(
      duracion,
      Math.max(0, ((evento.clientX - limites.left) / limites.width) * duracion),
    );
  };
  lienzo.addEventListener("pointerdown", (evento) => {
    if (estaOcupado() || !duracion || evento.button !== 0) return;
    const valor = situar(evento);
    const margen = (18 / lienzo.clientWidth) * duracion;
    arrastre =
      cortar() && Math.abs(valor - Number(inicio.value)) <= margen
        ? "inicio"
        : cortar() && Math.abs(valor - Number(fin.value)) <= margen
          ? "fin"
          : "posicion";
    lienzo.setPointerCapture(evento.pointerId);
    vista.pause();
    soloSeleccion = false;
    if (arrastre === "posicion") vista.currentTime = valor;
    else marcar(arrastre, valor);
    dibujar();
  });
  lienzo.addEventListener("pointermove", (evento) => {
    if (!arrastre || estaOcupado()) return;
    if (arrastre === "posicion") vista.currentTime = situar(evento);
    else marcar(arrastre, situar(evento));
    dibujar();
  });
  for (const evento of ["pointerup", "pointercancel", "lostpointercapture"])
    lienzo.addEventListener(evento, () => {
      arrastre = undefined;
    });
  lienzo.addEventListener("keydown", (evento) => {
    if (estaOcupado() || !duracion) return;
    if (["ArrowLeft", "ArrowRight", "Home", "End", " "].includes(evento.key))
      evento.preventDefault();
    if (evento.key === " ") void reproducir();
    else if (evento.key === "Home") vista.currentTime = 0;
    else if (evento.key === "End") vista.currentTime = duracion;
    else if (["ArrowLeft", "ArrowRight"].includes(evento.key))
      vista.currentTime = Math.max(
        0,
        Math.min(
          duracion,
          vista.currentTime +
            (evento.key === "ArrowLeft" ? -1 : 1) * (evento.shiftKey ? 1 : 0.1),
        ),
      );
    soloSeleccion = false;
  });
  const observador = new ResizeObserver(dibujar);
  observador.observe(lienzo);
  async function cargarOnda(archivo, actual) {
    if (bloque !== "sonido") return;
    // Limita la decodificación para no agotar la memoria con grabaciones extensas.
    if (archivo.size > 32 * 1024 * 1024) return;
    let decodificador;
    try {
      decodificador = new OfflineAudioContext(1, 1, 8000);
      const datos = await decodificador.decodeAudioData(
        await archivo.arrayBuffer(),
      );
      if (actual !== version) return;
      const resultado = new Float32Array(1000);
      const muestras = datos.getChannelData(0);
      const paso = Math.max(1, Math.floor(muestras.length / resultado.length));
      for (let i = 0; i < resultado.length; i++) {
        const limite = Math.min(muestras.length, (i + 1) * paso);
        for (let j = i * paso; j < limite; j++)
          resultado[i] = Math.max(resultado[i], Math.abs(muestras[j]));
      }
      picos = resultado;
      dibujar();
    } catch {
      /* La reproducción y la selección siguen disponibles sin onda. */
    }
  }
  function cargar(archivo) {
    version++;
    vista.pause();
    soloSeleccion = false;
    duracion = 0;
    picos = undefined;
    panel.hidden = true;
    vista.removeAttribute("src");
    vista.load();
    if (direccion) URL.revokeObjectURL(direccion);
    direccion = undefined;
    inicio.removeAttribute("max");
    fin.removeAttribute("max");
    fin.setCustomValidity("");
    if (!archivo) return;
    direccion = URL.createObjectURL(archivo);
    vista.src = direccion;
    const actual = version;
    vista.addEventListener(
      "loadedmetadata",
      () => {
        if (actual === version && vista.duration <= 600)
          void cargarOnda(archivo, actual);
      },
      { once: true },
    );
  }
  return {
    cargar,
    pausar: () => {
      vista.pause();
      soloSeleccion = false;
    },
    destruir: () => {
      version++;
      vista.pause();
      cancelAnimationFrame(animacion);
      observador.disconnect();
      if (direccion) URL.revokeObjectURL(direccion);
    },
  };
}
