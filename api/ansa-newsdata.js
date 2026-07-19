const CATEGORY_QUERIES = {
  breaking: "ultim'ora mondo internazionale",
  all: "mondo internazionale attualita",
  politics: "politica governo elezioni parlamento diplomazia",
  business: "economia mercati finanza imprese",
  technology: "tecnologia intelligenza artificiale startup cybersecurity",
  sports: "sport calcio tennis basket olimpiadi",
  health: "salute medicina ospedale vaccini",
  science: "scienza ricerca spazio scoperta",
  entertainment: "cinema musica spettacolo streaming",
  climate: "clima ambiente energia meteo emissioni",
  culture: "cultura libri arte museo patrimonio"
};

const NEWSDATA_CATEGORIES = {
  politics: "politics",
  business: "business",
  technology: "technology",
  sports: "sports",
  health: "health",
  science: "science",
  entertainment: "entertainment",
  climate: "environment",
  culture: "top"
};

const ANSA_FEEDS = {
  breaking: "https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml",
  all: "https://www.ansa.it/sito/ansait_rss.xml",
  politics: "https://www.ansa.it/sito/notizie/politica/politica_rss.xml",
  business: "https://www.ansa.it/sito/notizie/economia/economia_rss.xml",
  technology: "https://www.ansa.it/sito/notizie/tecnologia/tecnologia_rss.xml",
  sports: "https://www.ansa.it/sito/notizie/sport/sport_rss.xml",
  health: "https://www.ansa.it/canale_saluteebenessere/notizie/saluteebenessere_rss.xml",
  science: "https://www.ansa.it/canale_scienza_tecnica/notizie/scienza_tecnica_rss.xml",
  entertainment: "https://www.ansa.it/sito/notizie/cultura/cultura_rss.xml",
  climate: "https://www.ansa.it/canale_ambiente/notizie/ambiente_rss.xml",
  culture: "https://www.ansa.it/sito/notizie/cultura/cultura_rss.xml"
};

const CACHE_TTL = 15 * 60 * 1000;
const MAX_ARTICLES = 40;
const memoryCache = globalThis.__worldNewsCache || new Map();
globalThis.__worldNewsCache = memoryCache;

export default async function handler(request, response) {
  const { searchParams } = new URL(request.url, "http://localhost");
  const category = cleanCategory(searchParams.get("category") || "breaking");
  const cacheKey = JSON.stringify({ category, source: "ansa-newsdata-primary-v1" });
  const cached = memoryCache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < CACHE_TTL) {
    response.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800");
    response.status(200).json(cached.payload);
    return;
  }

  try {
    const payload = await fetchNews({ category });
    memoryCache.set(cacheKey, { createdAt: Date.now(), payload });
    response.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800");
    response.status(200).json(payload);
  } catch (error) {
    response.status(502).json({
      articles: [],
      error: "NEWS_SOURCE_UNAVAILABLE",
      message: error.message
    });
  }
}

function cleanCategory(value) {
  return Object.prototype.hasOwnProperty.call(CATEGORY_QUERIES, value) ? value : "breaking";
}

async function fetchNews({ category }) {
  const [ansaResult, newsDataResult] = await Promise.allSettled([
    fetchAnsaArticles(category),
    fetchNewsDataArticles(category)
  ]);
  const ansaArticles = ansaResult.status === "fulfilled" ? ansaResult.value : [];
  const newsDataArticles = newsDataResult.status === "fulfilled" ? newsDataResult.value : [];
  const articles = await enrichMissingImages(
    sortByDate(dedupe([...ansaArticles, ...newsDataArticles])).slice(0, MAX_ARTICLES)
  );

  if (articles.length === 0) {
    throw new Error("ANSA RSS and NewsData.io returned no articles");
  }

  return {
    articles,
    sourceNote: newsDataArticles.length > 0
      ? "Fonti primarie: ANSA RSS e NewsData.io, ordinate cronologicamente."
      : "Fonte primaria: ANSA RSS. Aggiungi NEWSDATA_API_KEY per unire anche NewsData.io."
  };
}

async function fetchAnsaArticles(category) {
  const feedUrl = ANSA_FEEDS[category] || ANSA_FEEDS.breaking;
  const rssResponse = await fetch(feedUrl, {
    headers: {
      "User-Agent": "WorldNewsPWA/1.0"
    }
  });

  if (!rssResponse.ok) {
    throw new Error(`ANSA ${rssResponse.status}`);
  }

  const xml = await rssResponse.text();
  const articles = parseRss(xml, {
    country: "IT",
    fallbackDomain: "ANSA",
    language: "it"
  });

  if (articles.length === 0) {
    throw new Error("ANSA returned no articles");
  }

  return articles;
}

function getNewsDataKey() {
  return globalThis.process?.env?.NEWSDATA_API_KEY
    || globalThis.process?.env?.NEWSDATA_KEY
    || "";
}

