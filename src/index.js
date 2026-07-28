/**
 * MovieBox API — Heroku / Node.js Express Version
 */

import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

const BASE_URL = "https://moviebox.ph";
const H5_API = "https://h5-api.aoneroom.com";
const DEFAULT_DOMAIN = "https://123movienow.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Middleware for CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, X-Stream-Resolution");
  
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Helper: Domain Discovery
async function discoverDomain() {
  try {
    const resp = await fetch(
      `${H5_API}/wefeed-h5api-bff/media-player/get-domain`,
      { headers: { "User-Agent": UA, "X-Client-Type": "h5" } }
    );
    if (resp.ok) {
      const d = await resp.json();
      return (d.data || DEFAULT_DOMAIN).replace(/\/+$/, "");
    }
  } catch {}
  return DEFAULT_DOMAIN;
}

// Helper: Fetch Streams
async function fetchStreams(domain, subjectId, detailPath, se, ep) {
  const playUrl = `${domain}/wefeed-h5api-bff/subject/play?subjectId=${subjectId}&se=${se}&ep=${ep}&detailPath=${detailPath}`;
  const resp = await fetch(playUrl, {
    headers: {
      accept: "application/json",
      referer: `${domain}/spa/videoPlayPage/movies/${detailPath}`,
      "x-client-info": '{"timezone":"Asia/Dhaka"}',
      cookie: "uuid=d8c3539e-2e46-4000-af20-7046a856e30a",
      "User-Agent": UA,
    },
  });
  if (!resp.ok) throw new Error(`Play API returned ${resp.status}`);
  const body = await resp.json();
  return body?.data?.streams || [];
}

// Helper: Fetch Home Data
async function fetchHomeData() {
  const resp = await fetch(
    `${H5_API}/wefeed-h5api-bff/home?host=moviebox.ph`,
    { headers: { "User-Agent": UA } }
  );
  if (!resp.ok) throw new Error(`Home API returned ${resp.status}`);
  const body = await resp.json();
  const ops = body?.data?.operatingList || [];

  const sections = [];
  for (const op of ops) {
    const title = op.title || "";

    if (op.banner) {
      const items = (op.banner.items || [])
        .filter((i) => i.title && !i.title.includes("Communities"))
        .map((i) => ({
          name: i.title,
          poster_url: i.image?.url || i.subject?.cover?.url || null,
          url: i.detailPath ? `${BASE_URL}/detail/${i.detailPath}` : null,
          badge: i.subject?.corner || null,
          slug: i.detailPath || null,
        }));
      sections.push({
        section: "Banner",
        count: items.length,
        movies: items,
        more_url: null,
      });
      continue;
    }

    const subs = op.subjects || [];
    if (!subs.length || !title) continue;

    const movies = subs.map((s) => ({
      name: s.title || s.name,
      poster_url: s.cover?.url || s.thumbnail || null,
      url: s.detailPath ? `${BASE_URL}/detail/${s.detailPath}` : null,
      slug: s.detailPath || null,
      badge: s.corner || null,
      blurhash: s.cover?.blurHash || null,
    }));

    sections.push({
      section: title,
      count: movies.length,
      movies,
      more_url: null,
    });
  }
  return sections;
}

// Helper: Fetch Category Data
async function fetchCategoryData(category) {
  const typeMap = {
    movie: "movie",
    "tv-series": "tvSeries",
    "animated-series": "anime",
  };
  const filterType = typeMap[category] || category;

  const resp = await fetch(
    `${H5_API}/wefeed-h5api-bff/subject/filter?type=${filterType}&page=1&perPage=60`,
    { headers: { "User-Agent": UA, accept: "application/json" } }
  );

  if (!resp.ok) throw new Error(`Category API returned ${resp.status}`);
  const body = await resp.json();
  const items = body?.data?.items || [];

  const movies = items.map((s) => ({
    name: s.title || s.name || "",
    poster_url: s.cover?.url || null,
    url: s.detailPath ? `${BASE_URL}/detail/${s.detailPath}` : null,
    slug: s.detailPath || null,
    badge: s.corner || null,
    blurhash: s.cover?.blurHash || null,
    year: s.releaseDate || null,
    rating: s.imdbRatingValue || null,
  }));

  const sectionName =
    category === "movie"
      ? "All Movies"
      : category === "tv-series"
      ? "All TV Series"
      : "All Animation";

  return [{ section: sectionName, more_url: null, count: movies.length, movies }];
}

