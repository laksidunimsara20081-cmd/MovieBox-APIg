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

// 1. Dynamic Client Token Generator (API Calls සදහා පමණි)
function getClientToken() {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const reversedTs = timestamp.split('').reverse().join('');
    const md5Hash = crypto.createHash('md5').update(reversedTs).digest('hex');
    return `${timestamp},${md5Hash}`;
}

// 2. MovieBox API Headers (Search & Details සදහා)
function getMovieBoxApiHeaders(refererUrl = "https://videodownloader.site/") {
    const token = getClientToken();
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://videodownloader.site",
        "Referer": refererUrl,
        "X-Client-Token": token,
        "x-client-token": token
    };
}

// Format Byte Sizes
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

// ROOT ENDPOINT
app.get('/', (req, res) => {
    res.json({
        status: "Online",
        engine: "MovieBox Direct Video Proxy Engine v6.0.0",
        endpoints: {
            search: "/search?q=movie_name",
            detail: "/detail?detail_path=movie-slug",
            proxy_download: "/api/download-proxy?url=CDN_URL&filename=file.mp4"
        }
    });
});

// 1. SEARCH API
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
            headers: getMovieBoxApiHeaders(`https://videodownloader.site/?utm_source=movieboxco&q=${encodeURIComponent(q)}`),
            timeout: 12000
        });

        const items = response.data?.data?.items || [];
        const results = items.filter(item => item.detailPath).map(item => {
            const releaseDate = item.releaseDate || "";
            return {
                title: item.title || "",
                link: `${BASE_URL}/detail/${item.detailPath}`,
                image: item.cover?.url || "",
                type: item.subjectType === 2 ? "tvshows" : "movies",
                quality: "HD",
                year: releaseDate ? releaseDate.substring(0, 4) : "N/A",
                subjectId: item.subjectId,
                detailPath: item.detailPath
            };
        });

        return res.json({ success: true, total: results.length, data: results });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message, data: [] });
    }
});

// 2. DETAILS & DOWNLOAD LINKS API
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

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const baseDomain = `${protocol}://${host}`;

    try {
        const detailUrl = `${H5_API_BASE}/detail?detailPath=${path}`;
        const pageReferer = `https://videodownloader.site/?utm_source=movieboxco&q=${encodeURIComponent(path)}`;
        
        const rDetail = await axios.get(detailUrl, { 
            headers: getMovieBoxApiHeaders(pageReferer), 
            timeout: 15000 
        });
        
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
                headers: getMovieBoxApiHeaders(pageReferer), 
                timeout: 15000 
            });

            if (rPlay.status === 200) {
                const playData = rPlay.data?.data || {};
                const streams = playData.downloads || [];
                const captions = playData.captions || [];
                const titleSuffix = subjectType === 2 ? ` (S${reqSe}E${reqEp})` : "";

                // Stream Downloads
                for (const s of streams) {
                    const resQuality = s.resolution || "HD";
                    const sizeStr = formatSize(s.size || 0);
                    const originalUrl = s.url || "";

                    if (originalUrl) {
                        const cleanFilename = `${title}_${resQuality}p`.replace(/[^a-zA-Z0-9_-]/g, '_');
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

                // Subtitles
                for (const sub of captions) {
                    const subLang = sub.lanName || sub.lan || "Unknown";
                    const originalSubUrl = sub.url;
                    const subSize = formatSize(sub.size || 0);

                    if (originalSubUrl) {
                        const cleanSubFile = `${title}_${subLang}`.replace(/[^a-zA-Z0-9_-]/g, '_');
                        const proxySubLink = `${baseDomain}/api/download-proxy?url=${encodeURIComponent(originalSubUrl)}&filename=${encodeURIComponent(cleanSubFile)}&type=sub`;

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

        return res.json({
            success: true,
            data: {
                title,
                image,
                imdb,
                story,
                genres,
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

// 3. FIX: CDN DOWNLOAD PROXY ENGINE (NO 403 / NO EXTRA HEADERS)
app.get('/api/download-proxy', async (req, res) => {
    const rawUrl = req.query.url;
    let filename = req.query.filename || "video";
    const isSub = req.query.type === 'sub';

    if (!rawUrl) {
        return res.status(400).send("URL parameter is missing");
    }

    const targetUrl = decodeURIComponent(rawUrl);
    const ext = isSub ? ".srt" : ".mp4";
    filename = filename.endsWith(ext) ? filename : `${filename}${ext}`;

    // Hakunaymatata / CDN එකට 403 නොදී බාගැනීමට අවශ‍ය Clean Headers
    const cleanCdnHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Encoding": "identity"
    };

    // Forward range header if browser requests video stream range
    if (req.headers.range) {
        cleanCdnHeaders["Range"] = req.headers.range;
    }

    try {
        const response = await axios({
            method: 'get',
            url: targetUrl,
            headers: cleanCdnHeaders,
            responseType: 'stream',
            timeout: 60000,
            maxRedirects: 10
        });

        const safeFilename = encodeURIComponent(filename);
        
        // Response Headers Setup
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${safeFilename}`);
        res.setHeader("Content-Type", response.headers['content-type'] || (isSub ? 'text/plain' : 'video/mp4'));
        res.setHeader("Accept-Ranges", "bytes");

        if (response.headers['content-length']) {
            res.setHeader("Content-Length", response.headers['content-length']);
        }
        if (response.headers['content-range']) {
            res.setHeader("Content-Range", response.headers['content-range']);
        }

        res.status(response.status);

        // Direct Stream Pipe to Client
        response.data.pipe(res);

        req.on('close', () => {
            if (response.data) {
                response.data.destroy();
            }
        });

    } catch (e) {
        console.error("CDN Stream Proxy Error:", e.response?.status || e.message);

        // Link එක කල් ඉකුත් වී ඇත්නම් (Expired token) Direct CDN එකට fallback redirect කරයි
        if (!res.headersSent) {
            return res.redirect(302, targetUrl);
        }
    }
});

// HEALTH CHECK
app.get('/api/health', (req, res) => {
    res.json({ status: "ok", service: "MovieBox Direct CDN Proxy Engine", version: "6.0.0" });
});

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
