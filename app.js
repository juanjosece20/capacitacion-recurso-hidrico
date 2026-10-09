// Las letras de Google Fonts se piden como "print" para no frenar la primera pantalla; aquí se activan
// (antes lo hacía un onload en el HTML, que la política de seguridad no permite)
document.getElementById("fuentes").media = "all";

// ===== Registro en Google Sheets =====
// Pega aquí la dirección de la aplicación web de Apps Script (termina en /exec).
// Mientras quede en "", no se envía nada y el curso funciona igual.
const REGISTRO_URL = "https://script.google.com/macros/s/AKfycbwu1TVIOjePB-JDycj3Ysx1DaMj9CWpOrlJcIVs7cZOVHHD5-CHiqYo5xszrCasffU/exec";

// ===== Videos de la capacitación =====
// Archivos MP4 de la carpeta videos/ (H.264, 720p). La portada es el mismo nombre terminado en .jpg.
// Si se cambian las portadas, subir VERSION_PORTADAS para que los celulares no muestren las guardadas.
const VERSION_PORTADAS = "2";
// Mientras quede en "", se muestra el recuadro de "video pendiente".
const VIDEOS = {
  introduccion: "videos/presentacion.mp4",
  preguntas: [
    "videos/pregunta-1.mp4", // Pregunta 1: el suelo del páramo como esponja
    "videos/pregunta-2.mp4", // Pregunta 2: minería y ganadería en los páramos
    "videos/pregunta-3.mp4", // Pregunta 3: las quebradas y los ríos de Oro y Suratá
    "videos/pregunta-4.mp4", // Pregunta 4: a quiénes beneficia proteger las quebradas
    "videos/pregunta-5.mp4"  // Pregunta 5: la delimitación del páramo
  ],
  despedida: "videos/despedida.mp4"
};

const questions = [
  {
    text: "¿Cómo funciona el suelo del Páramo de Santurbán?",
    explicacion: "Correcto. El suelo del páramo absorbe el agua de la lluvia y la neblina, y la va soltando poco a poco, incluso en temporadas secas.",
    options: [
      { text: "Como una roca que no deja pasar el agua", correct: false },
      { text: "Como una esponja que absorbe el agua y la suelta poco a poco", correct: true },
      { text: "Como un desierto que se seca en verano", correct: false },
      { text: "Como un río que corre bajo la tierra", correct: false }
    ]
  },
  {
    text: "Según la ley colombiana, ¿qué actividades están prohibidas en los páramos?",
    explicacion: "Correcto. En Colombia la minería y la ganadería están prohibidas en los páramos, aunque en municipios como Vetas y Suratá aún se realizan.",
    options: [
      { text: "Sembrar árboles nativos", correct: false },
      { text: "Hacer turismo ecológico", correct: false },
      { text: "La minería y la ganadería", correct: true },
      { text: "Investigar la biodiversidad", correct: false }
    ]
  },
  {
    text: "¿A qué ríos alimentan las quebradas de Bucaramanga?",
    explicacion: "Correcto. Las quebradas de Bucaramanga alimentan el río de Oro y el Suratá, que juntos forman el río Lebrija.",
    options: [
      { text: "Al río de Oro y al Suratá", correct: true },
      { text: "Al Magdalena y al Cauca", correct: false },
      { text: "Al Chicamocha y al Sogamoso", correct: false },
      { text: "Al Fonce y al Suárez", correct: false }
    ]
  },
  {
    text: "Además del ambiente, ¿a quiénes beneficia proteger las quebradas?",
    explicacion: "Correcto. Proteger las quebradas también beneficia a las familias que viven de la pesca aguas abajo.",
    options: [
      { text: "Solo a los turistas", correct: false },
      { text: "A las empresas de construcción", correct: false },
      { text: "A nadie en particular", correct: false },
      { text: "A las familias que viven de la pesca aguas abajo", correct: true }
    ]
  },
  {
    text: "¿Por qué importa tanto la delimitación del páramo?",
    explicacion: "Correcto. Lo que queda dentro de la delimitación tiene reglas de protección estrictas; lo que queda afuera puede quedar expuesto.",
    options: [
      { text: "Porque define dónde se puede construir más", correct: false },
      { text: "Porque lo que queda adentro tiene reglas de protección estrictas", correct: true },
      { text: "Porque marca los límites entre municipios", correct: false },
      { text: "Porque decide quién es dueño del agua", correct: false }
    ]
  }
];

const letters = ["A", "B", "C", "D"];
let current = 0;
let solved = false;
let vistos = new Set(); // videos vistos completos ("pregunta-2:videos/pregunta-2.mp4"); se guardan con el progreso
let participant = { nombre: "", tipoDocumento: "", documento: "", telefono: "", correo: "" };

// Progreso guardado en este dispositivo, para no perderlo si cierran la página
const STORAGE_KEY = "capacitacion_agua_progreso_v1";

function saveProgress(screen){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ screen, participant, current, vistos: [...vistos] }));
  } catch(e){ /* localStorage no disponible (modo privado, etc.) — seguimos sin guardar */ }
}

function loadProgress(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e){ return null; }
}

function clearProgress(){
  try{ localStorage.removeItem(STORAGE_KEY); } catch(e){ /* nada que limpiar */ }
}

let pendingResumeScreen = null;

// Videos: toma el archivo de VIDEOS y lo muestra, o deja el recuadro de "pendiente"
function archivoVideo(ruta){
  const r = String(ruta || "").trim();
  return /\.mp4$/i.test(r) ? r : null;
}

// ===== Videos =====
// Con poca señal, el video no se descarga hasta que la persona toca reproducir:
// mientras tanto solo se ve la portada (unos 70 KB). El MP4 empieza a verse mientras baja.
//
// Cada video debe verse completo antes de responder su pregunta o de continuar.
// No se puede adelantar con la barra (vuelve a donde iba); retroceder sí se puede.
// Un video ya visto completo se puede mover libremente. Los videos pendientes no bloquean nada.
const TOLERANCIA_S = 2; // margen para los saltos normales de la reproducción
const avisos = {
  introduccion: document.getElementById("avisoIntro"),
  pregunta: document.getElementById("avisoPregunta"),
  despedida: document.getElementById("avisoDespedida")
};
const avisoEspecial = {}; // tipo -> true mientras se muestra un aviso de problema

// Duración de cada video en segundos, para mostrarla en el aviso sin descargar nada.
// Si se cambia un video, hay que actualizar aquí su duración.
const DURACION_S = {
  "videos/presentacion.mp4": 24,
  "videos/pregunta-1.mp4": 28,
  "videos/pregunta-2.mp4": 32,
  "videos/pregunta-3.mp4": 12,
  "videos/pregunta-4.mp4": 12,
  "videos/pregunta-5.mp4": 66,
  "videos/despedida.mp4": 22
};

