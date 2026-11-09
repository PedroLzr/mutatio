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
const vistas = new Map();
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
  if (valor) panelEnProceso = panelActivo;
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
    elemento("banda-sonora").hidden = operacion !== "sustituir";
    elemento("archivo-banda").required = operacion === "sustituir";
    elemento("archivo-banda").disabled = operacion !== "sustituir";
  }
}
for (const bloque of ["sonido", "video"]) {
  elemento(`operacion-${bloque}`).addEventListener("change", () =>
    actualizarOperacion(bloque),
  );
  elemento(`archivo-${bloque}`).addEventListener("change", () => {
    const vista = elemento(`vista-${bloque}`);
    vista.pause();
    vista.removeAttribute("src");
    vista.load();
    vista.hidden = true;
    if (vistas.has(bloque)) URL.revokeObjectURL(vistas.get(bloque));
    const archivo = elemento(`archivo-${bloque}`).files[0];
    if (!archivo) return;
    try {
      validarArchivo(archivo);
    } catch (error) {
      avisar(error.message, true);
      return;
    }
    const direccion = URL.createObjectURL(archivo);
    vistas.set(bloque, direccion);
    vista.src = direccion;
  });
  elemento(`vista-${bloque}`).addEventListener("loadedmetadata", () => {
    const duracion = elemento(`vista-${bloque}`).duration;
    if (Number.isFinite(duracion)) {
      elemento(`fin-${bloque}`).value = String(
        Math.floor(duracion * 100) / 100,
      );
      elemento(`inicio-${bloque}`).value = "0";
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
  const superficie = document.createElement("canvas");
  const miniatura = document.createElement("canvas");
  try {
    senal.throwIfAborted();
    superficie.width = 1280;
    superficie.height = 720;
    const pincel = superficie.getContext("2d");
    pincel.fillStyle = "#000000";
    pincel.fillRect(0, 0, 1280, 720);
    const escala = Math.min(1280 / imagen.width, 720 / imagen.height);
    const ancho = imagen.width * escala,
      alto = imagen.height * escala;
    pincel.drawImage(imagen, (1280 - ancho) / 2, (720 - alto) / 2, ancho, alto);
    const contenido = await convertirLienzo(superficie, "image/jpeg", 0.9);
    senal.throwIfAborted();
    miniatura.width = 240;
    miniatura.height = 135;
    miniatura.getContext("2d").drawImage(superficie, 0, 0, 240, 135);
    const vista = await convertirLienzo(miniatura, "image/jpeg", 0.75);
    senal.throwIfAborted();
    return {
      nombre: archivo.name,
      contenido,
      direccion: URL.createObjectURL(vista),
    };
  } finally {
    imagen.close();
    superficie.width =
      superficie.height =
      miniatura.width =
      miniatura.height =
        0;
  }
}

async function agregarFotos(archivos) {
  if (trabajando || !archivos.length) return;
  bloquear(true, true);
  preparacionFotos = new AbortController();
  const nuevas = [];
  // Libera las referencias del selector; solo se decodifica un original cada vez.
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
elemento("formulario-creador").addEventListener("submit", (evento) => {
  evento.preventDefault();
  realizar(
    () =>
      procesarMultimedia(
        {
          bloque: "creador",
          fotos: fotos.map((foto) => foto.contenido),
          segundos: numero("duracion-foto"),
          musica: elemento("musica").files[0],
          transicion: elemento("transicion").value,
        },
        progreso,
      ),
    true,
  );
});
window.addEventListener("pagehide", () => {
  for (const direccion of descargas.values()) URL.revokeObjectURL(direccion);
  for (const direccion of vistas.values()) URL.revokeObjectURL(direccion);
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

elemento("transicion").addEventListener("change", () => {
  elemento("nota-transicion").hidden =
    elemento("transicion").value === "ninguna";
});
