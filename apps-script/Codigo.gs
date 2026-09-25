/**
 * Registro de la capacitación "Conservación del Agua"
 * Programa de Gestión Integral del Recurso Hídrico — Alcaldía de Bucaramanga
 *
 * Recibe los envíos de la página (al registrarse y al terminar) y escribe una fila por persona
 * en la pestaña "Registros". Cuando la persona termina, se actualiza su misma fila.
 *
 * La dirección de esta aplicación web queda visible en la página, así que cualquiera podría
 * enviarle datos. Por eso aquí se valida todo de nuevo, se limita la cantidad de envíos y se
 * usa un candado para que dos envíos al mismo tiempo no se pisen.
 *
 * Instalación: pegar este código en Extensiones > Apps Script de la hoja, ejecutar una vez
 * configurarHoja() y publicar como aplicación web (ver instrucciones en la conversación).
 */

// ===== Ajustes =====
const HOJA_REGISTROS = "Registros";
const HOJA_RESUMEN = "Resumen";
const ZONA_HORARIA = "America/Bogota";

const MAX_TAMANO_ENVIO = 4000;         // caracteres; un envío normal ocupa unos 400
const MAX_FILAS = 2000;                // tope de personas, para que un abuso no llene la hoja
const MAX_ENVIOS_POR_DOCUMENTO = 10;   // por hora, por número de documento
const MAX_ENVIOS_POR_MINUTO = 60;      // en total, entre todas las personas

const ENCABEZADOS = [
  "Fecha de registro", "Nombre", "Tipo de documento", "Número de documento", "Celular",
  "Correo", "Estado", "Fecha de finalización", "Código del certificado"
];
// Número de columna de cada dato (1 = columna A)
const COL = {
  fechaRegistro: 1, nombre: 2, tipoDocumento: 3, documento: 4, celular: 5,
  correo: 6, estado: 7, fechaFin: 8, codigo: 9
};
const ESTADO_REGISTRADO = "Registrado";
const ESTADO_TERMINADO = "Terminado";


// ===== Punto de entrada: la página envía aquí los datos =====
function doPost(e) {
  try {
    const cuerpo = e && e.postData && e.postData.contents;
    if (!cuerpo || cuerpo.length > MAX_TAMANO_ENVIO) return responder_(false, "Envío vacío o demasiado grande");

    let datos;
    try {
      datos = JSON.parse(cuerpo);
    } catch (err) {
      return responder_(false, "Formato inválido");
    }

    const v = validar_(datos);
    if (v.error) return responder_(false, v.error);

    // Candado: un solo envío a la vez escribe en la hoja
    const candado = LockService.getScriptLock();
    if (!candado.tryLock(20000)) return responder_(false, "Servidor ocupado", true);
    try {
      const limite = revisarLimites_(v.tipoDocumento + v.documento);
      if (limite) return responder_(false, limite.mensaje, limite.reintentar);
      const estado = guardar_(v);
      if (!estado) return responder_(false, "Se alcanzó el máximo de registros");
      return responder_(true, estado);
    } finally {
      candado.releaseLock();
    }
  } catch (err) {
    console.error(err);
    return responder_(false, "Error interno", true);
  }
}