// "Video de 24 segundos", "Video de 1 minuto y 6 segundos"; "" si no se conoce
function textoDuracion(tipo){
  const s = DURACION_S[archivoVideo(tipo === "pregunta" ? VIDEOS.preguntas[current] : VIDEOS[tipo])];
  if (!s) return "";
  const min = Math.floor(s / 60), seg = s % 60;
  const partes = [];
  if (min) partes.push(min === 1 ? "1 minuto" : `${min} minutos`);
  if (seg) partes.push(seg === 1 ? "1 segundo" : `${seg} segundos`);
  return "Video de " + partes.join(" y ");
}

// Clave del video de la pantalla ("introduccion", "pregunta" o "despedida"); null si no tiene enlace válido
function claveVideo(tipo){
  const archivo = archivoVideo(tipo === "pregunta" ? VIDEOS.preguntas[current] : VIDEOS[tipo]);
  return archivo ? (tipo === "pregunta" ? `pregunta-${current + 1}` : tipo) + ":" + archivo : null;
}

function videoPendiente(tipo){
  const clave = claveVideo(tipo);
  return !!clave && !vistos.has(clave);
}

function mostrarAviso(tipo, clase, texto, boton, duracion){
  const el = avisos[tipo];
  el.className = "video-aviso" + (clase ? " " + clase : "");
  el.textContent = "";
  el.hidden = !texto;
  if (!texto) return;
  if (duracion){
    const d = document.createElement("strong");
    d.className = "video-duracion";
    d.textContent = duracion;
    el.appendChild(d);
  }
  const span = document.createElement("span");
  span.textContent = texto;
  el.appendChild(span);
  if (boton){
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ghost-btn ghost-btn--full";
    b.textContent = boton.texto;
    b.addEventListener("click", boton.accion);
    el.appendChild(b);
  }
}

function avisoProblema(tipo, texto, boton){
  avisoEspecial[tipo] = true;
  mostrarAviso(tipo, "problema", texto, boton);
}

// Aviso normal: pide ver el video, o confirma que ya se vio
function avisoNormal(tipo){
  avisoEspecial[tipo] = false;
  const clave = claveVideo(tipo);
  if (!clave) return mostrarAviso(tipo, "", "");
  const accion = tipo === "pregunta" ? "responder" : tipo === "introduccion" ? "continuar" : "terminar";
  const duracion = textoDuracion(tipo);
  if (vistos.has(clave)){
    mostrarAviso(tipo, "visto", tipo === "pregunta" ? "✓ Ya viste el video completo. Ahora responde la pregunta." : "✓ Ya viste el video completo. Ya puedes " + accion + ".", null, duracion);
  } else {
    mostrarAviso(tipo, "", `Mira el video completo para ${accion}.`, null, duracion);
  }
}

// Bloquea o habilita las respuestas y los botones según el video de cada pantalla
function actualizarBloqueo(){
  document.getElementById("introBtn").disabled = videoPendiente("introduccion");
  document.getElementById("outroBtn").disabled = videoPendiente("despedida");
  const preguntaBloqueada = videoPendiente("pregunta");
  if (!solved){
    [...optionsList.children].forEach(b => {
      b.disabled = preguntaBloqueada;
      b.classList.toggle("bloqueada", preguntaBloqueada);
    });
  }
  ["introduccion", "pregunta", "despedida"].forEach(tipo => { if (!avisoEspecial[tipo]) avisoNormal(tipo); });
}

function marcarVisto(clave, tipo){
  vistos.add(clave);
  if (["intro", "quiz", "outro"].includes(pantallaActual)) saveProgress(pantallaActual);
  avisoEspecial[tipo] = false;
  actualizarBloqueo();
}

// Detiene el video del recuadro y corta su descarga (al cambiar de pantalla o de video)
// Subtítulos: desactivados por ahora. Para volver a mostrarlos (con el botón CC), cambiar a true.
// Los archivos .vtt siguen en la carpeta videos/.
const SUBTITULOS_HABILITADOS = false;

// Subtítulos activados o no (botón CC); se recuerda en este celular. Activados por defecto.
let subtitulosActivos = true;
try{ subtitulosActivos = localStorage.getItem("capacitacion_subtitulos") !== "no"; } catch(e){ /* sin almacenamiento */ }

function limpiarVideo(el){
  const v = el._video;
  if (!v) return;
  clearTimeout(v.lento);
  clearTimeout(v.avisoSalto);
  clearTimeout(v.controles);
  el._video = null;
  try{
    v.video.pause();
    v.video.removeAttribute("src");
    v.video.load(); // corta la descarga en curso
  } catch(e){ /* ya no existe */ }
}

