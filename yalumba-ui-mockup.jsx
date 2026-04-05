import { useState } from "react";

const wineries = [
  { id: 1, name: "Silver Oak Cellars", region: "Alexander Valley", type: "Cabernet Sauvignon", rating: 4.8, tasting: "$40", hours: "10am–5pm", appt: false, dogs: true, award: "98pts", img: "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=800&q=80" },
  { id: 2, name: "Jordan Winery", region: "Alexander Valley", type: "Chardonnay & Cab", rating: 4.9, tasting: "$60", hours: "10am–4pm", appt: true, dogs: false, award: "Gold", img: "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=800&q=80" },
  { id: 3, name: "Ferrari-Carano", region: "Dry Creek Valley", type: "Italian Varietals", rating: 4.6, tasting: "$30", hours: "10am–5pm", appt: false, dogs: true, award: null, img: "https://images.unsplash.com/photo-1543153987-9537a2bbc01b?w=800&q=80" },
  { id: 4, name: "Dry Creek Vineyard", region: "Dry Creek Valley", type: "Zinfandel", rating: 4.7, tasting: "$25", hours: "10:30am–4:30pm", appt: false, dogs: true, award: "Trophy", img: "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&q=80" },
  { id: 5, name: "Seghesio Family", region: "Healdsburg", type: "Zinfandel", rating: 4.8, tasting: "$35", hours: "11am–5pm", appt: false, dogs: false, award: "99pts", img: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80" },
];

const heroSlides = [
  { title: "Discover Wine Country", subtitle: "Explore the world's finest wineries", img: "https://images.unsplash.com/photo-1504279577054-acfeccf8fc52?w=800&q=80" },
  { title: "Book a Tasting", subtitle: "Reserve your private experience today", img: "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=800&q=80" },
  { title: "Upcoming Events", subtitle: "Harvest festivals and exclusive dinners", img: "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&q=80" },
];

const events = [
  { id: 1, title: "Harvest Sunset Dinner", winery: "Jordan Winery", date: "Oct 14, 2026", img: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80" },
  { id: 2, title: "Spring Release Weekend", winery: "Silver Oak Cellars", date: "Apr 5, 2026", img: "https://images.unsplash.com/photo-1504279577054-acfeccf8fc52?w=800&q=80" },
];

function AwardBadge({ text }) {
  return (
    <div style={{
      width: 52, height: 52,
      borderRadius: "50%",
      border: "1.5px solid #1a1a1a",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontSize: 8, fontWeight: 700,
      letterSpacing: "0.05em", textAlign: "center",
      color: "#1a1a1a", lineHeight: 1.2,
      padding: 4, boxSizing: "border-box",
      background: "white",
    }}>
      <div style={{ fontSize: 7, letterSpacing: "0.1em" }}>✦ {text} ✦</div>
    </div>
  );
}

export default function YalumbaUI() {
  const [tab, setTab] = useState("home");
  const [heroIdx, setHeroIdx] = useState(0);
  const [selected, setSelected] = useState(null);

  const selectedWinery = wineries.find(w => w.id === selected);

  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", minHeight: "100vh", background: "#f0ece4", padding: "40px 24px", fontFamily: "'Georgia', serif", gap: 48 }}>

      {/* Phone frame */}
      <div style={{
        width: 375, background: "#fff",
        borderRadius: 44, boxShadow: "0 32px 80px rgba(0,0,0,0.18)",
        overflow: "hidden", border: "6px solid #1a1a1a",
        display: "flex", flexDirection: "column",
        height: 780, position: "relative",
      }}>

        {/* Status bar */}
        <div style={{ background: "#fff", display: "flex", justifyContent: "space-between", padding: "10px 20px 0", fontSize: 11, color: "#1a1a1a", fontFamily: "sans-serif" }}>
          <span style={{ fontWeight: 600 }}>9:41</span>
          <span>●●● 🔋</span>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: "auto", background: "#fff" }}>

          {/* ── HOME ── */}
          {tab === "home" && !selected && (
            <div>
              {/* Hero carousel */}
              <div style={{ position: "relative", height: 420, overflow: "hidden" }}>
                <img src={heroSlides[heroIdx].img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 60%)" }} />

                {/* Logo */}
                <div style={{ position: "absolute", top: 20, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
                  <div style={{ background: "rgba(255,255,255,0.95)", padding: "8px 20px", borderRadius: 2 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.2em", color: "#1a1a1a" }}>WINE COUNTRY</div>
                    <div style={{ fontSize: 8, letterSpacing: "0.15em", color: "#666", textAlign: "center", fontFamily: "sans-serif" }}>SONOMA VALLEY</div>
                  </div>
                </div>

                {/* Hero text */}
                <div style={{ position: "absolute", bottom: 40, left: 24, right: 24 }}>
                  <div style={{ color: "white", fontSize: 30, fontWeight: 700, lineHeight: 1.15, marginBottom: 10 }}>{heroSlides[heroIdx].title}</div>
                  <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 14, fontFamily: "sans-serif", fontWeight: 300, marginBottom: 16 }}>{heroSlides[heroIdx].subtitle}</div>
                  <div style={{ display: "inline-block", border: "1px solid white", color: "white", padding: "8px 20px", fontSize: 10, letterSpacing: "0.15em", fontFamily: "sans-serif" }}>
                    EXPLORE NOW
                  </div>
                </div>

                {/* Carousel dots */}
                <div style={{ position: "absolute", bottom: 16, right: 24, display: "flex", gap: 4 }}>
                  {heroSlides.map((_, i) => (
                    <div key={i} onClick={() => setHeroIdx(i)} style={{ width: i === heroIdx ? 16 : 4, height: 4, borderRadius: 2, background: "white", opacity: i === heroIdx ? 1 : 0.5, cursor: "pointer", transition: "all 0.3s" }} />
                  ))}
                </div>
              </div>

              {/* Editorial section label */}
              <div style={{ padding: "28px 24px 12px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, height: 1, background: "#e0e0e0" }} />
                <div style={{ fontSize: 9, letterSpacing: "0.2em", color: "#999", fontFamily: "sans-serif" }}>EXPLORE THE REGION</div>
                <div style={{ flex: 1, height: 1, background: "#e0e0e0" }} />
              </div>

              {/* 3-column editorial grid */}
              <div style={{ display: "flex", gap: 1, padding: "0 24px", marginBottom: 32 }}>
                {[
                  { label: "Visit a Winery", img: "https://images.unsplash.com/photo-1543153987-9537a2bbc01b?w=400&q=80" },
                  { label: "Upcoming Events", img: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&q=80" },
                  { label: "The Map", img: "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=400&q=80" },
                ].map((item, i) => (
                  <div key={i} onClick={() => setTab(i === 0 ? "wineries" : i === 1 ? "events" : "map")} style={{ flex: 1, cursor: "pointer" }}>
                    <div style={{ height: 100, overflow: "hidden" }}>
                      <img src={item.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                    <div style={{ fontSize: 11, color: "#1a1a1a", marginTop: 8, lineHeight: 1.3, fontWeight: 500 }}>{item.label}</div>
                  </div>
                ))}
              </div>

              {/* Featured winery */}
              <div style={{ margin: "0 24px 32px", borderTop: "1px solid #e0e0e0", paddingTop: 24 }}>
                <div style={{ fontSize: 9, letterSpacing: "0.2em", color: "#999", fontFamily: "sans-serif", marginBottom: 12 }}>FEATURED WINERY</div>
                <div style={{ position: "relative", height: 200, borderRadius: 2, overflow: "hidden" }} onClick={() => { setTab("wineries"); setSelected(1); }}>
                  <img src={wineries[0].img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 60%)" }} />
                  <div style={{ position: "absolute", bottom: 16, left: 16, right: 16 }}>
                    <div style={{ color: "white", fontSize: 20, fontWeight: 700 }}>{wineries[0].name}</div>
                    <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 11, fontFamily: "sans-serif", letterSpacing: "0.1em" }}>{wineries[0].region.toUpperCase()}</div>
                  </div>
                  {wineries[0].award && (
                    <div style={{ position: "absolute", top: 12, right: 12 }}>
                      <AwardBadge text={wineries[0].award} />
                    </div>
                  )}
                </div>
              </div>

              {/* Events preview */}
              <div style={{ borderTop: "1px solid #e0e0e0", padding: "24px 24px 32px" }}>
                <div style={{ fontSize: 9, letterSpacing: "0.2em", color: "#999", fontFamily: "sans-serif", marginBottom: 16 }}>UPCOMING EVENTS</div>
                {events.map(e => (
                  <div key={e.id} style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "flex-start" }}>
                    <img src={e.img} alt="" style={{ width: 70, height: 70, objectFit: "cover", borderRadius: 1, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1a", lineHeight: 1.2, marginBottom: 4 }}>{e.title}</div>
                      <div style={{ fontSize: 11, color: "#999", fontFamily: "sans-serif", marginBottom: 2 }}>{e.winery}</div>
                      <div style={{ fontSize: 10, color: "#bbb", fontFamily: "sans-serif", letterSpacing: "0.05em" }}>{e.date.toUpperCase()}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── WINERIES ── */}
          {tab === "wineries" && !selected && (
            <div>
              {/* Header */}
              <div style={{ padding: "20px 24px 0" }}>
                <div style={{ fontSize: 9, letterSpacing: "0.2em", color: "#999", fontFamily: "sans-serif", marginBottom: 4 }}>SONOMA COUNTY</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#1a1a1a", marginBottom: 16 }}>Our Wineries</div>
                {/* Search */}
                <div style={{ border: "1px solid #e0e0e0", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                  <span style={{ fontSize: 12, color: "#ccc", fontFamily: "sans-serif" }}>⌕</span>
                  <span style={{ fontSize: 13, color: "#ccc", fontFamily: "sans-serif" }}>Search wineries, regions...</span>
                </div>
                {/* Filter row */}
                <div style={{ display: "flex", gap: 8, marginBottom: 24, overflowX: "auto", paddingBottom: 4 }}>
                  {["All", "Walk-in", "By Appt", "🐾 Dogs"].map((f, i) => (
                    <div key={f} style={{
                      padding: "6px 14px", fontSize: 10, letterSpacing: "0.1em",
                      fontFamily: "sans-serif", whiteSpace: "nowrap", cursor: "pointer",
                      border: i === 0 ? "1px solid #1a1a1a" : "1px solid #e0e0e0",
                      background: i === 0 ? "#1a1a1a" : "white",
                      color: i === 0 ? "white" : "#666",
                    }}>{f}</div>
                  ))}
                </div>
              </div>

              {/* Winery list */}
              <div style={{ padding: "0 24px" }}>
                {wineries.map((w, i) => (
                  <div key={w.id} onClick={() => setSelected(w.id)} style={{ marginBottom: 28, cursor: "pointer" }}>
                    <div style={{ position: "relative", height: 180, overflow: "hidden", marginBottom: 12 }}>
                      <img src={w.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 60%)" }} />
                      {w.award && (
                        <div style={{ position: "absolute", top: 10, left: 10 }}>
                          <AwardBadge text={w.award} />
                        </div>
                      )}
                      <div style={{ position: "absolute", bottom: 12, right: 12, background: "white", padding: "4px 10px" }}>
                        <div style={{ fontSize: 10, fontFamily: "sans-serif", letterSpacing: "0.05em", color: "#1a1a1a" }}>⭐ {w.rating}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a", marginBottom: 3 }}>{w.name}</div>
                        <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#999", fontFamily: "sans-serif", marginBottom: 4 }}>{w.region.toUpperCase()}</div>
                        <div style={{ fontSize: 12, color: "#666", fontFamily: "sans-serif" }}>{w.type}</div>
                      </div>
                      <div style={{ fontSize: 12, fontFamily: "sans-serif", color: "#1a1a1a", fontWeight: 600 }}>{w.tasting}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      {w.dogs && <div style={{ fontSize: 9, letterSpacing: "0.08em", border: "1px solid #e0e0e0", padding: "3px 8px", fontFamily: "sans-serif", color: "#666" }}>🐾 DOGS OK</div>}
                      {w.appt && <div style={{ fontSize: 9, letterSpacing: "0.08em", border: "1px solid #e0e0e0", padding: "3px 8px", fontFamily: "sans-serif", color: "#666" }}>BY APPT</div>}
                      {!w.appt && <div style={{ fontSize: 9, letterSpacing: "0.08em", border: "1px solid #e0e0e0", padding: "3px 8px", fontFamily: "sans-serif", color: "#666" }}>WALK-IN</div>}
                    </div>
                    {i < wineries.length - 1 && <div style={{ height: 1, background: "#f0f0f0", marginTop: 20 }} />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── WINERY DETAIL ── */}
          {selected && selectedWinery && (
            <div>
              <div style={{ position: "relative", height: 300 }}>
                <img src={selectedWinery.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 60%)" }} />
                <div onClick={() => setSelected(null)} style={{ position: "absolute", top: 16, left: 16, background: "rgba(255,255,255,0.9)", padding: "6px 12px", cursor: "pointer", fontSize: 11, fontFamily: "sans-serif" }}>← Back</div>
                {selectedWinery.award && <div style={{ position: "absolute", top: 16, right: 16 }}><AwardBadge text={selectedWinery.award} /></div>}
                <div style={{ position: "absolute", bottom: 20, left: 24 }}>
                  <div style={{ fontSize: 9, letterSpacing: "0.15em", color: "rgba(255,255,255,0.8)", fontFamily: "sans-serif", marginBottom: 6 }}>{selectedWinery.region.toUpperCase()}</div>
                  <div style={{ color: "white", fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>{selectedWinery.name}</div>
                </div>
              </div>

              <div style={{ padding: "24px 24px 100px" }}>
                {/* Type */}
                <div style={{ fontSize: 13, color: "#666", fontFamily: "sans-serif", marginBottom: 20, fontStyle: "italic" }}>{selectedWinery.type}</div>

                {/* Info grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "#e0e0e0", marginBottom: 24 }}>
                  {[
                    ["HOURS", selectedWinery.hours],
                    ["TASTING", selectedWinery.tasting],
                    ["RATING", `⭐ ${selectedWinery.rating}`],
                    ["ACCESS", selectedWinery.appt ? "By Appointment" : "Walk-ins Welcome"],
                  ].map(([label, value]) => (
                    <div key={label} style={{ background: "white", padding: "14px 16px" }}>
                      <div style={{ fontSize: 8, letterSpacing: "0.15em", color: "#999", fontFamily: "sans-serif", marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 13, color: "#1a1a1a", fontFamily: "sans-serif", fontWeight: 500 }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* About */}
                <div style={{ borderTop: "1px solid #e0e0e0", paddingTop: 20, marginBottom: 24 }}>
                  <div style={{ fontSize: 9, letterSpacing: "0.2em", color: "#999", fontFamily: "sans-serif", marginBottom: 12 }}>ABOUT THE WINERY</div>
                  <div style={{ fontSize: 14, color: "#444", lineHeight: 1.7, fontFamily: "sans-serif" }}>
                    Nestled in the heart of {selectedWinery.region}, {selectedWinery.name} is one of the region's most celebrated estates. Known for their exceptional {selectedWinery.type.toLowerCase()}, every visit offers an unforgettable experience.
                  </div>
                </div>

                {/* Amenities */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
                  {selectedWinery.dogs && <div style={{ fontSize: 9, letterSpacing: "0.1em", border: "1px solid #1a1a1a", padding: "5px 12px", fontFamily: "sans-serif" }}>🐾 DOGS WELCOME</div>}
                  {selectedWinery.appt && <div style={{ fontSize: 9, letterSpacing: "0.1em", border: "1px solid #1a1a1a", padding: "5px 12px", fontFamily: "sans-serif" }}>📅 BY APPOINTMENT</div>}
                  {!selectedWinery.appt && <div style={{ fontSize: 9, letterSpacing: "0.1em", border: "1px solid #1a1a1a", padding: "5px 12px", fontFamily: "sans-serif" }}>✓ WALK-INS WELCOME</div>}
                </div>

                {/* CTA buttons */}
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1, background: "#1a1a1a", color: "white", padding: "14px", textAlign: "center", fontSize: 10, letterSpacing: "0.15em", fontFamily: "sans-serif", cursor: "pointer" }}>BOOK A TASTING</div>
                  <div style={{ width: 52, border: "1px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, cursor: "pointer" }}>🗺</div>
                </div>
              </div>
            </div>
          )}

          {/* ── MAP ── */}
          {tab === "map" && (
            <div>
              <div style={{ padding: "20px 24px 16px" }}>
                <div style={{ fontSize: 9, letterSpacing: "0.2em", color: "#999", fontFamily: "sans-serif", marginBottom: 4 }}>SONOMA COUNTY</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#1a1a1a" }}>Explore the Map</div>
              </div>
              <div style={{ margin: "0 24px", height: 340, background: "#e8e4dc", position: "relative", overflow: "hidden", borderRadius: 2 }}>
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, #d4e8c2 0%, #c8dfa0 25%, #e8d5a0 60%, #c8b070 100%)", opacity: 0.7 }} />
                <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.3 }}>
                  <path d="M0 50% Q40% 38% 100% 52%" stroke="#fff" strokeWidth="4" fill="none" />
                  <path d="M30% 0 Q45% 45% 55% 100%" stroke="#fff" strokeWidth="3" fill="none" />
                </svg>
                {wineries.map(w => (
                  <div key={w.id} style={{ position: "absolute", left: `${15 + w.id * 15}%`, top: `${20 + w.id * 12}%`, transform: "translate(-50%,-100%)" }}>
                    <div style={{ background: "#1a1a1a", color: "white", padding: "4px 10px", fontSize: 9, letterSpacing: "0.05em", fontFamily: "sans-serif", whiteSpace: "nowrap" }}>
                      {w.name.split(" ")[0]}
                    </div>
                    <div style={{ width: 6, height: 6, background: "#1a1a1a", margin: "0 auto", transform: "rotate(45deg)", marginTop: -3 }} />
                  </div>
                ))}
                <div style={{ position: "absolute", bottom: 12, left: 12, background: "white", padding: "6px 12px", fontSize: 9, letterSpacing: "0.1em", fontFamily: "sans-serif", color: "#1a1a1a" }}>
                  📍 SONOMA WINE COUNTRY
                </div>
              </div>
              <div style={{ padding: "20px 24px" }}>
                <div style={{ fontSize: 9, letterSpacing: "0.2em", color: "#999", fontFamily: "sans-serif", marginBottom: 16 }}>NEARBY WINERIES</div>
                {wineries.slice(0, 3).map(w => (
                  <div key={w.id} onClick={() => { setTab("wineries"); setSelected(w.id); }} style={{ display: "flex", gap: 12, marginBottom: 16, cursor: "pointer", alignItems: "center" }}>
                    <img src={w.img} alt="" style={{ width: 56, height: 56, objectFit: "cover", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1a" }}>{w.name}</div>
                      <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "#999", fontFamily: "sans-serif" }}>{w.region.toUpperCase()}</div>
                    </div>
                    <div style={{ fontSize: 12, color: "#999", fontFamily: "sans-serif" }}>›</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── EVENTS ── */}
          {tab === "events" && (
            <div>
              <div style={{ padding: "20px 24px 0" }}>
                <div style={{ fontSize: 9, letterSpacing: "0.2em", color: "#999", fontFamily: "sans-serif", marginBottom: 4 }}>CALENDAR</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#1a1a1a", marginBottom: 20 }}>Events</div>
              </div>
              {events.map(e => (
                <div key={e.id} style={{ margin: "0 24px 28px" }}>
                  <div style={{ position: "relative", height: 200, overflow: "hidden", marginBottom: 14 }}>
                    <img src={e.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 60%)" }} />
                    <div style={{ position: "absolute", bottom: 14, left: 16 }}>
                      <div style={{ color: "white", fontSize: 18, fontWeight: 700 }}>{e.title}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#999", fontFamily: "sans-serif", marginBottom: 4 }}>{e.date.toUpperCase()}</div>
                  <div style={{ fontSize: 13, color: "#666", fontFamily: "sans-serif" }}>{e.winery}</div>
                  <div style={{ marginTop: 12, display: "inline-block", border: "1px solid #1a1a1a", padding: "7px 18px", fontSize: 9, letterSpacing: "0.15em", fontFamily: "sans-serif", cursor: "pointer" }}>
                    LEARN MORE
                  </div>
                  <div style={{ height: 1, background: "#f0f0f0", marginTop: 20 }} />
                </div>
              ))}
            </div>
          )}

        </div>

        {/* Floating tab bar */}
        <div style={{ position: "relative", background: "white", paddingBottom: 12 }}>
          <div style={{
            margin: "10px 20px 6px",
            background: "#1a1a1a",
            borderRadius: 36,
            display: "flex",
            justifyContent: "space-around",
            alignItems: "center",
            padding: "10px 8px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
          }}>
            {[
              { id: "home", label: "HOME", icon: "⌂" },
              { id: "wineries", label: "WINERIES", icon: "🍷" },
              { id: "map", label: "MAP", icon: "◎" },
              { id: "events", label: "EVENTS", icon: "◈" },
            ].map(t => (
              <div
                key={t.id}
                onClick={() => { setTab(t.id); setSelected(null); }}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  gap: 2, cursor: "pointer", flex: 1,
                  padding: "4px 0",
                  borderRadius: 28,
                  background: tab === t.id ? "rgba(255,255,255,0.12)" : "transparent",
                  transition: "all 0.2s",
                }}
              >
                <div style={{ fontSize: tab === t.id ? 18 : 15, color: tab === t.id ? "white" : "rgba(255,255,255,0.4)", transition: "all 0.2s" }}>{t.icon}</div>
                {tab !== t.id && (
                  <div style={{ fontSize: 6, letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", fontFamily: "sans-serif" }}>{t.label}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Side notes */}
      <div style={{ maxWidth: 260, fontFamily: "sans-serif" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>Yalumba-Inspired UI</h2>
        <p style={{ fontSize: 13, color: "#666", lineHeight: 1.6, marginBottom: 16 }}>Tap through all four tabs and tap any winery card to see the detail view.</p>
        <div style={{ fontSize: 12, color: "#444", lineHeight: 1.8 }}>
          <div style={{ marginBottom: 8 }}><b>White background</b> — clean, airy, premium</div>
          <div style={{ marginBottom: 8 }}><b>Serif typography</b> — editorial, heritage feel</div>
          <div style={{ marginBottom: 8 }}><b>All-caps labels</b> — refined, spaced out</div>
          <div style={{ marginBottom: 8 }}><b>Full-bleed photography</b> — images do the talking</div>
          <div style={{ marginBottom: 8 }}><b>Square badge stamps</b> — award recognition</div>
          <div style={{ marginBottom: 8 }}><b>Minimal borders</b> — thin lines, lots of space</div>
          <div style={{ marginBottom: 8 }}><b>Dark charcoal</b> — replaces your current purple as primary</div>
        </div>
        <div style={{ marginTop: 16, padding: 12, background: "#fff8f0", border: "1px solid #e8d8c0", borderRadius: 4, fontSize: 12, color: "#8B4513" }}>
          💡 This direction moves away from your current dark purple theme toward a light luxury aesthetic. Let me know if you want to keep your purple accent color incorporated.
        </div>
      </div>
    </div>
  );
}
