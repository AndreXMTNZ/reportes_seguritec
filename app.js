import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import {
  getDatabase,
  ref as dbRef,
  onValue,
  set,
  remove
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
const money = (value) => new Intl.NumberFormat("es-SV", { style: "currency", currency: "USD" }).format(Number(value) || 0);
const today = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
};
const niceDate = (value) => {
  if (!value) return "—";
  const parts = String(value).split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
};
const idGen = () => `VT-${today().replaceAll("-", "")}-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
const MAX_PHOTOS = 10;
const MAX_DOCUMENTS = 8;
const MAX_DOC_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_DOC_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "jpg", "jpeg", "png", "txt"]);
const MIME_BY_EXT = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", txt: "text/plain"
};
const FIELD_IDS = [
  "client", "project", "location", "technician", "date", "hours", "type", "statusField",
  "receiverName", "receiverRole", "work", "observations", "recommendations", "nextVisit", "labor"
];

let currentUser = null;
let visits = [];
let currentId = null;
let photos = [];
let documents = [];
let stopVisitsListener = null;
let stopConnectionListener = null;
let toastTimer = null;

function notify(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
}

function firebaseErrorMessage(error) {
  const code = error?.code || "";
  const messages = {
    "auth/operation-not-allowed": "Habilita el método Anónimo en Firebase Authentication → Sign-in method.",
    "auth/too-many-requests": "Firebase limitó temporalmente el acceso. Prueba más tarde.",
    "auth/network-request-failed": "No hay conexión. Verifica tu internet.",
    "auth/unauthorized-domain": "Este dominio no está autorizado en Firebase Authentication.",
    "database/permission-denied": "Firebase Realtime Database rechazó el acceso. Revisa las reglas y el acceso anónimo.",
    "storage/unauthorized": "Firebase Storage rechazó el archivo. Revisa sus reglas y confirma que el método Anónimo esté habilitado.",
    "storage/quota-exceeded": "Se alcanzó la cuota de almacenamiento disponible.",
    "storage/unknown": "No se pudo completar la operación de almacenamiento. Revisa la configuración de Storage y facturación."
  };
  return messages[code] || error?.message || "Ocurrió un error inesperado.";
}

function stopRealtimeListeners() {
  if (typeof stopVisitsListener === "function") stopVisitsListener();
  if (typeof stopConnectionListener === "function") stopConnectionListener();
  stopVisitsListener = null;
  stopConnectionListener = null;
}

function startRealtimeListeners() {
  stopRealtimeListeners();
  stopVisitsListener = onValue(dbRef(db, "visits"), (snapshot) => {
    const data = snapshot.val() || {};
    visits = Object.entries(data).map(([key, value]) => ({ ...value, id: value.id || key }))
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    renderHistory();
    $("#saveStatus").textContent = "Los registros están sincronizados con Firebase Realtime Database.";
  }, (error) => {
    console.error(error);
    notify(firebaseErrorMessage(error), true);
  });

  stopConnectionListener = onValue(dbRef(db, ".info/connected"), (snapshot) => {
    const connected = snapshot.val() === true;
    $("#connectionLabel").textContent = connected ? "Conectado" : "Sin conexión";
    $(".connection .status-dot").style.background = connected ? "#32c48d" : "#e6a23c";
  });
}

// Firebase Auth anónimo funciona sin formulario ni contraseña.
// Permite aplicar reglas que requieran auth != null, pero NO restringe el acceso
// a técnicos autorizados: cualquier visitante puede obtener una sesión anónima.
let anonymousAttempted = false;
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    $("#connectionLabel").textContent = "Conectando...";
    startRealtimeListeners();
  } else if (!anonymousAttempted) {
    anonymousAttempted = true;
    try {
      await signInAnonymously(auth);
    } catch (error) {
      console.error(error);
      $("#connectionLabel").textContent = "Sin acceso a Firebase";
      $("#saveStatus").textContent = firebaseErrorMessage(error);
      notify(firebaseErrorMessage(error), true);
    }
  }
});

const defaultItem = () => ({ equip: "", activity: "", qty: "1", unit: "equipo", price: "" });

function appendItem(data = defaultItem()) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input class="equip" aria-label="Equipo o sistema" placeholder="Ej. bomba 1" value="${esc(data.equip)}"></td>
    <td><input class="activity" aria-label="Actividad" placeholder="Ej. medición de presión" value="${esc(data.activity)}"></td>
    <td><input class="qty" type="number" min="0" step="0.01" aria-label="Cantidad" value="${esc(data.qty)}"></td>
    <td><select class="unit" aria-label="Unidad">${["equipo", "unidad", "servicio", "filtro", "metro", "litro", "hora", "otro"].map((unit) => `<option value="${unit}" ${unit === data.unit ? "selected" : ""}>${unit}</option>`).join("")}</select></td>
    <td><input class="price" type="number" min="0" step="0.01" aria-label="Precio unitario" placeholder="0.00" value="${esc(data.price)}"></td>
    <td><button class="xbtn" type="button" aria-label="Quitar fila">×</button></td>`;
  row.querySelectorAll("input,select").forEach((input) => input.addEventListener("input", updateTotal));
  row.querySelector(".xbtn").addEventListener("click", () => {
    row.remove();
    if (!$("#itemsBody").children.length) appendItem();
    updateTotal();
  });
  $("#itemsBody").appendChild(row);
}