function renderVideo(el, archivo, nombre, tipo){
  limpiarVideo(el);
  el.classList.add("has-video");
  el.innerHTML = "";
  const clave = claveVideo(tipo);

  const v = { video: null, maxVisto: 0, lento: null, avisoSalto: null, avisoLento: false, controles: null };
  const video = document.createElement("video");
  video.src = archivo;
  video.poster = archivo.replace(/\.mp4$/i, ".jpg") + "?v=" + VERSION_PORTADAS;
  video.preload = "none";   // nada se descarga hasta tocar reproducir
  video.controls = true;
  video.playsInline = true; // en iPhone se ve dentro de la página, sin abrir pantalla completa
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.setAttribute("controlslist", "nodownload noplaybackrate noremoteplayback");
  video.disablePictureInPicture = true;
  video.setAttribute("aria-label", nombre.charAt(0).toUpperCase() + nombre.slice(1));

  if (SUBTITULOS_HABILITADOS){
    // Subtítulos en español (mismo nombre terminado en .vtt). La pista queda oculta ("hidden"):
    // la página dibuja el texto ella misma, más grande y legible que el del navegador.
    const pista = document.createElement("track");
    pista.kind = "captions";
    pista.srclang = "es";
    pista.label = "Español";
    pista.src = archivo.replace(/\.mp4$/i, ".vtt");
    video.appendChild(pista);
    el.appendChild(video);
    pista.track.mode = "hidden";

    const subtitulos = document.createElement("div");
    subtitulos.className = "subtitulos";
    subtitulos.setAttribute("aria-hidden", "true"); // el video ya tiene la pista para lectores de pantalla
    el.appendChild(subtitulos);

    let empezo = false; // sobre la portada no se muestran subtítulos
    function pintarSubtitulos(){
      subtitulos.textContent = "";
      if (!subtitulosActivos || !empezo) return;
      const activos = pista.track.activeCues || [];
      for (let i = 0; i < activos.length; i++){
        activos[i].text.split("\n").forEach((linea, j) => {
          if (j || i) subtitulos.appendChild(document.createElement("br"));
          const span = document.createElement("span");
          span.className = "subtitulo-linea";
          span.textContent = linea;
          subtitulos.appendChild(span);
        });
      }
    }
    pista.track.addEventListener("cuechange", pintarSubtitulos);

    // En pantalla completa nativa la página no puede dibujar encima: ahí se usan los del navegador
    let pantallaCompletaIOS = false;
    function ajustarModoPista(){
      const completa = pantallaCompletaIOS || document.fullscreenElement === video || document.webkitFullscreenElement === video;
      pista.track.mode = completa && subtitulosActivos ? "showing" : "hidden";
    }
    ["fullscreenchange", "webkitfullscreenchange"].forEach(ev => video.addEventListener(ev, ajustarModoPista));
    video.addEventListener("webkitbeginfullscreen", () => { pantallaCompletaIOS = true; ajustarModoPista(); });
    video.addEventListener("webkitendfullscreen", () => { pantallaCompletaIOS = false; ajustarModoPista(); });

    // Botón CC
    const botonCC = document.createElement("button");
    botonCC.type = "button";
    botonCC.className = "video-cc";
    botonCC.textContent = "CC";
    const pintarCC = () => {
      botonCC.setAttribute("aria-pressed", subtitulosActivos ? "true" : "false");
      botonCC.setAttribute("aria-label", subtitulosActivos ? "Subtítulos activados: tocar para quitarlos" : "Subtítulos desactivados: tocar para activarlos");
    };
    pintarCC();
    botonCC.addEventListener("click", () => {
      subtitulosActivos = !subtitulosActivos;
      try{ localStorage.setItem("capacitacion_subtitulos", subtitulosActivos ? "si" : "no"); } catch(e){ /* sin almacenamiento */ }
      pintarCC();
      pintarSubtitulos();
      ajustarModoPista();
    });
    el.appendChild(botonCC);

    // Los controles nativos se ven en pausa y unos 3 segundos después de tocar el video:
    // mientras tanto los subtítulos suben para no taparlos
    function controlesVisibles(){
      el.classList.add("controles-visibles");
      clearTimeout(v.controles);
      if (!video.paused) v.controles = setTimeout(() => el.classList.remove("controles-visibles"), 3000);
    }
    el.classList.add("controles-visibles");
    ["pointerdown", "pointermove", "touchstart"].forEach(ev => el.addEventListener(ev, controlesVisibles, { passive: true }));
    video.addEventListener("play", () => { empezo = true; el.classList.remove("en-pausa"); pintarSubtitulos(); controlesVisibles(); });
    video.addEventListener("pause", () => { el.classList.add("en-pausa"); controlesVisibles(); });
  } else {
    el.appendChild(video);
  }

  // Botón de play grande: se oculta al reproducir y vuelve si el video se pausa o termina
  const botonPlay = document.createElement("button");
  botonPlay.type = "button";
  botonPlay.className = "video-play";
  botonPlay.setAttribute("aria-label", "Reproducir " + nombre);
  botonPlay.innerHTML = '<span class="video-play-circulo" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3.5L20 12L6 20.5Z" fill="#014A28"/></svg></span>';
  botonPlay.addEventListener("click", () => { video.play().catch(() => {}); });
  el.appendChild(botonPlay);
  video.addEventListener("play", () => { botonPlay.hidden = true; });
  video.addEventListener("pause", () => {
    botonPlay.classList.add("en-pausa"); // ya empezó: los controles nativos de abajo quedan libres
    botonPlay.hidden = false;
  });

  v.video = video;
  el._video = v;
  const libre = () => vistos.has(clave); // ya visto completo: se puede mover sin restricciones

  // Cuánto se ha visto seguido: un salto hacia adelante no cuenta
  video.addEventListener("timeupdate", () => {
    if (libre() || video.seeking) return;
    const t = video.currentTime;
    if (t <= v.maxVisto + TOLERANCIA_S) v.maxVisto = Math.max(v.maxVisto, t);
  });

  // Adelantar con la barra: vuelve a donde iba (retroceder sí se puede)
  video.addEventListener("seeking", () => {
    if (libre() || video.currentTime <= v.maxVisto + TOLERANCIA_S) return;
    video.currentTime = v.maxVisto;
    avisoProblema(tipo, "El video no se puede adelantar. Sigue viéndolo desde donde ibas.");
    clearTimeout(v.avisoSalto);
    v.avisoSalto = setTimeout(() => { if (el._video === v && !libre()) avisoNormal(tipo); }, 6000);
  });

  video.addEventListener("ended", () => {
    if (libre()) return;
    if (video.duration > 0 && v.maxVisto + TOLERANCIA_S >= video.duration){
      clearTimeout(v.avisoSalto);
      marcarVisto(clave, tipo);
      return;
    }
    avisoProblema(tipo, "Parece que adelantaste el video. Para continuar, míralo completo.", {
      texto: "Seguir viendo desde donde iba",
      accion: () => { video.currentTime = v.maxVisto; video.play().catch(() => {}); avisoNormal(tipo); }
    });
  });

  // Con poca señal puede tardar: se avisa sin interrumpir la carga
  video.addEventListener("waiting", () => {
    clearTimeout(v.lento);
    v.lento = setTimeout(() => {
      if (el._video !== v) return;
      v.avisoLento = true;
      avisoProblema(tipo, "El video está tardando en cargar. Si tienes poca señal, espera un momento o intenta en un lugar con mejor señal.");
    }, 15000);
  });
  video.addEventListener("playing", () => {
    clearTimeout(v.lento);
    if (v.avisoLento){ v.avisoLento = false; avisoNormal(tipo); }
  });

  video.addEventListener("error", () => {
    if (el._video !== v) return; // error por haber quitado el video al cambiar de pantalla
    clearTimeout(v.lento);
    avisoProblema(tipo, "No se pudo cargar el video. Revisa tu conexión a internet o intenta en un lugar con mejor señal.", {
      texto: "Intentar de nuevo",
      accion: () => {
        const desde = v.maxVisto;
        avisoNormal(tipo);
        video.load();
        video.addEventListener("loadedmetadata", () => { video.currentTime = desde; }, { once: true });
        video.play().catch(() => {});
      }
    });
  });
}

// Recuadro sin video: archivo pendiente o que no es MP4 (no bloquea la pregunta)
function renderSinVideo(el, url, label){
  limpiarVideo(el);
  el.classList.remove("has-video");
  el.innerHTML = `
    <div class="play-circle" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" focusable="false">
        <path d="M8 5.5L18 12L8 18.5V5.5Z" fill="#014A28"/>
      </svg>
    </div>
    <p>${label}</p>
    <p class="small">${url ? "(el archivo no es un video MP4)" : "(pendiente por cargar)"}</p>
  `;
}

