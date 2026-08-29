#!/usr/bin/env python3
"""
vidsbrows - Offline Local Video & Picture Browser with Background Scanner & Thumbnail Generator.
Drop this into any folder or run:
    python3 server.py [TARGET_FOLDER] [--port 8000]

100% Offline: Zero external CDN dependencies, instant streaming, and responsive media viewer.
"""

import os
import sys
import re
import time
import json
import hashlib
import sqlite3
import argparse
import mimetypes
import threading
import subprocess
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

# Optional Pillow support
try:
    from PIL import Image, ImageOps
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

# Media file extensions
VIDEO_EXTENSIONS = {
    ".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".flv", ".wmv",
    ".ts", ".3gp", ".ogv", ".mpg", ".mpeg"
}

IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif",
    ".svg", ".heic", ".heif", ".avif", ".ico"
}

ALL_EXTENSIONS = VIDEO_EXTENSIONS | IMAGE_EXTENSIONS

# Ignored directory names during scanning
IGNORED_DIR_NAMES = {
    ".vidsbrows_cache", ".git", ".svn", ".hg", "node_modules",
    "__pycache__", ".vscode", ".idea", ".DS_Store", ".Trash", "venv", ".venv"
}


def format_bytes(size_bytes: int) -> str:
    """Format byte size into human-readable string."""
    if size_bytes is None:
        return "0 B"
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.1f} {unit}" if unit != 'B' else f"{size_bytes} B"
        size_bytes /= 1024.0
    return f"{size_bytes:.1f} PB"


def format_duration(seconds: float) -> str:
    """Format seconds into HH:MM:SS or MM:SS."""
    if not seconds or seconds <= 0:
        return ""
    total_sec = int(round(seconds))
    hours = total_sec // 3600
    minutes = (total_sec % 3600) // 60
    secs = total_sec % 60
    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def extract_video_duration(video_path: str) -> str:
    """Extract video duration using ffprobe or ffmpeg."""
    # Method 1: ffprobe
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(video_path)
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=5)
        if res.returncode == 0 and res.stdout.strip():
            sec = float(res.stdout.strip())
            return format_duration(sec)
    except Exception:
        pass

    # Method 2: ffmpeg -i parsing
    try:
        cmd = ["ffmpeg", "-hide_banner", "-i", str(video_path)]
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, timeout=5)
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+)", res.stderr)
        if m:
            h, m_val, s = map(int, m.groups())
            total = h * 3600 + m_val * 60 + s
            return format_duration(total)
    except Exception:
        pass

    return ""


