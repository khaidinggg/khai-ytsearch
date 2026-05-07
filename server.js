const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const { Readable } = require("stream");
const ytDlp = require("yt-dlp-exec");
const ffmpegStatic = require("ffmpeg-static");

const app = express();
const PORT = process.env.PORT || 3000;

// You can override this via env without changing code.
const YOUTUBE_API_KEY =
  process.env.YOUTUBE_API_KEY;

const MAX_RESULTS = 10;
const DOWNLOAD_TIMEOUT_MS = 120000;
const tempDir = path.join(os.tmpdir(), "youtube-proxy-search");
const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
const ffmpegAvailable = checkFfmpegAvailable(ffmpegPath);
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/assets/thumb-fallback.svg", (_req, res) => {
  res.type("image/svg+xml");
  res.send(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-label="Thumbnail unavailable"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0%" stop-color="#111827"/><stop offset="100%" stop-color="#1f2937"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><g fill="#e5e7eb" font-family="Arial, sans-serif" text-anchor="middle"><text x="640" y="330" font-size="44">Thumbnail unavailable</text><text x="640" y="385" font-size="24" opacity="0.8">Try opening the video directly</text></g></svg>`
  );
});

app.get("/api/system/status", (_req, res) => {
  res.json({
    ffmpegPath,
    ffmpegAvailable
  });
});

app.get("/api/search", async (req, res) => {
  const rawQuery = req.query.q;
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  const pageToken =
    typeof req.query.pageToken === "string" ? req.query.pageToken.trim() : "";

  if (!query) {
    return res.status(400).json({ error: "Search query is required." });
  }

  try {
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("maxResults", String(MAX_RESULTS));
    searchUrl.searchParams.set("key", YOUTUBE_API_KEY);
    if (pageToken) {
      searchUrl.searchParams.set("pageToken", pageToken);
    }

    const searchResponse = await fetch(searchUrl);
    if (!searchResponse.ok) {
      const details = await searchResponse.text();
      return res.status(502).json({
        error: "YouTube search API failed.",
        details
      });
    }

    const searchData = await searchResponse.json();
    const items = searchData.items || [];
    const videoIds = items
      .map((item) => item?.id?.videoId)
      .filter(Boolean)
      .join(",");

    let statsById = {};
    if (videoIds) {
      const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
      videosUrl.searchParams.set("part", "statistics,contentDetails");
      videosUrl.searchParams.set("id", videoIds);
      videosUrl.searchParams.set("key", YOUTUBE_API_KEY);

      const videosResponse = await fetch(videosUrl);
      if (videosResponse.ok) {
        const videosData = await videosResponse.json();
        statsById = (videosData.items || []).reduce((acc, video) => {
          acc[video.id] = {
            ...(video.statistics || {}),
            duration: video.contentDetails?.duration
          };
          return acc;
        }, {});
      }
    }

    const results = items.map((item) => {
      const videoId = item.id.videoId;
      const thumbnails = item.snippet?.thumbnails || {};
      const bestThumb =
        thumbnails.maxres?.url ||
        thumbnails.standard?.url ||
        thumbnails.high?.url ||
        thumbnails.medium?.url ||
        thumbnails.default?.url ||
        "";
      const statistics = statsById[videoId] || {};

      return {
        id: videoId,
        title: item.snippet?.title || "",
        channelTitle: item.snippet?.channelTitle || "Unknown channel",
        description: item.snippet?.description || "",
        publishedAt: item.snippet?.publishedAt || "",
        duration: formatIso8601Duration(statistics.duration),
        viewCount: statistics.viewCount || "0",
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnailProxyUrl: bestThumb
          ? `/proxy/thumbnail?url=${encodeURIComponent(bestThumb)}`
          : "/assets/thumb-fallback.svg",
        thumbnailPreviewUrl: bestThumb
          ? `/proxy/thumbnail?url=${encodeURIComponent(bestThumb)}`
          : "/assets/thumb-fallback.svg",
        videoProxyUrl: `/proxy/video/${videoId}`
      };
    });

    return res.json({
      results,
      nextPageToken: searchData.nextPageToken || null
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unexpected error while searching YouTube.",
      details: error.message
    });
  }
});

