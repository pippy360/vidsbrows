#!/usr/bin/env python3
"""
vidsbrows - Lightweight Video Browser & Streaming Server
A zero-dependency Python backend serving modern plain HTML/CSS/JS frontend
and providing video browsing REST APIs and HTTP Range streaming.
"""

import os
import re
import json
import mimetypes
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
VIDEOS_DIR = BASE_DIR / "videos"

# Supported video file extensions
VIDEO_EXTENSIONS = {".mp4", ".webm", ".ogg", ".mov", ".mkv", ".m4v"}

# Built-in sample video items to show when no local videos are in videos/
SAMPLE_VIDEOS = [
    {
        "id": "sample-1",
        "title": "Big Buck Bunny (Animation Short)",
        "filename": "sample_bunny.mp4",
        "url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
        "thumbnail": "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop&q=80",
        "duration": "9:56",
        "tag": "Animation",
        "category": "Creative Commons",
        "is_sample": True,
        "description": "Blender Foundation open source classic cartoon short film."
    },
    {
        "id": "sample-2",
        "title": "Elephants Dream (Sci-Fi Short)",
        "filename": "sample_elephants.mp4",
        "url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
        "thumbnail": "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80",
        "duration": "10:53",
        "tag": "Sci-Fi",
        "category": "Open Movie",
        "is_sample": True,
        "description": "The world's first open computer generated movie by the Orange Open Movie Project."
    },
    {
        "id": "sample-3",
        "title": "For Bigger Blazes (Chromecast Showcase)",
        "filename": "sample_blazes.mp4",
        "url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
        "thumbnail": "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600&auto=format&fit=crop&q=80",
        "duration": "0:15",
        "tag": "Short",
        "category": "Tech Demo",
        "is_sample": True,
        "description": "Short high definition clip demonstrating color depth and dynamic range."
    },
    {
        "id": "sample-4",
        "title": "Tears of Steel (VFX Open Movie)",
        "filename": "sample_tears.mp4",
        "url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
        "thumbnail": "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=600&auto=format&fit=crop&q=80",
        "duration": "12:14",
        "tag": "VFX",
        "category": "Open Movie",
        "is_sample": True,
        "description": "Sci-fi short film set in a dystopian future exploring open visual effects."
    }
]


def format_bytes(size_bytes: int) -> str:
    """Format file size in human-readable string."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.1f} {unit}" if unit != 'B' else f"{size_bytes} B"
        size_bytes /= 1024.0
    return f"{size_bytes:.1f} TB"


def scan_local_videos():
    """Scans the videos directory and returns video metadata list."""
    videos = []
    if not VIDEOS_DIR.exists():
        VIDEOS_DIR.mkdir(parents=True, exist_ok=True)

    for idx, path in enumerate(sorted(VIDEOS_DIR.iterdir())):
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS:
            stat = path.stat()
            # Generate a readable title from filename
            clean_title = path.stem.replace("-", " ").replace("_", " ").title()
            videos.append({
                "id": f"local-{idx + 1}",
                "title": clean_title,
                "filename": path.name,
                "url": f"/videos/{path.name}",
                "thumbnail": "",
                "duration": "Local File",
                "tag": path.suffix.lower().lstrip(".").upper(),
                "category": "Local Library",
                "size": format_bytes(stat.st_size),
                "bytes": stat.st_size,
                "is_sample": False,
                "description": f"Local media file ({path.suffix.lower()}) located in ./videos/"
            })
    return videos


class VidsBrowsRequestHandler(BaseHTTPRequestHandler):
    """Custom request handler with API endpoints and HTTP Range video streaming."""

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        # Allow HEAD requests using the same headers as GET
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path == "/" or path == "":
            path = "/index.html"
        clean_rel_path = path.lstrip("/")
        file_path = (STATIC_DIR / clean_rel_path).resolve()
        if file_path.exists() and file_path.is_file():
            mime_type, _ = mimetypes.guess_type(str(file_path))
            self.send_response(200)
            self.send_header("Content-Type", mime_type or "application/octet-stream")
            self.send_header("Content-Length", str(file_path.stat().st_size))
            self.end_headers()
        else:
            self.send_response(200)
            self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        # 1. API Endpoints
        if path == "/api/status":
            local_videos = scan_local_videos()
            self.send_json({
                "status": "online",
                "version": "0.1.0",
                "local_video_count": len(local_videos),
                "total_available": len(local_videos) if local_videos else len(SAMPLE_VIDEOS)
            })
            return

        if path == "/api/videos":
            local = scan_local_videos()
            response = {
                "source": "local" if local else "sample",
                "has_local_videos": bool(local),
                "videos": local if local else SAMPLE_VIDEOS,
                "videos_dir": str(VIDEOS_DIR)
            }
            self.send_json(response)
            return

        # 2. Local Video Streaming with Range Support
        if path.startswith("/videos/"):
            filename = os.path.basename(path)
            video_file = VIDEOS_DIR / filename
            if not video_file.exists() or not video_file.is_file():
                self.send_error(404, "Video file not found")
                return

            self.serve_file_with_range(video_file)
            return

        # 3. Static Files (Frontend)
        if path == "/" or path == "":
            path = "/index.html"

        # Sanitize static path
        clean_rel_path = path.lstrip("/")
        file_path = (STATIC_DIR / clean_rel_path).resolve()

        if not str(file_path).startswith(str(STATIC_DIR.resolve())) or not file_path.exists() or not file_path.is_file():
            self.send_error(404, "File not found")
            return

        mime_type, _ = mimetypes.guess_type(str(file_path))
        if not mime_type:
            mime_type = "application/octet-stream"

        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", f"{mime_type}; charset=utf-8" if "text" in mime_type or "javascript" in mime_type else mime_type)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, f"Error reading file: {e}")

    def serve_file_with_range(self, file_path: Path):
        """Serve media files supporting HTTP 206 Partial Content for video seeking."""
        file_size = file_path.stat().st_size
        mime_type, _ = mimetypes.guess_type(str(file_path))
        if not mime_type:
            mime_type = "video/mp4"

        range_header = self.headers.get("Range", None)
        if not range_header:
            # Full file transfer
            self.send_response(200)
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", str(file_size))
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            with open(file_path, "rb") as f:
                self.wfile.write(f.read())
            return

        # Parse Range: bytes=start-end
        match = re.match(r"bytes=(\d+)-(\d*)", range_header)
        if not match:
            self.send_error(416, "Requested Range Not Satisfiable")
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

        with open(file_path, "rb") as f:
            f.seek(start)
            remaining = chunk_length
            chunk_size = 64 * 1024  # 64KB chunks
            while remaining > 0:
                read_bytes = min(remaining, chunk_size)
                data = f.read(read_bytes)
                if not data:
                    break
                self.wfile.write(data)
                remaining -= len(data)

    def log_message(self, format, *args):
        # Clean terminal logging
        print(f"[{self.log_date_time_string()}] {self.command} {self.path} -> {args[1] if len(args) > 1 else ''}")


def run_server(host="127.0.0.1", port=8000):
    server_address = (host, port)
    httpd = HTTPServer(server_address, VidsBrowsRequestHandler)
    print("=" * 60)
    print(f"  🎬 VidsBrows Server Running!")
    print(f"  ➜ Frontend UI : http://{host}:{port}/")
    print(f"  ➜ API Videos  : http://{host}:{port}/api/videos")
    print(f"  ➜ Status      : http://{host}:{port}/api/status")
    print(f"  ➜ Drop videos in: {VIDEOS_DIR}")
    print("=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        httpd.server_close()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    run_server(port=port)