// Los videos de pantallas ocultas se detienen y se vacían, para que no sigan sonando de fondo
function refreshVideos(){
  document.querySelectorAll(".video-placeholder[data-video]").forEach(el => {
    if (el.closest("section").hidden){ limpiarVideo(el); el.innerHTML = ""; return; }
    const tipo = el.dataset.video === "pregunta" ? "pregunta" : el.dataset.video;
    const url = tipo === "pregunta" ? VIDEOS.preguntas[current] : VIDEOS[tipo];
    const nombre = tipo === "pregunta" ? `el video de la pregunta ${current + 1}`
      : tipo === "introduccion" ? "el video de introducción" : "el video de despedida";
    const label = tipo === "pregunta" ? `Espacio reservado para el video de la pregunta ${current + 1}` : el.dataset.videoLabel;
    const archivo = archivoVideo(url);
    avisoEspecial[tipo] = false;
    if (archivo) renderVideo(el, archivo, nombre, tipo);
    else renderSinVideo(el, url, label);
  });
}

// Screens
const welcomeCard = document.getElementById("welcomeCard");
const resumeCard = document.getElementById("resumeCard");
const registerCard = document.getElementById("registerCard");
const introCard = document.getElementById("introCard");
const progressRow = document.getElementById("progressRow");
const quizCard = document.getElementById("quizCard");
const outroCard = document.getElementById("outroCard");
const doneCard = document.getElementById("doneCard");

// Respaldo para navegadores anteriores a 2022 (Safari < 16, Chrome < 105), que no conocen la unidad cqw:
// se calcula --u (1% del ancho del diploma) en píxeles. En los actuales no se hace nada.
const SOPORTA_CQW = !!(window.CSS && CSS.supports && CSS.supports("width", "1cqw"));

function ajustarUnidadDiploma(){
  if (SOPORTA_CQW) return;
  document.querySelectorAll(".diploma-frame:not([data-pdf-stage])").forEach(frame => {
    if (frame.clientWidth) frame.style.setProperty("--u", (frame.clientWidth / 100) + "px");
  });
}
window.addEventListener("resize", ajustarUnidadDiploma); // también al girar el celular

// Lectores de pantalla (TalkBack, VoiceOver): al cambiar de pantalla se lleva el foco a su título
// para que lo anuncien. No se hace al abrir la página. En las preguntas lo hace renderQuestion,
// después de poner el texto de la pregunta nueva.
let esPantallaInicial = true;
function anunciarPantalla(seccion){
  if (esPantallaInicial){ esPantallaInicial = false; return; }
  const titulo = seccion && seccion !== quizCard ? seccion.querySelector("h2") : null;
  if (titulo) enfocarTitulo(titulo);
}
function enfocarTitulo(titulo){
  titulo.setAttribute("tabindex", "-1");
  titulo.focus({ preventScroll: true });
}

let pantallaActual = null;

// Fundido de entrada: se reinicia la animación cada vez que la pantalla aparece
function animarEntrada(el){
  if (!el || el.hidden) return;
  el.classList.remove("entrando");
  void el.offsetWidth; // fuerza a reiniciar la animación
  el.classList.add("entrando");
}

function showScreen(name){
  const anterior = pantallaActual;
  pantallaActual = name;
  welcomeCard.hidden = name !== "welcome";
  resumeCard.hidden = name !== "resume";
  registerCard.hidden = name !== "register";
  introCard.hidden = name !== "intro";
  progressRow.hidden = name !== "quiz";
  quizCard.hidden = name !== "quiz";
  outroCard.hidden = name !== "outro";
  doneCard.hidden = name !== "done";
  refreshVideos();
  actualizarBloqueo();
  ajustarUnidadDiploma(); // el diploma solo tiene ancho cuando su pantalla está visible
  anunciarPantalla({ welcome: welcomeCard, resume: resumeCard, register: registerCard, intro: introCard, quiz: quizCard, outro: outroCard, done: doneCard }[name]);
  if (name === "done") precargarPdf();
  if (anterior !== name){
    animarEntrada({ welcome: welcomeCard, resume: resumeCard, register: registerCard, intro: introCard, quiz: quizCard, outro: outroCard, done: doneCard }[name]);
    if (name === "quiz") animarEntrada(progressRow);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });

  if (["intro", "quiz", "outro", "done"].includes(name)){
    saveProgress(name);
  }
}

// 1. Registro
const fNombre = document.getElementById("fNombre");
const fDocumento = document.getElementById("fDocumento");
const fTelefono = document.getElementById("fTelefono");
const fCorreo = document.getElementById("fCorreo");
const fConsent = document.getElementById("fConsent");
const registerBtn = document.getElementById("registerBtn");

const hintNombre = document.getElementById("hintNombre");
const hintDocumento = document.getElementById("hintDocumento");
const hintTelefono = document.getElementById("hintTelefono");
const hintCorreo = document.getElementById("hintCorreo");

const touched = new Set();

// Solo permite dígitos mientras se escribe, con el límite correcto por campo
fDocumento.addEventListener("input", () => {
  fDocumento.value = fDocumento.value.replace(/\D/g, "").slice(0, 11);
});
// Solo dígitos, máximo 10. Si el celular autocompleta con el indicativo (+57 300 123 4567), se quita el 57.
fTelefono.addEventListener("input", () => {
  let d = fTelefono.value.replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("57")) d = d.slice(2);
  fTelefono.value = d.slice(0, 10);
});

// Un nombre no puede empezar por = + - @: en Excel o en un CSV se tomaría como fórmula
function limpiarNombre(v){ return v.replace(/^[\s=+\-@]+/, "").trim(); }
function isNombreValido(v){ const n = limpiarNombre(v).length; return n >= 3 && n <= 80; }
function isDocumentoValido(v){ return /^\d{3,11}$/.test(v.trim()); } // incluye cédulas antiguas
function isTelefonoValido(v){ return /^3\d{9}$/.test(v.trim()); }
function isCorreoValido(v){ return /^[^\s@=+\-][^\s@]*@[^\s@]+\.[^\s@]+$/.test(v.trim()); }

// Después de tocar "Comenzar" se marcan todos los campos que faltan, también los vacíos
let intentoRegistro = false;
const consentRow = document.getElementById("consentRow");
const hintConsent = document.getElementById("hintConsent");
const registerError = document.getElementById("registerError");

function paintField(input, hintEl, isValid, okMsg, errMsg){
  const show = !isValid && (intentoRegistro || (touched.has(input.id) && input.value.trim().length > 0));
  input.classList.toggle("invalid", show);
  input.setAttribute("aria-invalid", show ? "true" : "false");
  hintEl.classList.toggle("error", show);
  hintEl.textContent = show ? errMsg : okMsg;
}

