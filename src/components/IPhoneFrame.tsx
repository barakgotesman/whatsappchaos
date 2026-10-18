/** Available iPhone 18 Pro finishes */
export type IPhoneFinish = "burgundy" | "glacier" | "silver" | "black"

/**
 * Per-finish palette. `body` is a 5-stop diagonal gradient (light catch → shadow → light catch)
 * that reads as brushed aluminium; `rim` is the flat-edge chamfer; `btn` colors the side buttons.
 */
const FINISHES: Record<IPhoneFinish, { body: string[]; rim: [string, string]; btn: [string, string] }> = {
  burgundy: { body: ["#8a4452", "#6b2c3a", "#561f2d", "#6e2f3d", "#8f4a58"], rim: ["#b9707f", "#3e1620"], btn: ["#5a2230", "#7d3c4a"] },
  glacier:  { body: ["#d3dde6", "#b4c2cf", "#9fafbd", "#b7c5d1", "#d6e0e8"], rim: ["#f1f6fa", "#7f8f9d"], btn: ["#9aabb9", "#c3d0db"] },
  silver:   { body: ["#e7e8ea", "#cfd0d3", "#b9babe", "#d2d3d6", "#ebecee"], rim: ["#ffffff", "#8e8f94"], btn: ["#b4b5b9", "#dcdddf"] },
  black:    { body: ["#3a3b3f", "#26272a", "#1a1b1d", "#28292c", "#404145"], rim: ["#6a6b70", "#0c0c0d"], btn: ["#1c1d1f", "#383a3d"] },
}

/**
 * SVG iPhone 18 Pro frame — pure decorative layer.
 *
 * Renders a vector aluminium unibody with flat chamfered edges, thin bezels, the smaller
 * Dynamic Island, iOS status bar, Action button + volume rocker (left), side button and
 * Camera Control (right), and a home indicator.
 *
 * Geometry is in 402×874 pt (the 6.3" 18 Pro logical resolution; 2622×1206 px @3x).
 * App content sits in a sibling .wa-phone-content div layered on top via CSS — if you change
 * W/H/INSET/SB_H here, update the .wa-phone* percentages in index.css to match.
 *
 * @param className - applied to the <svg> root
 * @param finish - body color; defaults to burgundy (new for the 18 generation)
 */