// Para comprobar que la dirección funciona: al abrirla en el navegador muestra que está activa.
// No devuelve ningún dato de la hoja.
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, servicio: "activo" }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ===== Validación (las mismas reglas del formulario de la página) =====
function validar_(d) {
  if (!d || typeof d !== "object") return { error: "Datos inválidos" };

  const tipo = d.tipo;
  if (tipo !== "registro" && tipo !== "fin") return { error: "Tipo de envío inválido" };

  const nombre = limpiarTexto_(d.nombre);
  if (nombre.length < 3 || nombre.length > 80) return { error: "Nombre inválido" }; // más largo no cabe en el certificado

  const tipoDocumento = d.tipoDocumento;
  if (tipoDocumento !== "CC" && tipoDocumento !== "TI") return { error: "Tipo de documento inválido" };

  const documento = String(d.documento || "").trim();
  if (!/^\d{3,11}$/.test(documento)) return { error: "Número de documento inválido" }; // incluye cédulas antiguas

  const celular = String(d.telefono || "").trim();
  if (!/^3\d{9}$/.test(celular)) return { error: "Celular inválido" };

  const correo = String(d.correo || "").trim().toLowerCase();
  if (correo.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return { error: "Correo inválido" };

  if (d.consentimiento !== true) return { error: "Falta la autorización de datos" };

  const ahora = new Date();
  // Si la fecha no llega o no es creíble, se usa la hora de llegada
  const fechaRegistro = fechaCreible_(d.fechaRegistro, ahora, 60) || ahora;

  const v = { tipo, nombre, tipoDocumento, documento, celular, correo, fechaRegistro };

  if (tipo === "fin") {
    const fechaFin = fechaCreible_(d.fechaFin, ahora, 60);
    if (!fechaFin) return { error: "Fecha de finalización inválida" };
    const codigo = String(d.codigo || "").trim();
    if (!codigoValido_(codigo, tipoDocumento, documento, fechaFin)) return { error: "Código de certificado inválido" };
    v.fechaFin = fechaFin;
    v.codigo = codigo;
  }
  return v;
}

// Quita caracteres de control y espacios repetidos
function limpiarTexto_(valor) {
  return String(valor || "").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
}

// Fecha válida, no más de 10 minutos en el futuro y no más antigua que `diasMax` días
function fechaCreible_(valor, ahora, diasMax) {
  if (typeof valor !== "string" || valor.length > 40) return null;
  const f = new Date(valor);
  if (isNaN(f.getTime())) return null;
  if (f.getTime() > ahora.getTime() + 10 * 60 * 1000) return null;
  if (f.getTime() < ahora.getTime() - diasMax * 24 * 60 * 60 * 1000) return null;
  return f;
}

// Recalcula el código igual que la página (certCode en index.html) y lo compara.
// La página usa el año según la hora del celular; se acepta el año de la fecha ±1 por el cambio de año.
function codigoValido_(codigo, tipoDocumento, documento, fechaFin) {
  const m = /^PGIRH-(\d{4})-([0-9A-Z]{6})$/.exec(codigo);
  if (!m) return false;
  const base = tipoDocumento + documento + fechaFin.toISOString().slice(0, 10);
  let h = 0;
  for (const ch of base) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const sufijo = h.toString(36).toUpperCase().slice(0, 6).padStart(6, "0");
  const anio = Number(m[1]);
  return m[2] === sufijo && Math.abs(anio - fechaFin.getUTCFullYear()) <= 1;
}


// ===== Límites de envíos (se revisan dentro del candado) =====
function revisarLimites_(clave) {
  const cache = CacheService.getScriptCache();
  const minuto = "min:" + Math.floor(Date.now() / 60000);
  const totalMinuto = Number(cache.get(minuto) || 0);
  if (totalMinuto >= MAX_ENVIOS_POR_MINUTO) return { mensaje: "Demasiados envíos, intenta más tarde", reintentar: true };

  const porDocumento = "doc:" + clave;
  const totalDocumento = Number(cache.get(porDocumento) || 0);
  if (totalDocumento >= MAX_ENVIOS_POR_DOCUMENTO) return { mensaje: "Demasiados envíos para este documento", reintentar: false };

  cache.put(minuto, String(totalMinuto + 1), 120);
  cache.put(porDocumento, String(totalDocumento + 1), 3600);
  return null;
}


// ===== Escritura en la hoja =====
function guardar_(v) {
  const hoja = obtenerHojaRegistros_();
  const fila = buscarFila_(hoja, v.tipoDocumento, v.documento);

  if (fila) {
    // La persona ya existe: nunca se crea otra fila. Tampoco se cambian su nombre ni sus datos
    // de contacto, para que alguien que conozca un número de documento no pueda alterarlos.
    const estadoActual = hoja.getRange(fila, COL.estado).getValue();
    if (v.tipo === "fin" && estadoActual !== ESTADO_TERMINADO) {
      // Se conserva la primera finalización (los reintentos no la cambian)
      hoja.getRange(fila, COL.estado, 1, 3).setValues([[ESTADO_TERMINADO, v.fechaFin, v.codigo]]);
    }
    return v.tipo === "fin" ? ESTADO_TERMINADO : estadoActual;
  }

  if (hoja.getLastRow() - 1 >= MAX_FILAS) return null;

  const terminado = v.tipo === "fin";
  hoja.appendRow([
    v.fechaRegistro,
    comoTexto_(v.nombre),
    v.tipoDocumento,
    v.documento,
    v.celular,
    comoTexto_(v.correo),
    terminado ? ESTADO_TERMINADO : ESTADO_REGISTRADO,
    terminado ? v.fechaFin : "",
    terminado ? v.codigo : ""
  ]);
  return terminado ? ESTADO_TERMINADO : ESTADO_REGISTRADO;
}

function buscarFila_(hoja, tipoDocumento, documento) {
  const ultima = hoja.getLastRow();
  if (ultima < 2) return 0;
  const valores = hoja.getRange(2, COL.tipoDocumento, ultima - 1, 2).getDisplayValues();
  for (let i = 0; i < valores.length; i++) {
    if (valores[i][0] === tipoDocumento && valores[i][1] === documento) return i + 2;
  }
  return 0;
}

// Evita que un texto que empieza por = + - @ se interprete como fórmula en la hoja
function comoTexto_(texto) {
  return /^[=+\-@]/.test(texto) ? "'" + texto : texto;
}

function libro_() {
  const id = PropertiesService.getScriptProperties().getProperty("ID_HOJA");
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function obtenerHojaRegistros_() {
  const libro = libro_();
  return libro.getSheetByName(HOJA_REGISTROS) || prepararRegistros_(libro);
}

function prepararRegistros_(libro) {
  const hoja = libro.getSheetByName(HOJA_REGISTROS) || libro.insertSheet(HOJA_REGISTROS, 0);
  if (hoja.getLastRow() === 0) hoja.appendRow(ENCABEZADOS);
  hoja.getRange(1, 1, 1, ENCABEZADOS.length).setFontWeight("bold");
  hoja.setFrozenRows(1);
  // Documento, celular y código como texto (conserva ceros y evita notación científica)
  hoja.getRange("C:F").setNumberFormat("@");
  hoja.getRange("I:I").setNumberFormat("@");
  hoja.getRange("A:A").setNumberFormat("yyyy-mm-dd hh:mm");
  hoja.getRange("H:H").setNumberFormat("yyyy-mm-dd hh:mm");
  return hoja;
}


// ===== Ejecutar UNA vez desde el editor (botón "Ejecutar") antes de publicar =====
// Crea las pestañas "Registros" y "Resumen", pone la zona horaria de Colombia
// y guarda la identificación de esta hoja para la aplicación web.
function configurarHoja() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  libro.setSpreadsheetTimeZone(ZONA_HORARIA);
  PropertiesService.getScriptProperties().setProperty("ID_HOJA", libro.getId());

  const registros = prepararRegistros_(libro);
  const encabezadosActuales = registros.getRange(1, 1, 1, ENCABEZADOS.length).getValues()[0];
  if (encabezadosActuales.join("|") !== ENCABEZADOS.join("|")) {
    throw new Error('La pestaña "' + HOJA_REGISTROS + '" ya tiene otros encabezados. Cámbiale el nombre o bórrala y vuelve a ejecutar.');
  }

  const resumen = libro.getSheetByName(HOJA_RESUMEN) || libro.insertSheet(HOJA_RESUMEN);
  // Desde Apps Script las fórmulas van en inglés y con comas, aunque la hoja esté en español
  resumen.getRange("A1:A4").setValues([["Indicador"], ["Personas registradas"], ["Personas que terminaron"], ["Porcentaje que terminó"]]);
  resumen.getRange("B1").setValue("Valor");
  resumen.getRange("B2:B4").setFormulas([
    ["=COUNTA(" + HOJA_REGISTROS + "!D2:D)"],
    ["=COUNTIF(" + HOJA_REGISTROS + "!G2:G,\"" + ESTADO_TERMINADO + "\")"],
    ["=IF(B2=0,0,B3/B2)"]
  ]);
  resumen.getRange("A1:B1").setFontWeight("bold");
  resumen.getRange("B4").setNumberFormat("0%");
  resumen.autoResizeColumn(1);

  console.log("Hoja lista: " + libro.getName());
}


// ===== Respuesta a la página =====
// reintentar = true le indica a la página que guarde el envío y lo intente más tarde
function responder_(ok, mensaje, reintentar) {
  const cuerpo = ok ? { ok: true, estado: mensaje } : { ok: false, error: mensaje, reintentar: !!reintentar };
  return ContentService.createTextOutput(JSON.stringify(cuerpo)).setMimeType(ContentService.MimeType.JSON);
}
