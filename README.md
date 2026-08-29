# 🎬 VidsBrows

**VidsBrows** is an ultra-fast, 100% offline local video and photo gallery with background indexing, progressive thumbnail generation, and HTTP Range video streaming.

Drop it into any directory with thousands of videos and photos, and it instantly serves a responsive web gallery while indexing and generating thumbnails in the background.

---

## ⚡ Highlights

- **100% Offline**: Zero external CDN requests, zero tracking, and no external web fonts. Uses high-performance native system typography and inline SVGs.
- **Drop-in Portability**: Point it at any folder on your machine or external drive. It recursively scans and organizes all subfolders.
- **Background Scanner & Parallel Workers**:
  - Starts serving files immediately—no waiting for thousands of files to index.
  - Multi-threaded background thumbnail generation for both **videos** (via `ffmpeg` / Apple QuickLook) and **images** (via Pillow / Apple `sips`).
  - Stores persistent thumbnails and SQLite index inside `.vidsbrows_cache/` in the target folder so subsequent launches are instantaneous.
- **Large Library Scaling**:
  - Infinite scrolling with virtual DOM chunking via `IntersectionObserver`.
  - Fast indexed queries backed by SQLite WAL mode.
- **HTML5 Range Video Streaming**:
  - Native HTTP `206 Partial Content` support for smooth scrubbing and seeking in `.mp4`, `.webm`, `.mov`, `.mkv`, etc.
- **Unified Media Lightbox**:
  - Seamlessly view full-resolution pictures and stream videos.
  - Keyboard navigation (`←` / `→` arrows, `Space` to play/pause, `Esc` to close, `F` for fullscreen).

---

## 📁 Supported Media Formats

| Category | Extensions |
| :--- | :--- |
| **Videos** | `.mp4`, `.webm`, `.mov`, `.mkv`, `.avi`, `.m4v`, `.flv`, `.wmv`, `.ts`, `.3gp`, `.ogv` |
| **Pictures** | `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.tiff`, `.svg`, `.heic`, `.heif`, `.avif` |

---

## 🚀 Quick Start

### Option A: Browse the Current Folder
From any directory containing media:
```bash
python3 /Users/tomnom/git/vidsbrows/server.py
```

### Option B: Point to Any Folder or External Drive
```bash
python3 /Users/tomnom/git/vidsbrows/server.py /Volumes/MyDrive/PhotosAndVideos
```

### Option C: Copy/Symlink into Your Folder
Copy or symlink `vidsbrows` into your target directory and run:
```bash
python3 server.py
```

Open [http://localhost:8000](http://localhost:8000) in your web browser.

---

## ⚙️ Command Line Options

```text
usage: server.py [-h] [--port PORT] [--host HOST] [--workers WORKERS] [target_dir]

positional arguments:
  target_dir            Directory containing videos and pictures (default: current directory)

options:
  -h, --help            show this help message and exit
  --port, -p PORT       Port to bind (default: 8000)
  --host HOST           Host interface to bind (default: 127.0.0.1)
  --workers, -w WORKERS Number of background thumbnail workers (default: 2)
```

---

## 🗄️ How the Cache Works

Thumbnails and the database are saved directly in the **website's repository directory** under `.vidsbrows_cache/`, keeping your scanned media directories 100% untouched and clean:

```text
vidsbrows/                          # Website directory
├── server.py
├── static/
└── .vidsbrows_cache/               # All caches stored here
    └── <folder_name>_<hash>/       # Namespaced per media folder
        ├── library.db              # SQLite index (WAL mode)
        └── thumbnails/             # Cached 440px JPEG thumbnails
```

- **Clean Scanned Folders**: VidsBrows does not write any files to the folder you point it to.
- **Multiple Libraries Supported**: Each media folder you browse gets its own subfolder inside `vidsbrows/.vidsbrows_cache/`, so switching between different folders retains all cached thumbnails and indexes without re-scanning.
- `.vidsbrows_cache/` is automatically ignored in git.

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
| :--- | :--- |
| `←` / `→` | Previous / Next media in lightbox |
| `Space` | Play / Pause active video |
| `F` | Toggle fullscreen |
| `Esc` | Close lightbox / unfocus search |