class MediaLibrary:
    """Thread-safe SQLite database manager for media metadata and thumbnails."""

    def __init__(self, target_dir: Path, cache_dir: Path = None):
        self.target_dir = target_dir

        if cache_dir is not None:
            self.cache_dir = Path(cache_dir).resolve()
        else:
            # Save thumbnails & SQLite database in the website's directory
            website_dir = Path(__file__).resolve().parent
            dir_hash = hashlib.md5(str(target_dir.resolve()).encode("utf-8")).hexdigest()[:10]
            safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', target_dir.name or "root")
            self.cache_dir = website_dir / ".vidsbrows_cache" / f"{safe_name}_{dir_hash}"

        self.thumbs_dir = self.cache_dir / "thumbnails"
        self.db_path = self.cache_dir / "library.db"

        # Ensure directories exist
        self.thumbs_dir.mkdir(parents=True, exist_ok=True)

        self._lock = threading.Lock()
        self._init_db()

    def get_connection(self):
        """Create a connection with WAL mode enabled for high concurrency."""
        conn = sqlite3.connect(str(self.db_path), timeout=30.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _init_db(self):
        with self._lock:
            with self.get_connection() as conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS media (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        rel_path TEXT UNIQUE,
                        abs_path TEXT,
                        filename TEXT,
                        parent_dir TEXT,
                        media_type TEXT,
                        ext TEXT,
                        size_bytes INTEGER,
                        mtime REAL,
                        thumb_file TEXT,
                        thumb_status TEXT DEFAULT 'pending',
                        duration TEXT
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_rel_path ON media(rel_path);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_media_type ON media(media_type);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_parent_dir ON media(parent_dir);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_mtime ON media(mtime);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_thumb_status ON media(thumb_status);")

                # Auto-migrate table if duration column doesn't exist
                cursor = conn.execute("PRAGMA table_info(media)")
                cols = [row["name"] for row in cursor.fetchall()]
                if "duration" not in cols:
                    conn.execute("ALTER TABLE media ADD COLUMN duration TEXT;")

                conn.commit()

    def get_existing_file_map(self):
        """Returns dict of {rel_path: (mtime, size_bytes)} for fast change detection."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.execute("SELECT rel_path, mtime, size_bytes FROM media")
                return {row["rel_path"]: (row["mtime"], row["size_bytes"]) for row in cursor.fetchall()}

    def upsert_batch(self, items):
        """Bulk insert or update discovered media items."""
        if not items:
            return
        with self._lock:
            with self.get_connection() as conn:
                conn.executemany("""
                    INSERT INTO media (
                        rel_path, abs_path, filename, parent_dir, media_type, ext, size_bytes, mtime, thumb_status
                    ) VALUES (
                        :rel_path, :abs_path, :filename, :parent_dir, :media_type, :ext, :size_bytes, :mtime, 'pending'
                    ) ON CONFLICT(rel_path) DO UPDATE SET
                        abs_path=excluded.abs_path,
                        filename=excluded.filename,
                        parent_dir=excluded.parent_dir,
                        media_type=excluded.media_type,
                        ext=excluded.ext,
                        size_bytes=excluded.size_bytes,
                        mtime=excluded.mtime,
                        thumb_status='pending'
                    WHERE media.mtime != excluded.mtime OR media.size_bytes != excluded.size_bytes;
                """, items)
                conn.commit()

    def remove_missing_files(self, existing_rel_paths_set):
        """Clean up records for files that were deleted from disk."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.execute("SELECT id, rel_path FROM media")
                to_delete = [row["id"] for row in cursor.fetchall() if row["rel_path"] not in existing_rel_paths_set]
                if to_delete:
                    conn.executemany("DELETE FROM media WHERE id = ?", [(item_id,) for item_id in to_delete])
                    conn.commit()

    def get_pending_thumbnails(self, limit=50):
        """Fetch items waiting for thumbnail generation or video duration extraction."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.execute(
                    "SELECT id, abs_path, rel_path, media_type, ext, mtime, size_bytes, duration "
                    "FROM media WHERE thumb_status = 'pending' OR (media_type = 'video' AND (duration IS NULL OR duration = '')) "
                    "ORDER BY id DESC LIMIT ?",
                    (limit,)
                )
                return [dict(row) for row in cursor.fetchall()]

    def update_thumbnail(self, item_id, thumb_file, status='done', duration=None):
        """Update thumbnail status and duration for an item."""
        with self._lock:
            with self.get_connection() as conn:
                if duration:
                    conn.execute(
                        "UPDATE media SET thumb_file = ?, thumb_status = ?, duration = ? WHERE id = ?",
                        (thumb_file, status, duration, item_id)
                    )
                else:
                    conn.execute(
                        "UPDATE media SET thumb_file = ?, thumb_status = ? WHERE id = ?",
                        (thumb_file, status, item_id)
                    )
                conn.commit()

    def get_stats(self):
        """Get summary statistics."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.execute("""
                    SELECT 
                        COUNT(*) as total_media,
                        SUM(CASE WHEN media_type = 'video' THEN 1 ELSE 0 END) as videos_count,
                        SUM(CASE WHEN media_type = 'image' THEN 1 ELSE 0 END) as images_count,
                        SUM(CASE WHEN thumb_status = 'done' THEN 1 ELSE 0 END) as thumbs_done,
                        SUM(CASE WHEN thumb_status = 'pending' THEN 1 ELSE 0 END) as thumbs_pending
                    FROM media
                """)
                row = cursor.fetchone()
                return {
                    "total_media": row["total_media"] or 0,
                    "videos_count": row["videos_count"] or 0,
                    "images_count": row["images_count"] or 0,
                    "thumbs_done": row["thumbs_done"] or 0,
                    "thumbs_pending": row["thumbs_pending"] or 0,
                }

    def query_media(self, media_type=None, parent_dir=None, search_query=None, sort="date_desc", limit=60, offset=0, recursive=True):
        """Query media items with filtering and pagination."""
        clauses = []
        params = []

        if media_type and media_type != "all":
            clauses.append("media_type = ?")
            params.append(media_type)

        if parent_dir is not None and parent_dir != "" and parent_dir != "all":
            if recursive:
                clauses.append("(parent_dir = ? OR parent_dir LIKE ? || '/%')")
                params.extend([parent_dir, parent_dir])
            else:
                clauses.append("parent_dir = ?")
                params.append(parent_dir)

        if search_query:
            clauses.append("(filename LIKE ? OR rel_path LIKE ?)")
            pattern = f"%{search_query}%"
            params.extend([pattern, pattern])

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""

        sort_map = {
            "date_desc": "mtime DESC, id DESC",
            "date_asc": "mtime ASC, id ASC",
            "name_asc": "filename COLLATE NOCASE ASC",
            "name_desc": "filename COLLATE NOCASE DESC",
            "size_desc": "size_bytes DESC",
            "size_asc": "size_bytes ASC",
        }
        order_sql = sort_map.get(sort, "mtime DESC, id DESC")

        with self._lock:
            with self.get_connection() as conn:
                count_cursor = conn.execute(f"SELECT COUNT(*) as count FROM media {where_sql}", params)
                total_count = count_cursor.fetchone()["count"]

                query_params = list(params) + [limit, offset]
                cursor = conn.execute(f"""
                    SELECT id, rel_path, filename, parent_dir, media_type, ext, size_bytes, mtime, thumb_file, thumb_status, duration
                    FROM media {where_sql}
                    ORDER BY {order_sql}
                    LIMIT ? OFFSET ?
                """, query_params)
                items = [dict(row) for row in cursor.fetchall()]

        # Format items for API output
        formatted_items = []
        for item in items:
            dt_str = time.strftime("%Y-%m-%d %H:%M", time.localtime(item["mtime"])) if item["mtime"] else ""
            formatted_items.append({
                "id": item["id"],
                "filename": item["filename"],
                "rel_path": item["rel_path"],
                "parent_dir": item["parent_dir"] or "Root",
                "media_type": item["media_type"],
                "ext": item["ext"],
                "size_formatted": format_bytes(item["size_bytes"]),
                "size_bytes": item["size_bytes"],
                "mtime": item["mtime"],
                "date_formatted": dt_str,
                "duration": item.get("duration") or "",
                "thumb_url": f"/api/thumbnail?id={item['id']}",
                "media_url": f"/api/file?id={item['id']}",
                "has_thumb": bool(item["thumb_file"] and item["thumb_status"] == 'done'),
                "thumb_status": item["thumb_status"]
            })

        return {
            "items": formatted_items,
            "total_count": total_count,
            "offset": offset,
            "limit": limit,
            "has_more": (offset + limit) < total_count
        }

    def get_folders(self, current_folder=""):
        """Get hierarchical subfolders, breadcrumbs, and flat folder list."""
        curr = (current_folder or "").strip("/").strip()
        if curr == "all" or curr == "Root":
            curr = ""

        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.execute("""
                    SELECT 
                        parent_dir, 
                        COUNT(*) as total_count,
                        SUM(CASE WHEN media_type = 'video' THEN 1 ELSE 0 END) as videos_count,
                        SUM(CASE WHEN media_type = 'image' THEN 1 ELSE 0 END) as images_count,
                        MAX(CASE WHEN thumb_status = 'done' THEN id ELSE id END) as preview_id
                    FROM media 
                    GROUP BY parent_dir 
                    ORDER BY parent_dir ASC
                """)
                rows = [dict(r) for r in cursor.fetchall()]

        # Compute breadcrumbs
        breadcrumbs = [{"name": "All Folders", "path": ""}]
        if curr:
            parts = curr.split("/")
            accum = []
            for p in parts:
                accum.append(p)
                breadcrumbs.append({"name": p, "path": "/".join(accum)})

        # Compute direct subfolders under current folder
        prefix = (curr + "/") if curr else ""
        subfolders_map = {}

        for r in rows:
            p = (r["parent_dir"] or "").strip("/")
            if not p:
                continue
            if prefix:
                if not p.startswith(prefix):
                    continue
                rem = p[len(prefix):]
            else:
                rem = p

            parts = rem.split("/")
            child_name = parts[0]
            child_full_path = (prefix + child_name) if prefix else child_name

            if child_name not in subfolders_map:
                subfolders_map[child_name] = {
                    "name": child_name,
                    "path": child_full_path,
                    "total_items": 0,
                    "videos_count": 0,
                    "images_count": 0,
                    "preview_id": r["preview_id"]
                }

            subfolders_map[child_name]["total_items"] += r["total_count"]
            subfolders_map[child_name]["videos_count"] += r["videos_count"]
            subfolders_map[child_name]["images_count"] += r["images_count"]
            if not subfolders_map[child_name]["preview_id"] and r["preview_id"]:
                subfolders_map[child_name]["preview_id"] = r["preview_id"]

        # Flat list of all folders for dropdown
        all_folders = []
        for r in rows:
            folder_name = r["parent_dir"] or "Root"
            all_folders.append({
                "folder": folder_name,
                "path": r["parent_dir"] or "",
                "count": r["total_count"]
            })

        return {
            "current_folder": curr,
            "breadcrumbs": breadcrumbs,
            "subfolders": sorted(list(subfolders_map.values()), key=lambda x: x["name"].lower()),
            "all_folders": all_folders
        }

    def get_item_by_id(self, item_id):
        """Get single media record by ID."""
        with self._lock:
            with self.get_connection() as conn:
                cursor = conn.execute("SELECT * FROM media WHERE id = ?", (item_id,))
                row = cursor.fetchone()
                return dict(row) if row else None


class ScannerManager:
    """Manages background discovery and thumbnail generation workers."""

    def __init__(self, target_dir: Path, media_lib: MediaLibrary, num_workers=2):
        self.target_dir = target_dir
        self.media_lib = media_lib
        self.num_workers = num_workers

        self.status = "idle"
        self.current_folder = ""
        self.last_scan_time = 0
        self.stop_event = threading.Event()

        # Start initial scan thread
        self.start_scan()

        # Start thumbnail worker threads
        self.worker_threads = []
        for i in range(num_workers):
            t = threading.Thread(target=self._thumbnail_worker, name=f"ThumbWorker-{i+1}", daemon=True)
            t.start()
            self.worker_threads.append(t)

    def start_scan(self):
        """Trigger background directory scan."""
        if self.status == "scanning":
            return
        t = threading.Thread(target=self._run_scan, daemon=True)
        t.start()

    def _run_scan(self):
        self.status = "scanning"
        start_time = time.time()
        print(f"[*] Starting media scan in: {self.target_dir}")

        existing_map = self.media_lib.get_existing_file_map()
        discovered_rel_paths = set()
        batch = []
        BATCH_SIZE = 100

        try:
            for root, dirs, files in os.walk(self.target_dir, topdown=True, followlinks=False):
                if self.stop_event.is_set():
                    break

                # Filter out ignored directories in-place
                dirs[:] = [d for d in dirs if not d.startswith(".") and d not in IGNORED_DIR_NAMES]

                rel_root = os.path.relpath(root, self.target_dir)
                parent_dir = "" if rel_root == "." else rel_root
                self.current_folder = parent_dir or "Root"

                for filename in files:
                    if filename.startswith("."):
                        continue

                    ext = os.path.splitext(filename)[1].lower()
                    if ext not in ALL_EXTENSIONS:
                        continue

                    abs_path = os.path.join(root, filename)
                    rel_path = os.path.relpath(abs_path, self.target_dir)
                    discovered_rel_paths.add(rel_path)

                    try:
                        stat = os.stat(abs_path)
                        mtime = stat.st_mtime
                        size_bytes = stat.st_size
                    except OSError:
                        continue

                    # Check if already in DB unchanged
                    if rel_path in existing_map:
                        prev_mtime, prev_size = existing_map[rel_path]
                        if abs(prev_mtime - mtime) < 0.001 and prev_size == size_bytes:
                            continue

                    media_type = "video" if ext in VIDEO_EXTENSIONS else "image"
                    batch.append({
                        "rel_path": rel_path,
                        "abs_path": abs_path,
                        "filename": filename,
                        "parent_dir": parent_dir,
                        "media_type": media_type,
                        "ext": ext,
                        "size_bytes": size_bytes,
                        "mtime": mtime
                    })

                    if len(batch) >= BATCH_SIZE:
                        self.media_lib.upsert_batch(batch)
                        batch.clear()

            # Insert remaining items
            if batch:
                self.media_lib.upsert_batch(batch)
                batch.clear()

            # Remove deleted files
            self.media_lib.remove_missing_files(discovered_rel_paths)

        except Exception as e:
            print(f"[!] Error during scan: {e}", file=sys.stderr)
        finally:
            self.status = "idle"
            self.current_folder = ""
            self.last_scan_time = time.time()
            elapsed = self.last_scan_time - start_time
            stats = self.media_lib.get_stats()
            print(f"[✓] Scan complete in {elapsed:.2f}s! Found {stats['total_media']} items ({stats['videos_count']} videos, {stats['images_count']} images).")

    def _thumbnail_worker(self):
        """Worker thread processing pending thumbnails."""
        while not self.stop_event.is_set():
            items = self.media_lib.get_pending_thumbnails(limit=20)
            if not items:
                time.sleep(1.0)
                continue

            for item in items:
                if self.stop_event.is_set():
                    break
                self._generate_thumbnail_for_item(item)

    def _generate_thumbnail_for_item(self, item):
        item_id = item["id"]
        abs_path = item["abs_path"]
        rel_path = item["rel_path"]
        mtime = item["mtime"]
        size_bytes = item["size_bytes"]
        media_type = item["media_type"]

        if not os.path.exists(abs_path):
            self.media_lib.update_thumbnail(item_id, None, status='failed')
            return None

        # Deterministic thumb hash
        hash_input = f"{rel_path}_{mtime}_{size_bytes}".encode("utf-8")
        thumb_filename = f"{hashlib.md5(hash_input).hexdigest()}.jpg"
        dest_path = self.media_lib.thumbs_dir / thumb_filename

        # Extract duration for video files
        duration_str = None
        if media_type == "video":
            duration_str = extract_video_duration(abs_path)

        # If already exists on disk
        if dest_path.exists() and dest_path.stat().st_size > 0:
            self.media_lib.update_thumbnail(item_id, thumb_filename, status='done', duration=duration_str)
            return dest_path

        success = False
        try:
            if media_type == "image":
                success = self._generate_image_thumbnail(abs_path, dest_path)
            elif media_type == "video":
                success = self._generate_video_thumbnail(abs_path, dest_path)
        except Exception as e:
            # Fallback
            success = False

        if success and dest_path.exists() and dest_path.stat().st_size > 0:
            self.media_lib.update_thumbnail(item_id, thumb_filename, status='done', duration=duration_str)
            return dest_path
        else:
            self.media_lib.update_thumbnail(item_id, None, status='failed', duration=duration_str)
            return None

    def _generate_image_thumbnail(self, src_path: str, dest_path: Path) -> bool:
        # Method 1: Pillow if installed
        if HAS_PIL:
            try:
                with Image.open(src_path) as img:
                    img = ImageOps.exif_transpose(img)
                    if img.mode not in ("RGB", "L"):
                        img = img.convert("RGB")
                    img.thumbnail((440, 440), Image.Resampling.LANCZOS)
                    img.save(str(dest_path), "JPEG", quality=80, optimize=True)
                return True
            except Exception:
                pass

        # Method 2: macOS sips
        try:
            cmd = ["sips", "-s", "format", "jpeg", "-Z", "440", src_path, "--out", str(dest_path)]
            res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            if res.returncode == 0 and dest_path.exists():
                return True
        except Exception:
            pass

        return False

    def _generate_video_thumbnail(self, src_path: str, dest_path: Path) -> bool:
        # Method 1: ffmpeg
        try:
            # Seek to 1s
            cmd = [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-ss", "00:00:01",
                "-i", src_path,
                "-vframes", "1",
                "-vf", "scale=440:440:force_original_aspect_ratio=decrease",
                "-q:v", "4",
                str(dest_path)
            ]
            res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=12)
            if res.returncode == 0 and dest_path.exists() and dest_path.stat().st_size > 0:
                return True

            # If 1s seek failed (e.g. very short video), seek to 0s
            cmd[5] = "00:00:00"
            res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            if res.returncode == 0 and dest_path.exists() and dest_path.stat().st_size > 0:
                return True
        except Exception:
            pass

        # Method 2: macOS QuickLook qlmanage
        try:
            tmp_dir = dest_path.parent
            cmd = ["qlmanage", "-t", "-s", "440", "-o", str(tmp_dir), src_path]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            # qlmanage outputs <filename>.png
            base_name = os.path.basename(src_path)
            ql_thumb = tmp_dir / f"{base_name}.png"
            if ql_thumb.exists():
                # Convert png to jpg destination
                if HAS_PIL:
                    with Image.open(str(ql_thumb)) as img:
                        img.convert("RGB").save(str(dest_path), "JPEG", quality=80)
                    ql_thumb.unlink(missing_ok=True)
                    return True
                else:
                    ql_thumb.rename(dest_path)
                    return True
        except Exception:
            pass

        return False

    def get_or_generate_thumbnail(self, item_id: int):
        """Synchronously get or generate thumbnail on demand for fast UI response."""
        item = self.media_lib.get_item_by_id(item_id)
        if not item:
            return None

        if item["thumb_file"]:
            p = self.media_lib.thumbs_dir / item["thumb_file"]
            if p.exists() and p.stat().st_size > 0:
                return p

        # Generate on the fly
        return self._generate_thumbnail_for_item(item)

    def get_status_summary(self):
        stats = self.media_lib.get_stats()
        return {
            "status": self.status,
            "target_dir": str(self.target_dir),
            "target_name": self.target_dir.name or str(self.target_dir),
            "total_media": stats["total_media"],
            "videos_count": stats["videos_count"],
            "images_count": stats["images_count"],
            "thumbs_done": stats["thumbs_done"],
            "thumbs_pending": stats["thumbs_pending"],
            "current_folder": self.current_folder,
            "last_scan_time": self.last_scan_time
        }


class VidsBrowsHTTPHandler(BaseHTTPRequestHandler):
    """Zero-dependency HTTP Handler with streaming, API, and offline static assets."""

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def send_svg_placeholder(self, media_type="video"):
        """Serve an offline embedded SVG fallback icon if thumbnail is pending."""
        icon = "🎬" if media_type == "video" else "📷"
        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225">
            <rect width="400" height="225" fill="#151a26"/>
            <text x="200" y="120" font-size="48" text-anchor="middle" dominant-baseline="central" fill="#475569">{icon}</text>
        </svg>""".encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "image/svg+xml")
        self.send_header("Content-Length", str(len(svg)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(svg)

    def do_HEAD(self):
        self.handle_request(is_head=True)

    def do_GET(self):
        self.handle_request(is_head=False)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path == "/api/rescan":
            self.server.scanner_mgr.start_scan()
            self.send_json({"ok": True, "message": "Scan triggered"})
            return
        self.send_error(404, "Endpoint not found")

    def handle_request(self, is_head=False):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        qs = parse_qs(parsed.query)

        # 1. API Endpoints
        if path == "/api/scan_status":
            if is_head:
                self.send_response(200)
                self.end_headers()
                return
            summary = self.server.scanner_mgr.get_status_summary()
            self.send_json(summary)
            return

        if path == "/api/media":
            if is_head:
                self.send_response(200)
                self.end_headers()
                return
            media_type = qs.get("type", ["all"])[0]
            folder = qs.get("folder", [None])[0]
            if folder == "all" or folder == "":
                folder = None
            q = qs.get("q", [None])[0]
            sort = qs.get("sort", ["date_desc"])[0]
            limit = min(int(qs.get("limit", [60])[0]), 200)
            offset = int(qs.get("offset", [0])[0])
            recursive = qs.get("recursive", ["1"])[0].lower() in ("1", "true", "yes")

            result = self.server.media_lib.query_media(
                media_type=media_type,
                parent_dir=folder,
                search_query=q,
                sort=sort,
                limit=limit,
                offset=offset,
                recursive=recursive
            )
            self.send_json(result)
            return

        if path == "/api/folders":
            if is_head:
                self.send_response(200)
                self.end_headers()
                return
            folder = qs.get("folder", [""])[0]
            folder_data = self.server.media_lib.get_folders(current_folder=folder)
            self.send_json(folder_data)
            return

        # 2. Thumbnail Request
        if path == "/api/thumbnail":
            item_id = qs.get("id", [None])[0]
            if not item_id:
                self.send_error(400, "Missing id")
                return

            try:
                item_id = int(item_id)
            except ValueError:
                self.send_error(400, "Invalid id")
                return

            thumb_path = self.server.scanner_mgr.get_or_generate_thumbnail(item_id)
            if thumb_path and thumb_path.exists():
                self.serve_file(thumb_path, "image/jpeg", is_head=is_head, cache_control="public, max-age=86400")
            else:
                item = self.server.media_lib.get_item_by_id(item_id)
                media_type = item["media_type"] if item else "video"
                if not is_head:
                    self.send_svg_placeholder(media_type)
                else:
                    self.send_response(200)
                    self.send_header("Content-Type", "image/svg+xml")
                    self.end_headers()
            return

        # 3. Full Media File Request (Video or Full Image)
        if path == "/api/file":
            item_id = qs.get("id", [None])[0]
            if not item_id:
                self.send_error(400, "Missing id")
                return

            try:
                item_id = int(item_id)
            except ValueError:
                self.send_error(400, "Invalid id")
                return

            item = self.server.media_lib.get_item_by_id(item_id)
            if not item:
                self.send_error(404, "Item not found")
                return

            file_path = Path(item["abs_path"])
            if not file_path.exists() or not file_path.is_file():
                self.send_error(404, "File missing from disk")
                return

            mime_type, _ = mimetypes.guess_type(str(file_path))
            if not mime_type:
                mime_type = "video/mp4" if item["media_type"] == "video" else "image/jpeg"

            if item["media_type"] == "video":
                self.serve_media_with_range(file_path, mime_type, is_head=is_head)
            else:
                self.serve_file(file_path, mime_type, is_head=is_head)
            return

        # 4. Static Frontend Assets
        if path == "/" or path == "":
            path = "/index.html"

        clean_rel_path = path.lstrip("/")
        static_file = (self.server.static_dir / clean_rel_path).resolve()

        # Security check: must remain within static_dir
        if not str(static_file).startswith(str(self.server.static_dir.resolve())) or not static_file.exists() or not static_file.is_file():
            self.send_error(404, "File not found")
            return

        mime_type, _ = mimetypes.guess_type(str(static_file))
        if not mime_type:
            mime_type = "application/octet-stream"
        if "text" in mime_type or "javascript" in mime_type:
            mime_type += "; charset=utf-8"

        self.serve_file(static_file, mime_type, is_head=is_head)

    def serve_file(self, file_path: Path, content_type: str, is_head=False, cache_control="no-cache"):
        try:
            file_size = file_path.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(file_size))
            self.send_header("Cache-Control", cache_control)
            self.end_headers()
            if not is_head:
                with open(file_path, "rb") as f:
                    # Stream in 64k chunks
                    while chunk := f.read(65536):
                        self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            self.send_error(500, f"Server error: {e}")

    def serve_media_with_range(self, file_path: Path, mime_type: str, is_head=False):
        """Serve media file supporting HTTP 206 Range requests for instant video seeking."""
        try:
            file_size = file_path.stat().st_size
            range_header = self.headers.get("Range")

            if not range_header:
                self.send_response(200)
                self.send_header("Content-Type", mime_type)
                self.send_header("Content-Length", str(file_size))
                self.send_header("Accept-Ranges", "bytes")
                self.end_headers()
                if not is_head:
                    with open(file_path, "rb") as f:
                        while chunk := f.read(65536):
                            self.wfile.write(chunk)
                return

            # Range: bytes=start-end
            match = re.match(r"bytes=(\d+)-(\d*)", range_header)
            if not match:
                self.send_error(416, "Invalid range")
                return

            start_str, end_str = match.groups()
            start = int(start_str)
            end = int(end_str) if end_str else file_size - 1

            if start >= file_size or end >= file_size or start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{file_size}")
                self.end_headers()
                return

            chunk_length = end - start + 1
            self.send_response(206)
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
            self.send_header("Content-Length", str(chunk_length))
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()

            if is_head:
                return

            with open(file_path, "rb") as f:
                f.seek(start)
                remaining = chunk_length
                while remaining > 0:
                    read_size = min(remaining, 65536)
                    data = f.read(read_size)
                    if not data:
                        break
                    self.wfile.write(data)
                    remaining -= len(data)

        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            self.send_error(500, f"Streaming error: {e}")

    def log_message(self, format, *args):
        # Keep console output concise; suppress noisy 200/206/304 logs
        pass


class VidsBrowsServer(HTTPServer):
    """Extended HTTPServer with references to scanner and media library."""

    def __init__(self, server_address, RequestHandlerClass, target_dir: Path, static_dir: Path, workers=2, cache_dir=None):
        super().__init__(server_address, RequestHandlerClass)
        self.target_dir = target_dir
        self.static_dir = static_dir
        self.media_lib = MediaLibrary(target_dir, cache_dir=cache_dir)
        self.scanner_mgr = ScannerManager(target_dir, self.media_lib, num_workers=workers)


def main():
    parser = argparse.ArgumentParser(description="VidsBrows - Offline Local Video & Picture Browser")
    parser.add_argument("target_dir", nargs="?", default=".", help="Directory containing videos and pictures (default: current directory)")
    parser.add_argument("--port", "-p", type=int, default=8000, help="Port to bind (default: 8000)")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind (default: 127.0.0.1)")
    parser.add_argument("--workers", "-w", type=int, default=2, help="Number of background thumbnail workers (default: 2)")
    parser.add_argument("--cache-dir", default=None, help="Directory to store thumbnails & DB (default: <website_dir>/.vidsbrows_cache/<folder>_<hash>)")

    args = parser.parse_args()

    target_path = Path(args.target_dir).resolve()
    if not target_path.exists() or not target_path.is_dir():
        print(f"Error: Target directory does not exist: {target_path}", file=sys.stderr)
        sys.exit(1)

    # Locate static web assets:
    # 1. Adjacent to this script (e.g. vidsbrows/static)
    # 2. Inside target_dir/static
    script_dir = Path(__file__).resolve().parent
    static_path = script_dir / "static"
    if not static_path.exists():
        static_path = target_path / "static"

    if not static_path.exists():
        print(f"Error: 'static' directory not found in {script_dir} or {target_path}", file=sys.stderr)
        sys.exit(1)

    port = int(os.environ.get("PORT", args.port))
    server = VidsBrowsServer(
        (args.host, port), 
        VidsBrowsHTTPHandler, 
        target_path, 
        static_path, 
        workers=args.workers,
        cache_dir=Path(args.cache_dir).resolve() if args.cache_dir else None
    )

    print("\n" + "=" * 65)
    print("  🎬  VidsBrows - Offline Media Browser & Streaming Server")
    print("=" * 65)
    print(f"  📁 Browsing Directory : {target_path}")
    print(f"  ⚡ Web Interface      : http://{args.host}:{port}/")
    print(f"  💾 Cache & Thumbnails : {server.media_lib.cache_dir}")
    print(f"  ⚙️  Thumbnail Workers  : {args.workers} background threads")
    print("=" * 65)
    print("  Press Ctrl+C to stop the server.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Stopping VidsBrows...")
        server.scanner_mgr.stop_event.set()
        server.server_close()
        print("[✓] Server stopped.")


if __name__ == "__main__":
    main()
