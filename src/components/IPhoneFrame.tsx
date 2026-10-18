/**
 * SVG iPhone 16 Pro Max frame — pure decorative layer.
 *
 * Renders a crisp vector titanium (desert titanium) shell including:
 *   - Titanium brushed-metal body with edge bevels and multi-stop gradient
 *   - iOS status bar: time (9:41), signal bars, WiFi icon, battery icon
 *   - Dynamic Island with front camera lens + sensor dot
 *   - Side buttons: power (right), volume up/down + mute (left)
 *   - Home indicator pill
 *   - Glass sheen overlay
 *
 * App content sits in a sibling .wa-phone-content div layered on top via CSS.
 * This avoids foreignObject pointer-event quirks across browsers.
 */
export function IPhoneFrame({ className = "" }: { className?: string }) {
  // Canonical viewport — all coords in these units. 430×932 = iPhone 16 Pro Max points.
  const W = 430
  const H = 932

  const R     = 56    // outer shell corner radius
  const INSET = 13    // gap between outer edge and screen
  const SR    = 44    // screen corner radius (tighter than shell)

  const sx = INSET
  const sy = INSET
  const sw = W - INSET * 2
  const sh = H - INSET * 2

  // Dynamic Island
  const DI_W = 126
  const DI_H = 36
  const DI_R = 18
  const DI_X = (W - DI_W) / 2
  const DI_Y = sy + 14   // sits just inside the top of the screen

  // iOS status bar sits at the very top of the screen area, height ~54px
  const SB_Y  = sy + 4   // top of status bar text baseline
  const SB_H  = 54       // full status bar height including DI area

  // Button geometry (protrude outside the main rect)
  const BTN_X_L = -8    // left buttons x start (protrudes left)
  const BTN_X_R = W     // right button x start (protrudes right)
  const BTN_THICK = 8   // protrusion width
  const BTN_R_VAL = 3   // button edge radius

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: "block", overflow: "visible" }}
      aria-hidden="true"
    >
      <defs>
        {/* ── Titanium shell gradient: desert titanium warm sand/gold ── */}
        <linearGradient id="ip-titanium" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"    stopColor="#d4c4a4" />
          <stop offset="12%"   stopColor="#c4b494" />
          <stop offset="30%"   stopColor="#a89880" />
          <stop offset="50%"   stopColor="#9c8c74" />
          <stop offset="68%"   stopColor="#b4a488" />
          <stop offset="85%"   stopColor="#cebb9a" />
          <stop offset="100%"  stopColor="#baa880" />
        </linearGradient>

        {/* Brushed highlight along left edge */}
        <linearGradient id="ip-bevel-l" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.42)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        {/* Brushed highlight along right edge */}
        <linearGradient id="ip-bevel-r" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.28)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        {/* Top highlight */}
        <linearGradient id="ip-bevel-t" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.30)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>

        {/* Screen bezel background — matches --c-surface-low so status bar strip blends in */}
        <linearGradient id="ip-bezel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#1c1b1b" />
          <stop offset="100%" stopColor="#1c1b1b" />
        </linearGradient>

        {/* Glass sheen: diagonal streak across screen */}
        <linearGradient id="ip-glass" x1="0" y1="0" x2="0.5" y2="1">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.09)" />
          <stop offset="45%"  stopColor="rgba(255,255,255,0.03)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>

        {/* Button face gradient */}
        <linearGradient id="ip-btn" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#a89878" />
          <stop offset="50%"  stopColor="#bfaf8f" />
          <stop offset="100%" stopColor="#a89878" />
        </linearGradient>
        <linearGradient id="ip-btn-r" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0%"   stopColor="#a89878" />
          <stop offset="50%"  stopColor="#bfaf8f" />
          <stop offset="100%" stopColor="#a89878" />
        </linearGradient>

        {/* Drop shadow */}
        <filter id="ip-shadow" x="-10%" y="-5%" width="120%" height="115%">
          <feDropShadow dx="0" dy="24" stdDeviation="32" floodColor="#000" floodOpacity="0.75" />
          <feDropShadow dx="0" dy="6"  stdDeviation="10" floodColor="#000" floodOpacity="0.45" />
          <feDropShadow dx="-2" dy="0" stdDeviation="6"  floodColor="#000" floodOpacity="0.2" />
        </filter>

        {/* Glow filter for camera lens */}
        <filter id="ip-lens-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>

        {/* Screen clip */}
        <clipPath id="ip-screen-clip">
          <rect x={sx} y={sy} width={sw} height={sh} rx={SR} ry={SR} />
        </clipPath>

        {/* Battery clip (inner fill mask) */}
        <clipPath id="ip-batt-clip">
          <rect x={0} y={0} width={22} height={11} rx={2} ry={2} />
        </clipPath>
      </defs>

      {/* ══════════════════════════════════════════════
          SHELL + SHADOW
          ══════════════════════════════════════════════ */}
      <g filter="url(#ip-shadow)">
        {/* Main titanium body */}
        <rect x={0} y={0} width={W} height={H} rx={R} ry={R} fill="url(#ip-titanium)" />

        {/* Left bevel highlight strip */}
        <rect x={0} y={0} width={16} height={H} rx={R} ry={R} fill="url(#ip-bevel-l)" />
        {/* Right bevel highlight strip */}
        <rect x={W - 16} y={0} width={16} height={H} rx={R} ry={R} fill="url(#ip-bevel-r)" />
        {/* Top bevel highlight strip */}
        <rect x={0} y={0} width={W} height={16} rx={R} ry={R} fill="url(#ip-bevel-t)" />

        {/* Thin inner dark ring between titanium and screen */}
        <rect
          x={INSET - 1} y={INSET - 1}
          width={sw + 2} height={sh + 2}
          rx={SR + 1} ry={SR + 1}
          fill="#080808"
        />
      </g>

      {/* ══════════════════════════════════════════════
          SCREEN BACKGROUND
          ══════════════════════════════════════════════ */}
      <rect x={sx} y={sy} width={sw} height={sh} rx={SR} ry={SR} fill="url(#ip-bezel)" />

      {/* ══════════════════════════════════════════════
          IOS STATUS BAR (drawn over screen, under content layer)
          Left: time "9:41"
          Center: Dynamic Island occupies this zone
          Right: signal + wifi + battery
          ══════════════════════════════════════════════ */}

      {/* Time — left side of status bar */}
      <text
        x={sx + 26} y={SB_Y + 32}
        fontFamily="-apple-system, SF Pro Display, Helvetica Neue, sans-serif"
        fontWeight="600"
        fontSize="16"
        fill="rgba(255,255,255,0.92)"
        letterSpacing="-0.3"
      >
        9:41
      </text>

      {/* ── Signal bars (right cluster, rightmost) ── */}
      {/* 4 bars, each 3px wide, heights: 4,6,9,12 */}
      {[
        { h: 4,  o: 0 },
        { h: 7,  o: 5 },
        { h: 10, o: 10 },
        { h: 13, o: 15 },
      ].map(({ h, o }, i) => (
        <rect
          key={i}
          x={sx + sw - 26 - 20 - 48 + o}
          y={SB_Y + 30 - h}
          width={3} height={h}
          rx={1} ry={1}
          fill={i < 3 ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.35)"}
        />
      ))}

      {/* ── WiFi icon (3 arcs) ── */}
      {[10, 7, 4].map((r, i) => (
        <path
          key={i}
          d={`M ${sx + sw - 26 - 20 - 20} ${SB_Y + 30} a ${r} ${r} 0 0 1 ${r * 2} 0`}
          fill="none"
          stroke={i === 0 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.92)"}
          strokeWidth={2}
          strokeLinecap="round"
          transform={`translate(${-r}, 0)`}
        />
      ))}
      {/* WiFi dot */}
      <circle
        cx={sx + sw - 26 - 20 - 20}
        cy={SB_Y + 30}
        r={1.5}
        fill="rgba(255,255,255,0.92)"
      />

      {/* ── Battery icon ── */}
      {/* Outer shell */}
      <rect
        x={sx + sw - 26 - 22} y={SB_Y + 20}
        width={22} height={12}
        rx={3} ry={3}
        fill="none"
        stroke="rgba(255,255,255,0.7)"
        strokeWidth={1.5}
      />
      {/* Nub */}
      <rect
        x={sx + sw - 26 - 22 + 23} y={SB_Y + 23}
        width={3} height={6}
        rx={1.5} ry={1.5}
        fill="rgba(255,255,255,0.55)"
      />
      {/* Fill (≈75%) */}
      <rect
        x={sx + sw - 26 - 22 + 2} y={SB_Y + 22}
        width={15} height={8}
        rx={1.5} ry={1.5}
        fill="rgba(255,255,255,0.85)"
      />

      {/* ══════════════════════════════════════════════
          DYNAMIC ISLAND
          ══════════════════════════════════════════════ */}

      {/* Island pill */}
      <rect
        x={DI_X} y={DI_Y}
        width={DI_W} height={DI_H}
        rx={DI_R} ry={DI_R}
        fill="#080808"
      />

      {/* Front camera lens — layered circles for depth */}
      {/* Outer housing ring */}
      <circle
        cx={DI_X + DI_W - 22} cy={DI_Y + DI_H / 2}
        r={10}
        fill="#0f0f0f"
      />
      {/* Lens barrel */}
      <circle
        cx={DI_X + DI_W - 22} cy={DI_Y + DI_H / 2}
        r={7.5}
        fill="#141414"
        stroke="rgba(80,80,80,0.6)"
        strokeWidth={0.8}
      />
      {/* Iris */}
      <circle
        cx={DI_X + DI_W - 22} cy={DI_Y + DI_H / 2}
        r={5}
        fill="#1a1a24"
      />
      {/* Pupil */}
      <circle
        cx={DI_X + DI_W - 22} cy={DI_Y + DI_H / 2}
        r={2.8}
        fill="#0a0a14"
      />
      {/* Lens specular highlight */}
      <circle
        cx={DI_X + DI_W - 24.5} cy={DI_Y + DI_H / 2 - 2.5}
        r={1.2}
        fill="rgba(255,255,255,0.28)"
      />

      {/* Proximity / Face ID sensor dot (left of camera) */}
      <circle
        cx={DI_X + DI_W - 38} cy={DI_Y + DI_H / 2}
        r={2.5}
        fill="#1a1a1a"
        stroke="rgba(60,60,60,0.8)"
        strokeWidth={0.6}
      />
      {/* Sensor inner */}
      <circle
        cx={DI_X + DI_W - 38} cy={DI_Y + DI_H / 2}
        r={1.2}
        fill="#111118"
      />

      {/* ══════════════════════════════════════════════
          GLASS SHEEN — pointer-events: none, on top of content
          ══════════════════════════════════════════════ */}
      <rect
        x={sx} y={sy} width={sw} height={sh}
        rx={SR} ry={SR}
        fill="url(#ip-glass)"
        style={{ pointerEvents: "none" }}
      />

      {/* ══════════════════════════════════════════════
          SIDE BUTTONS
          ══════════════════════════════════════════════ */}

      {/* RIGHT — Power / Sleep-Wake button */}
      <rect
        x={BTN_X_R - 2} y={268}
        width={BTN_THICK + 4} height={92}
        rx={BTN_R_VAL} ry={BTN_R_VAL}
        fill="url(#ip-btn-r)"
      />
      {/* Bevel top */}
      <rect
        x={BTN_X_R - 1} y={269}
        width={3} height={90}
        rx={1} ry={1}
        fill="rgba(255,255,255,0.22)"
      />

      {/* LEFT — Mute / Action button */}
      <rect
        x={BTN_X_L} y={158}
        width={BTN_THICK + 4} height={40}
        rx={BTN_R_VAL} ry={BTN_R_VAL}
        fill="url(#ip-btn)"
      />
      <rect x={BTN_X_L + 2} y={160} width={3} height={36} rx={1} ry={1} fill="rgba(255,255,255,0.22)" />

      {/* LEFT — Volume Up */}
      <rect
        x={BTN_X_L} y={220}
        width={BTN_THICK + 4} height={74}
        rx={BTN_R_VAL} ry={BTN_R_VAL}
        fill="url(#ip-btn)"
      />
      <rect x={BTN_X_L + 2} y={222} width={3} height={70} rx={1} ry={1} fill="rgba(255,255,255,0.22)" />

      {/* LEFT — Volume Down */}
      <rect
        x={BTN_X_L} y={310}
        width={BTN_THICK + 4} height={74}
        rx={BTN_R_VAL} ry={BTN_R_VAL}
        fill="url(#ip-btn)"
      />
      <rect x={BTN_X_L + 2} y={312} width={3} height={70} rx={1} ry={1} fill="rgba(255,255,255,0.22)" />

      {/* ══════════════════════════════════════════════
          HOME INDICATOR
          ══════════════════════════════════════════════ */}
      <rect
        x={(W - 134) / 2} y={H - 14}
        width={134} height={5}
        rx={2.5} ry={2.5}
        fill="rgba(220,220,220,0.32)"
      />
    </svg>
  )
}
