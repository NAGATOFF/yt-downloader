const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// =====================================================
// PATHS
// =====================================================

const OUTPUT_DIR = path.join(__dirname, "output");
const TEMP_DIR = path.join(__dirname, "temp");
const THUMBNAIL_DIR = path.join(__dirname, "thumbnails");

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(TEMP_DIR, { recursive: true });
fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

// =====================================================
// FFMPEG PATH - AUTO DETECT
// =====================================================

function findFFmpeg() {
    // مسارات شائعة في Railway/Ubuntu
    const paths = [
        '/usr/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        '/opt/bin/ffmpeg',
        '/app/bin/ffmpeg',
        'ffmpeg'
    ];
    
    for (const p of paths) {
        try {
            require('child_process').execSync(`"${p}" -version`, { stdio: 'ignore' });
            console.log(`✅ FFmpeg found at: ${p}`);
            return p;
        } catch {}
    }
    
    // محاولة with which/where
    try {
        const result = require('child_process').execSync('which ffmpeg || where ffmpeg', { encoding: 'utf8' });
        const p = result.trim().split('\n')[0];
        if (p) {
            console.log(`✅ FFmpeg found at: ${p}`);
            return p;
        }
    } catch {}
    
    console.warn('⚠️ FFmpeg not found, using default');
    return 'ffmpeg';
}

const FFMPEG = findFFmpeg();
console.log(`📌 FFmpeg path: ${FFMPEG}`);

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// =====================================================
// CLEAN YOUTUBE URL
// =====================================================

function cleanYouTubeUrl(url) {
    try {
        const urlObj = new URL(url);
        
        if (urlObj.hostname.includes("youtube.com") || urlObj.hostname.includes("youtu.be")) {
            let videoId = urlObj.searchParams.get('v');
            
            if (urlObj.hostname.includes("youtu.be")) {
                videoId = urlObj.pathname.substring(1);
            }
            
            if (videoId) {
                return `https://www.youtube.com/watch?v=${videoId}`;
            }
        }
        return url;
    } catch {
        return url;
    }
}

// =====================================================
// CHECK FFMPEG
// =====================================================