// Helper: Fetch Ranking Data
async function fetchRankingData() {
  const resp = await fetch(
    `${H5_API}/wefeed-h5api-bff/subject/rank-list`,
    { headers: { "User-Agent": UA, accept: "application/json" } }
  );
  if (!resp.ok) throw new Error(`Ranking API returned ${resp.status}`);
  const body = await resp.json();
  const lists = body?.data || [];

  const sections = [];
  for (const list of Array.isArray(lists) ? lists : [lists]) {
    const title = list.title || "Most Watched";
    const items = list.items || list.subjects || [];
    const movies = items.map((s, i) => ({
      name: s.title || s.name || "",
      poster_url: s.cover?.url || null,
      url: s.detailPath ? `${BASE_URL}/detail/${s.detailPath}` : null,
      slug: s.detailPath || null,
      rank: String(i + 1),
      badge: s.corner || null,
    }));
    sections.push({ section: title, more_url: null, count: movies.length, movies });
  }
  return sections;
}

// ── Routes ──────────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({
    api: "MovieBox API",
    version: "4.0.0",
    runtime: "Heroku Node.js Express",
    endpoints: {
      home: ["/home", "/home/sections", "/home/section/:name", "/home/banner", "/home/trending", "/home/hot", "/home/cinema"],
      movies: ["/movies", "/movies/sections", "/movies/section/:name"],
      tv_series: ["/tv-series", "/tv-series/sections", "/tv-series/section/:name"],
      animation: ["/animation", "/animation/sections", "/animation/section/:name"],
      ranking: ["/ranking", "/ranking/sections", "/ranking/section/:name"],
      search: ["/search?q={query}", "/search/suggest?q={query}"],
      detail: ["/detail/:slug", "/episodes/:slug"],
      streaming: ["/api/stream/:subject_id?detail_path=...", "/watch/:subject_id?detail_path=...&resolution=480"],
    },
  });
});

app.get("/home", async (req, res, next) => {
  try {
    const sections = await fetchHomeData();
    res.json({ source: `${H5_API}/wefeed-h5api-bff/home`, total_sections: sections.length, poster_map_size: 0, sections });
  } catch (err) { next(err); }
});

app.get("/home/sections", async (req, res, next) => {
  try {
    const sections = await fetchHomeData();
    res.json({ total: sections.length, sections: sections.map((s) => ({ name: s.section, count: s.count, more_url: s.more_url })) });
  } catch (err) { next(err); }
});

app.get("/home/banner", async (req, res, next) => {
  try {
    const sections = await fetchHomeData();
    const banner = sections.find((s) => s.section === "Banner");
    res.json({ count: banner ? banner.count : 0, featured: banner ? banner.movies : [] });
  } catch (err) { next(err); }
});

app.get("/home/trending", async (req, res, next) => {
  try {
    const sections = await fetchHomeData();
    const match = sections.find((s) => ["trending now", "popular movie"].some((kw) => s.section.toLowerCase().includes(kw)));
    if (!match) return res.status(404).json({ error: "Section not found" });
    res.json(match);
  } catch (err) { next(err); }
});

app.get("/home/hot", async (req, res, next) => {
  try {
    const sections = await fetchHomeData();
    const match = sections.find((s) => s.section.toLowerCase().includes("hot"));
    if (!match) return res.status(404).json({ error: "Section not found" });
    res.json(match);
  } catch (err) { next(err); }
});

app.get("/home/cinema", async (req, res, next) => {
  try {
    const sections = await fetchHomeData();
    const match = sections.find((s) => ["cinema", "popular series"].some((kw) => s.section.toLowerCase().includes(kw)));
    if (!match) return res.status(404).json({ error: "Section not found" });
    res.json(match);
  } catch (err) { next(err); }
});

