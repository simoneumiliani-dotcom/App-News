const categories = [
  ["breaking", "Ultim'ora"],
  ["all", "Tutte"],
  ["politics", "Politica"],
  ["business", "Economia"],
  ["technology", "Tecnologia"],
  ["sports", "Sport"],
  ["health", "Salute"],
  ["science", "Scienza"],
  ["entertainment", "Intrattenimento"],
  ["climate", "Clima"],
  ["culture", "Cultura"]
];

const state = {
  articles: [],
  saved: readSaved(),
  favoritesOnly: false,
  deferredInstall: null
};

const els = {
  category: document.querySelector("#categorySelect"),
  grid: document.querySelector("#newsGrid"),
  count: document.querySelector("#resultCount"),
  status: document.querySelector("#statusText"),
  refresh: document.querySelector("#refreshButton"),
  favorites: document.querySelector("#favoritesToggle"),
  install: document.querySelector("#installButton"),
  share: document.querySelector("#shareButton"),
  widgetTitle: document.querySelector("#widgetTitle"),
  widgetMeta: document.querySelector("#widgetMeta"),
  template: document.querySelector("#articleTemplate")
};

init();

function init() {
  fillSelect(els.category, categories);
  applyInitialFilters();
  bindEvents();
  registerServiceWorker();
  loadNews();
}

function fillSelect(select, items) {
  select.innerHTML = items.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
}

function applyInitialFilters() {
  const params = new URLSearchParams(location.search);
  setSelectValue(els.category, params.get("category"));
}

function setSelectValue(select, value) {
  if (value && [...select.options].some(option => option.value === value)) {
    select.value = value;
  }
}

function bindEvents() {
  els.category.addEventListener("change", loadNews);
  els.refresh.addEventListener("click", loadNews);
  els.favorites.addEventListener("click", () => {
    state.favoritesOnly = !state.favoritesOnly;
    els.favorites.classList.toggle("is-active", state.favoritesOnly);
    render();
  });
  if (els.share) els.share.addEventListener("click", shareApp);
  els.install.addEventListener("click", async () => {
    if (!state.deferredInstall) return;
    state.deferredInstall.prompt();
    await state.deferredInstall.userChoice;
    state.deferredInstall = null;
    els.install.hidden = true;
  });

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    state.deferredInstall = event;
    els.install.hidden = false;
  });
}

async function loadNews() {
  const params = new URLSearchParams({
    category: els.category.value
  });

  setLoading(true);
  try {
    const response = await fetch(`/api/news?${params.toString()}`);
    if (!response.ok) throw new Error("Risposta non disponibile");
    const payload = await response.json();
    state.articles = payload.articles || [];
    render();
    els.status.textContent = payload.sourceNote || "Aggiornato ora.";
  } catch (error) {
    els.status.textContent = "Non riesco a raggiungere le fonti ora. Riprova tra poco.";
    state.articles = [];
    render();
  } finally {
    setLoading(false);
  }
}

function render() {
  const articles = state.favoritesOnly
    ? state.articles.filter(article => state.saved[article.url])
    : state.articles;

  els.grid.innerHTML = "";
  els.count.textContent = `${articles.length} notizie`;

  if (articles.length === 0) {
    els.grid.innerHTML = `<div class="empty-state">Nessuna notizia trovata con questi filtri.</div>`;
    updateWidget(null);
    return;
  }

  articles.forEach(article => els.grid.appendChild(createArticle(article)));
  updateWidget(articles[0]);
}

function createArticle(article) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  const imageLink = node.querySelector(".article-image-link");
  const img = node.querySelector("img");
  const meta = node.querySelector(".article-meta");
  const title = node.querySelector("h2 a");
  const summary = node.querySelector("p");
  const read = node.querySelector(".read-link");
  const save = node.querySelector(".save-button");
  const saved = Boolean(state.saved[article.url]);

  imageLink.href = article.url;
  img.src = article.image || "/icons/news-placeholder-globe.png";
  img.alt = article.title;
  img.onerror = () => {
    img.onerror = null;
    img.src = "/icons/news-placeholder-globe.png";
  };
  meta.innerHTML = `
    <span class="time-badge">${formatRelativeDate(article.seenAt)}</span>
    <span>${escapeHtml(article.domain || "News")}</span>
  `;
  title.href = article.url;
  title.textContent = article.title;
  summary.textContent = article.summary || "Apri la fonte per leggere il pezzo completo.";
  read.href = article.url;
  save.textContent = saved ? "Salvata" : "Salva";
  save.classList.toggle("is-saved", saved);
  save.addEventListener("click", () => toggleSaved(article, save));

  return node;
}

function updateWidget(article) {
  if (!els.widgetTitle || !els.widgetMeta) return;

  if (!article) {
    els.widgetTitle.textContent = "Nessuna notizia in evidenza";
    els.widgetMeta.textContent = "Cambia filtro o aggiorna il flusso.";
    return;
  }
  els.widgetTitle.textContent = article.title;
  els.widgetMeta.textContent = [article.domain, formatDate(article.seenAt)].filter(Boolean).join(" - ");
}

function toggleSaved(article, button) {
  if (state.saved[article.url]) {
    delete state.saved[article.url];
  } else {
    state.saved[article.url] = {
      title: article.title,
      url: article.url,
      savedAt: new Date().toISOString()
    };
  }
  localStorage.setItem("mondoChiaroSaved", JSON.stringify(state.saved));
  button.textContent = state.saved[article.url] ? "Salvata" : "Salva";
  button.classList.toggle("is-saved", Boolean(state.saved[article.url]));
  if (state.favoritesOnly) render();
}

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem("mondoChiaroSaved") || "{}");
  } catch {
    return {};
  }
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatRelativeDate(value) {
  if (!value) return "ora";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ora";

  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "adesso";
  if (minutes < 60) return `${minutes} minuti fa`;
  if (hours < 24) return `${hours} ore fa`;
  if (days < 7) return `${days} giorni fa`;
  return formatDate(value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setLoading(isLoading) {
  els.refresh.disabled = isLoading;
  if (isLoading) els.status.textContent = "Aggiorno il flusso globale...";
}

async function shareApp() {
  const shareData = {
    title: "24News",
    text: "News globali aggiornate, installabili come PWA.",
    url: location.href
  };

  if (navigator.share) {
    await navigator.share(shareData);
  } else {
    await navigator.clipboard.writeText(location.href);
    els.status.textContent = "Link copiato negli appunti.";
  }
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").then(registration => registration.update());
  }
}
