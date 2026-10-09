# Immich Upload Optimizer [![goreleaser](https://github.com/joojoooo/immich-upload-optimizer/actions/workflows/release.yaml/badge.svg)](https://github.com/joojoooo/immich-upload-optimizer/actions/workflows/release.yaml)
Immich Upload Optimizer (IOU) is a proxy designed to be placed in front of the [Immich](https://immich.app/) server. It intercepts file uploads and uses external CLI programs (by default: [AVIF](https://aomediacodec.github.io/av1-avif/), [JPEG-XL](https://jpegxl.info/), [FFmpeg](https://www.ffmpeg.org/)) to optimize, resize, or compress images and videos to save storage space

## ☕  Support the project
Love this project? You can [support it on Ko-fi](https://ko-fi.com/joojooo) Every contribution makes a difference!

[![ko-fi](https://www.ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/joojooo)

A special thanks to @kevinfiol and @timaschew . Your donations are what keep this project alive 💖

## 🎯 About
This fork was created because the original author [doesn't welcome contributions](https://github.com/miguelangel-nubla/immich-upload-optimizer/pull/21) and [censors comments](https://github.com/miguelangel-nubla/immich-upload-optimizer/issues/15) instead of discussing. Here I can add features without having to convince or ask anyone for permission.

## ✨ Features
Features that differentiate this fork from the original project:

- **Longer disk lifespan**
  - Writes temporary files to RAM by default (tmpfs). Frequently writing to disk reduce its lifespan
  - Does less disk writes even with tmpfs disabled by not making useless copies of uploaded files
- **Lower RAM usage**
  - Does chunked uploads using io.Pipe: streaming small chunks from disk as they are sent. This prevents a copy in RAM of the whole file to be uploaded
- **Usable mobile app**
  - Doesn't show duplicate assets on the mobile app
  - Replaces checksums and file names, making the app oblivious to the different file being uploaded
  - The app won't try to upload the same files again because of checksum mismatch, even if you reinstall
- **AVIF support**
  - A more compatible open image format with similar quality/size to JXL
- **Automatic JXL/AVIF to JPG conversion**
  - Automatically converts JXL/AVIF to JPG on download for better compatibility
- **Easier tasks config**
  - Default passthrough of any unprocessed image/video instead of having to add an empty task and list all extensions to allow
  - No need for a command to remove the original file, it's still needed if processing produces a bigger file size. IUO will delete it
- **Debloated Docker image**
  - Significantly smaller Docker image with only the essentials
  - Latest AVIF/HEIF/JXL/ImageMagick versions compiled from sources with full image format conversion support

## 🐋 Usage via Docker compose
Edit your Immich Docker Compose file:

```yaml
services:
  immich-upload-optimizer:
    image: ghcr.io/joojoooo/immich-upload-optimizer:latest
    tmpfs:
      - /tempfs
    ports:
      - "2284:2284"
    environment:
      - IUO_UPSTREAM=http://immich-server:2283
      - IUO_LISTEN=:2284
      - IUO_TASKS_FILE=/etc/immich-upload-optimizer/config/lossy_avif.yaml
      #- IUO_CHECKSUMS_FILE=/IUO/checksums.csv # Uncomment after defining a volume
      - TMPDIR=/tempfs # Writes uploaded files in RAM to improve disk lifespan (Remove if running low on RAM)
      #- IUO_DOWNLOAD_JPG_FROM_JXL=true # Uncomment to enable JXL to JPG conversion
      #- IUO_DOWNLOAD_JPG_FROM_AVIF=true # Uncomment to enable AVIF to JPG conversion
    volumes:
      #- /path/to/your/host/dir:/IUO # Keep the checksums and tasks files between updates by defining a volume
    restart: unless-stopped
    depends_on:
      - immich-server

  immich-server:
  # ...existing configuration...
  # remove the ports section if you only want to access immich through the proxy.
```
Run the appropriate commands at the `docker-compose.yml` location to stop, update and start the container:
```sh
# Stop container and edit docker-compose.yml
docker compose down
# Pull updates
docker compose pull
# Start container
docker compose up -d
```
Configure your **[tasks configuration file](TASKS.md)**

## 🖼️  Web optimizer

The separate web target lets you search an existing Immich server, compare fixed image-compression profiles, and selectively upload smaller results. The UI is a React SPA built with Vite and the server is a [Hono](https://hono.dev) app served by Node; `@immich/sdk` is used only server-side, so the Immich API key is never sent to the browser. The existing proxy image remains the default GoReleaser target.

Build from the repository root:

```sh
docker build -f Dockerfile.goreleaser --target web -t immich-web-media-optimizer:local .
```

Example Compose service (create protected secret files outside the repository):

```yaml
services:
  immich-web-optimizer:
    image: immich-web-media-optimizer:local
    build:
      context: .
      dockerfile: Dockerfile.goreleaser
      target: web
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      IMMICH_URL: http://immich-server:2283
      IMMICH_API_KEY_FILE: /run/secrets/immich_api_key
      WEB_PASSWORD_FILE: /run/secrets/web_password
      WEB_HOST: 0.0.0.0
      WEB_PORT: 3000
      WEB_DATA_DIR: /data
    secrets:
      - immich_api_key
      - web_password
    volumes:
      - optimizer-work:/data
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    restart: unless-stopped

secrets:
  immich_api_key:
    file: /path/to/immich-api-key
  web_password:
    file: /path/to/web-password

volumes:
  optimizer-work:
```

Set `IMMICH_URL` to the server root, for example `http://immich-server:2283` (a trailing `/api` is accepted). `WEB_PASSWORD_FILE` must contain a password of at least 12 characters. Protect both secret files and do not commit them. You can use `IMMICH_API_KEY` and `WEB_PASSWORD` directly instead of their `_FILE` forms, but do not place those values in source control.

The Immich API key needs `asset.read`, `asset.download`, `asset.upload`, `album.read`, `albumAsset.create`, `tag.asset`, and `user.read` (the monthly overview reads your calendar heatmap). Compression also upserts and verifies an `optimized` tag, so it needs `tag.read` and `tag.create`. Add `asset.delete` and `asset.update` for the monthly cleanup tab, which moves assets to the Immich trash and archives them; `asset.delete` is also required if you enable original deletion in a compression run. The UI uses HTTP Basic authentication with username `optimizer` and the password from `WEB_PASSWORD`/`WEB_PASSWORD_FILE`. The service binds to port 3000 inside the container; this Compose example publishes it only on localhost. Use a trusted network or HTTPS reverse proxy for remote access. HTTP Basic authentication does not encrypt credentials.

There are two tabs.

**Compress** searches still images by capture date and/or album, excluding anything in the Immich trash. It accepts JPEG, HEIC, and HEIF; paired Live Photo video IDs are preserved and verified. Selecting multiple profiles optimizes every selected image up front, three at a time, and then presents each image's candidates for an individual decision, highlighting the smallest eligible one. Selecting one profile creates a batch review with an explicit apply step. Candidates that are not strictly smaller cannot be uploaded. Original deletion is off by default and happens only after the new asset, tags, and album memberships are verified. Only one optimization run can be active at a time, across both tabs; the Compress tab offers *Discard this run* to release it, and a run that produces nothing to review releases the slot by itself.

**Monthly cleanup** walks the library a month at a time: a year grid shows the capture count per month (one calendar-heatmap request), and opening a month loads every asset captured in it as thumbnails only, oldest first from the 1st, with burst groups and single images interleaved in capture order. Assets sharing a capture minute form a burst group, since usually only one frame is worth keeping — left click marks an image as keep, right click marks it as trash, and each group has its own action bar that trashes the marked images or compresses/archives the marked keeps. Single images each carry three buttons: compress and delete the original, move to trash, or archive.

Actions are queued rather than blocking: you can keep reviewing and queue as many jobs as you like, and the server runs them one after another (a *Job queue* panel shows what is waiting, running, and done, and a still-queued job can be cancelled). Assets with a queued job have their buttons disabled so the same image cannot be queued twice. Every action asks for confirmation first, and each confirmation has a "don't ask again" checkbox that is remembered in the browser; use *Re-enable prompts* in the month toolbar to bring the dialogs back. Trashing and archiving are reversible from Immich itself; compress-and-delete replaces the original and is not.

Compressed replacements are tagged `optimized` in Immich (created on first use, verified alongside the copied tags before the original is deleted), and the month view marks any asset carrying that tag, so you can see what has already been optimized.

Each run is limited to 100 images, and individual source files over 1 GiB are skipped. Every mode stages one candidate per selected profile for every selected image under `/data` until you decide on or apply them, so provide enough free space. Temporary candidates are cleared on container restart; prepared originals are never changed. A month in the cleanup tab is capped at 3000 assets and says so when it truncates. The job queue lives in memory: restarting the container drops queued jobs (a job that was mid-run leaves its original untouched unless its replacement had already been verified).

### Local development

`web/` holds both halves: `web/src` is the Hono server and `web/client` is the React SPA styled with Tailwind CSS v4 and shadcn/ui components (`components.json`, `components/ui/*`).

```sh
cd web
npm ci
npm run build        # tsc for the server, Vite for the SPA
IMMICH_URL=http://127.0.0.1:2283 IMMICH_API_KEY=… WEB_PASSWORD=… npm start
```

For a live-reloading SPA, run the server (`npm start`) and Vite (`npm run dev`) side by side; Vite proxies `/api` and `/healthz` to port 3000. `npm run typecheck` checks both halves, and `npm run build` is what the Docker web target runs.


## 🚩 Flags
All flags are also available as environment variables using the prefix `IUO_` followed by the uppercase flag.
- `-upstream`: The URL of the Immich server (default: `http://immich-server:2283`)
- `-listen`: The address on which the proxy will listen (default: `:2284`)
- `-tasks_file`: Path to the [configuration file](TASKS.md) (default: [`lossy_avif.yaml`](config/lossy_avif.yaml))
- `-checksums_file`: Path to the checksums file (default: `checksums.csv`)
- `-download_jpg_from_jxl`: Converts JXL images to JPG on download for compatibility (default: `false`)
- `-download_jpg_from_avif`: Converts AVIF images to JPG on download for compatibility (default: `false`)
- `-max_image_jobs`: Max number of image jobs running concurrently (default: `5`)
- `-max_video_jobs`: Max number of video jobs running concurrently (default: `1`)
- `-force_colors`: Force colored log output even in non-TTY environments like Docker (default: `true`)

## 📸 Images
**[AVIF](https://aomediacodec.github.io/av1-avif/)** is used by default, saving **~80%** space while maintaining the same perceived quality (lossy conversion)
- It's an open format
- Offers good compatibility: it's easy to view or share the image with others
- Better than re-transcoding older formats (e.g., converting JPEG to a lower-quality JPEG)

**[JPEG-XL](https://jpegxl.info/)** is a superior format to AVIF, has all AVIF's pros and more, except it lacks widespread compatibility 😔
- Can losslessly convert JPEG to save **~20%** in space without losing any quality
- Support bit-accurate conversion back to the original JPEG
- A lossy JXL option is also available with similar quality/size ratio to AVIF

If neither fits your needs, create your own conversion task: examples in [config](config)

**To experiment with different quality settings live before modifying the task:** [squoosh.app](https://squoosh.app/), [caesium.app](https://caesium.app/)

> [!NOTE]
> Don't judge image compression artifacts by looking at the [Immich](https://github.com/immich-app/immich) low quality preview, zoom the image or download it and use an external viewer (Zooming on the Immich viewer will load the original image only if your browser is compatible with the format)

## 🎬 Videos
Lossy **[H.265](wikipedia.org/wiki/High_Efficiency_Video_Coding)** CRF23 60fps is used by default to ensure storage savings even for short videos while maintaining the same perceived quality.

All metadata is preserved and the video is not rotated (a different rotation than the original would cause viewing issues in the immich app)<br>
Lowering FPS or audio quality isn't worth it, would only give negligible file size savings for a much worse output<br>
It's recommended to only modify CRF and -preset speed to achieve the quality and speed you're after

## License
This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details

## Acknowledgements
- [JamesCullum/multipart-upload-proxy](https://github.com/JamesCullum/multipart-upload-proxy)
- [libavif](https://github.com/AOMediaCodec/libavif)
- [libjxl](https://github.com/libjxl/libjxl)
- [Caesium](https://github.com/Lymphatus/caesium)
- [FFmpeg](https://www.ffmpeg.org/)
- [Immich](https://github.com/immich-app/immich)