app.get("/home/section/:name", async (req, res, next) => {
  try {
    const name = req.params.name;
    const sections = await fetchHomeData();
    const matched = sections.filter((s) => s.section.toLowerCase().includes(name.toLowerCase()));
    if (!matched.length) return res.status(404).json({ message: `No section matching '${name}'`, available: sections.map((s) => s.section) });
    res.json({ results: matched });
  } catch (err) { next(err); }
});

// Category Routes
const handleCategoryRoutes = (routePrefix, categoryKey) => {
  app.get(`/${routePrefix}`, async (req, res, next) => {
    try {
      const sections = await fetchCategoryData(categoryKey);
      res.json({ source: `${H5_API}/wefeed-h5api-bff/subject/filter`, total_sections: sections.length, poster_map_size: 0, sections });
    } catch (err) { next(err); }
  });

  app.get(`/${routePrefix}/sections`, async (req, res, next) => {
    try {
      const sections = await fetchCategoryData(categoryKey);
      res.json({ total: sections.length, sections: sections.map((s) => ({ name: s.section, count: s.count, more_url: s.more_url })) });
    } catch (err) { next(err); }
  });

  app.get(`/${routePrefix}/section/:name`, async (req, res, next) => {
    try {
      const sections = await fetchCategoryData(categoryKey);
      const matched = sections.filter((s) => s.section.toLowerCase().includes(req.params.name.toLowerCase()));
      if (!matched.length) return res.status(404).json({ message: `No section matching '${req.params.name}'`, available: sections.map((s) => s.section) });
      res.json({ results: matched });
    } catch (err) { next(err); }
  });
};

handleCategoryRoutes("movies", "movie");
handleCategoryRoutes("tv-series", "tv-series");
handleCategoryRoutes("animation", "animated-series");

// Ranking Routes
app.get("/ranking", async (req, res, next) => {
  try {
    const sections = await fetchRankingData();
    res.json({ source: `${H5_API}/wefeed-h5api-bff/subject/rank-list`, total_sections: sections.length, poster_map_size: 0, sections });
  } catch (err) { next(err); }
});

app.get("/ranking/sections", async (req, res, next) => {
  try {
    const sections = await fetchRankingData();
    res.json({ total: sections.length, sections: sections.map((s) => ({ name: s.section, count: s.count, more_url: s.more_url })) });
  } catch (err) { next(err); }
});

app.get("/ranking/section/:name", async (req, res, next) => {
  try {
    const sections = await fetchRankingData();
    const matched = sections.filter((s) => s.section.toLowerCase().includes(req.params.name.toLowerCase()));
    if (!matched.length) return res.status(404).json({ message: `No section matching '${req.params.name}'`, available: sections.map((s) => s.section) });
    res.json({ results: matched });
  } catch (err) { next(err); }
});

// Search
app.get("/search/suggest", async (req, res, next) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: "q parameter required" });

    const resp = await fetch(`${H5_API}/wefeed-h5api-bff/subject/search-suggest`, {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: q, perPage: 10 }),
    });
    if (!resp.ok) return res.status(502).json({ error: "Search API failed" });
    const body = await resp.json();
    const items = body?.data?.items || [];
    res.json({ query: q, suggestions: items.map((i) => i.word).filter(Boolean) });
  } catch (err) { next(err); }
});

app.get("/search", async (req, res, next) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: "q parameter required" });

    const resp = await fetch(`${H5_API}/wefeed-h5api-bff/subject/search`, {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: q, perPage: 30, page: 1 }),
    });
    if (!resp.ok) return res.status(502).json({ error: "Search API failed" });
    const body = await resp.json();
    const items = body?.data?.items || [];

    const movies = items.map((s) => ({
      name: s.title || "",
      poster_url: s.cover?.url || null,
      url: s.detailPath ? `${BASE_URL}/detail/${s.detailPath}` : null,
      slug: s.detailPath || null,
      badge: s.corner || null,
      blurhash: s.cover?.blurHash || null,
    }));

    res.json({ query: q, count: movies.length, movies });
  } catch (err) { next(err); }
});