// Resumen junto al botón con lo que falta, en palabras sencillas
function mostrarFaltantes(faltantes){
  registerError.hidden = !(intentoRegistro && faltantes.length);
  registerError.textContent = "";
  if (registerError.hidden) return;
  const titulo = document.createElement("p");
  titulo.textContent = "Para comenzar, falta:";
  const lista = document.createElement("ul");
  faltantes.forEach(f => {
    const li = document.createElement("li");
    li.textContent = f.texto;
    lista.appendChild(li);
  });
  registerError.append(titulo, lista);
}

function validateForm(){
  const nombreOk = isNombreValido(fNombre.value);
  const documentoOk = isDocumentoValido(fDocumento.value);
  const telefonoOk = isTelefonoValido(fTelefono.value);
  const correoOk = isCorreoValido(fCorreo.value);

  paintField(fNombre, hintNombre, nombreOk,
    "", "Escribe tu nombre completo.");
  paintField(fDocumento, hintDocumento, documentoOk,
    "Solo números, sin puntos: de 3 a 11 dígitos.", "Debe tener entre 3 y 11 números.");
  paintField(fTelefono, hintTelefono, telefonoOk,
    "10 dígitos y debe empezar por 3.", "Debe tener 10 dígitos y empezar por 3.");
  paintField(fCorreo, hintCorreo, correoOk,
    "Ej.: nombre@correo.com", "Escribe un correo válido.");

  const consentFalta = intentoRegistro && !fConsent.checked;
  consentRow.classList.toggle("invalid", consentFalta);
  fConsent.setAttribute("aria-invalid", consentFalta ? "true" : "false");
  hintConsent.hidden = !consentFalta;

  const vacio = el => !el.value.trim();
  const faltantes = [];
  if (!nombreOk) faltantes.push({ campo: fNombre, texto: "Escribir tu nombre completo" });
  if (!documentoOk) faltantes.push({ campo: fDocumento, texto: vacio(fDocumento) ? "Escribir tu número de documento" : "Revisar el número de documento (de 3 a 11 números)" });
  if (!telefonoOk) faltantes.push({ campo: fTelefono, texto: vacio(fTelefono) ? "Escribir tu número de celular" : "Revisar el celular (10 números, empieza por 3)" });
  if (!correoOk) faltantes.push({ campo: fCorreo, texto: vacio(fCorreo) ? "Escribir tu correo electrónico" : "Revisar el correo electrónico" });
  if (!fConsent.checked) faltantes.push({ campo: fConsent, texto: "Marcar la casilla de autorización de datos" });
  mostrarFaltantes(faltantes);
  return faltantes;
}

[fNombre, fDocumento, fTelefono, fCorreo].forEach(el => {
  el.addEventListener("input", validateForm);
  el.addEventListener("blur", () => { touched.add(el.id); validateForm(); });
});
fConsent.addEventListener("change", validateForm);


const fTipoDoc = document.getElementById("fTipoDoc");

registerBtn.addEventListener("click", () => {
  intentoRegistro = true;
  const faltantes = validateForm();
  if (faltantes.length){
    // Lleva a la persona al primer dato que falta; el resumen junto al botón dice qué falta
    const primero = faltantes[0].campo;
    primero.focus({ preventScroll: true });
    primero.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }
  participant = {
    nombre: limpiarNombre(fNombre.value),
    tipoDocumento: fTipoDoc.value,
    documento: fDocumento.value.trim(),
    telefono: fTelefono.value.trim(),
    correo: fCorreo.value.trim().toLowerCase(),
    fechaRegistro: new Date().toISOString()
  };
  revisarRegistroExistente();
});

// ¿Este documento ya se registró? Si la hoja responde que sí (y el celular coincide), se ofrece
// continuar o ver el certificado en vez de registrarlo de nuevo. Sin internet o si tarda, se sigue normal:
// la hoja de todas formas nunca crea dos filas para el mismo documento.
const ESPERA_CONSULTA_MS = 6000;
const registroExistente = document.getElementById("registroExistente");
const existenteBtn = document.getElementById("existenteBtn");
let accionExistente = null;

async function consultarRegistro(p){
  if (!REGISTRO_URL || navigator.onLine === false) return null;
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const limite = setTimeout(() => ctrl && ctrl.abort(), ESPERA_CONSULTA_MS);
  try{
    const resp = await fetch(REGISTRO_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        tipo: "consulta", nombre: p.nombre, tipoDocumento: p.tipoDocumento, documento: p.documento,
        telefono: p.telefono, correo: p.correo, consentimiento: true,
        web: document.getElementById("fWeb").value
      }),
      signal: ctrl ? ctrl.signal : undefined
    });
    const r = await resp.json();
    return r && r.ok ? r : null;
  } catch(e){
    return null; // sin respuesta: se sigue como registro nuevo
  } finally {
    clearTimeout(limite);
  }
}

function mostrarExistente(titulo, texto, boton, accion){
  document.getElementById("existenteTitulo").textContent = titulo;
  document.getElementById("existenteTexto").textContent = texto;
  existenteBtn.hidden = !boton;
  existenteBtn.textContent = boton || "";
  accionExistente = accion || null;
  registroExistente.hidden = false;
  registroExistente.scrollIntoView({ block: "center", behavior: "smooth" });
  document.getElementById("existenteTitulo").focus({ preventScroll: true });
}

function empezarCurso(){
  showScreen("intro");
  registrarEnvio("registro");
}

async function revisarRegistroExistente(){
  registroExistente.hidden = true;
  const textoBoton = registerBtn.textContent;
  registerBtn.disabled = true;
  registerBtn.textContent = "Revisando tus datos…";
  let r;
  try{
    r = await consultarRegistro(participant);
  } finally {
    registerBtn.disabled = false;
    registerBtn.textContent = textoBoton;
  }
  if (!r || r.estado === "nuevo") return empezarCurso();

  if (r.estado === "otros-datos"){
    return mostrarExistente(
      "Este documento ya está registrado",
      "Se registró con otro número de celular. Si es tu documento, escribe el mismo celular que usaste la primera vez."
    );
  }
  // Ya existe y el celular coincide: se usa el nombre con el que se registró
  if (r.nombre) participant.nombre = r.nombre;
  if (r.estado === "Terminado" && r.fechaFin){
    mostrarExistente(
      "Ya terminaste este curso",
      `${participant.nombre}, ya completaste la capacitación con este documento. Puedes ver y descargar tu certificado.`,
      "Ver mi certificado →",
      () => { participant.fechaFin = r.fechaFin; setDoneTitle(); showScreen("done"); }
    );
  } else {
    mostrarExistente(
      "Ya te habías registrado",
      `${participant.nombre}, ya tienes un registro con este documento. Puedes continuar el curso sin registrarte de nuevo.`,
      "Continuar el curso →",
      () => showScreen("intro")
    );
  }
}

