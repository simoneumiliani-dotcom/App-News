const CATEGORY_QUERIES = {
  all: "world OR global OR international",
  politics: 'topic:"politics"',
  business: 'topic:"financial and economic news"',
  technology: 'topic:"science and technology"',
  sports: 'topic:"sports"',
  health: 'topic:"health"',
  science: 'topic:"science"',
  entertainment: 'topic:"entertainment"',
  climate: 'topic:"environment"',
  culture: 'topic:"arts and culture"'
};

const LANGUAGE_QUERIES = {
  it: "language:italian",
  en: "language:english"
};

const memoryCache = globalThis.__mondoChiaroCache || new Map();
globalThis.__mondoChiaroCache = memoryCache;

export default async function handler(request, response) {
  const { searchParams } = new URL(request.url, "http://localhost");
  const category = searchParams.get("category") || "all";
  const country = cleanToken(searchParams.get("country") || "");
  const lang = searchParams.get("lang") || "it";
  const q = cleanQuery(searchParams.get("q") || "");
  const cacheKey = JSON.stringify({ category, country, lang, q });
  const cached = memoryCache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < 5 * 60 * 1000) {
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    response.status(200).json(cached.payload);
    return;
  }

  try {
    const payload = await fetchWebzNews({ category, country, lang, q });
    memoryCache.set(cacheKey, { createdAt: Date.now(), payload });
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    response.status(200).json(payload);
  } catch {
    try {
      const payload = await fetchGoogleNews({ category, country, lang, q });
      memoryCache.set(cacheKey, { createdAt: Date.now(), payload });
      response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
      response.status(200).json(payload);
    } catch {
      response.status(502).json({
        articles: [],
        error: "NEWS_SOURCE_UNAVAILABLE"
      });
    }
  }
}

function cleanQuery(value) {
  return value
    .replace(/[^\p{L}\p{N}\s'"-]/gu, " ")
    .trim()
    .slice(0, 90);
}

function cleanToken(value) {
  return value.replace(/[^A-Z]/gi, "").toUpperCase().slice(0, 3);
}

function getWebzToken() {
  return globalThis.__WEBZ_IO_TOKEN
    || globalThis.process?.env?.WEBZ_IO_TOKEN
    || globalThis.process?.env?.WEBZ_TOKEN
    || "";
}

async function fetchWebzNews({ category, country, lang, q }) {
  const token = getWebzToken();

  if (!token) {
    throw new Error("WEBZ_IO_TOKEN missing");
  }

  const webzUrl = new URL("https://api.webz.io/newsApiLite");
  webzUrl.searchParams.set("token", token);
  webzUrl.searchParams.set("q", buildWebzQuery({ category, country, lang, q }));

  const webzResponse = await fetch(webzUrl, {
    headers: {
      "User-Agent": "MondoChiaroNews/1.0"
    }
  });

  if (!webzResponse.ok) {
    throw new Error(`Webz.io ${webzResponse.status}`);
  }

  const data = await webzResponse.json();

  if (data.error) {
    throw new Error(typeof data.error === "string" ? data.error : "Webz.io error");
  }

  const articles = dedupe(data.posts || data.articles || []).map(normalizeWebzArticle);

  return {
    articles,
    sourceNote: lang === "en"
      ? "Primary source: Webz.io News API Lite, global news in English."
      : "Fonte principale: Webz.io News API Lite, notizie globali in italiano."
  };
}

function buildWebzQuery({ category, country, lang, q }) {
  return [
    q,
    CATEGORY_QUERIES[category] || CATEGORY_QUERIES.all,
    LANGUAGE_QUERIES[lang] || LANGUAGE_QUERIES.it,
    country ? `site_country:${country}` : ""
  ].filter(Boolean).join(" ");
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

function normalizeWebzArticle(article) {
  const thread = article.thread || {};
  const source = thread.site_full || thread.site || article.site || "";

  return {
    title: article.title || thread.title || "Notizia senza titolo",
    url: article.url || thread.url || "",
    image: thread.main_image || article.image || "",
    domain: source,
    country: thread.country || article.country || "",
    language: article.language || "",
    seenAt: article.published || article.crawled || "",
    summary: buildSummary(article.text || article.highlightText, source)
  };
}

function buildSummary(body, source) {
  if (body) {
    const clean = stripHtml(body).replace(/\s+/g, " ").trim();
    return clean.length > 180 ? `${clean.slice(0, 177)}...` : clean;
  }

  return source
    ? `Copertura segnalata da ${source}.`
    : "Copertura internazionale indicizzata da Webz.io.";
}

async function fetchGoogleNews({ category, country, lang, q }) {
  const locale = getGoogleLocale(country, lang);
  const query = [
    q,
    fallbackQueryForCategory(category)
  ].filter(Boolean).join(" ");
  const rssUrl = new URL("https://news.google.com/rss/search");
  rssUrl.searchParams.set("q", query);
  rssUrl.searchParams.set("hl", locale.hl);
  rssUrl.searchParams.set("gl", locale.gl);
  rssUrl.searchParams.set("ceid", `${locale.gl}:${locale.lang}`);

  const rssResponse = await fetch(rssUrl, {
    headers: {
      "User-Agent": "MondoChiaroNews/1.0"
    }
  });

  if (!rssResponse.ok) {
    throw new Error(`Google News ${rssResponse.status}`);
  }

  const xml = await rssResponse.text();
  const missingToken = !getWebzToken();

  return {
    articles: parseGoogleNews(xml, locale.gl),
    sourceNote: missingToken
      ? "Aggiungi WEBZ_IO_TOKEN su Vercel per usare Webz.io. Fallback temporaneo da Google News RSS."
      : "Webz.io non disponibile ora. Fallback temporaneo da Google News RSS."
  };
}

function fallbackQueryForCategory(category) {
  return (CATEGORY_QUERIES[category] || CATEGORY_QUERIES.all)
    .replace(/topic:"([^"]+)"/g, "$1")
    .replace(/\bOR\b/g, " ");
}

function getGoogleLocale(country, lang) {
  if (lang === "en") {
    return { hl: "en-US", gl: country || "US", lang: "en" };
  }

  return { hl: "it-IT", gl: country || "IT", lang: "it" };
}

function parseGoogleNews(xml, country) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.slice(0, 36).map(item => {
    const title = stripSource(readTag(item, "title"));
    const link = readTag(item, "link");
    const source = readSource(item);
    const pubDate = readTag(item, "pubDate");

    return {
      title,
      url: link,
      image: "",
      domain: source,
      country,
      language: "",
      seenAt: pubDate ? new Date(pubDate).toISOString() : "",
      summary: source ? `Copertura segnalata da ${source}.` : "Copertura da Google News RSS."
    };
  }).filter(article => article.title && article.url);
}

function readTag(item, tag) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return decodeXml(match?.[1] || "");
}

function readSource(item) {
  const match = item.match(/<source[^>]*>([\s\S]*?)<\/source>/);
  return decodeXml(match?.[1] || "");
}

function stripHtml(value) {
  return decodeXml(value || "").replace(/<[^>]*>/g, " ");
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
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}
