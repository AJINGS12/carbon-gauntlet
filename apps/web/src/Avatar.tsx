/** Hexagon avatars that echo the logo, one simple glyph per agent. */

const HEX = "M50 4 L90 27 L90 73 L50 96 L10 73 L10 27 Z";

const GLYPHS: Record<string, JSX.Element> = {
  // Honest Developer: a sprout
  "honest-dev": (
    <g fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M50 72 V44" />
      <path d="M50 52 C50 38 38 32 28 34 C28 46 38 52 50 52 Z" fill="currentColor" stroke="none" />
      <path d="M50 46 C50 32 62 26 72 28 C72 40 62 46 50 46 Z" fill="currentColor" stroke="none" />
    </g>
  ),
  // Opportunist: a mask
  "opportunist-dev": (
    <g>
      <path d="M24 40 C24 34 30 32 36 34 L50 38 L64 34 C70 32 76 34 76 40 C76 54 68 62 60 62 C54 62 52 56 50 56 C48 56 46 62 40 62 C32 62 24 54 24 40 Z" fill="currentColor" />
      <ellipse cx="38" cy="45" rx="6" ry="4" fill="var(--avatar-bg)" />
      <ellipse cx="62" cy="45" rx="6" ry="4" fill="var(--avatar-bg)" />
    </g>
  ),
  // Credit Broker: two arrows trading places
  broker: (
    <g fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M28 40 H70 M60 30 L70 40 L60 50" />
      <path d="M72 60 H30 M40 50 L30 60 L40 70" />
    </g>
  ),
  // Coal Nation: a factory with a chimney
  "coal-nation": (
    <g fill="currentColor">
      <path d="M26 72 V48 L40 56 V48 L54 56 V48 L64 54 V30 H72 V72 Z" />
      <circle cx="70" cy="22" r="4" opacity="0.7" />
      <circle cx="78" cy="15" r="3" opacity="0.5" />
    </g>
  ),
};

export function Avatar({ id, honest, size = 40, active = false }: { id: string; honest?: boolean; size?: number; active?: boolean }) {
  return (
    <svg className={`avatar ${honest ? "honest" : "attacker"} ${active ? "active" : ""}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path d={HEX} className="avatar-hex" />
      <g className="avatar-glyph">{GLYPHS[id] ?? <circle cx="50" cy="50" r="14" fill="currentColor" />}</g>
    </svg>
  );
}

export function Logo({ size = 40 }: { size?: number }) {
  return <img className="logo" src="/logo-192.png" width={size} height={size} alt="" />;
}
