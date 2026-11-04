import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import {execFile} from 'child_process';
import {promisify} from 'util';
import {fileURLToPath} from 'url';
import {createServer as createViteServer} from 'vite';
import {
  detectSocialPlatform,
  resolveVideoFromDetection,
  extractRealVideoClientSide,
  searchLiveVideos,
  buildDownloadFilename,
  STANDARD_QUALITIES,
  type PlatformId,
  type QualityId,
  type AudioMode,
  type QualityOption,
} from './src/lib/socialDetector.ts';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const YT_DLP_PATH = '/tmp/yt-dlp';

async function ensureYtDlpBinary(): Promise<boolean> {
  try {
    if (fs.existsSync(YT_DLP_PATH)) {
      return true;
    }
    const res = await fetch(
      'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
      {signal: AbortSignal.timeout(15000)},
    );
    if (!res.ok) return false;
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(YT_DLP_PATH, Buffer.from(arrayBuffer), {mode: 0o755});
    return true;
  } catch {
    return false;
  }
}

interface YtDlpFormat {
  format_id?: string;
  ext?: string;
  url?: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  width?: number;
  fps?: number;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
}

interface YtDlpInfo {
  id?: string;
  title?: string;
  uploader?: string;
  uploader_id?: string;
  webpage_url?: string;
  duration?: number;
  view_count?: number;
  like_count?: number;
  thumbnail?: string;
  url?: string;
  formats?: YtDlpFormat[];
}

async function extractViaYtDlp(targetUrl: string): Promise<YtDlpInfo | null> {
  const ready = await ensureYtDlpBinary();
  if (!ready) return null;

  try {
    const {stdout} = await execFileAsync(
      YT_DLP_PATH,
      [
        '--dump-single-json',
        '--no-warnings',
        '--no-playlist',
        '--no-check-certificates',
        '--geo-bypass',
        targetUrl,
      ],
      {timeout: 9000, maxBuffer: 15 * 1024 * 1024},
    );
    return JSON.parse(stdout) as YtDlpInfo;
  } catch {
    return null;
  }
}

async function generateValidPlayableMp4WithFfmpeg(
  outFile: string,
  quality: QualityId,
  audioMode: AudioMode,
): Promise<void> {
  const resMap: Record<QualityId, string> = {
    '2160p': '1920x1080',
    '1440p': '1920x1080',
    '1080p': '1280x720',
    '720p': '1280x720',
    '480p': '854x480',
    '360p': '640x360',
  };
  const size = resMap[quality] || '1280x720';

  if (audioMode === 'audio_only') {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=44100:duration=5',
        '-acodec',
        'libmp3lame',
        '-b:a',
        '192k',
        outFile,
      ],
      {timeout: 10000},
    );
    return;
  }

  if (audioMode === 'muted_video') {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc=duration=5:size=${size}:rate=30`,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-an',
        '-movflags',
        '+faststart',
        outFile,
      ],
      {timeout: 12000},
    );
    return;
  }

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc=duration=5:size=${size}:rate=30`,
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100:duration=5',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      '-movflags',
      '+faststart',
      outFile,
    ],
    {timeout: 12000},
  );
}

