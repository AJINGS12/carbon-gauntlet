/** The agents as little toy characters, plus the logo. */

export const TOY_COLORS: Record<string, string> = {
  "honest-dev": "#0a8a45",
  "opportunist-dev": "#7b3fc8",
  broker: "#d27a12",
  "coal-nation": "#4a5560",
};

const HEX = "M30 4 L52 16.5 L52 41.5 L30 54 L8 41.5 L8 16.5 Z";

/** Small white badge on the toy's belly: what the agent is. */
const BADGES: Record<string, JSX.Element> = {
  "honest-dev": (
    <g fill="#fff">
      <path d="M30 46 V39" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M30 41 C30 37 27 35.5 24.5 36 C24.5 39 27 41 30 41 Z" />
      <path d="M30 39.5 C30 35.5 33 34 35.5 34.5 C35.5 37.5 33 39.5 30 39.5 Z" />
    </g>
  ),
  "opportunist-dev": (
    <g>
      <path d="M22.5 38 C22.5 36.4 24 35.8 25.6 36.3 L30 37.4 L34.4 36.3 C36 35.8 37.5 36.4 37.5 38 C37.5 42 35.2 44 33 44 C31.4 44 30.6 42.6 30 42.6 C29.4 42.6 28.6 44 27 44 C24.8 44 22.5 42 22.5 38 Z" fill="#fff" />
      <ellipse cx="26.5" cy="39.4" rx="1.7" ry="1.1" fill="currentColor" />
      <ellipse cx="33.5" cy="39.4" rx="1.7" ry="1.1" fill="currentColor" />
    </g>
  ),
  broker: (
    <g fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M24 37.5 H35.5 M33 35 L35.5 37.5 L33 40" />
      <path d="M36 42.5 H24.5 M27 40 L24.5 42.5 L27 45" />
    </g>
  ),
  "coal-nation": (
    <g fill="#fff">
      <path d="M23.5 45 V39 L27 41 V39 L30.5 41 V39 L33 40.5 V34.5 H35 V45 Z" />
    </g>
  ),
};

/**
 * A toy agent. `mood` changes the face; `walking` animates the feet; `thinking` shows a thought bubble.
 * Purely decorative: the agent's name is always shown as text next to it.
 */
export function Toy({ id, size = 48, mood = "idle", walking = false, thinking = false, bob = true }: {
  id: string; size?: number; mood?: "idle" | "happy" | "sad" | "sleep"; walking?: boolean; thinking?: boolean; bob?: boolean;
}) {
  const color = TOY_COLORS[id] ?? "#4a5560";
  return (
    <span className={`toy mood-${mood} ${walking ? "walking" : ""} ${bob ? "bob" : ""}`} style={{ width: size, height: size * (70 / 60), color }} aria-hidden="true">
      {thinking && <span className="bubble"><i /><i /><i /></span>}
      {mood === "sleep" && <span className="zzz">z</span>}
      <svg viewBox="0 0 60 70" width={size} height={size * (70 / 60)}>
        <ellipse className="toy-shadow" cx="30" cy="66" rx="16" ry="2.6" />
        <g className="toy-feet">
          <rect className="foot left" x="18" y="52" width="9" height="11" rx="4" fill={color} />
          <rect className="foot right" x="33" y="52" width="9" height="11" rx="4" fill={color} />
        </g>
        <g className="toy-body">
          <path d={HEX} fill={color} />
          <path d={HEX} fill="url(#toy-shine)" opacity=".35" />
          <g className="eyes">
            <ellipse className="eye" cx="23" cy="25" rx="5" ry="5.6" fill="#fff" />
            <ellipse className="eye" cx="37" cy="25" rx="5" ry="5.6" fill="#fff" />
            <circle className="pupil" cx="24" cy="26" r="2.4" fill="#111" />
            <circle className="pupil" cx="38" cy="26" r="2.4" fill="#111" />
            <path className="lid" d="M17.5 22 Q23 18.5 28.5 22 M31.5 22 Q37 18.5 42.5 22" stroke="#111" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          </g>
          {BADGES[id]}
        </g>
        <defs>
          <linearGradient id="toy-shine" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" />
            <stop offset=".55" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </span>
  );
}

/** Kept for places that only need a small, static agent mark. */
export function Avatar({ id, size = 40, active = false }: { id: string; honest?: boolean; size?: number; active?: boolean }) {
  return <Toy id={id} size={size} thinking={false} bob={active} />;
}

export function Logo({ size = 40 }: { size?: number }) {
  return <img className="logo" src="/logo-192.png" width={size} height={size} alt="" />;
}
