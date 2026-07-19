import ansaNewsDataHandler from "./ansa-newsdata.js";

export default ansaNewsDataHandler;

const CATEGORY_QUERIES = {
  it: {
    breaking: "ultim'ora notizie importanti when:1h",
    all: "mondo internazionale attualita",
    politics: "politica governo parlamento elezioni",
    business: "economia mercati finanza imprese",
    technology: "tecnologia intelligenza artificiale startup cybersecurity",
    sports: "sport calcio tennis basket olimpiadi",
    health: "salute medicina ospedale vaccini",
    science: "scienza ricerca spazio scoperta",
    entertainment: "cinema musica spettacolo streaming",
    climate: "clima ambiente energia meteo emissioni",
    culture: "cultura libri arte museo patrimonio"
  },
  en: {
    breaking: "breaking news top stories when:1h",
    all: "world global international",
    politics: "politics government parliament election diplomacy",
    business: "economy markets finance business inflation",
    technology: "technology artificial intelligence startup cybersecurity",
    sports: "sport football soccer tennis basketball olympics",
    health: "health medicine hospital vaccine disease",
    science: "science research space discovery",
    entertainment: "cinema music entertainment streaming celebrity",
    climate: "climate environment energy weather emissions",
    culture: "culture books art museum heritage"
  }
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

const memoryCache = globalThis.__worldNewsCache || new Map();
globalThis.__worldNewsCache = memoryCache;

async function legacyHandler(request, response) {
  const { searchParams } = new URL(request.url, "http://localhost");
  const category = cleanCategory(searchParams.get("category") || "breaking");
  const country = cleanToken(searchParams.get("country") || "");
  const lang = cleanLang(searchParams.get("lang") || "it");
  const q = cleanQuery(searchParams.get("q") || "");
  const cacheKey = JSON.stringify({ category, country, lang, q });
  const cached = memoryCache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < 5 * 60 * 1000) {
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    response.status(200).json(cached.payload);
    return;
  }

  try {
    const payload = await fetchCombinedNews({ category, country, lang, q });
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

function cleanCategory(value) {
  return Object.prototype.hasOwnProperty.call(CATEGORY_QUERIES.it, value) ? value : "breaking";
}

function cleanLang(value) {
  return value === "en" ? "en" : "it";
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

async function fetchCombinedNews(filters) {
  const [googleResult, ansaResult] = await Promise.allSettled([
    fetchGoogleArticles(filters),
    fetchAnsaArticles(filters)
  ]);

  const googleArticles = googleResult.status === "fulfilled" ? googleResult.value : [];
  const ansaArticles = ansaResult.status === "fulfilled" ? ansaResult.value : [];
  const articles = await enrichMissingImages(
    sortByDate(dedupe([...googleArticles, ...ansaArticles])).slice(0, 48)
  );

  if (articles.length === 0) {
    throw new Error("No news available from Google News or ANSA");
  }

  return {
    articles: filters.category === "breaking" ? prioritizeRecent(articles) : articles,
    sourceNote: filters.lang === "en"
      ? "Primary sources: Google News RSS and ANSA, shown together with equal priority."
      : "Fonti primarie: Google News RSS e ANSA, mostrate insieme con pari importanza."
  };
}

async function fetchGoogleArticles({ category, country, lang, q }) {
  const locale = getGoogleLocale(country, lang);
  const query = [
    q,
    getCategoryQuery(category, lang)
  ].filter(Boolean).join(" ");
  const rssUrl = new URL("https://news.google.com/rss/search");
  rssUrl.searchParams.set("q", query);
  rssUrl.searchParams.set("hl", locale.hl);
  rssUrl.searchParams.set("gl", locale.gl);
  rssUrl.searchParams.set("ceid", `${locale.gl}:${locale.lang}`);

  const rssResponse = await fetch(rssUrl, {
    headers: {
      "User-Agent": "WorldNewsPWA/1.0"
    }
  });

  if (!rssResponse.ok) {
    throw new Error(`Google News ${rssResponse.status}`);
  }

  const xml = await rssResponse.text();
  const articles = parseRss(xml, {
    country: locale.gl,
    fallbackDomain: "Google News",
    language: lang
  });

  if (articles.length === 0) {
    throw new Error("Google News returned no articles");
  }

  return articles;
}

async function fetchAnsaArticles({ category, q }) {
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
  }).filter(article => matchesTerms(article, q));

  if (articles.length === 0) {
    throw new Error("ANSA returned no articles");
  }

  return articles;
}

function getCategoryQuery(category, lang) {
  const dictionary = CATEGORY_QUERIES[lang] || CATEGORY_QUERIES.it;
  return dictionary[category] || dictionary.breaking;
}

function getGoogleLocale(country, lang) {
  if (lang === "en") {
    return { hl: "en-US", gl: country || "US", lang: "en" };
  }

  return { hl: "it-IT", gl: country || "IT", lang: "it" };
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
  const publishedAt = pubDate ? new Date(pubDate) : null;
  const rawDescription = readTag(item, "description");
  const description = stripHtml(rawDescription);

  return {
    title,
    url: link,
    image: readMediaUrl(item) || readImageFromHtml(rawDescription),
    domain: source,
    country,
    language,
    seenAt: publishedAt && Number.isFinite(publishedAt.getTime()) ? publishedAt.toISOString() : "",
    summary: description || (source ? `Copertura segnalata da ${source}.` : "Copertura news RSS.")
  };
}

function matchesTerms(article, terms) {
  if (!terms) return true;
  const haystack = `${article.title} ${article.summary}`.toLocaleLowerCase("it-IT");
  return terms
    .split(/\s+/)
    .filter(term => term.length > 3)
    .some(term => haystack.includes(term.toLocaleLowerCase("it-IT")));
}

function prioritizeRecent(articles) {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const recent = articles.filter(article => {
    const time = new Date(article.seenAt).getTime();
    return Number.isFinite(time) && time >= oneHourAgo;
  });

  return recent.length >= 3 ? recent : articles;
}

function sortByDate(articles) {
  return [...articles].sort((left, right) => {
    const leftTime = new Date(left.seenAt).getTime() || 0;
    const rightTime = new Date(right.seenAt).getTime() || 0;
    return rightTime - leftTime;
  });
}

async function enrichMissingImages(articles) {
  const enriched = await Promise.all(articles.map(async (article, index) => {
    if (article.image || index >= 18) return article;

    const image = await fetchPageImage(article.url);
    return image ? { ...article, image } : article;
  }));

  return enriched;
}

async function fetchPageImage(url) {
  if (!url || !/^https?:\/\//i.test(url)) return "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1600);

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
    const baseUrl = response.url || url;
    return normalizeImageUrl(
      readMetaImage(html)
        || readImageFromHtml(html),
      baseUrl
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