async function fetchNewsDataArticles(category) {
  const apiKey = getNewsDataKey();

  if (!apiKey) {
    return [];
  }

  const url = new URL("https://newsdata.io/api/1/latest");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("language", "it,en");
  url.searchParams.set("removeduplicate", "1");
  url.searchParams.set("image", "1");
  url.searchParams.set("size", "10");

  if (category === "breaking") {
    url.searchParams.set("q", CATEGORY_QUERIES.breaking);
    url.searchParams.set("timeframe", "12");
  } else if (category !== "all") {
    url.searchParams.set("category", NEWSDATA_CATEGORIES[category] || "top");
    url.searchParams.set("q", CATEGORY_QUERIES[category]);
  }

  const apiResponse = await fetch(url, {
    headers: {
      "User-Agent": "WorldNewsPWA/1.0"
    }
  });

  if (!apiResponse.ok) {
    throw new Error(`NewsData.io ${apiResponse.status}`);
  }

  const data = await apiResponse.json();

  if (data.status && data.status !== "success") {
    throw new Error(data.results?.message || data.message || "NewsData.io error");
  }

  return (data.results || [])
    .map(normalizeNewsDataArticle)
    .filter(article => article.title && article.url);
}

function normalizeNewsDataArticle(article) {
  return {
    title: article.title || "Notizia senza titolo",
    url: article.link || "",
    image: normalizeImageUrl(article.image_url || ""),
    domain: article.source_name || article.source_id || "NewsData.io",
    country: Array.isArray(article.country) ? article.country.join(", ").toUpperCase() : "",
    language: article.language || "",
    seenAt: parseDate(article.pubDate),
    summary: article.description || article.content || `Copertura segnalata da ${article.source_name || "NewsData.io"}.`
  };
}

function parseRss(xml, options) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return dedupe(items.slice(0, 48).map(item => normalizeRssArticle(item, options)))
    .filter(article => article.title && article.url);
}

function normalizeRssArticle(item, { country, fallbackDomain, language }) {
  const title = stripSource(readTag(item, "title"));
  const link = readTag(item, "link");
  const source = readSource(item) || fallbackDomain;
  const pubDate = readTag(item, "pubDate");
  const rawDescription = readTag(item, "description");
  const description = stripHtml(rawDescription);

  return {
    title,
    url: link,
    image: readMediaUrl(item) || readImageFromHtml(rawDescription),
    domain: source,
    country,
    language,
    seenAt: parseDate(pubDate),
    summary: description || (source ? `Copertura segnalata da ${source}.` : "Copertura news RSS.")
  };
}

function sortByDate(articles) {
  return [...articles].sort((left, right) => {
    const leftTime = new Date(left.seenAt).getTime() || 0;
    const rightTime = new Date(right.seenAt).getTime() || 0;
    return rightTime - leftTime;
  });
}

async function enrichMissingImages(articles) {
  return Promise.all(articles.map(async article => {
    if (article.image) return article;

    const image = await fetchPageImage(article.url);
    return image ? { ...article, image } : article;
  }));
}

async function fetchPageImage(url) {
  if (!url || !/^https?:\/\//i.test(url)) return "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1400);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "WorldNewsPWA/1.0",
        "Accept": "text/html,application/xhtml+xml"
      }
    });

    if (!response.ok) return "";

    const html = await response.text();
    return normalizeImageUrl(
      readMetaImage(html) || readImageFromHtml(html),
      response.url || url
    );
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function dedupe(articles) {
  const seen = new Set();
  return articles.filter(article => {
    const key = article.url || article.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readTag(item, tag) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return decodeXml(match?.[1] || "");
}

function readSource(item) {
  const match = item.match(/<source[^>]*>([\s\S]*?)<\/source>/);
  return decodeXml(match?.[1] || "");
}

function readMediaUrl(item) {
  const media = item.match(/<(?:media:content|media:thumbnail|enclosure)[^>]+url=["']([^"']+)["'][^>]*>/i);
  return normalizeImageUrl(decodeXml(media?.[1] || ""));
}

function readMetaImage(html) {
  return readMetaContent(html, "property", "og:image")
    || readMetaContent(html, "property", "og:image:url")
    || readMetaContent(html, "name", "twitter:image")
    || readMetaContent(html, "name", "twitter:image:src");
}

function readMetaContent(html, attribute, value) {
  const pattern = new RegExp(`<meta[^>]+${attribute}=["']${escapeRegExp(value)}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
  const reversePattern = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${escapeRegExp(value)}["'][^>]*>`, "i");
  return decodeXml(html.match(pattern)?.[1] || html.match(reversePattern)?.[1] || "");
}

function readImageFromHtml(html) {
  const image = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
  return normalizeImageUrl(decodeXml(image?.[1] || ""));
}

function normalizeImageUrl(value, baseUrl = "") {
  if (!value || value.startsWith("data:")) return "";

  try {
    return new URL(value, baseUrl || undefined).toString();
  } catch {
    return "";
  }
}

function parseDate(value) {
  if (!value) return "";

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function stripHtml(value) {
  return decodeXml(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function stripSource(title) {
  return title.replace(/\s+-\s+[^-]+$/, "").trim();
}

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