function readItems() {
  return Array.from($("#itemsBody").children).map((row) => ({
    equip: row.querySelector(".equip").value.trim(),
    activity: row.querySelector(".activity").value.trim(),
    qty: row.querySelector(".qty").value,
    unit: row.querySelector(".unit").value,
    price: row.querySelector(".price").value
  }));
}

function updateTotal() {
  const subtotal = readItems().reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.price) || 0), 0);
  const labor = Number($("#labor").value) || 0;
  $("#totalPrice").textContent = money(subtotal + labor);
}

function releasePreviewUrls() {
  [...photos, ...documents].forEach((item) => {
    if (item.previewUrl && item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
  });
}

function clearForm() {
  releasePreviewUrls();
  currentId = null;
  $("#visitForm").reset();
  FIELD_IDS.forEach((id) => {
    if (["type", "statusField"].includes(id)) return;
    $("#" + id).value = "";
  });
  $("#date").value = today();
  $("#itemsBody").innerHTML = "";
  appendItem();
  photos = [];
  documents = [];
  renderPhotos();
  renderDocuments();
  $("#formTitle").textContent = "Nueva visita de mantenimiento";
  $("#formSubtitle").textContent = "Completa la información del servicio";
  $("#saveBtn").textContent = "Guardar visita";
  $("#saveStatus").textContent = "";
  updateTotal();
}

function collect() {
  const visit = {};
  FIELD_IDS.forEach((id) => visit[id] = $("#" + id).value.trim());
  visit.includeCosts = $("#includeCosts").checked;
  visit.items = readItems().filter((item) => item.equip || item.activity);
  visit.photos = photos.map((photo) => ({ ...photo }));
  visit.documents = documents.map((doc) => ({ ...doc }));
  if (!currentId) currentId = idGen();
  visit.id = currentId;
  visit.updatedAt = new Date().toISOString();
  const old = visits.find((item) => item.id === currentId);
  visit.createdAt = old?.createdAt || visit.updatedAt;
  // Sin cuentas personales: no se registra correo de usuario.
  visit.createdBy = old?.createdBy || "app-sin-login";
  visit.updatedBy = "app-sin-login";
  return visit;
}

function validate(visit) {
  if (!visit.client || !visit.project || !visit.technician || !visit.date || !visit.work) {
    notify("Completa cliente, proyecto, técnico, fecha y trabajo realizado.", true);
    $("#visitForm").reportValidity();
    return false;
  }
  if (!visit.items.length || visit.items.some((item) => !item.equip)) {
    notify("Agrega el nombre de cada equipo o sistema revisado.", true);
    return false;
  }
  return true;
}

function loadVisit(visit) {
  releasePreviewUrls();
  currentId = visit.id;
  FIELD_IDS.forEach((id) => {
    $("#" + id).value = visit[id] ?? (id === "receiverName" ? visit.contact ?? "" : "");
  });
  $("#includeCosts").checked = !!visit.includeCosts;
  $("#itemsBody").innerHTML = "";
  (visit.items?.length ? visit.items : [defaultItem()]).forEach(appendItem);
  photos = (visit.photos || []).map((item) => ({ ...item }));
  documents = (visit.documents || []).map((item) => ({ ...item }));
  renderPhotos();
  renderDocuments();
  updateTotal();
  $("#formTitle").textContent = "Editar visita";
  $("#formSubtitle").textContent = `Reporte ${visit.id} · ${niceDate(visit.date)}`;
  $("#saveBtn").textContent = "Actualizar visita";
  $("#saveStatus").textContent = "Editando un registro sincronizado con Firebase.";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function statusLabel(status) {
  if (status === "pendiente") return "Pendiente";
  if (status === "proceso") return "En proceso";
  return "Finalizada";
}

function renderHistory() {
  const query = $("#search").value.toLowerCase().trim();
  const filtered = visits.filter((visit) => [visit.client, visit.project, visit.technician, visit.id, visit.receiverName].join(" ").toLowerCase().includes(query));
  $("#totalStat").textContent = visits.length;
  $("#pendingStat").textContent = visits.filter((visit) => visit.statusField === "pendiente").length;
  const holder = $("#history");
  holder.innerHTML = "";
  if (!filtered.length) {
    holder.innerHTML = `<div class="side-empty"><b>${query ? "Sin coincidencias" : "Aún no hay visitas registradas"}</b>${query ? "Prueba otra búsqueda." : "Guarda tu primera visita para crear el historial."}</div>`;
    return;
  }
  filtered.forEach((visit) => {
    const element = document.createElement("article");
    element.className = "visit";
    const statusClass = visit.statusField === "pendiente" ? "pending" : visit.statusField === "proceso" ? "progress" : "";
    element.innerHTML = `
      <div class="meta">${esc(niceDate(visit.date))}<span>·</span><span>${esc(visit.id)}</span></div>
      <h4>${esc(visit.project || "Proyecto sin nombre")}</h4>
      <div class="meta">${esc(visit.client || "Cliente no indicado")} · ${esc(visit.technician || "Sin técnico")}</div>
      <div class="desc"><span class="pill ${statusClass}">${statusLabel(visit.statusField)}</span> &nbsp; ${visit.items?.length || 0} revisiones · ${visit.photos?.length || 0} fotos · ${visit.documents?.length || 0} adjuntos</div>
      <div class="visit-actions"><button type="button" class="mini-btn edit">Abrir</button><button type="button" class="mini-btn print">PDF</button><button type="button" class="mini-btn danger del">Eliminar</button></div>`;
    element.querySelector(".edit").addEventListener("click", () => loadVisit(visit));
    element.querySelector(".print").addEventListener("click", () => generateReport(visit));
    element.querySelector(".del").addEventListener("click", () => deleteVisit(visit));
    holder.appendChild(element);
  });
}

function fileSize(bytes) {
  return bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(2)} MB`;
}

function renderPhotos() {
  const holder = $("#photoGrid");
  holder.innerHTML = "";
  $("#photoCount").textContent = `${photos.length} de ${MAX_PHOTOS} fotos`;
  if (!photos.length) {
    holder.innerHTML = '<div class="empty-photo">Sin fotografías. Puedes tomarlas directamente con la cámara.</div>';
    return;
  }
  photos.forEach((photo, index) => {
    const source = photo.previewUrl || photo.url || photo.data || "";
    const card = document.createElement("div");
    card.className = "photo-card";
    card.innerHTML = `<img alt="Evidencia fotográfica ${index + 1}" src="${esc(source)}"><button type="button" aria-label="Quitar fotografía">×</button><input aria-label="Descripción de fotografía ${index + 1}" placeholder="Descripción de la foto" value="${esc(photo.caption || "")}">`;
    card.querySelector("input").addEventListener("input", (event) => photos[index].caption = event.target.value);
    card.querySelector("button").addEventListener("click", () => {
      if (photo.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(photo.previewUrl);
      photos.splice(index, 1);
      renderPhotos();
    });
    holder.appendChild(card);
  });
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const sourceUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const maxDimension = 1600;
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d", { alpha: false }).drawImage(image, 0, 0, width, height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(sourceUrl);
          if (blob) resolve(blob);
          else reject(new Error("No se pudo optimizar la fotografía."));
        }, "image/jpeg", 0.78);
      } catch (error) {
        URL.revokeObjectURL(sourceUrl);
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      reject(new Error("No se pudo leer la fotografía."));
    };
    image.src = sourceUrl;
  });
}

async function addPhotos(files) {
  let added = 0;
  for (const file of files) {
    if (photos.length >= MAX_PHOTOS) {
      notify(`El límite es de ${MAX_PHOTOS} fotografías por visita.`, true);
      break;
    }
    if (!file.type.startsWith("image/")) continue;
    try {
      const blob = await compressImage(file);
      const previewUrl = URL.createObjectURL(blob);
      photos.push({ name: file.name, size: blob.size, mime: "image/jpeg", file: blob, previewUrl, caption: "" });
      added++;
    } catch (error) {
      console.error(error);
      notify(`No se pudo cargar ${file.name}.`, true);
    }
  }
  renderPhotos();
  if (added) notify(`${added} fotografía(s) agregada(s). Guarda la visita para subirlas a la nube.`);
}

function renderDocuments() {
  const holder = $("#documentList");
  holder.innerHTML = "";
  $("#documentCount").textContent = `${documents.length} de ${MAX_DOCUMENTS} archivos`;
  if (!documents.length) {
    holder.innerHTML = '<div class="empty-photo">Sin documentos adjuntos. Puedes agregar una cotización o reporte complementario.</div>';
    return;
  }
  documents.forEach((doc, index) => {
    const extension = (doc.name?.split(".").pop() || "FILE").toUpperCase();
    const element = document.createElement("div");
    element.className = "document-item";
    element.innerHTML = `<span class="document-icon">${esc(extension.slice(0, 5))}</span><div class="document-details"><strong>${esc(doc.name)}</strong><small>${fileSize(doc.size || 0)} · ${doc.storagePath ? "En la nube" : "Pendiente de subir"}</small></div><div class="document-buttons"><button type="button" class="download">Abrir / descargar</button><button type="button" class="remove">Quitar</button></div>`;
    element.querySelector(".download").addEventListener("click", () => downloadDocument(doc));
    element.querySelector(".remove").addEventListener("click", () => {
      documents.splice(index, 1);
      renderDocuments();
    });
    holder.appendChild(element);
  });
}

async function downloadDocument(doc) {
  try {
    if (doc.url) {
      window.open(doc.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (doc.file) {
      const url = URL.createObjectURL(doc.file);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = doc.name || "documento";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  } catch (error) {
    console.error(error);
    notify("No se pudo abrir el documento.", true);
  }
}

async function addDocuments(files) {
  let added = 0;
  for (const file of files) {
    const extension = (file.name.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      notify(`Formato no admitido: ${file.name}`, true);
      continue;
    }
    if (documents.length >= MAX_DOCUMENTS) {
      notify(`El límite es de ${MAX_DOCUMENTS} documentos por visita.`, true);
      break;
    }
    if (file.size > MAX_DOC_BYTES) {
      notify(`El archivo supera 10 MB: ${file.name}`, true);
      continue;
    }
    const currentTotal = documents.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
    if (currentTotal + file.size > MAX_TOTAL_DOC_BYTES) {
      notify("El total de documentos supera 25 MB por visita.", true);
      continue;
    }
    if (documents.some((item) => item.name === file.name && item.size === file.size)) {
      notify(`Ya está adjunto: ${file.name}`, true);
      continue;
    }
    documents.push({ name: file.name, size: file.size, mime: file.type || MIME_BY_EXT[extension], file });
    added++;
  }
  renderDocuments();
  if (added) notify(`${added} documento(s) adjuntado(s). Guarda la visita para subirlos a la nube.`);
}

function safeFileName(name) {
  return String(name || "archivo").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_").slice(-90);
}

function uploadOneFile(visitId, folder, item, onProgress) {
  const blob = item.file;
  const fileName = safeFileName(item.name || "archivo");
  const unique = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const path = `visits/${visitId}/${folder}/${unique}_${fileName}`;
  const fileRef = storageRef(storage, path);
  const contentType = item.mime || blob.type || "application/octet-stream";
  const task = uploadBytesResumable(fileRef, blob, { contentType, customMetadata: { originalName: item.name || fileName, visitId } });
  return new Promise((resolve, reject) => {
    task.on("state_changed", (snapshot) => {
      const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
      onProgress?.(percent);
    }, reject, async () => {
      try {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve({
          name: item.name || fileName,
          size: item.size || blob.size,
          mime: contentType,
          url,
          storagePath: path,
          ...(folder === "photos" ? { caption: item.caption || "" } : {})
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function uploadVisitAttachments(visit) {
  const uploadedPaths = [];
  let completed = 0;
  const total = visit.photos.filter((item) => item.file).length + visit.documents.filter((item) => item.file).length;
  const uploadList = async (list, folder) => {
    const result = [];
    for (const item of list) {
      if (item.storagePath && item.url && !item.file) {
        result.push({
          name: item.name, size: item.size || 0, mime: item.mime || "application/octet-stream",
          url: item.url, storagePath: item.storagePath,
          ...(folder === "photos" ? { caption: item.caption || "" } : {})
        });
        continue;
      }
      if (!item.file) throw new Error(`El archivo ${item.name || "adjunto"} no está disponible. Vuelve a seleccionarlo.`);
      $("#saveStatus").textContent = `Subiendo ${folder === "photos" ? "fotografía" : "documento"}: ${item.name}...`;
      const uploaded = await uploadOneFile(visit.id, folder, item, (percent) => {
        $("#saveStatus").textContent = `Subiendo archivos a Firebase Storage: ${completed + 1} de ${total} (${percent}%)`;
      });
      uploadedPaths.push(uploaded.storagePath);
      completed++;
      result.push(uploaded);
    }
    return result;
  };

  try {
    const savedPhotos = await uploadList(visit.photos, "photos");
    const savedDocuments = await uploadList(visit.documents, "documents");
    return { visit: { ...visit, photos: savedPhotos, documents: savedDocuments }, uploadedPaths };
  } catch (error) {
    await Promise.allSettled(uploadedPaths.map((path) => deleteObject(storageRef(storage, path))));
    throw error;
  }
}

function attachmentPaths(visit) {
  return [...(visit?.photos || []), ...(visit?.documents || [])].map((item) => item.storagePath).filter(Boolean);
}

async function deleteStorageFiles(paths) {
  const results = await Promise.allSettled(paths.map((path) => deleteObject(storageRef(storage, path))));
  return results.filter((result) => result.status === "rejected");
}

async function saveFromForm(event) {
  event?.preventDefault();
  if (!currentUser) {
    notify("Firebase aún se está conectando. Revisa que el acceso anónimo esté habilitado.", true);
    return;
  }
  const visit = collect();
  if (!validate(visit)) return;
  const button = $("#saveBtn");
  const wasExisting = visits.some((item) => item.id === visit.id);
  let saveCompleted = false;
  button.disabled = true;
  button.textContent = "Guardando...";
  const previous = visits.find((item) => item.id === visit.id);
  let uploadedPaths = [];
  try {
    const uploadResult = await uploadVisitAttachments(visit);
    uploadedPaths = uploadResult.uploadedPaths;
    const savedVisit = uploadResult.visit;
    await set(dbRef(db, `visits/${visit.id}`), savedVisit);
    saveCompleted = true;
    const keepPaths = new Set(attachmentPaths(savedVisit));
    const obsoletePaths = attachmentPaths(previous).filter((path) => !keepPaths.has(path));
    const cleanupErrors = await deleteStorageFiles(obsoletePaths);
    releasePreviewUrls();
    photos = savedVisit.photos.map((item) => ({ ...item }));
    documents = savedVisit.documents.map((item) => ({ ...item }));
    renderPhotos();
    renderDocuments();
    $("#formTitle").textContent = "Editar visita";
    $("#formSubtitle").textContent = `Reporte ${savedVisit.id} · ${niceDate(savedVisit.date)}`;
    $("#saveBtn").textContent = "Actualizar visita";
    $("#saveStatus").textContent = "✓ Visita guardada y sincronizada con Firebase.";
    notify(cleanupErrors.length ? "Visita guardada. Algunos archivos antiguos no pudieron eliminarse." : "Visita guardada correctamente en Firebase.", cleanupErrors.length > 0);
  } catch (error) {
    console.error(error);
    if (uploadedPaths.length) await deleteStorageFiles(uploadedPaths);
    $("#saveStatus").textContent = "No se pudo completar el guardado. Revisa la conexión, las reglas y la configuración de Firebase.";
    notify(firebaseErrorMessage(error), true);
  } finally {
    button.disabled = false;
    button.textContent = (wasExisting || saveCompleted) ? "Actualizar visita" : "Guardar visita";
  }
}

async function deleteVisit(visit) {
  if (!confirm(`¿Eliminar la visita ${visit.id}, sus fotografías y documentos? Esta acción no se puede deshacer.`)) return;
  try {
    await remove(dbRef(db, `visits/${visit.id}`));
    const failedFiles = await deleteStorageFiles(attachmentPaths(visit));
    if (currentId === visit.id) clearForm();
    notify(failedFiles.length ? "Visita eliminada. Algunos archivos podrían permanecer en Storage." : "Visita y archivos eliminados correctamente.", failedFiles.length > 0);
  } catch (error) {
    console.error(error);
    notify(firebaseErrorMessage(error), true);
  }
}

function labelPair(label, value) {
  return `<div class="report-pair"><strong>${esc(label)}</strong><span>${esc(value || "—")}</span></div>`;
}

function reportBlock(title, content) {
  return `<div class="print-section"><h3>${esc(title)}</h3><div class="report-text">${esc(content || "No registrado")}</div></div>`;
}

function generateReport(visit) {
  if (!validate(visit)) return;
  const includeCosts = !!visit.includeCosts;
  const subtotal = (visit.items || []).reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.price) || 0), 0);
  const total = subtotal + (Number(visit.labor) || 0);
  const rows = (visit.items || []).map((item, index) => `
    <tr><td>${index + 1}</td><td>${esc(item.equip)}</td><td>${esc(item.activity || "—")}</td><td>${esc(item.qty || "—")} ${esc(item.unit || "")}</td>
    ${includeCosts ? `<td>${money(item.price)}</td><td>${money((Number(item.qty) || 0) * (Number(item.price) || 0))}</td>` : ""}</tr>`).join("");
  const photoHtml = (visit.photos || []).map((photo, index) => {
    const source = photo.url || photo.previewUrl || photo.data || "";
    return `<div class="print-photo"><img src="${esc(source)}" alt="Evidencia ${index + 1}"><p><strong>Foto ${index + 1}.</strong> ${esc(photo.caption || "Evidencia de la visita")}</p></div>`;
  }).join("");
  const documentHtml = (visit.documents || []).length ? `
    <div class="print-section"><h3>Documentos relacionados con la visita</h3><ol class="print-documents">${visit.documents.map((doc) => `<li>${esc(doc.name)} (${fileSize(doc.size || 0)})</li>`).join("")}</ol>
    <p class="print-document-note">Los documentos originales permanecen adjuntos al registro digital y se pueden descargar por separado.</p></div>` : "";
  const report = $("#printView");
  report.innerHTML = `
    <div class="report-head">
      <div class="report-brand"><div class="report-logo">S</div><div><div class="report-name">SEGURITEC</div><div class="report-sub">Control de visitas técnicas · Reporte de mantenimiento</div></div></div>
      <div class="report-tag"><b>REPORTE TÉCNICO</b><span>N.º ${esc(visit.id)}</span><br><span>${esc(niceDate(visit.date))}</span></div>
    </div>
    <div class="print-section"><h3>1. Información de la visita</h3><div class="report-grid">
      ${labelPair("Cliente / empresa", visit.client)}${labelPair("Lugar o proyecto", visit.project)}${labelPair("Ubicación", visit.location)}${labelPair("Técnico responsable", visit.technician)}
      ${labelPair("Fecha", niceDate(visit.date))}${labelPair("Tipo de servicio", visit.type)}${labelPair("Estado", statusLabel(visit.statusField))}${labelPair("Horas invertidas", visit.hours ? `${visit.hours} horas` : "—")}
      ${labelPair("Persona que recibió", visit.receiverName || visit.contact)}${labelPair("Cargo", visit.receiverRole)}${labelPair("Próxima visita", niceDate(visit.nextVisit))}
    </div></div>
    <div class="print-section"><h3>2. Equipos y actividades revisadas</h3><table class="print-table"><thead><tr><th>#</th><th>Equipo / sistema</th><th>Actividad</th><th>Cantidad</th>${includeCosts ? "<th>Precio unit.</th><th>Importe</th>" : ""}</tr></thead>
      <tbody>${rows}</tbody>${includeCosts ? `<tfoot><tr><td colspan="${includeCosts ? 5 : 3}" style="text-align:right">Mano de obra adicional</td><td>${money(visit.labor)}</td></tr><tr><td colspan="5" style="text-align:right">Total registrado</td><td>${money(total)}</td></tr></tfoot>` : ""}</table></div>
    ${reportBlock("3. Trabajo realizado y hallazgos", visit.work)}
    ${visit.observations ? reportBlock("4. Observaciones", visit.observations) : ""}
    ${visit.recommendations ? reportBlock("5. Recomendaciones", visit.recommendations) : ""}
    ${documentHtml}
    ${photoHtml ? `<div class="print-section"><h3>Evidencia fotográfica</h3><div class="print-photos">${photoHtml}</div></div>` : ""}
    <div class="signs"><div class="sign">${esc(visit.technician || "Técnico responsable")}<br>Elaboró el reporte</div><div class="sign">${esc(visit.receiverName || visit.contact || "Nombre del receptor")}<br>${esc(visit.receiverRole || "Cargo no especificado")} · Recibió el mantenimiento</div></div>
    <div class="report-footer">SEGURITEC · Reporte de visita técnica · Documento para entrega al cliente</div>`;

  const images = [...report.querySelectorAll("img")];
  // No bloquear la impresión cuando una imagen remota no responde.
  Promise.all(images.map((image) => new Promise((resolve) => {
    if (image.complete) { resolve(); return; }
    let finished = false;
    const finish = () => { if (!finished) { finished = true; resolve(); } };
    image.addEventListener("load", finish, { once: true });
    image.addEventListener("error", finish, { once: true });
    setTimeout(finish, 5000);
  }))).then(() => setTimeout(() => window.print(), 250));
}

function exportBackup() {
  try {
    const backup = {
      version: 1,
      project: "reportesseguritec",
      company: "SEGURITEC",
      exportedAt: new Date().toISOString(),
      note: "Incluye datos y referencias de Storage. Los archivos físicos permanecen en Firebase Storage.",
      visits
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `respaldo_seguritec_${today()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    notify("Respaldo JSON descargado.");
  } catch (error) {
    console.error(error);
    notify("No se pudo crear el respaldo.", true);
  }
}

async function importBackup(file) {
  try {
    const backup = JSON.parse(await file.text());
    if (!Array.isArray(backup.visits)) throw new Error("El archivo no contiene una lista de visitas.");
    if (backup.project && backup.project !== "reportesseguritec") {
      throw new Error("El respaldo pertenece a otro proyecto Firebase. Solo importa respaldos de SEGURITEC.");
    }
    if (!confirm(`Se importarán ${backup.visits.length} visita(s). Los registros con el mismo ID serán reemplazados. ¿Continuar?`)) return;
    for (const visit of backup.visits) {
      if (!visit.id || !Array.isArray(visit.items) || !Array.isArray(visit.photos) || !Array.isArray(visit.documents)) {
        throw new Error("El respaldo contiene una visita con formato no válido.");
      }
      await set(dbRef(db, `visits/${visit.id}`), visit);
    }
    notify("Respaldo importado. Los archivos adjuntos deben seguir existiendo en el Storage del proyecto original.");
  } catch (error) {
    console.error(error);
    notify(`No se pudo importar: ${error.message}`, true);
  }
}

$("#addItem").addEventListener("click", () => appendItem());
$("#newBtn").addEventListener("click", clearForm);
$("#clearBtn").addEventListener("click", () => {
  if (confirm("¿Limpiar el formulario actual? Los cambios sin guardar se perderán.")) clearForm();
});
$("#visitForm").addEventListener("submit", saveFromForm);
$("#labor").addEventListener("input", updateTotal);
$("#pdfBtn").addEventListener("click", () => generateReport(collect()));
$("#search").addEventListener("input", renderHistory);
$("#documentInput").addEventListener("change", async (event) => {
  await addDocuments([...event.target.files]);
  event.target.value = "";
});
$("#photoInput").addEventListener("change", async (event) => {
  await addPhotos([...event.target.files]);
  event.target.value = "";
});
$("#cameraInput").addEventListener("change", async (event) => {
  await addPhotos([...event.target.files]);
  event.target.value = "";
});
$("#exportBtn").addEventListener("click", exportBackup);
$("#importFile").addEventListener("change", async (event) => {
  if (event.target.files[0]) await importBackup(event.target.files[0]);
  event.target.value = "";
});

// El formulario está disponible inmediatamente; Firebase se conecta automáticamente.
clearForm();