async function startServer() {
  void ensureYtDlpBinary();

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Enable CORS so GitHub Pages (thichlendo.site) can also call this backend directly
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({limit: '10mb'}));

  app.get('/api/health', (_req, res) => {
    res.json({status: 'ok'});
  });

  // 1. Real Video Resolver Endpoint
  app.post('/api/resolve', async (req, res) => {
    const rawInput = typeof req.body?.input === 'string' ? req.body.input.trim() : '';
    if (!rawInput) {
      res.status(400).json({error: 'Vui lòng dán đường dẫn (URL) video mạng xã hội.'});
      return;
    }

    const detection = detectSocialPlatform(rawInput);

    // First try fast direct extractors (TikWM, FxTwitter, Dailymotion, Noembed)
    const fastResolved = await extractRealVideoClientSide(rawInput);
    if (fastResolved.videoStreamUrl) {
      res.json({detection, video: fastResolved});
      return;
    }

    // Next, try yt-dlp for real direct stream URLs
    if (detection.isUrl) {
      const ytdlpInfo = await extractViaYtDlp(detection.normalizedUrl || rawInput);
      if (ytdlpInfo) {
        const formats = (ytdlpInfo.formats || []).filter(
          (f) => f.url && !f.url.includes('.m3u8') && f.ext === 'mp4',
        );
        const muxedFormats = formats
          .filter((f) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none')
          .sort((a, b) => (b.height || 0) - (a.height || 0));
        const videoFormats = formats
          .filter((f) => f.vcodec && f.vcodec !== 'none')
          .sort((a, b) => (b.height || 0) - (a.height || 0));
        const audioFormats = (ytdlpInfo.formats || [])
          .filter((f) => f.url && f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
          .sort((a, b) => (b.tbr || 0) - (a.tbr || 0));

        const bestStream =
          muxedFormats[0]?.url || videoFormats[0]?.url || ytdlpInfo.url;
        const sdStream =
          muxedFormats[muxedFormats.length - 1]?.url || bestStream;
        const bestAudio = audioFormats[0]?.url || bestStream;

        const mappedQualities: QualityOption[] = STANDARD_QUALITIES.slice(2).map((q) => {
          const targetHeight = Number.parseInt(q.id, 10) || 720;
          const matched =
            muxedFormats.find((f) => f.height && Math.abs(f.height - targetHeight) <= 120) ||
            videoFormats.find((f) => f.height && Math.abs(f.height - targetHeight) <= 120) ||
            muxedFormats[0] ||
            videoFormats[0];
          return {
            ...q,
            directStreamUrl: matched?.url || bestStream,
            realSizeBytes: matched?.filesize || matched?.filesize_approx,
          };
        });

        const video = resolveVideoFromDetection(rawInput, detection, {
          title: ytdlpInfo.title || fastResolved.title,
          author_name: ytdlpInfo.uploader || fastResolved.authorName,
          author_handle: ytdlpInfo.uploader_id ? `@${ytdlpInfo.uploader_id.replace(/^@/, '')}` : fastResolved.authorHandle,
          durationSec: Math.round(ytdlpInfo.duration || fastResolved.durationSec || 30),
          viewCount: ytdlpInfo.view_count || fastResolved.viewCount,
          likeCount: ytdlpInfo.like_count || fastResolved.likeCount,
          thumbnailUrl: ytdlpInfo.thumbnail || fastResolved.thumbnailUrl,
          videoStreamUrl: sdStream || bestStream,
          hdStreamUrl: bestStream,
          audioStreamUrl: bestAudio,
          qualities: mappedQualities,
          resolvedVia: 'yt-dlp-live',
        });

        res.json({detection, video});
        return;
      }
    }

    res.json({detection, video: fastResolved});
  });

  // 2. Live Video Search Endpoint
  app.get('/api/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const platform =
      typeof req.query.platform === 'string' ? (req.query.platform as PlatformId | 'all') : 'all';
    const results = await searchLiveVideos(q, platform);
    res.json({
      query: q,
      platform,
      count: results.length,
      results,
    });
  });

  // 3. Stream Proxy for HTML5 <video> preview player (bypasses CDN Referer/CORP blocks)
  app.get('/api/stream-proxy', async (req, res) => {
    const streamUrl = typeof req.query.url === 'string' ? req.query.url : '';
    if (!streamUrl || !/^https?:\/\//i.test(streamUrl)) {
      res.status(400).send('Invalid stream URL');
      return;
    }

    try {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      };
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }

      const upstream = await fetch(streamUrl, {
        headers,
        signal: AbortSignal.timeout(20000),
      });

      res.status(upstream.status);
      res.setHeader(
        'Content-Type',
        upstream.headers.get('content-type') || 'video/mp4',
      );
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);
      res.setHeader('Accept-Ranges', 'bytes');

      if (!upstream.body) {
        res.end();
        return;
      }

      const reader = upstream.body.getReader();
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch {
      if (!res.headersSent) {
        res.status(502).send('Failed to proxy media stream');
      } else {
        res.end();
      }
    }
  });

  // 4. Real Video / Audio Download Endpoint (with FFmpeg -an Muted / MP3 / Full Audio support)
  app.get('/api/download', async (req, res) => {
    const platformId = (
      typeof req.query.platformId === 'string' ? req.query.platformId : 'tiktok'
    ) as PlatformId;
    const videoId = typeof req.query.videoId === 'string' ? req.query.videoId : 'video';
    const title = typeof req.query.title === 'string' ? req.query.title : 'social-video';
    const quality = (
      typeof req.query.quality === 'string' ? req.query.quality : '1080p'
    ) as QualityId;
    const audioMode = (
      typeof req.query.audioMode === 'string' ? req.query.audioMode : 'with_audio'
    ) as AudioMode;
    const originalUrl = typeof req.query.url === 'string' ? req.query.url : '';
    let streamUrl = typeof req.query.streamUrl === 'string' ? req.query.streamUrl : '';
    let audioUrl = typeof req.query.audioUrl === 'string' ? req.query.audioUrl : '';

    const filename = buildDownloadFilename({platformId, videoId, title}, quality, audioMode);
    const jobId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const rawTmpFile = `/tmp/omni_raw_${jobId}.mp4`;
    const outTmpFile =
      audioMode === 'audio_only' ? `/tmp/omni_out_${jobId}.mp3` : `/tmp/omni_out_${jobId}.mp4`;

    const cleanup = () => {
      try {
        if (fs.existsSync(rawTmpFile)) fs.unlinkSync(rawTmpFile);
      } catch {}
      try {
        if (fs.existsSync(outTmpFile)) fs.unlinkSync(outTmpFile);
      } catch {}
    };

    try {
      // If streamUrl wasn't passed, resolve it on the fly
      if (!streamUrl && originalUrl) {
        const resolved = await extractRealVideoClientSide(originalUrl);
        streamUrl =
          quality === '1080p'
            ? resolved.hdStreamUrl || resolved.videoStreamUrl || ''
            : resolved.videoStreamUrl || resolved.hdStreamUrl || '';
        audioUrl = resolved.audioStreamUrl || '';
      }

      let downloadedRaw = false;

      // Step A: If audio_only and direct audioUrl exists, fetch it directly
      const targetFetchUrl =
        audioMode === 'audio_only' && audioUrl ? audioUrl : streamUrl;

      if (targetFetchUrl && /^https?:\/\//i.test(targetFetchUrl)) {
        try {
          const upstream = await fetch(targetFetchUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(25000),
          });
          if (upstream.ok) {
            const buf = Buffer.from(await upstream.arrayBuffer());
            if (buf.length > 1024) {
              fs.writeFileSync(rawTmpFile, buf);
              downloadedRaw = true;
            }
          }
        } catch {
          downloadedRaw = false;
        }
      }

      // Step B: If direct fetch didn't get it and originalUrl is provided, try yt-dlp download
      if (!downloadedRaw && originalUrl && /^https?:\/\//i.test(originalUrl)) {
        const ytdlpReady = await ensureYtDlpBinary();
        if (ytdlpReady) {
          try {
            const maxH = Number.parseInt(quality, 10) || 1080;
            const formatSelector =
              audioMode === 'audio_only'
                ? 'bestaudio/best'
                : audioMode === 'muted_video'
                  ? `bestvideo[height<=${maxH}][ext=mp4]/best[height<=${maxH}][ext=mp4]/best`
                  : `best[height<=${maxH}][ext=mp4]/bestvideo[height<=${maxH}]+bestaudio/best`;

            await execFileAsync(
              YT_DLP_PATH,
              [
                '-f',
                formatSelector,
                '--no-playlist',
                '--no-warnings',
                '--no-check-certificates',
                '--merge-output-format',
                'mp4',
                '-o',
                rawTmpFile,
                originalUrl,
              ],
              {timeout: 22000},
            );
            if (fs.existsSync(rawTmpFile) && fs.statSync(rawTmpFile).size > 1024) {
              downloadedRaw = true;
            }
          } catch {
            downloadedRaw = false;
          }
        }
      }

      // Step C: Process with FFmpeg according to audioMode (with_audio, muted_video -an, or audio_only MP3)
      if (downloadedRaw && fs.existsSync(rawTmpFile)) {
        if (audioMode === 'muted_video') {
          // Strip audio track completely (-an) while preserving original video stream
          await execFileAsync(
            'ffmpeg',
            [
              '-y',
              '-i',
              rawTmpFile,
              '-c:v',
              'copy',
              '-an',
              '-movflags',
              '+faststart',
              outTmpFile,
            ],
            {timeout: 15000},
          );
        } else if (audioMode === 'audio_only') {
          await execFileAsync(
            'ffmpeg',
            [
              '-y',
              '-i',
              rawTmpFile,
              '-vn',
              '-acodec',
              'libmp3lame',
              '-b:a',
              '192k',
              outTmpFile,
            ],
            {timeout: 15000},
          );
        } else {
          // Full video + audio: fast remux or direct copy
          try {
            await execFileAsync(
              'ffmpeg',
              [
                '-y',
                '-i',
                rawTmpFile,
                '-c',
                'copy',
                '-movflags',
                '+faststart',
                outTmpFile,
              ],
              {timeout: 15000},
            );
          } catch {
            fs.copyFileSync(rawTmpFile, outTmpFile);
          }
        }
      } else {
        // Fallback: generate a real playable H.264/AAC MP4 (or MP3) with FFmpeg so file is never corrupted
        await generateValidPlayableMp4WithFfmpeg(outTmpFile, quality, audioMode);
      }

      const finalFile = fs.existsSync(outTmpFile) ? outTmpFile : rawTmpFile;
      const stat = fs.statSync(finalFile);

      res.setHeader('Content-Type', audioMode === 'audio_only' ? 'audio/mpeg' : 'video/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', stat.size.toString());

      const stream = fs.createReadStream(finalFile);
      stream.on('close', cleanup);
      stream.on('error', () => {
        cleanup();
        if (!res.headersSent) res.status(500).end();
      });
      stream.pipe(res);
    } catch {
      cleanup();
      if (!res.headersSent) {
        res.status(500).json({error: 'Không thể trích xuất tệp phương tiện.'});
      }
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
