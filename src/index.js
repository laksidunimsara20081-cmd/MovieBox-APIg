const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const BASE_URL = "https://themoviebox.xyz";
const H5_API_BASE = "https://h5-api.aoneroom.com/wefeed-h5api-bff";

// Dynamic Client Token Generator (Python code එකේ get_client_token මගින්)
function getClientToken() {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const reversedTs = timestamp.split('').reverse().join('');
    const md5Hash = crypto.createHash('md5').update(reversedTs).digest('hex');
    return `${timestamp},${md5Hash}`;
}

// Default Headers
function getHeaders(referer = "https://h5.aoneroom.com/") {
    const token = getClientToken();
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Origin": "https://h5.aoneroom.com",
        "Referer": referer,
        "Content-Type": "application/json",
        "X-Request-Lang": "en",
        "X-Client-Info": JSON.stringify({ timezone: "Asia/Colombo" }),
        "X-Client-Token": token,
        "x-client-token": token
    };
}

// File Size Formatter
function formatSize(sizeBytes) {
    try {
        let bytes = parseInt(sizeBytes, 10);
        if (isNaN(bytes) || bytes <= 0) return "N/A";
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        while (bytes >= 1024 && i < units.length - 1) {
            bytes /= 1024;
            i++;
        }
        return `${bytes.toFixed(2)} ${units[i]}`;
    } catch {
        return "N/A";
    }
}

// Root Route
app.get('/', (req, res) => {
    res.json({
        api: "MovieBox Direct API",
        version: "3.2.0 (Node Express Port)",
        status: "Active",
        endpoints: {
            search: "/search?q={query}",
            details: "/detail?detail_path={path}",
            health: "/api/health"
        }
    });
});

// 1. SEARCH ENDPOINT (Search API fixed)
app.get(['/search', '/api/search'], async (req, res) => {
    const q = req.query.q;
    if (!q) {
        return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
    }

    const url = `${H5_API_BASE}/subject/search`;
    const payload = {
        keyword: q,
        page: 1,
        perPage: 30,
        subjectType: 0
    };

    try {
        const response = await axios.post(url, payload, {
            headers: getHeaders(),
            timeout: 12000
        });

        const items = response.data?.data?.items || [];
        const results = [];

        for (const item of items) {
            const detailPath = item.detailPath;
            if (!detailPath) continue;

            const coverUrl = item.cover?.url || "";
            const releaseDate = item.releaseDate || "";
            const year = releaseDate ? releaseDate.substring(0, 4) : "N/A";

            results.push({
                title: item.title || "",
                link: `${BASE_URL}/detail/${detailPath}`,
                image: coverUrl,
                type: item.subjectType === 2 ? "tvshows" : "movies",
                quality: "HD",
                year: year,
                subjectId: item.subjectId,
                detailPath: detailPath
            });
        }

        return res.json({ success: true, total: results.length, data: results });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message, data: [] });
    }
});

