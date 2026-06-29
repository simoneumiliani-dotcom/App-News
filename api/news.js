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

export default async function handler(request, response) {
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
    const payload = await fetchGoogleNews({ category, country, lang, q });
    memoryCache.set(cacheKey, { createdAt: Date.now(), payload });
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    response.status(200).json(payload);
  } catch {
    try {
      const payload = await fetchAnsaNews({ category, country, lang, q });
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

async function fetchGoogleNews({ category, country, lang, q }) {
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

  return {
    articles: category === "breaking" ? prioritizeRecent(articles) : articles,
    sourceNote: lang === "en"
      ? "Primary source: Google News RSS. ANSA is used only when Google has no available results."
      : "Fonte principale: Google News RSS. ANSA viene usata solo se Google non restituisce risultati."
  };
}

async function fetchAnsaNews({ category, country, lang, q }) {
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

  return {
    articles: category === "breaking" ? prioritizeRecent(articles) : articles,
    sourceNote: lang === "en"
      ? "Google News has no available results for these filters. Secondary source: ANSA."
      : "Google News non ha restituito risultati per questi filtri. Fonte secondaria: ANSA."
  };
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
  const description = stripHtml(readTag(item, "description"));

  return {
    title,
    url: link,
    image: readMediaUrl(item),
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
  return decodeXml(media?.[1] || "");
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
