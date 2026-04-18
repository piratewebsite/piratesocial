/** @jsxImportSource preact */
import { useState, useRef, useCallback, useMemo } from 'preact/hooks';

function getYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?\s]+)/);
  return m ? m[1] : null;
}

const defaults = {
  audioPlayer: '♫ Audio Player',
  videoPlayer: '▶ Player',
  play: 'Play',
  pause: 'Pause',
  previous: 'Previous',
  next: 'Next',
  playlist: 'Playlist',
  minimize: 'Minimize',
  expand: 'Expand player',
  changePosition: 'Change position',
  track: 'Track',
  youtubeVideo: 'YouTube video',
};

export default function YouTubePlayer({ url, heading, caption, audioOnly, display = 'docked', tracks, layout = 'contained', labels: userLabels = {}, startTime, endTime }) {
  const L = { ...defaults, ...userLabels };
  const isFloating = display === 'floating';
  const [currentIndex, setCurrentIndex] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState({ side: 'bottom' });
  const [dragOffset, setDragOffset] = useState(null);
  const [dragPos, setDragPos] = useState(null);
  const containerRef = useRef(null);

  // Build playlist
  const playlist = useMemo(() => {
    const items = [];
    const mainId = getYouTubeId(url);
    if (mainId) items.push({
      id: mainId,
      title: heading || `${L.track} 1`,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
    });
    if (tracks && tracks.length) {
      tracks.forEach((t) => {
        const tid = getYouTubeId(t.url);
        if (tid) items.push({
          id: tid,
          title: t.title || `${L.track} ${items.length + 1}`,
          startTime: t.startTime || undefined,
          endTime: t.endTime || undefined,
        });
      });
    }
    return items;
  }, [url, heading, tracks, startTime, endTime]);

  if (playlist.length === 0) return null;

  const current = playlist[currentIndex];
  const embedUrl = `https://www.youtube-nocookie.com/embed/${current.id}?autoplay=0&muted=1&controls=1&modestbranding=1&rel=0&playsinline=1${current.startTime ? `&start=${Math.floor(current.startTime)}` : ''}${current.endTime ? `&end=${Math.floor(current.endTime)}` : ''}`;

  const handleDragStart = useCallback((e) => {
    if (!isFloating || e.target.closest('button, input, [role="button"]')) return;
    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setDragOffset({ x: touch.clientX - rect.left, y: touch.clientY - rect.top });
    }
  }, [isFloating]);

  const handleDragMove = useCallback((e) => {
    if (!dragOffset) return;
    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;
    const x = Math.max(0, Math.min(window.innerWidth - 60, touch.clientX - dragOffset.x));
    const y = Math.max(0, Math.min(window.innerHeight - 60, touch.clientY - dragOffset.y));
    setDragPos({ x, y });
  }, [dragOffset]);

  const handleDragEnd = useCallback(() => {
    setDragOffset(null);
  }, []);

  // Simplified player for docked layout
  if (!isFloating) {
    return (
      <section class={`mb-12 ${layout === 'full' ? '' : 'max-w-4xl mx-auto'}`}>
        {heading && <h2 class="mb-4 text-xl font-semibold">{heading}</h2>}
        <div class="rounded-lg overflow-hidden mb-3">
          <div style="aspect-ratio:16/9;background:#000;width:100%">
            <iframe
              width="100%"
              height="100%"
              src={embedUrl}
              title={L.youtubeVideo}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ border: 'none', display: 'block' }}
            />
          </div>
        </div>

        {/* Controls */}
        <div class="rounded-lg border overflow-hidden" style="border-color:var(--ps-card-border);background:var(--ps-card-bg)">
          <div class="flex items-center gap-3 p-4">
            {playlist.length > 1 && (
              <>
                <button onClick={() => setCurrentIndex(p => p > 0 ? p - 1 : playlist.length - 1)} class="p-2 rounded" style="color:var(--ps-text-muted)" title={L.previous}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="19,20 9,12 19,4" /><rect x="5" y="4" width="3" height="16" /></svg>
                </button>
                <button onClick={() => setCurrentIndex(p => p < playlist.length - 1 ? p + 1 : 0)} class="p-2 rounded" style="color:var(--ps-text-muted)" title={L.next}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,4 15,12 5,20" /><rect x="16" y="4" width="3" height="16" /></svg>
                </button>
              </>
            )}
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate" style="color:var(--ps-text)">{current.title}</div>
            </div>
          </div>
          {playlist.length > 1 && (
            <div class="border-t px-2 py-2" style="border-color:var(--ps-border)">
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(50px,1fr));gap:4px">
                {playlist.map((track, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentIndex(i)}
                    class="px-2 py-1 text-xs rounded font-medium transition"
                    style={{
                      background: i === currentIndex ? 'var(--ps-primary)' : 'var(--ps-surface)',
                      color: i === currentIndex ? '#fff' : 'var(--ps-text)',
                    }}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  // Floating player
  const pos = dragPos ? { left: `${dragPos.x}px`, top: `${dragPos.y}px` } : { bottom: '20px', right: '20px' };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        zIndex: 9999,
        transition: dragOffset ? 'none' : 'all 0.3s ease',
        ...pos,
        width: minimized ? '48px' : '320px',
      }}
      onMouseDown={handleDragStart}
      onMouseMove={handleDragMove}
      onMouseUp={handleDragEnd}
      onMouseLeave={handleDragEnd}
      onTouchStart={handleDragStart}
      onTouchMove={handleDragMove}
      onTouchEnd={handleDragEnd}
    >
      {minimized ? (
        <button
          onClick={() => setMinimized(false)}
          class="w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
          style="background:var(--ps-primary);color:#fff"
          title={L.expand}
        >
          ▶
        </button>
      ) : (
        <div class="rounded-lg overflow-hidden shadow-lg" style="background:#000;border-radius:12px">
          <div style="aspect-ratio:16/9;background:#000">
            <iframe
              width="100%"
              height="100%"
              src={embedUrl}
              title={L.youtubeVideo}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ border: 'none', display: 'block' }}
            />
          </div>

          {/* Mini controls */}
          <div class="px-3 py-2 text-xs" style="background:rgba(0,0,0,0.8);color:#fff">
            <div class="flex items-center justify-between gap-2 mb-1.5">
              <div class="font-medium truncate flex-1">{current.title}</div>
              <button onClick={() => setMinimized(true)} class="text-xs px-1" title={L.minimize}>−</button>
            </div>
            {playlist.length > 1 && (
              <div style="display:flex;gap:2px;overflow-x:auto">
                {playlist.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentIndex(i)}
                    class="px-1.5 py-0.5 text-xs rounded transition"
                    style={{
                      background: i === currentIndex ? '#fff' : 'rgba(255,255,255,0.3)',
                      color: i === currentIndex ? '#000' : '#fff',
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