existenteBtn.addEventListener("click", () => { if (accionExistente) accionExistente(); });
// Si cambian el documento o el celular, el aviso anterior ya no aplica
[fDocumento, fTelefono, fTipoDoc].forEach(el => el.addEventListener("input", () => { registroExistente.hidden = true; }));

// 2. Video introducción
document.getElementById("introBtn").addEventListener("click", () => {
  if (videoPendiente("introduccion")) return;
  current = 0;
  showScreen("quiz");
  renderQuestion();
});

// 3. Preguntas
const progressTrack = document.getElementById("progressTrack");
const progressLabel = document.getElementById("progressLabel");
const progressPercent = document.getElementById("progressPercent");
const questionText = document.getElementById("questionText");
const optionsList = document.getElementById("optionsList");
const feedback = document.getElementById("feedback");
const nextBtn = document.getElementById("nextBtn");

function renderProgress(){
  progressTrack.innerHTML = "";
  questions.forEach((_, i) => {
    const seg = document.createElement("span");
    seg.className = "segment" + (i < current ? " done" : "") + (i === current ? " active" : "");
    progressTrack.appendChild(seg);
  });
  progressLabel.textContent = `Pregunta ${current + 1} de ${questions.length}`;
  progressPercent.textContent = `${Math.round((current / questions.length) * 100)}% completado`;
}

function renderQuestion(){
  solved = false;
  feedback.textContent = "";
  feedback.className = "feedback";
  nextBtn.disabled = true;

  renderProgress();
  refreshVideos();

  const q = questions[current];
  questionText.textContent = q.text;
  enfocarTitulo(questionText); // anuncia la pregunta nueva

  optionsList.innerHTML = "";
  q.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "option";
    btn.innerHTML = `<span class="badge">${letters[i]}</span><span>${opt.text}</span>`;
    btn.addEventListener("click", () => selectOption(btn, opt));
    optionsList.appendChild(btn);
  });
  actualizarBloqueo(); // opciones bloqueadas hasta ver el video completo
}

function selectOption(btn, opt){
  if (solved || videoPendiente("pregunta")) return;

  if (opt.correct){
    solved = true;
    btn.classList.add("correct");
    feedback.textContent = questions[current].explicacion || "¡Correcto! Puedes continuar.";
    feedback.className = "feedback ok";
    nextBtn.disabled = false;
    [...optionsList.children].forEach(b => b.disabled = true);
  } else {
    btn.classList.add("wrong");
    feedback.textContent = "Esa no es la respuesta correcta. Vuelve a intentarlo.";
    feedback.className = "feedback no";
  }
}

nextBtn.addEventListener("click", () => {
  if (!solved) return;
  current++;
  if (current < questions.length){
    saveProgress("quiz");
    renderQuestion();
    animarEntrada(quizCard);
  } else {
    showScreen("outro");
  }
});


// ===== Datos del certificado — completar cuando estén confirmados =====
// Deja en null lo que aún no esté definido: aparece resaltado en el boceto.
const CERT = {
  curso: "Importancia de la incidencia en el Páramo de Santurbán", // Nombre oficial del curso
  firmante: null,       // Nombre de quien firma
  cargoFirmante: null,  // Cargo de quien firma
  programa: "Programa de Gestión Integral del Recurso Hídrico",
  ciudad: "Bucaramanga"
};
const CERT_PENDIENTE = {
  curso: "[Nombre oficial del curso]",
  firmante: "[Nombre de quien firma]",
  cargoFirmante: "[Cargo]"
};

function setCertField(el, key){
  const val = CERT[key];
  el.textContent = val || CERT_PENDIENTE[key];
  el.classList.toggle("pending", !val);
}

function formatDocumento(num){
  return String(num || "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Fecha en que terminó (guardada), para que el certificado no cambie si lo abren otro día
function fechaFin(p){
  return p.fechaFin ? new Date(p.fechaFin) : new Date();
}

function certCode(p){
  // Código corto y estable a partir del documento + fecha (para identificar el certificado)
  const fin = fechaFin(p);
  const base = `${p.tipoDocumento}${p.documento}${fin.toISOString().slice(0,10)}`;
  let h = 0;
  for (const ch of base){ h = (h * 31 + ch.charCodeAt(0)) >>> 0; }
  return `PGIRH-${fin.getFullYear()}-${h.toString(36).toUpperCase().slice(0,6).padStart(6,"0")}`;
}

function renderDiploma(){
  const logo = document.querySelector(".logo-badge img");
  // El logo del certificado se crea aquí, copiando el del encabezado (así no se repite la imagen en el HTML)
  if (logo && !document.getElementById("diplomaLogo")){
    const dipLogo = document.createElement("img");
    dipLogo.className = "diploma-logo";
    dipLogo.id = "diplomaLogo";
    dipLogo.alt = "Alcaldía de Bucaramanga — Secretaría de Salud y Ambiente";
    dipLogo.src = logo.src;
    document.querySelector(".diploma-logo-card").appendChild(dipLogo);
  }

  document.getElementById("dipName").textContent = participant.nombre || "Nombre del participante";
  const tipo = participant.tipoDocumento === "TI" ? "T.I." : "C.C.";
  document.getElementById("dipDoc").textContent =
    `identificado(a) con ${tipo} ${formatDocumento(participant.documento) || "0.000.000.000"}`;

  setCertField(document.getElementById("dipCourse"), "curso");
  setCertField(document.getElementById("dipSigner"), "firmante");
  setCertField(document.getElementById("dipSignerRole"), "cargoFirmante");
  document.getElementById("dipProgram").textContent = CERT.programa;

  const fecha = fechaFin(participant).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });
  document.getElementById("dipDate").textContent = `${CERT.ciudad}, ${fecha}`;
  document.getElementById("dipCode").textContent = certCode(participant);

  const faltan = [];
  if (!CERT.curso) faltan.push("nombre oficial del curso");
  if (!CERT.firmante || !CERT.cargoFirmante) faltan.push("nombre y cargo de quien firma");
  const note = document.getElementById("draftNote");
  note.hidden = faltan.length === 0;
  note.textContent = `Boceto: falta confirmar ${faltan.join(" y ")} (resaltado en amarillo).`;
}

// 4. Video despedida
function setDoneTitle(){
  const doneTitle = document.getElementById("doneTitle");
  doneTitle.textContent = participant.nombre
    ? `¡Felicidades, ${participant.nombre}!`
    : "¡Completaste la capacitación!";
  renderDiploma();
}

document.getElementById("outroBtn").addEventListener("click", () => {
  if (videoPendiente("despedida")) return;
  participant.fechaFin = new Date().toISOString();
  setDoneTitle();
  showScreen("done"); // queda guardado: al volver a abrir el enlace ve su certificado
  registrarEnvio("fin");
});