export function IPhoneFrame({
  className = "",
  finish = "burgundy",
}: {
  className?: string
  finish?: IPhoneFinish
}) {
  const W = 402
  const H = 874
  const pal = FINISHES[finish]

  const R     = 62   // outer shell corner radius
  const INSET = 7    // shell edge → screen; ~1.2 mm bezel on the 18 Pro
  const SR    = 55   // display corner radius (concentric with shell: R - INSET)

  const sx = INSET
  const sy = INSET
  const sw = W - INSET * 2
  const sh = H - INSET * 2

  // Smaller Dynamic Island than the 17 Pro (~125×37). Exact size is approximate.
  const DI_W = 104
  const DI_H = 31
  const DI_R = DI_H / 2
  const DI_X = (W - DI_W) / 2
  const DI_Y = sy + 11

  const SB_Y = sy + 4    // status bar origin
  const SB_H = 54        // status bar height; content layer starts at sy + SB_H

  // Side hardware protrudes slightly beyond the shell
  const BTN_L = -3
  const BTN_R = W - 1
  const BTN_W = 4
  const camX = DI_X + DI_W - 19   // front camera center x
  const camY = DI_Y + DI_H / 2

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: "block", overflow: "visible" }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ip-body" x1="0" y1="0" x2="1" y2="1">
          {pal.body.map((c, i) => (
            <stop key={i} offset={`${i * 25}%`} stopColor={c} />
          ))}
        </linearGradient>

        {/* Flat-edge chamfer: light on the top-left, dark on the bottom-right */}
        <linearGradient id="ip-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor={pal.rim[0]} />
          <stop offset="50%"  stopColor={pal.rim[1]} />
          <stop offset="100%" stopColor={pal.rim[0]} stopOpacity="0.7" />
        </linearGradient>

        <linearGradient id="ip-btn" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor={pal.btn[0]} />
          <stop offset="50%"  stopColor={pal.btn[1]} />
          <stop offset="100%" stopColor={pal.btn[0]} />
        </linearGradient>
        <linearGradient id="ip-btn-r" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0%"   stopColor={pal.btn[0]} />
          <stop offset="50%"  stopColor={pal.btn[1]} />
          <stop offset="100%" stopColor={pal.btn[0]} />
        </linearGradient>

        {/* Camera Control: dark sapphire glass, flush with the frame */}
        <linearGradient id="ip-camctl" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0%"   stopColor="#0d0d10" />
          <stop offset="100%" stopColor="#2a2b30" />
        </linearGradient>

        {/* Diagonal glass sheen over the display */}
        <linearGradient id="ip-glass" x1="0" y1="0" x2="0.5" y2="1">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.08)" />
          <stop offset="40%"  stopColor="rgba(255,255,255,0.025)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>

        <filter id="ip-shadow" x="-10%" y="-5%" width="120%" height="115%">
          <feDropShadow dx="0" dy="24" stdDeviation="32" floodColor="#000" floodOpacity="0.75" />
          <feDropShadow dx="0" dy="6"  stdDeviation="10" floodColor="#000" floodOpacity="0.45" />
        </filter>
      </defs>

      {/* ── Side hardware (drawn first so the shell overlaps its inner edge) ── */}

      {/* Left: Action button, volume up, volume down */}
      {[
        { y: 150, h: 34 },
        { y: 204, h: 62 },
        { y: 278, h: 62 },
      ].map(({ y, h }) => (
        <g key={y}>
          <rect x={BTN_L} y={y} width={BTN_W + 3} height={h} rx={2} fill="url(#ip-btn)" />
          <rect x={BTN_L + 0.5} y={y + 1} width={1.5} height={h - 2} rx={0.75} fill="rgba(255,255,255,0.28)" />
        </g>
      ))}

      {/* Right: side (power) button */}
      <rect x={BTN_R} y={236} width={BTN_W + 2} height={96} rx={2} fill="url(#ip-btn-r)" />
      <rect x={BTN_R + 3} y={237} width={1.5} height={94} rx={0.75} fill="rgba(255,255,255,0.25)" />

      {/* Right: Camera Control — flush sapphire pill, lower on the frame */}
      <rect x={W - 2.5} y={560} width={4.5} height={52} rx={2.25} fill="url(#ip-camctl)" />
      <rect x={W - 1.5} y={562} width={1} height={48} rx={0.5} fill="rgba(255,255,255,0.2)" />

      {/* ── Shell ── */}
      <g filter="url(#ip-shadow)">
        {/* Body */}
        <rect x={0} y={0} width={W} height={H} rx={R} fill="url(#ip-body)" />
        {/* Flat chamfered rim: stroke ring just inside the outer edge */}
        <rect
          x={1.25} y={1.25} width={W - 2.5} height={H - 2.5} rx={R - 1.25}
          fill="none" stroke="url(#ip-rim)" strokeWidth={2.5}
        />
        {/* Black ring between aluminium and glass */}
        <rect
          x={INSET - 1.5} y={INSET - 1.5} width={sw + 3} height={sh + 3} rx={SR + 1.5}
          fill="#050505"
        />
      </g>

      {/* ── Screen background (matches --c-surface-low so the status strip blends in) ── */}
      <rect x={sx} y={sy} width={sw} height={sh} rx={SR} fill="#1c1b1b" />

      {/* ── Status bar ── */}
      <text
        x={sx + 30} y={SB_Y + 30}
        fontFamily="-apple-system, SF Pro Display, Helvetica Neue, sans-serif"
        fontWeight="600" fontSize="16" letterSpacing="-0.3"
        fill="rgba(255,255,255,0.92)"
      >
        9:41
      </text>

      {/* Signal bars */}
      {[4, 7, 10, 13].map((h, i) => (
        <rect
          key={h}
          x={sx + sw - 30 - 22 - 20 - 22 + i * 5}
          y={SB_Y + 28 - h}
          width={3} height={h} rx={1}
          fill={i < 3 ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.35)"}
        />
      ))}

      {/* Wi-Fi: three arcs + dot */}
      {[10, 7, 4].map((r, i) => (
        <path
          key={r}
          d={`M ${sx + sw - 30 - 22 - 12 - r} ${SB_Y + 28} a ${r} ${r} 0 0 1 ${r * 2} 0`}
          fill="none" strokeWidth={2} strokeLinecap="round"
          stroke={i === 0 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.92)"}
        />
      ))}
      <circle cx={sx + sw - 30 - 22 - 12} cy={SB_Y + 28} r={1.5} fill="rgba(255,255,255,0.92)" />

      {/* Battery (~75%) */}
      <rect x={sx + sw - 30 - 22} y={SB_Y + 18} width={22} height={12} rx={3.5}
        fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={1.5} />
      <rect x={sx + sw - 30 + 2} y={SB_Y + 21} width={2} height={6} rx={1} fill="rgba(255,255,255,0.55)" />
      <rect x={sx + sw - 30 - 20} y={SB_Y + 20} width={15} height={8} rx={2} fill="rgba(255,255,255,0.88)" />

      {/* ── Dynamic Island ── */}
      <rect x={DI_X} y={DI_Y} width={DI_W} height={DI_H} rx={DI_R} fill="#050505" />
      <circle cx={camX} cy={camY} r={9}   fill="#0c0c0f" />
      <circle cx={camX} cy={camY} r={6.5} fill="#121218" stroke="rgba(90,90,110,0.55)" strokeWidth={0.7} />
      <circle cx={camX} cy={camY} r={4.2} fill="#181826" />
      <circle cx={camX} cy={camY} r={2.3} fill="#07070f" />
      <circle cx={camX - 2} cy={camY - 2} r={1} fill="rgba(255,255,255,0.3)" />

      {/* ── Glass sheen (non-interactive) ── */}
      <rect
        x={sx} y={sy} width={sw} height={sh} rx={SR}
        fill="url(#ip-glass)" style={{ pointerEvents: "none" }}
      />

      {/* ── Home indicator ── */}
      <rect
        x={(W - 134) / 2} y={H - INSET - 11}
        width={134} height={5} rx={2.5}
        fill="rgba(220,220,220,0.32)"
      />
    </svg>
  )
}
