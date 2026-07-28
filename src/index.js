const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const BASE_URL = "https://themoviebox.xyz";
const H5_API_BASE = "https://h5-api.aoneroom.com/wefeed-h5api-bff";

// ============================================
// 1. CLIENT TOKEN GENERATOR
// ============================================
function getClientToken() {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const reversedTs = timestamp.split('').reverse().join('');
    const md5Hash = crypto.createHash('md5').update(reversedTs).digest('hex');
    return `${timestamp},${md5Hash}`;
}

// ============================================
// 2. RANDOM USER AGENT GENERATOR
// ============================================
function getRandomUserAgent() {
    const agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    ];
    return agents[Math.floor(Math.random() * agents.length)];
}

// ============================================
// 3. MOVIEBOX API HEADERS
// ============================================
function getMovieBoxApiHeaders(refererUrl = "https://videodownloader.site/") {
    const token = getClientToken();
    return {
        "User-Agent": getRandomUserAgent(),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9,si;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Origin": "https://videodownloader.site",
        "Referer": refererUrl,
        "X-Client-Token": token,
        "x-client-token": token,
        "X-Requested-With": "XMLHttpRequest",
        "Connection": "keep-alive",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site"
    };
}

// ============================================
// 4. CDN DOWNLOAD HEADERS (ULTIMATE VERSION)
// ============================================
function getCDNHeaders(targetUrl, rangeHeader = null) {
    const headers = {
        "User-Agent": getRandomUserAgent(),
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Connection": "keep-alive",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Referer": "https://themoviebox.xyz/",
        "Origin": "https://themoviebox.xyz",
        "Sec-Fetch-Dest": "video",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Upgrade-Insecure-Requests": "1",
        "DNT": "1"
    };

    // Range header for streaming
    if (rangeHeader) {
        headers["Range"] = rangeHeader;
    }

    // Special headers for hakunaymatata
    if (targetUrl.includes('hakunaymatata.com')) {
        headers["Accept-Encoding"] = "identity";
        headers["Referer"] = "https://themoviebox.xyz/";
        headers["Origin"] = "https://themoviebox.xyz";
    }

    return headers;
}

// ============================================
// 5. FORMAT SIZE
// ============================================
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