// 2. DETAILS & DOWNLOAD LINKS ENDPOINT
app.get(['/detail', '/api/details'], async (req, res) => {
    let path = req.query.detail_path;
    const inputUrl = req.query.url;
    const se = parseInt(req.query.se || 0);
    const ep = parseInt(req.query.ep || 0);

    if (!path && inputUrl) {
        try {
            const parsedUrl = new URL(inputUrl);
            const pathParts = parsedUrl.pathname.replace(/^\/|\/$/g, '').split('/');
            if (pathParts.length > 0) path = pathParts[pathParts.length - 1];
        } catch (e) {}
    }

    if (!path) {
        return res.status(400).json({ success: false, error: "Provide 'url' or 'detail_path'" });
    }

    // Heroku Protocol & Host Detection
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const baseDomain = `${protocol}://${host}`;

    const detailUrl = `${H5_API_BASE}/detail?detailPath=${path}`;

    try {
        const rDetail = await axios.get(detailUrl, { headers: getHeaders(), timeout: 15000 });
        const resData = rDetail.data?.data || {};
        const subject = resData.subject || {};

        if (!subject.title) {
            return res.status(404).json({ success: false, error: "Metadata empty or content not found" });
        }

        const title = subject.title || "";
        const story = subject.description || "";
        const image = subject.cover?.url || "";
        const imdb = subject.imdbRatingValue || "N/A";
        const genresStr = subject.genre || "";
        const genres = genresStr ? genresStr.split(',').map(g => g.trim()).filter(Boolean) : [];
        const subjectId = subject.subjectId;
        const subjectType = subject.subjectType;

        const reqSe = subjectType === 2 ? se : 0;
        const reqEp = subjectType === 2 ? ep : 0;

        const downloads = [];
        const downloadUrl = `${H5_API_BASE}/subject/download?subjectId=${subjectId}&se=${reqSe}&ep=${reqEp}&detailPath=${path}`;

        try {
            const rPlay = await axios.get(downloadUrl, { 
                headers: getHeaders("https://videodownloader.site/"), 
                timeout: 15000 
            });

            if (rPlay.status === 200) {
                const playData = rPlay.data?.data || {};
                const streams = playData.downloads || [];
                const captions = playData.captions || [];
                const titleSuffix = subjectType === 2 ? ` (S${reqSe}E${reqEp})` : "";

                // Stream/Download Links
                for (const s of streams) {
                    const resQuality = s.resolution || "HD";
                    const sizeStr = formatSize(s.size || 0);
                    const originalUrl = s.url || "";

                    if (originalUrl) {
                        const cleanFilename = `${title}_${resQuality}p.mp4`.replace(/\s+/g, '_');
                        const proxyLink = `${baseDomain}/api/download-proxy?url=${encodeURIComponent(originalUrl)}&filename=${encodeURIComponent(cleanFilename)}`;

                        downloads.push({
                            title: `Direct Download ${resQuality}p${titleSuffix}`,
                            url: proxyLink,
                            original_url: originalUrl,
                            size: sizeStr,
                            quality: `${resQuality}p`
                        });
                    }
                }

                // Subtitle Links
                for (const sub of captions) {
                    const subLang = sub.lanName || sub.lan || "Unknown";
                    const originalSubUrl = sub.url;
                    const subSize = formatSize(sub.size || 0);

                    if (originalSubUrl) {
                        const cleanSubFile = `${title}_${subLang}.srt`.replace(/\s+/g, '_');
                        const proxySubLink = `${baseDomain}/api/download-proxy?url=${encodeURIComponent(originalSubUrl)}&filename=${encodeURIComponent(cleanSubFile)}`;

                        downloads.push({
                            title: `Subtitle - ${subLang}${titleSuffix}`,
                            url: proxySubLink,
                            original_url: originalSubUrl,
                            size: subSize,
                            quality: "SUB"
                        });
                    }
                }
            }
        } catch (playErr) {
            console.error("Play download fetch error:", playErr.message);
        }

        // Fallback Trailer
        if (downloads.length === 0) {
            const trailerUrl = subject.trailer?.videoAddress?.url || "";
            if (trailerUrl) {
                const cleanTrailerFile = `${title}_Trailer.mp4`.replace(/\s+/g, '_');
                const proxyTrailer = `${baseDomain}/api/download-proxy?url=${encodeURIComponent(trailerUrl)}&filename=${encodeURIComponent(cleanTrailerFile)}`;
                downloads.push({
                    title: "Trailer (MP4)",
                    url: proxyTrailer,
                    original_url: trailerUrl,
                    size: "N/A",
                    quality: "Trailer"
                });
            }
        }

        const castList = (resData.stars || []).map(star => ({
            name: star.name || "",
            role: star.character || "N/A",
            image: star.avatarUrl || ""
        }));

        let directorVal = "N/A";
        for (const staff of (subject.staffList || [])) {
            if (staff.staffType === 2 || (staff.job && staff.job.toLowerCase().includes('director'))) {
                directorVal = staff.name || "N/A";
                break;
            }
        }

        return res.json({
            success: true,
            data: {
                title,
                image,
                imdb,
                director: directorVal,
                genres,
                story,
                cast: castList,
                downloads,
                subjectId,
                subjectType,
                detailPath: path
            }
        });

    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// 3. FAST HEROKU STREAMING PROXY ENGINE
app.get('/api/download-proxy', async (req, res) => {
    const rawUrl = req.query.url;
    const filename = req.query.filename || "video.mp4";

    if (!rawUrl) {
        return res.status(400).send("URL parameter is missing");
    }

    const targetUrl = decodeURIComponent(rawUrl);

    const proxyHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Referer": "https://videodownloader.site/",
        "Origin": "https://videodownloader.site",
        "Accept": "*/*",
        "Accept-Encoding": "identity"
    };

    if (req.headers.range) {
        proxyHeaders["Range"] = req.headers.range;
    }

    try {
        const response = await axios({
            method: 'get',
            url: targetUrl,
            headers: proxyHeaders,
            responseType: 'stream',
            timeout: 15000
        });

        if (response.status !== 200 && response.status !== 206) {
            return res.redirect(307, targetUrl);
        }

        const safeFilename = encodeURIComponent(filename);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${safeFilename}`);
        res.setHeader("Content-Type", response.headers['content-type'] || 'video/mp4');
        res.setHeader("Accept-Ranges", "bytes");

        if (response.headers['content-length']) res.setHeader("Content-Length", response.headers['content-length']);
        if (response.headers['content-range']) res.setHeader("Content-Range", response.headers['content-range']);

        res.status(response.status);
        response.data.pipe(res);

    } catch (e) {
        // Heroku 30s connection timeout or CDN block fallback
        return res.redirect(307, targetUrl);
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: "ok", service: "MovieBox Express API", version: "3.2.0" });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