// Borra de este celular los datos y el progreso de la persona actual.
// No toca la cola de envíos a la hoja (COLA_KEY): lo pendiente se sigue enviando.
function borrarDatosDelCelular(){
  intentoRegistro = false;
  vistos = new Set();
  current = 0;
  participant = { nombre: "", tipoDocumento: "", documento: "", telefono: "", correo: "" };
  pendingResumeScreen = null;
  fNombre.value = ""; fDocumento.value = ""; fTelefono.value = ""; fCorreo.value = "";
  fTipoDoc.value = "CC";
  fConsent.checked = false;
  touched.clear();
  clearProgress();
  validateForm();
}

// 5. Reiniciar demo

// 0. Retomar progreso guardado
document.getElementById("resumeContinueBtn").addEventListener("click", () => {
  const target = pendingResumeScreen || "intro";
  showScreen(target);
  if (target === "quiz") renderQuestion();
  if (target === "done") setDoneTitle();
});


// 6. Descargar certificado en PDF (carta horizontal)
// Las librerías se cargan solo al tocar el botón, para no gastar datos al abrir la página.
const PDF_LIBS = [
  { src: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
    integrity: "sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H" },
  { src: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js",
    integrity: "sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3" }
];
const PDF_ANCHO_PX = 1100; // ancho al que se dibuja el diploma: igual en celular y computador
const PDF_MARGEN_MM = 8;   // margen blanco para que la impresora no corte el borde

const downloadBtn = document.getElementById("downloadBtn");
const downloadStatus = document.getElementById("downloadStatus");
let pdfLibsPromise = null;

function loadScript({ src, integrity }){
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.integrity = integrity;
    s.crossOrigin = "anonymous";
    s.onload = resolve;
    s.onerror = () => reject(new Error("No se pudo cargar " + src));
    document.head.appendChild(s);
  });
}

function loadPdfLibs(){
  if (!pdfLibsPromise){
    pdfLibsPromise = Promise.all(PDF_LIBS.map(loadScript))
      .catch(err => { pdfLibsPromise = null; throw err; });
  }
  return pdfLibsPromise;
}

// El certificado se puede descargar desde el botón principal o desde la confirmación de "Soy otra persona";
// el mensaje aparece junto al botón que se tocó
const otherDownloadBtn = document.querySelector("#doneOtherPanel [data-otra-descargar]");
const otherDownloadStatus = document.querySelector("#doneOtherPanel [data-otra-estado]");

// Con poca señal, las librerías del PDF (unos 180 KB) empiezan a bajar apenas aparece el certificado,
// cuando el celular está desocupado, para que al tocar "Descargar" el PDF salga casi de inmediato.
// Si fallan, se vuelven a pedir al tocar el botón.
function precargarPdf(){
  const iniciar = () => loadPdfLibs().catch(() => {});
  if ("requestIdleCallback" in window) requestIdleCallback(iniciar, { timeout: 3000 });
  else setTimeout(iniciar, 1500);
}

function setDownloadStatus(text, isError, statusEl = downloadStatus){
  statusEl.textContent = text;
  statusEl.classList.toggle("error", !!isError);
}

async function svgToPng(svg){
  const [, , vbW, vbH] = svg.getAttribute("viewBox").split(/\s+/).map(Number);
  const xml = new XMLSerializer().serializeToString(svg);
  const source = new Image();
  source.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
  await source.decode();
  const escala = 2400 / Math.max(vbW, vbH); // resolución suficiente para imprimir (el PDF se dibuja a 2200 px)
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vbW * escala);
  canvas.height = Math.round(vbH * escala);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  const img = document.createElement("img");
  img.className = svg.getAttribute("class");
  img.src = canvas.toDataURL("image/png");
  await img.decode();
  svg.replaceWith(img);
}

async function diplomaToCanvas(){
  if (document.fonts) await document.fonts.ready;
  // Copia del diploma a un ancho fijo y oculta; solo se hace visible en la captura
  const stage = document.createElement("div");
  stage.className = "diploma-frame";
  stage.dataset.pdfStage = "";
  stage.style.cssText = `position:fixed;left:0;top:0;width:${PDF_ANCHO_PX}px;margin:0;visibility:hidden;pointer-events:none;`;
  if (!SOPORTA_CQW) stage.style.setProperty("--u", (PDF_ANCHO_PX / 100) + "px");
  const copy = document.getElementById("diploma").cloneNode(true);
  copy.style.boxShadow = "none";
  // html2canvas no dibuja los SVG (ni incrustados ni como imagen): el paisaje de la franja
  // se convierte a PNG antes de la captura, y antes de quitar los id (el SVG los usa por dentro)
  await Promise.all([...copy.querySelectorAll("svg")].map(svgToPng));
  copy.removeAttribute("id");
  copy.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
  stage.appendChild(copy);
  document.body.appendChild(stage);
  try{
    return await html2canvas(copy, {
      scale: 2,
      backgroundColor: "#FFFDF7",
      logging: false,
      scrollX: 0,
      scrollY: 0,
      onclone: doc => { doc.querySelector("[data-pdf-stage]").style.visibility = "visible"; }
    });
  } finally {
    stage.remove();
  }
}

function pdfFileName(){
  const nombre = (participant.nombre || "participante")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `Certificado-${nombre || "participante"}.pdf`;
}

async function descargarCertificado(statusEl){
  downloadBtn.disabled = true;
  otherDownloadBtn.disabled = true;
  setDownloadStatus("Preparando tu certificado…", false, statusEl);
  try{
    await loadPdfLibs();
    const canvas = await diplomaToCanvas();
    const pdf = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const w = pageW - PDF_MARGEN_MM * 2;
    const h = w * canvas.height / canvas.width;
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", PDF_MARGEN_MM, (pageH - h) / 2, w, h);
    pdf.setProperties({
      title: `Certificado — ${participant.nombre || "Participante"}`,
      subject: CERT.programa,
      author: "Alcaldía de Bucaramanga"
    });
    pdf.save(pdfFileName());
    setDownloadStatus("Listo. Busca el PDF en las descargas de tu celular.", false, statusEl);
  } catch(err){
    console.error(err);
    setDownloadStatus("No se pudo generar el PDF. Revisa tu conexión a internet e inténtalo de nuevo.", true, statusEl);
  } finally {
    downloadBtn.disabled = false;
    otherDownloadBtn.disabled = false;
  }
}

downloadBtn.addEventListener("click", () => descargarCertificado(downloadStatus));
otherDownloadBtn.addEventListener("click", () => descargarCertificado(otherDownloadStatus));