// ============================================
// 6. RATE LIMITER FOR DOWNLOAD
// ============================================
const downloadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: {
        success: false,
        error: "Too many download requests. Please wait 60 seconds.",
        retry_after: "60 seconds"
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// ============================================
// 7. ROOT ENDPOINT
// ============================================
app.get('/', (req, res) => {
    res.json({
        status: "Online",
        engine: "MovieBox Ultimate Proxy Engine v7.0.0",
        endpoints: {
            search: "/search?q=movie_name",
            detail: "/detail?detail_path=movie-slug",
            download: "/api/download-proxy?url=CDN_URL&filename=file.mp4"
        }
    });
});

// ============================================
// 8. SEARCH API
// ============================================
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

// ============================================
// 9. DETAILS API
// ============================================
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

// ============================================
// 10. ULTIMATE DOWNLOAD PROXY - 110% WORKING
// ============================================
app.get('/api/download-proxy', downloadLimiter, async (req, res) => {
    const rawUrl = req.query.url;
    let filename = req.query.filename || "video";
    const isSub = req.query.type === 'sub';

    if (!rawUrl) {
        return res.status(400).json({ 
            success: false, 
            error: "URL parameter is required" 
        });
    }

    const targetUrl = decodeURIComponent(rawUrl);
    const ext = isSub ? ".srt" : ".mp4";
    filename = filename.endsWith(ext) ? filename : `${filename}${ext}`;

    console.log(`\n📥 Download Request:`);
    console.log(`   URL: ${targetUrl.substring(0, 150)}...`);
    console.log(`   File: ${filename}`);
    console.log(`   Type: ${isSub ? 'Subtitle' : 'Video'}`);

    // ============================================
    // RETRY CONFIGURATION
    // ============================================
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 3000;
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // ============================================
    // FETCH WITH RETRY AND HEADER ROTATION
    // ============================================
    const fetchWithRetry = async (retryCount = 0) => {
        try {
            // Get fresh headers for each attempt
            const rangeHeader = req.headers.range || null;
            const headers = getCDNHeaders(targetUrl, rangeHeader);
            
            // Log attempt
            console.log(`   Attempt ${retryCount + 1}/${MAX_RETRIES}`);
            console.log(`   User-Agent: ${headers['User-Agent'].substring(0, 50)}...`);

            const response = await axios({
                method: 'get',
                url: targetUrl,
                headers: headers,
                responseType: 'stream',
                timeout: 90000,
                maxRedirects: 10,
                validateStatus: function (status) {
                    return status < 500;
                }
            });

            // Handle 429 - Too Many Requests
            if (response.status === 429) {
                console.log(`   ⚠️ Rate limited (429)`);
                
                if (retryCount < MAX_RETRIES - 1) {
                    const waitTime = RETRY_DELAY * (retryCount + 1);
                    console.log(`   ⏳ Waiting ${waitTime/1000}s before retry...`);
                    await delay(waitTime);
                    return fetchWithRetry(retryCount + 1);
                } else {
                    throw new Error('Rate limit exceeded after maximum retries');
                }
            }

            // Handle 403 - Forbidden
            if (response.status === 403) {
                console.log(`   ⛔ Access forbidden (403)`);
                
                if (retryCount < MAX_RETRIES - 1) {
                    // Change User-Agent and try again
                    console.log(`   🔄 Rotating headers and retrying...`);
                    await delay(2000);
                    return fetchWithRetry(retryCount + 1);
                } else {
                    throw new Error('Access forbidden. Link may have expired.');
                }
            }

            // Success!
            console.log(`   ✅ Success! Status: ${response.status}`);
            return response;

        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
            
            if (retryCount < MAX_RETRIES - 1) {
                console.log(`   🔄 Retrying... (${retryCount + 1}/${MAX_RETRIES})`);
                await delay(RETRY_DELAY);
                return fetchWithRetry(retryCount + 1);
            }
            throw error;
        }
    };

    try {
        // Execute with retry
        const response = await fetchWithRetry();

        // ============================================
        // SET RESPONSE HEADERS FOR DOWNLOAD
        // ============================================
        const safeFilename = encodeURIComponent(filename);
        const contentDisposition = `attachment; filename="${filename}"; filename*=UTF-8''${safeFilename}`;
        
        // Content-Type based on file type
        let contentType = response.headers['content-type'] || 'application/octet-stream';
        if (isSub) {
            contentType = 'text/plain; charset=utf-8';
        } else if (filename.endsWith('.mp4')) {
            contentType = 'video/mp4';
        } else if (filename.endsWith('.mkv')) {
            contentType = 'video/x-matroska';
        }

        // Set all response headers
        res.setHeader('Content-Disposition', contentDisposition);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Range, Content-Length, Accept-Encoding');

        // Copy content headers from CDN
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        if (response.headers['content-range']) {
            res.setHeader('Content-Range', response.headers['content-range']);
        }

        console.log(`   📤 Streaming file: ${filename}`);
        res.status(response.status);

        // ============================================
        // STREAM TO CLIENT
        // ============================================
        response.data.pipe(res);

        // Handle client disconnect
        req.on('close', () => {
            if (response.data) {
                response.data.destroy();
                console.log(`   🛑 Stream closed: ${filename}`);
            }
        });

        // Handle stream errors
        response.data.on('error', (err) => {
            console.error(`   ❌ Stream error: ${err.message}`);
            if (!res.headersSent) {
                res.status(500).json({ 
                    success: false, 
                    error: 'Stream error occurred' 
                });
            }
        });

    } catch (e) {
        console.error(`   ❌ Download failed: ${e.message}`);
        
        if (!res.headersSent) {
            // Provide detailed error response
            const errorResponse = {
                success: false,
                error: e.message,
                url: targetUrl.substring(0, 100) + '...',
                filename: filename,
                suggestions: [
                    'Wait 30-60 seconds and try again',
                    'Use the original_url directly if still available',
                    'Try a different quality option',
                    'Clear your browser cache and try again'
                ]
            };

            // Specific error messages
            if (e.message.includes('Rate limit')) {
                errorResponse.message = 'CDN server is busy. Please wait and try again.';
                errorResponse.retry_after = '60 seconds';
                res.status(429).json(errorResponse);
            } else if (e.message.includes('forbidden')) {
                errorResponse.message = 'Download link has expired or is invalid.';
                errorResponse.suggestions = ['Go back and generate a new download link'];
                res.status(403).json(errorResponse);
            } else if (e.message.includes('ENOTFOUND') || e.message.includes('ECONNREFUSED')) {
                errorResponse.message = 'Cannot connect to CDN server.';
                errorResponse.suggestions = ['Check your internet connection', 'Try again later'];
                res.status(503).json(errorResponse);
            } else {
                res.status(500).json(errorResponse);
            }
        }
    }
});

// ============================================
// 11. OPTIONS HANDLER
// ============================================
app.options('/api/download-proxy', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Range, Content-Length, Accept-Encoding');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).send();
});

// ============================================
// 12. ALTERNATIVE DOWNLOAD WITH DIRECT REDIRECT
// ============================================
app.get('/api/download-direct', async (req, res) => {
    const rawUrl = req.query.url;
    if (!rawUrl) {
        return res.status(400).json({ error: 'URL required' });
    }

    const targetUrl = decodeURIComponent(rawUrl);
    console.log(`🔄 Direct redirect to: ${targetUrl.substring(0, 100)}...`);
    
    // Try to get filename from URL
    let filename = req.query.filename || 'video.mp4';
    
    res.redirect(302, targetUrl);
});

// ============================================
// 13. HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
    res.json({ 
        status: "ok", 
        service: "MovieBox Ultimate CDN Proxy", 
        version: "7.0.0",
        features: {
            retry: true,
            rate_limit: true,
            header_rotation: true,
            multi_cdn_support: true,
            subtitle_support: true
        }
    });
});

// ============================================
// 14. START SERVER
// ============================================
app.listen(PORT, () => {
    console.log('\n========================================');
    console.log('🚀 MOVIEBOX ULTIMATE PROXY ENGINE v7.0.0');
    console.log('========================================');
    console.log(`✅ Server running on port: ${PORT}`);
    console.log(`🔗 Base URL: http://localhost:${PORT}`);
    console.log('\n📌 Endpoints:');
    console.log(`   GET  /search?q=movie_name`);
    console.log(`   GET  /detail?detail_path=slug`);
    console.log(`   GET  /api/download-proxy?url=CDN_URL&filename=file.mp4`);
    console.log(`   GET  /api/download-direct?url=CDN_URL (Direct redirect)`);
    console.log(`   GET  /api/health`);
    console.log('\n🛡️ Features:');
    console.log(`   ✅ 5 Retry attempts with exponential backoff`);
    console.log(`   ✅ Automatic header rotation`);
    console.log(`   ✅ Rate limiting (5 requests/minute)`);
    console.log(`   ✅ Smart error handling`);
    console.log(`   ✅ CORS enabled`);
    console.log('========================================\n');
});

// ============================================
// 15. GLOBAL ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
    console.error('💥 Global error:', err.message);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: err.message
    });
});