// Detail
app.get("/detail/:slug", async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const pageUrl = `${BASE_URL}/detail/${slug}`;
    const resp = await fetch(pageUrl, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!resp.ok) return res.status(404).json({ error: "Movie not found" });
    const html = await resp.text();

    const match = html.match(/<script[^>]+id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return res.status(500).json({ error: "Could not find NUXT data" });

    let nuxt = JSON.parse(match[1]);

    function resolve(index) {
      if (typeof index !== "number" || index < 0 || index >= nuxt.length) return index;
      const val = nuxt[index];
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const out = {};
        for (const [k, v] of Object.entries(val)) out[k] = resolve(v);
        return out;
      }
      if (Array.isArray(val)) return val.map(resolve);
      return val;
    }

    let movieDict = null, seasons = [], topCast = [], userReviews = [];
    for (let i = 0; i < nuxt.length; i++) {
      const resolved = resolve(i);
      if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) continue;
      if (resolved.subjectId && resolved.title && resolved.duration && !movieDict) movieDict = resolved;
      if (resolved.seasons) seasons = resolved.seasons;
      if (resolved.stars) topCast = resolved.stars;
      if (resolved.items && Array.isArray(resolved.items) && resolved.items.some((it) => it && typeof it === "object" && it.content)) {
        userReviews = resolved.items;
      }
    }

    if (!movieDict) return res.status(404).json({ error: "Could not extract movie metadata" });

    const mp4Urls = nuxt.filter((v) => typeof v === "string" && v.includes(".mp4"));
    const hlsUrls = nuxt.filter((v) => typeof v === "string" && (v.includes(".m3u8") || v.includes("/m3u8/")));

    res.json({
      slug,
      source: pageUrl,
      metadata: {
        id: movieDict.subjectId,
        title: movieDict.title,
        description: movieDict.description,
        release_date: movieDict.releaseDate,
        duration: movieDict.duration,
        genre: movieDict.genre,
        country: movieDict.countryName,
        imdb_rating: movieDict.imdbRatingValue,
        poster: movieDict.cover && typeof movieDict.cover === "object" ? movieDict.cover.url : null,
        badge: movieDict.corner,
        dubs: movieDict.dubs || [],
        top_cast: topCast,
        seasons,
        user_reviews: userReviews.filter((r) => r && typeof r === "object" && r.content).map((r) => ({
          user: r.user?.nickname || null,
          content: r.content,
          created_at: r.createdAt || null,
        })),
      },
      streams: { mp4: mp4Urls, hls: hlsUrls },
    });
  } catch (err) { next(err); }
});

// Episodes
app.get("/episodes/:slug", async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const resp = await fetch(`${H5_API}/wefeed-h5api-bff/detail?detailPath=${slug}`, { headers: { "User-Agent": UA } });
    if (!resp.ok) return res.status(404).json({ error: "Movie/Series not found" });
    const body = await resp.json();
    const data = body?.data || {};
    const resource = data.resource || {};
    const seasonsData = resource.seasons || [];
    const subjectId = data.subject?.subjectId || data.subjectId || resource.id || null;

    if (!seasonsData.length) {
      return res.json({ slug, message: "No seasons/episodes found. This might be a movie.", seasons: [] });
    }

    const seasons = seasonsData.map((s) => {
      const epCount = s.maxEp || 0;
      const episodes = [];
      for (let i = 1; i <= epCount; i++) {
        episodes.push({
          name: `Episode ${i}`,
          ep: i,
          se: s.se,
          watch_url: subjectId ? `/watch/${subjectId}?detail_path=${slug}&se=${s.se}&ep=${i}` : null,
          stream_api_url: subjectId ? `/api/stream/${subjectId}?detail_path=${slug}&se=${s.se}&ep=${i}` : null,
        });
      }
      return { season: s.se, episode_count: epCount, episodes };
    });

    res.json({ slug, subject_id: subjectId, total_seasons: seasons.length, seasons });
  } catch (err) { next(err); }
});