function isFFmpegInstalled() {
    try {
        require('child_process').execSync(`"${FFMPEG}" -version`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// =====================================================
// GET VIDEO INFO - WITH DENO SUPPORT
// =====================================================

async function getYouTubeInfo(youtubeUrl) {
    try {
        console.log("📊 Fetching video info...");
        
        const cleanUrl = cleanYouTubeUrl(youtubeUrl);
        // ✅ إضافة --js-runtimes deno
        const cmd = `yt-dlp --js-runtimes deno --no-check-certificates -j "${cleanUrl}"`;
        
        console.log("📌 Command:", cmd);
        
        const { stdout, stderr } = await exec(cmd, { 
            maxBuffer: 10 * 1024 * 1024,
            timeout: 60000
        });

        if (stderr && !stderr.includes("Warning") && !stderr.includes("warn")) {
            console.warn("⚠️ yt-dlp warning:", stderr);
        }

        const info = JSON.parse(stdout);
        
        let thumbnail = info.thumbnail || "";
        if (info.thumbnails && info.thumbnails.length > 0) {
            const bestThumb = info.thumbnails.reduce((a, b) => (a.width || 0) > (b.width || 0) ? a : b);
            thumbnail = bestThumb.url || thumbnail;
        }
        
        return {
            title: info.title || "Unknown Title",
            thumbnail: thumbnail,
            duration: info.duration || 0,
            uploader: info.uploader || "Unknown Uploader"
        };
    } catch (error) {
        console.error("❌ Failed to get video info:", error.message);
        return null;
    }
}

// =====================================================
// DOWNLOAD TO MP3 - WITH DENO SUPPORT
// =====================================================

function downloadYouTubeToMp3(youtubeUrl, quality = 192) {
    return new Promise((resolve, reject) => {
        try {
            console.log("🎵 Starting MP3 download...");
            
            const cleanUrl = cleanYouTubeUrl(youtubeUrl);
            console.log("📌 URL:", cleanUrl);
            console.log("📌 Quality:", quality + " kbps");

            if (!isFFmpegInstalled()) {
                reject(new Error(`FFmpeg not found`));
                return;
            }

            const { PassThrough } = require('stream');
            const outputStream = new PassThrough();

            // ✅ إضافة --js-runtimes deno
            const cmd = `yt-dlp --js-runtimes deno --no-check-certificates --ffmpeg-location "${FFMPEG}" -f bestaudio --extract-audio --audio-format mp3 --audio-quality ${quality}k --no-playlist -o - "${cleanUrl}"`;
            
            console.log("📌 Command:", cmd);
            
            const process = spawn(cmd, { 
                shell: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let totalBytes = 0;
            let lastLogTime = Date.now();

            process.stdout.on('data', (data) => {
                totalBytes += data.length;
                const now = Date.now();
                
                if (now - lastLogTime > 2000) {
                    const mb = (totalBytes / (1024 * 1024)).toFixed(2);
                    console.log(`📤 Streaming: ${mb} MB sent`);
                    lastLogTime = now;
                }
                
                outputStream.push(data);
            });

            process.stderr.on('data', (data) => {
                const text = data.toString();
                if (text.includes('[download]') && text.includes('%')) {
                    const match = text.match(/(\d+\.\d+)%/);
                    if (match) {
                        console.log(`📥 Download: ${match[1]}%`);
                    }
                }
                if (text.includes('[ExtractAudio]')) {
                    console.log(`🎵 ${text.trim()}`);
                }
            });

            process.on('close', (code) => {
                if (code === 0) {
                    outputStream.push(null);
                    const mb = (totalBytes / (1024 * 1024)).toFixed(2);
                    console.log(`✅ MP3 stream complete! Size: ${mb} MB`);
                    resolve(outputStream);
                } else {
                    reject(new Error(`yt-dlp failed with code ${code}`));
                }
            });

            process.on('error', (error) => {
                reject(error);
            });

        } catch (error) {
            console.error('❌ Download error:', error.message);
            reject(error);
        }
    });
}

// =====================================================
// DOWNLOAD TO MP4 - WITH DENO SUPPORT
// =====================================================

function downloadYouTubeToMp4(youtubeUrl, quality = 'medium') {
    return new Promise((resolve, reject) => {
        try {
            console.log("🎬 Starting MP4 download...");
            
            const cleanUrl = cleanYouTubeUrl(youtubeUrl);
            console.log("📌 URL:", cleanUrl);
            console.log("📌 Quality:", quality);

            if (!isFFmpegInstalled()) {
                reject(new Error(`FFmpeg not found`));
                return;
            }

            const { PassThrough } = require('stream');
            const outputStream = new PassThrough();

            let formatOption = '';
            
            switch(quality) {
                case 'low':
                    formatOption = 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]';
                    break;
                case 'medium':
                    formatOption = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]';
                    break;
                case 'high':
                    formatOption = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]';
                    break;
                default:
                    formatOption = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]';
            }

            const tempId = Date.now() + '-' + Math.random().toString(36).substring(2, 8);
            const tempFile = path.join(TEMP_DIR, `${tempId}.mp4`);

            // ✅ إضافة --js-runtimes deno
            const cmd = `yt-dlp --js-runtimes deno --no-check-certificates --ffmpeg-location "${FFMPEG}" -f "${formatOption}" --merge-output-format mp4 --no-playlist -o "${tempFile}" "${cleanUrl}"`;
            
            console.log("📌 Command:", cmd);
            
            const process = spawn(cmd, { 
                shell: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let downloadPercent = 0;

            process.stderr.on('data', (data) => {
                const text = data.toString();
                
                if (text.includes('[download]') && text.includes('%')) {
                    const match = text.match(/(\d+\.\d+)%/);
                    if (match) {
                        downloadPercent = parseFloat(match[1]);
                        console.log(`📥 Download: ${downloadPercent}%`);
                    }
                }
                
                if (text.includes('[Merger]')) {
                    console.log(`🔗 ${text.trim()}`);
                }
            });

            process.on('close', async (code) => {
                if (code !== 0) {
                    reject(new Error(`yt-dlp failed with code ${code}`));
                    return;
                }

                if (!fs.existsSync(tempFile)) {
                    reject(new Error('MP4 file not created'));
                    return;
                }

                const fileSize = fs.statSync(tempFile).size;
                console.log(`📊 File size: ${(fileSize / (1024 * 1024)).toFixed(2)} MB`);
                
                const fileStream = fs.createReadStream(tempFile);
                
                let bytesSent = 0;
                let lastLogTime = Date.now();

                fileStream.on('data', (chunk) => {
                    bytesSent += chunk.length;
                    const now = Date.now();
                    
                    if (now - lastLogTime > 2000) {
                        const mb = (bytesSent / (1024 * 1024)).toFixed(2);
                        console.log(`📤 Streaming: ${mb} MB sent`);
                        lastLogTime = now;
                    }
                    
                    outputStream.push(chunk);
                });

                fileStream.on('end', () => {
                    console.log('✅ File streaming complete');
                    outputStream.push(null);
                    
                    fs.unlink(tempFile, (err) => {
                        if (err) console.error('Error deleting temp file:', err);
                        else console.log('🗑️ Temp file deleted');
                    });
                    
                    resolve(outputStream);
                });

                fileStream.on('error', (error) => {
                    console.error('❌ File stream error:', error.message);
                    reject(error);
                });
            });

            process.on('error', (error) => {
                reject(error);
            });

        } catch (error) {
            console.error('❌ Download error:', error.message);
            reject(error);
        }
    });
}

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/health", (req, res) => {
    res.json({
        success: true,
        status: "online",
        timestamp: new Date().toISOString(),
        ffmpeg: isFFmpegInstalled(),
        ffmpegPath: FFMPEG
    });
});

// =====================================================
// CONVERT API
// =====================================================

app.post("/convert", async (req, res) => {
    try {
        const { url, quality = "192", format = "mp3" } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: "Please enter a video URL."
            });
        }

        const cleanUrl = cleanYouTubeUrl(url);
        console.log("\n" + "=".repeat(50));
        console.log("🎬 NEW CONVERSION REQUEST");
        console.log("📌 URL:", cleanUrl);
        console.log("📌 Format:", format.toUpperCase());
        console.log("📌 Quality:", quality);
        console.log("=".repeat(50) + "\n");

        const videoInfo = await getYouTubeInfo(cleanUrl);
        let filename = format === 'mp3' ? 'audio.mp3' : 'video.mp4';
        let title = "Unknown Title";

        if (videoInfo) {
            title = videoInfo.title;
            const cleanTitle = videoInfo.title
                .replace(/[^\w\s\-]/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
            filename = format === 'mp3' 
                ? cleanTitle + '.mp3'
                : cleanTitle + '.mp4';
            console.log("📊 Video Title:", title);
        }

        if (!isFFmpegInstalled()) {
            return res.status(500).json({
                success: false,
                error: "FFmpeg is not installed or not found in PATH",
                ffmpegPath: FFMPEG
            });
        }

        return res.json({
            success: true,
            message: "Stream ready",
            format: format.toUpperCase(),
            quality: quality,
            filename: filename,
            title: title,
            thumbnail: videoInfo?.thumbnail || "",
            duration: videoInfo?.duration || 0,
            downloadUrl: `/download?url=${encodeURIComponent(cleanUrl)}&quality=${quality}&format=${format}`
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =====================================================
// DOWNLOAD STREAM
// =====================================================

app.get("/download", async (req, res) => {
    try {
        const url = req.query.url;
        const quality = req.query.quality || "192";
        const format = req.query.format || "mp3";

        if (!url) {
            return res.status(400).send("Missing URL parameter");
        }

        const cleanUrl = decodeURIComponent(url);
        console.log("📥 Download request for:", cleanUrl);
        console.log("📥 Format:", format.toUpperCase());

        if (!isFFmpegInstalled()) {
            return res.status(500).send(`FFmpeg not found at: ${FFMPEG}`);
        }

        const videoInfo = await getYouTubeInfo(cleanUrl);
        let filename = format === 'mp3' ? 'audio.mp3' : 'video.mp4';
        if (videoInfo && videoInfo.title) {
            const cleanTitle = videoInfo.title
                .replace(/[^\w\s\-]/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
            filename = format === 'mp3' ? cleanTitle + '.mp3' : cleanTitle + '.mp4';
        }

        const contentType = format === 'mp3' ? 'audio/mpeg' : 'video/mp4';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        let stream;
        if (format === 'mp3') {
            stream = await downloadYouTubeToMp3(cleanUrl, quality);
        } else {
            stream = await downloadYouTubeToMp4(cleanUrl, quality);
        }

        stream.pipe(res);

        let bytesSent = 0;
        let lastLogTime = Date.now();

        stream.on('data', (chunk) => {
            bytesSent += chunk.length;
            const now = Date.now();
            
            if (now - lastLogTime > 2000) {
                const mb = (bytesSent / (1024 * 1024)).toFixed(2);
                console.log(`📤 Total sent: ${mb} MB`);
                lastLogTime = now;
            }
        });

        stream.on('end', () => {
            const mb = (bytesSent / (1024 * 1024)).toFixed(2);
            console.log(`✅ Download complete! Total: ${mb} MB`);
        });

        stream.on('error', (error) => {
            console.error('❌ Stream error:', error.message);
            if (!res.headersSent) {
                res.status(500).send('Stream failed: ' + error.message);
            }
        });

    } catch (error) {
        console.error('❌ Download error:', error.message);
        if (!res.headersSent) {
            res.status(500).send('Download failed: ' + error.message);
        }
    }
});

// =====================================================
// CLEANUP OLD TEMP FILES
// =====================================================

function cleanTempFiles() {
    try {
        const dirs = [TEMP_DIR, THUMBNAIL_DIR];
        const now = Date.now();
        const maxAge = 60 * 60 * 1000;
        
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) continue;
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const filePath = path.join(dir, file);
                try {
                    const stats = fs.statSync(filePath);
                    if (now - stats.mtimeMs > maxAge) {
                        fs.unlinkSync(filePath);
                        console.log(`🗑️ Deleted old file: ${file}`);
                    }
                } catch {}
            }
        }
    } catch (error) {
        console.error('❌ Cleanup error:', error.message);
    }
}

setInterval(cleanTempFiles, 60 * 60 * 1000);

// =====================================================
// 404 HANDLER
// =====================================================

app.use((req, res) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/convert") || req.path.startsWith("/download")) {
        return res.status(404).json({
            success: false,
            error: "Endpoint not found."
        });
    }
    res.status(404).send("Page not found.");
});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, HOST, async () => {
    console.log("\n" + "=".repeat(50));
    console.log("🎵  YOUTUBE DOWNLOADER  🎵");
    console.log("=".repeat(50));
    console.log(`✅ Server running on http://${HOST}:${PORT}`);
    
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`✅ Network: http://${net.address}:${PORT}`);
                break;
            }
        }
    }
    
    console.log(`✅ FFmpeg path: ${FFMPEG}`);
    const ffmpegStatus = isFFmpegInstalled();
    console.log(`✅ FFmpeg: ${ffmpegStatus ? "Ready ✅" : "Not found ❌"}`);
    
    try {
        require('child_process').execSync('yt-dlp --version', { stdio: 'ignore' });
        console.log("✅ yt-dlp: Ready ✅");
    } catch {
        console.warn("⚠️ yt-dlp: Not found ❌");
    }
    
    console.log("✅ Deno: Ready ✅");
    console.log("=".repeat(50));
    console.log("Press Ctrl+C to stop\n");
});

process.on('SIGINT', () => {
    console.log("\n🛑 Shutting down...");
    cleanTempFiles();
    process.exit(0);
});

process.on('unhandledRejection', (error) => {
    console.error("❌ Unhandled rejection:", error);
});

process.on('uncaughtException', (error) => {
    console.error("❌ Uncaught exception:", error);
});
// =====================================================
// SEO PAGES
// =====================================================

// الصفحة الرئيسية
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// صفحة تحميل Shorts
app.get("/shorts", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "shorts.html"));
});

// صفحة تحويل MP4
app.get("/mp4-converter", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "mp4-converter.html"));
});

// صفحة المدونة الرئيسية
app.get("/blog", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "blog", "index.html"));
});

// مقالة المدونة
app.get("/blog/how-to-download-youtube-shorts", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "blog", "post1.html"));
});

// sitemap.xml
app.get("/sitemap.xml", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "sitemap.xml"));
});

// robots.txt
app.get("/robots.txt", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "robots.txt"));
});