// 7. Envío de registros a la hoja de Google (REGISTRO_URL)
// Cada envío se guarda en una cola en este celular y solo se borra cuando la hoja lo confirma.
// Si no hay internet o algo falla, la persona sigue el curso normalmente y se reintenta después:
// cada vez más espaciado mientras la página esté abierta, al volver la conexión y al abrir de nuevo el enlace.
const COLA_KEY = "capacitacion_agua_envios_v1"; // aparte del progreso: "Reiniciar" no la borra
let colaEnMemoria = [];   // respaldo si el navegador no deja guardar (modo privado)
let enviando = false;
let reintentoTimer = null;
let esperaReintento = 0;

function leerCola(){
  try{
    const raw = localStorage.getItem(COLA_KEY);
    return raw ? JSON.parse(raw) : colaEnMemoria.slice();
  } catch(e){ return colaEnMemoria.slice(); }
}

function guardarCola(cola){
  colaEnMemoria = cola.slice();
  try{
    if (cola.length) localStorage.setItem(COLA_KEY, JSON.stringify(cola));
    else localStorage.removeItem(COLA_KEY);
  } catch(e){ /* sin almacenamiento: queda solo en memoria */ }
}

function registrarEnvio(tipo){
  if (!REGISTRO_URL) return; // sin hoja configurada no se guarda nada para enviar
  const p = participant;
  const envio = {
    tipo,
    nombre: p.nombre,
    tipoDocumento: p.tipoDocumento,
    documento: p.documento,
    telefono: p.telefono,
    correo: p.correo,
    consentimiento: true,
    fechaRegistro: p.fechaRegistro || null,
    web: document.getElementById("fWeb").value // campo trampa: vacío para las personas
  };
  if (tipo === "fin"){
    envio.fechaFin = p.fechaFin;
    envio.codigo = certCode(p);
  }
  const cola = leerCola();
  cola.push(envio);
  guardarCola(cola);
  enviarPendientes();
}

// "ok": la hoja lo guardó · "rechazado": datos inválidos, no sirve reintentar · "reintentar": falla temporal
async function enviarUno(envio){
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const limite = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
  try{
    // text/plain evita la consulta previa (CORS) que Apps Script no responde
    const resp = await fetch(REGISTRO_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(envio),
      signal: ctrl ? ctrl.signal : undefined
    });
    const r = await resp.json();
    if (r.ok) return "ok";
    console.warn("La hoja no aceptó el envío:", r.error);
    return r.reintentar ? "reintentar" : "rechazado";
  } catch(e){
    return "reintentar"; // sin internet, tiempo agotado o respuesta ilegible
  } finally {
    if (limite) clearTimeout(limite);
  }
}

async function enviarPendientes(){
  if (!REGISTRO_URL || enviando) return;
  enviando = true;
  clearTimeout(reintentoTimer);
  reintentoTimer = null;
  try{
    while (leerCola().length){
      const resultado = await enviarUno(leerCola()[0]);
      if (resultado === "reintentar"){
        esperaReintento = Math.min(Math.max(esperaReintento * 2, 30000), 5 * 60000);
        reintentoTimer = setTimeout(enviarPendientes, esperaReintento);
        return;
      }
      const cola = leerCola();
      cola.shift(); // los nuevos envíos solo se agregan al final
      guardarCola(cola);
      esperaReintento = 0;
    }
  } finally {
    enviando = false;
  }
}

window.addEventListener("online", enviarPendientes);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") enviarPendientes();
});
enviarPendientes(); // lo que haya quedado pendiente de una visita anterior

// 8. "Soy otra persona": para celulares que usan varias personas.
// Pide confirmación, intenta enviar a la hoja lo pendiente y borra de este celular los datos
// y el progreso de la persona anterior. No borra nada de la hoja.
const ESPERA_ENVIO_MAX_MS = 6000;

// Si no se alcanza a enviar (sin internet), la cola se conserva y se envía en la próxima oportunidad:
// cada envío lleva sus propios datos, así que no depende de lo que se borra.
async function enviarAntesDeBorrar(){
  if (!REGISTRO_URL || !leerCola().length) return;
  await Promise.race([enviarPendientes(), new Promise(r => setTimeout(r, ESPERA_ENVIO_MAX_MS))]);
}

function prepararOtraPersona(botonId, panelId, textoAviso){
  const boton = document.getElementById(botonId);
  const panel = document.getElementById(panelId);
  const confirmar = panel.querySelector("[data-otra-confirmar]");
  const cerrar = () => { panel.hidden = true; boton.hidden = false; };

  boton.addEventListener("click", () => {
    panel.querySelector("[data-otra-texto]").textContent = textoAviso();
    const estado = panel.querySelector("[data-otra-estado]");
    if (estado) setDownloadStatus("", false, estado);
    boton.hidden = true;
    panel.hidden = false;
    panel.querySelector(".confirm-title").focus({ preventScroll: true });
    panel.scrollIntoView({ block: "center", behavior: "smooth" });
  });

  panel.querySelector("[data-otra-cancelar]").addEventListener("click", () => {
    cerrar();
    boton.focus();
  });

  confirmar.addEventListener("click", async () => {
    confirmar.disabled = true;
    confirmar.textContent = "Un momento…";
    try{
      await enviarAntesDeBorrar();
    } finally {
      borrarDatosDelCelular();
      setDownloadStatus("");
      cerrar();
      confirmar.disabled = false;
      confirmar.textContent = "Sí, empezar de nuevo";
      showScreen("welcome");
    }
  });
}

const nombreAnterior = () => participant.nombre || "la persona anterior";
prepararOtraPersona("doneOtherBtn", "doneOtherPanel", () =>
  `Se borrarán de este celular los datos y el certificado de ${nombreAnterior()}. ` +
  "Si todavía no lo descargaste, hazlo antes: después ya no se podrá ver en este celular.");
prepararOtraPersona("resumeOtherBtn", "resumeOtherPanel", () =>
  `Se borrará de este celular el avance de ${nombreAnterior()}. ` +
  "Si esa persona quiere terminar después, tendrá que empezar de nuevo.");

document.getElementById("welcomeBtn").addEventListener("click", () => showScreen("register"));

const saved = loadProgress();
if (saved && Array.isArray(saved.vistos)) vistos = new Set(saved.vistos); // videos ya vistos completos
if (saved && saved.screen === "done" && saved.participant){
  // Ya terminó en este celular: mostrar directamente su certificado
  participant = saved.participant;
  setDoneTitle();
  showScreen("done");
} else if (saved && saved.screen && ["intro", "quiz", "outro"].includes(saved.screen)){
  participant = saved.participant || participant;
  current = typeof saved.current === "number" ? saved.current : 0;
  pendingResumeScreen = saved.screen;
  showScreen("resume");
} else {
  showScreen("welcome");
}