// Stream API
app.get("/api/stream/:subject_id", async (req, res, next) => {
  try {
    const subjectId = req.params.subject_id;
    const detailPath = req.query.detail_path;
    if (!detailPath) return res.status(400).json({ error: "detail_path is required" });
    const se = req.query.se || "0";
    const ep = req.query.ep || "0";

    const domain = await discoverDomain();
    const streams = await fetchStreams(domain, subjectId, detailPath, se, ep);

    if (!streams.length) return res.status(404).json({ error: "No streams found" });

    const formatted = streams
      .map((s) => ({
        resolution: s.resolutions ? `${s.resolutions}p` : "Unknown",
        format: s.format || null,
        url: s.url,
        size_bytes: s.size || null,
        id: s.id || null,
      }))
      .sort((a, b) => (parseInt(b.resolution) || 0) - (parseInt(a.resolution) || 0));

    let subtitles = [];
    const streamId = streams[0]?.id;
    if (streamId) {
      try {
        const capUrl = `${H5_API}/wefeed-h5api-bff/subject/caption?subjectId=${subjectId}&id=${streamId}&detailPath=${detailPath}`;
        const capResp = await fetch(capUrl, {
          headers: {
            "User-Agent": UA,
            accept: "application/json",
            "x-client-info": '{"timezone":"Asia/Dhaka"}',
            cookie: "uuid=d8c3539e-2e46-4000-af20-7046a856e30a",
          },
        });
        if (capResp.ok) {
          const capBody = await capResp.json();
          const subs = capBody?.data?.subtitles || [];
          subtitles = subs
            .filter((s) => s.lan === "en" || s.lanName?.toLowerCase().includes("english"))
            .map((s) => ({ language: s.lanName || "English", url: s.url }));
        }
      } catch (err) {}
    }

    res.json({
      subject_id: subjectId,
      detail_path: detailPath,
      season: parseInt(se),
      episode: parseInt(ep),
      stream_domain: domain,
      count: formatted.length,
      sources: formatted,
      subtitles,
    });
  } catch (err) { next(err); }
});

// Watch (Stream proxy)
app.get("/watch/:subject_id", async (req, res, next) => {
  try {
    const subjectId = req.params.subject_id;
    const detailPath = req.query.detail_path;
    if (!detailPath) return res.status(400).json({ error: "detail_path is required" });
    const se = req.query.se || "0";
    const ep = req.query.ep || "0";
    const resolution = parseInt(req.query.resolution || "0", 10);

    const domain = await discoverDomain();
    const streams = await fetchStreams(domain, subjectId, detailPath, se, ep);
    if (!streams.length) return res.status(404).json({ error: "No streams found" });

    let stream;
    if (resolution > 0) {
      stream = streams.find((s) => parseInt(s.resolutions) === resolution) || streams[streams.length - 1];
    } else {
      stream = streams.sort((a, b) => parseInt(b.resolutions) - parseInt(a.resolutions))[0];
    }

    const streamUrl = stream.url;
    if (!streamUrl) return res.status(404).json({ error: "Stream URL is empty" });

    const cdnHeaders = {
      Referer: `${domain}/`,
      Origin: domain,
      Accept: "*/*",
      "User-Agent": UA,
    };

    if (req.headers.range) cdnHeaders["Range"] = req.headers.range;

    const vidResp = await fetch(streamUrl, { headers: cdnHeaders, redirect: "follow" });

    if (vidResp.status !== 200 && vidResp.status !== 206) {
      const errBody = await vidResp.text();
      return res.status(vidResp.status).json({ error: `CDN returned ${vidResp.status}`, detail: errBody.slice(0, 200) });
    }

    res.status(vidResp.status);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", vidResp.headers.get("Content-Type") || "video/mp4");
    res.setHeader("X-Stream-Resolution", `${stream.resolutions}p`);
    res.setHeader("Cache-Control", "no-store");

    const cl = vidResp.headers.get("Content-Length");
    if (cl) res.setHeader("Content-Length", cl);
    const cr = vidResp.headers.get("Content-Range");
    if (cr) res.setHeader("Content-Range", cr);

    // Stream the body using Node stream
    const reader = vidResp.body.getReader();
    async function read() {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        return;
      }
      res.write(value);
      read();
    }
    read();
  } catch (err) { next(err); }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal error" });
});

// Start Express Server for Heroku
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
