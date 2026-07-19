const CATEGORY_QUERIES = {
  it: {
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
  },
  en: {
    breaking: "breaking news world international",
    all: "world international latest news",
    politics: "politics government elections parliament diplomacy",
    business: "economy markets finance business companies",
    technology: "technology artificial intelligence startups cybersecurity",
    sports: "sports football tennis basketball olympics",
    health: "health medicine hospitals vaccines",
    science: "science research space discovery",
    entertainment: "movies music entertainment streaming",
    climate: "climate environment energy weather emissions",
    culture: "culture books art museum heritage"
  }
};

const GOOGLE_LOCALES = [
  { country: "IT", fallbackDomain: "Google News IT", hl: "it-IT", gl: "IT", ceid: "IT:it", language: "it" },
  { country: "US", fallbackDomain: "Google News EN", hl: "en-US", gl: "US", ceid: "US:en", language: "en" }
];

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

const MAX_ARTICLES = 40;

export default async function handler(request, response) {
  const { searchParams } = new URL(request.url, "http://localhost");
  const category = cleanCategory(searchParams.get("category") || "breaking");

  try {
    const payload = await fetchNews({ category });
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json(payload);
  } catch (error) {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(502).json({
      articles: [],
      error: "NEWS_SOURCE_UNAVAILABLE",
      message: error.message
    });
  }
}

function cleanCategory(value) {
  return Object.prototype.hasOwnProperty.call(CATEGORY_QUERIES.it, value) ? value : "breaking";
}

async function fetchNews({ category }) {
  const [ansaResult, googleResult] = await Promise.allSettled([
    fetchAnsaArticles(category),
    fetchGoogleArticles(category)
  ]);
  const ansaArticles = ansaResult.status === "fulfilled" ? ansaResult.value : [];
  const googleArticles = googleResult.status === "fulfilled" ? googleResult.value : [];
  const articles = await enrichMissingImages(
    sortByDate(dedupe([...ansaArticles, ...googleArticles])).slice(0, MAX_ARTICLES)
  );

  if (articles.length === 0) {
    throw new Error("ANSA RSS and Google News RSS returned no articles");
  }

  return {
    articles,
    sourceNote: "Fonti primarie: ANSA RSS e Google News RSS in italiano e inglese, ordinate dal piu recente."
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

async function fetchGoogleArticles(category) {
  const results = await Promise.allSettled(
    GOOGLE_LOCALES.map(locale => fetchGoogleLocaleArticles(category, locale))
  );
  const articles = results.flatMap(result => result.status === "fulfilled" ? result.value : []);

  if (articles.length === 0) {
    throw new Error("Google News RSS returned no articles");
  }

  return articles;
}

async function fetchGoogleLocaleArticles(category, locale) {
  const rssUrl = new URL("https://news.google.com/rss/search");
  rssUrl.searchParams.set("q", CATEGORY_QUERIES[locale.language][category] || CATEGORY_QUERIES[locale.language].breaking);
  rssUrl.searchParams.set("hl", locale.hl);
  rssUrl.searchParams.set("gl", locale.gl);
  rssUrl.searchParams.set("ceid", locale.ceid);

  const rssResponse = await fetch(rssUrl, {
    headers: {
      "User-Agent": "WorldNewsPWA/1.0"
    }
  });

  if (!rssResponse.ok) {
    throw new Error(`Google News RSS ${locale.language} ${rssResponse.status}`);
  }

  const xml = await rssResponse.text();
  return parseRss(xml, locale);
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
