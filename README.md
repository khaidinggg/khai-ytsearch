# YouTube Proxy Search

A simple YouTube search website with:

- no login required
- no user data collection
- server-side thumbnail proxy
- server-side video proxy with `yt-dlp` and download fallback

## Requirements

- Node.js 18+
- npm
- Internet access to YouTube APIs

`ffmpeg` is required for merge/download fallback.  
This project includes `ffmpeg-static` by default, so app startup does not depend on global `ffmpeg`.

You can still override the binary location:

- `FFMPEG_PATH=/usr/bin/ffmpeg` (Linux)
- `FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe` (Windows)

## Local run

```bash
npm install
npm start
```

Open: `http://localhost:3000`

## Server deployment (Docker, recommended)

```bash
docker build -t youtube-proxy-search .
docker run -p 3000:3000 --name youtube-proxy-search youtube-proxy-search
```

Open: `http://<server-ip>:3000`

## Health / dependency check

`GET /api/system/status`

Example response:

```json
{
  "ffmpegPath": "/app/node_modules/ffmpeg-static/ffmpeg",
  "ffmpegAvailable": true
}
```

## Notes

- API key is currently embedded in `server.js` as requested.
- For production, move API key to env variable: `YOUTUBE_API_KEY`.
