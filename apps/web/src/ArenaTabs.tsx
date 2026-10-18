/** The two things you can do in the Arena: watch the AI agents, or try a trick yourself. */
export function ArenaTabs({ active, go, badge }: { active: "watch" | "try"; go: (path: string) => void; badge?: React.ReactNode }) {
  const tab = (to: string, id: "watch" | "try", label: string, hint: string) => (
    <a
      href={to}
      className={`arena-tab ${active === id ? "on" : ""}`}
      aria-current={active === id ? "page" : undefined}
      onClick={(e) => { e.preventDefault(); go(to); }}
    >
      <strong>{label}</strong>
      <span>{hint}</span>
    </a>
  );
  return (
    <nav className="arena-tabs" aria-label="Arena">
      {tab("/arena", "watch", "Run the gauntlet", "Watch four AI agents play")}
      {tab("/try", "try", "Try to cheat it", "Play the attacker yourself")}
      {badge}
    </nav>
  );
}
