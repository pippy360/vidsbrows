# 🎬 VidsBrows

A sleek, lightweight video browsing and streaming web application built with plain HTML, CSS, JavaScript, and a zero-dependency Python backend.

---

## ✨ Features

- **Zero-Dependency Python Backend**: Uses Python's standard library (`http.server`) out of the box—no extra packages required.
- **HTTP Range Streaming**: Supports HTTP 206 Partial Content range requests, allowing smooth HTML5 video scrubbing and instant seeking.
- **Instant Demo Content**: Ships with built-in open-source sample video streams (Blender open movie clips) so you can test playback immediately.
- **Local File Discovery**: Automatically scans `./videos/` for local media files (`.mp4`, `.webm`, `.mov`, `.mkv`, `.ogg`, `.m4v`).
- **Responsive Dark UI**: Clean, modern media browser interface with real-time search, category filtering, responsive video card grid, and an interactive video modal player.
- **Keyboard Shortcuts**: Press `Esc` to dismiss the video player.

---

## 📁 Project Structure

```text
vidsbrows/
├── .gitignore         # Ignores large media files, pycache, OS files
├── README.md          # Project documentation
├── server.py          # Python HTTP server, REST APIs & streaming handler
├── static/            # Static frontend assets
│   ├── index.html     # HTML structure & media player modal
│   ├── css/
│   │   └── style.css  # Dark-mode styling, responsive grid & animations
│   └── js/
│       └── app.js     # Video state, search, filtering & modal logic
└── videos/            # Directory to drop local videos
    └── .gitkeep
```

---

## 🚀 Getting Started

### 1. Run the Server
From the repository directory, simply run:

```bash
python3 server.py
```

By default, the server starts on port `8000`. You can change the port with the `PORT` environment variable:

```bash
PORT=8080 python3 server.py
```

### 2. Open in Browser
Visit [http://localhost:8000](http://localhost:8000) in your web browser.

### 3. Add Local Videos
Drop any video files (`.mp4`, `.webm`, etc.) into the `videos/` directory and click the **🔄 Refresh** button in the top navigation bar.

---

## 🔌 API Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/videos` | `GET` | Returns list of local videos or fallback demo clips |
| `/api/status` | `GET` | Health check & repository video count |
| `/videos/<filename>` | `GET` | Stream video file with HTTP Range support |

---

## 🛠️ Roadmap & Future Ideas

- [ ] Drag-and-drop file upload directly through the web UI
- [ ] Automatic thumbnail extraction using `ffmpeg`
- [ ] SQLite database for custom titles, descriptions, and user ratings
- [ ] Playlist creation and watch history tracking