function formatIso8601Duration(rawDuration) {
  if (!rawDuration || typeof rawDuration !== "string") {
    return "Unknown";
  }

  const match = rawDuration.match(
    /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/
  );
  if (!match) {
    return "Unknown";
  }

  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0) + days * 24;
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);

  if (hours > 0) {
    return [hours, minutes, seconds].map((v) => String(v).padStart(2, "0")).join(":");
  }

  return [minutes, seconds].map((v) => String(v).padStart(2, "0")).join(":");
}

app.get("/proxy/thumbnail", async (req, res) => {
  const imageUrl = req.query.url;
  if (typeof imageUrl !== "string" || !imageUrl.trim()) {
    return res.status(400).send("Missing thumbnail URL.");
  }

  try {
    const parsed = new URL(imageUrl);
    if (!/^https?:$/.test(parsed.protocol)) {
      return res.status(400).send("Invalid URL protocol.");
    }

    const upstream = await fetch(parsed.toString());
    if (!upstream.ok || !upstream.body) {
      return res.status(502).send("Failed to fetch thumbnail.");
    }

    const contentType = upstream.headers.get("content-type");
    if (contentType) {
      res.setHeader("content-type", contentType);
    }

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    res.status(500).send(`Thumbnail proxy error: ${error.message}`);
  }
});

app.get("/proxy/video/:videoId", async (req, res) => {
  const { videoId } = req.params;
  if (!videoId) {
    return res.status(400).send("Missing video ID.");
  }

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const directMediaUrl = await getDirectProxyUrl(watchUrl);
    if (!directMediaUrl) {
      throw new Error("yt-dlp could not resolve a direct media URL.");
    }
    const upstream = await fetch(directMediaUrl);
    if (!upstream.ok || !upstream.body) {
      throw new Error("Direct proxy request failed.");
    }

    res.setHeader(
      "content-type",
      upstream.headers.get("content-type") || "video/mp4"
    );
    const len = upstream.headers.get("content-length");
    if (len) {
      res.setHeader("content-length", len);
    }
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (proxyError) {
    try {
      if (!ffmpegAvailable) {
        throw new Error(
          `ffmpeg is not available. Set FFMPEG_PATH or install ffmpeg on PATH. Current path: ${ffmpegPath}`
        );
      }
      const filePath = await downloadVideoWithYtDlp(videoId, watchUrl);
      res.setHeader("content-type", "video/mp4");
      res.sendFile(filePath, (err) => {
        fs.unlink(filePath, () => {});
        if (err && !res.headersSent) {
          res.status(500).send("Failed to send ffmpeg video output.");
        }
      });
    } catch (ffmpegError) {
      res.status(502).json({
        error: "Video proxy and ffmpeg fallback both failed.",
        proxyError: proxyError.message,
        ffmpegError: ffmpegError.message
      });
    }
  }
});

async function getDirectProxyUrl(watchUrl) {
  const output = await ytDlp(watchUrl, {
    getUrl: true,
    format: "best[protocol^=http][vcodec!=none][acodec!=none]/best",
    noWarnings: true,
    noPlaylist: true
  });

  const urls = String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\//i.test(line));

  return urls[0] || null;
}

function downloadVideoWithYtDlp(videoId, watchUrl) {
  const outputPath = path.join(
    tempDir,
    `${videoId}-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`
  );

  const downloadPromise = ytDlp(watchUrl, {
    noPlaylist: true,
    noWarnings: true,
    format: "bestvideo*+bestaudio/best",
    mergeOutputFormat: "mp4",
    ffmpegLocation: ffmpegPath,
    output: outputPath
  });

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error("yt-dlp download timed out."));
    }, DOWNLOAD_TIMEOUT_MS);
  });

  return Promise.race([downloadPromise, timeoutPromise]).then(() => {
    if (!fs.existsSync(outputPath)) {
      throw new Error("yt-dlp completed but output file is missing.");
    }
    return outputPath;
  });
}

function checkFfmpegAvailable(binaryPath) {
  try {
    const result = spawnSync(binaryPath, ["-version"], {
      stdio: "ignore"
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

app.listen(PORT, () => {
  console.log(`ffmpeg path: ${ffmpegPath}`);
  console.log(`ffmpeg available: ${ffmpegAvailable}`);
  console.log(`Server running on http://localhost:${PORT}`);
});
