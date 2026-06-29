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

const countries = [
  ["", "Tutto il mondo"],
  ["IT", "Italia"],
  ["EG", "Egitto"],
  ["AE", "Abu Dhabi"],
  ["US", "Stati Uniti"],
  ["GB", "Regno Unito"],
  ["FR", "Francia"],
  ["DE", "Germania"],
  ["ES", "Spagna"],
  ["CN", "Cina"],
  ["JP", "Giappone"],
  ["IN", "India"],
  ["BR", "Brasile"],
  ["ZA", "Sudafrica"],
  ["AU", "Australia"]
];

const state = {
  articles: [],
  saved: readSaved(),
  favoritesOnly: false,
  deferredInstall: null
};

const els = {
  category: document.querySelector("#categorySelect"),
  country: document.querySelector("#countrySelect"),
  language: document.querySelector("#languageSelect"),
  search: document.querySelector("#searchInput"),
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
  fillSelect(els.country, countries);
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
  setSelectValue(els.country, params.get("country"));
  setSelectValue(els.language, params.get("lang"));
  els.search.value = params.get("q") || "";
}

function setSelectValue(select, value) {
  if (value && [...select.options].some(option => option.value === value)) {
    select.value = value;
  }
}

function bindEvents() {
  const reload = debounce(loadNews, 350);
  els.category.addEventListener("change", loadNews);
  els.country.addEventListener("change", loadNews);
  els.language.addEventListener("change", loadNews);
  els.search.addEventListener("input", reload);
  els.refresh.addEventListener("click", loadNews);
  els.favorites.addEventListener("click", () => {
    state.favoritesOnly = !state.favoritesOnly;
    els.favorites.classList.toggle("is-active", state.favoritesOnly);
    render();
  });
  els.share.addEventListener("click", shareApp);
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
    category: els.category.value,
    country: els.country.value,
    lang: els.language.value,
    q: els.search.value.trim()
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
  img.src = article.image || "/icons/news-placeholder.svg";
  img.alt = article.title;
  meta.textContent = [article.domain, article.country, formatDate(article.seenAt)].filter(Boolean).join(" - ");
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

function setLoading(isLoading) {
  els.refresh.disabled = isLoading;
  if (isLoading) els.status.textContent = "Aggiorno il flusso globale...";
}

async function shareApp() {
  const shareData = {
    title: "World news",
    text: "News globali filtrabili, installabili come PWA.",
    url: location.href
  };

  if (navigator.share) {
    await navigator.share(shareData);
  } else {
    await navigator.clipboard.writeText(location.href);
    els.widgetMeta.textContent = "Link copiato negli appunti.";
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
    navigator.serviceWorker.register("/sw.js");
  }
}
