# Procreator

A self-hosted gallery for Procreate artwork, layers, and time-lapse recordings. Built with Next.js, React, TypeScript, and Tailwind CSS, with a compact typographic layout and automatic loading in batches of 100.

## Quick start

Requires Node.js 22+ (Node 24 LTS recommended), npm, and a local artwork directory. Linux is required for the optional systemd service and Python tagging worker. The core gallery does not need Python or an AI model.

```sh
npm ci
cp .env.example .env.local
# Edit MEDIA_ROOT in .env.local to point to your artwork folder.
npm run build
npm start
```

Open `http://localhost:3042`. With the default `APP_HOST=0.0.0.0`, other devices can use `http://YOUR_SERVER_IP:3042`. For development, run `npm run dev` instead.

The example's `./media` directory starts empty. You can point `MEDIA_ROOT` at an existing directory without moving your files. The application reads source artworks without modifying them.

## Configuration

Use `.env.local` or `.env`, or supply environment variables through your process manager. Process environment variables take precedence; `.env.local` overrides `.env`. Relative paths resolve from the project directory. Use absolute paths for external drives, and quote paths containing spaces. The launchers load these files before starting Next.js, including the host and port settings. See [Next.js environment loading](https://nextjs.org/docs/app/guides/environment-variables).

| Variable | Default | Purpose |
| --- | --- | --- |
| `MEDIA_ROOT` | Required | Directory recursively scanned for Procreate documents and images. |
| `APP_HOST` | `0.0.0.0` | Listen address; use `127.0.0.1` for access through a local reverse proxy only. |
| `APP_PORT` | `3042` | HTTP listening port. |
| `DEV_ALLOWED_HOSTS` | Empty | Extra development hostnames/IPs, comma-separated, without schemes or ports. |
| `DATA_DIR` | `./data` | SQLite artwork catalog, tags, and worker progress/logs. Back up this directory. |
| `CACHE_DIR` | `./.cache` | Regenerable time-lapse cache. |
| `TIMELAPSE_CACHE_GB` | `2` | Cache target in GiB; the current video is retained even if larger. |
| `CATALOG_REFRESH_SECONDS` | `60` | Interval between background checks for changed artwork files. |
| `TAGGING_ENGINE` | `none` | `none`, `ram++`, or `custom`. |
| `TAGGER_PYTHON` | `python3` | Python executable or virtual-environment interpreter. |
| `TAGGER_PLUGIN` | Empty | Custom engine's Python adapter file. |
| `RAM_DEVICE` | `auto` | RAM++ device: `auto`, `cpu`, or `cuda`. |
| `RAM_THREADS` | `4` | Maximum RAM++ CPU threads. |
| `RAM_CHECKPOINT` | Cached RAM++ model | Optional local checkpoint path. |
| `HF_HOME` | Hugging Face default | Optional model/tokenizer cache location. |

Keep `DATA_DIR` and `CACHE_DIR` outside the media directory and outside `public/`. Restart after configuration changes. Changes to `DEV_ALLOWED_HOSTS` require rebuilding a production build because it is part of Next.js configuration. Application code changes also require a rebuild. Stop a running production service before building in the same checkout so it cannot serve mismatched HTML and JavaScript assets.

## Features

The artwork catalog persists in `DATA_DIR/catalog.sqlite`. After the initial scan, visits read saved metadata immediately—even after a server restart—and check for changes in the background. Only new or changed files have their previews and document metadata inspected again. Deleted files disappear after a successful rescan, and disconnected drives do not erase the saved catalog. **Refresh archive** waits for an incremental rescan. Changes found in the background appear automatically in an open gallery. Tags remain in `DATA_DIR/tags.json`.

SQLite is embedded; no database server or account is needed. Keep its files on a local writable disk. To rebuild the catalog from scratch, stop the app and remove `catalog.sqlite` and its `-wal`/`-shm` sidecars from `DATA_DIR`, then restart. This does not remove saved tags or original artworks. A new installation still needs one initial scan.

- Search titles, filenames, folders, and generated subject tags. Filter by folder, subject, or available time-lapses.
- Browse 100 artworks at a time with automatic loading on scroll. Cards show only number, title, and date.
- Newest first is the default sort. Embedded artwork dates use the first recording's movie creation time, earliest recording ZIP date, saved document ZIP date, then filesystem modification time. These estimate creation/saved time; the detail view identifies the source.
- Inspect saved layers and masks, group paths, opacity, blend modes, clipping, and hidden layers. Isolated previews use a transparency checkerboard and full opacity; use the saved artwork composite to see blending and masks applied. Layer previews support LZ4/LZO tiles, document rotation, and canvases up to 64 megapixels, rendered up to 1600 pixels along the longest edge.
- Play recorded time-lapses with seeking, fullscreen, 0.5–4× speed, and MP4 downloads. Videos are prepared on demand and cached; a bundled FFmpeg binary handles joining/conversion.
- Download original documents. Thumbnails, artwork previews, and isolated layer previews are served as lossless PNG. Procreate artwork previews use the embedded QuickLook image, not a full-resolution canvas export.
- Open **Fullscreen** in the detail view to expand artwork, layers, or time-lapse playback while retaining navigation and media controls. Use **Exit fullscreen** or Escape to return. Browsers without element-fullscreen support use an expanded view within the browser window.
- Read PNG, JPEG, WebP, GIF, TIFF, and BMP images alongside Procreate documents. Damaged documents stay visible with a fallback. Hidden files and symlinks are ignored.

## Optional image tagging

Tagging is disabled by default. Existing saved tags remain searchable when tagging is disabled. Enable RAM++ or supply your own Python adapter using the [tagging setup guide](docs/tagging.md).

The **Tag untagged** action processes new, changed, and previously failed artwork previews. Progress appears in the header. Each result is saved immediately, and interrupted batches can resume. Changing engines preserves existing tags; see the guide for retagging a collection.

## Startup and shell commands

On Linux with a user systemd manager, run this once from a regular terminal:

```sh
./scripts/install-service.sh
```

The installer builds the app, generates a unit using the current checkout location and Node executable, links it, enables startup, and checks the configured port. It does not assume a username, home directory layout, or Node version manager. Re-run it after moving the checkout or changing the Node installation.

```sh
./start.sh
./stop.sh
./restart.sh
./status.sh
```

These wrappers also work by absolute path from another directory. Equivalent commands:

```sh
systemctl --user start procreate-archive
systemctl --user stop procreate-archive
systemctl --user restart procreate-archive
systemctl --user status procreate-archive
journalctl --user -u procreate-archive -f
```

To apply code changes to an existing service safely:

```sh
./stop.sh && npm run build && ./start.sh
```

For startup at boot without logging in, enable lingering for your account if necessary: `loginctl enable-linger "$USER"` (your system may require administrator authorization). Disable startup with `systemctl --user disable --now procreate-archive`.

On other platforms or with another process manager, use `npm start`. The supplied shell wrappers specifically control the Linux user service.

## Access and privacy

There is **no built-in authentication**. Anyone able to reach the app can browse artwork, time-lapses, filenames, embedded metadata, hidden layers, and original downloads, and can start tagging when enabled. Use a trusted network, VPN, or authenticated reverse proxy for private collections. The app serves HTTP; terminate HTTPS at your proxy when needed. Configuring a hostname does not configure DNS, proxying, or router forwarding.

The gallery API omits the absolute media directory and worker process IDs. Original downloads retain all original document contents and metadata. RAM++ runs locally with downloads disabled during tagging; custom adapters control their own data handling.

Private environment files, media, model weights, caches, tag indexes, logs, screenshots, and generated systemd units are excluded from Git. Keep personal additions out of public source directories. Do not force-add ignored files.

## Development and verification

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run release:check
npm run release:bundle
```

Unit checks use synthetic fixtures and temporary files. The custom tagging integration check uses Python 3 and Pillow; install `scripts/requirements-tagging.txt` to run it. Without Pillow that optional check is skipped. No private artwork or model weights are required for the normal test suite.

Optional Chromium checks against a populated archive (at least 300 artworks and a multi-layer work with a time-lapse):

```sh
npx playwright install chromium
GALLERY_URL=http://127.0.0.1:3042 npm test
```

Screenshots are stored in `.artifacts/` and are excluded from the release. See [release preparation](docs/releasing.md) for the source bundle and GitHub publishing steps.

## Format references

Procreate format research: [Silicate](https://github.com/axaril/silicate) and [Silica Viewer](https://github.com/heyzoish/silica-viewer). Compression: [lz4js](https://github.com/Benzinga/lz4js) and [lzo1x](https://github.com/mbtech-nl/lzo1x). Optional recognition: [RAM++](https://github.com/xinyu1205/recognize-anything). Third-party code and model weights retain their respective licenses. This project is independent of Procreate and is not affiliated with its developers.
