import { useEffect, useState } from "react";
import Home from "./Home";
import Arena from "./Arena";
import { REPO_URL } from "./api";

/** Two pages, no router library: "/" is the home page, "/arena" runs the gauntlet. */
function usePath(): [string, (to: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = (to: string) => {
    if (to === window.location.pathname) return;
    window.history.pushState({}, "", to);
    setPath(to);
    window.scrollTo(0, 0);
  };
  return [path, go];
}

export default function App() {
  const [path, go] = usePath();
  const arena = path.startsWith("/arena");
  const link = (to: string) => (e: React.MouseEvent) => { e.preventDefault(); go(to); };

  useEffect(() => {
    document.title = arena ? "The Arena · Carbon Gauntlet" : "Carbon Gauntlet: only honest credits make it through";
  }, [arena]);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <nav className="topbar" aria-label="Main">
        <a className="brand" href="/" onClick={link("/")} aria-label="Carbon Gauntlet home">Carbon Gauntlet</a>
        <div className="nav-links">
          {!arena && <a href="#how">How it works</a>}
          <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
          {arena ? (
            <a className="button" href="/" onClick={link("/")}>About the project</a>
          ) : (
            <a className="button primary" href="/arena" onClick={link("/arena")}>Open the Arena</a>
          )}
        </div>
      </nav>
      <main id="main">{arena ? <Arena /> : <Home go={go} />}</main>
      <footer className="site-foot">
        <p>Carbon Gauntlet is an experimental prototype built for the IEEE ClimateChain Global Hackathon 2026. All projects are synthetic and it runs on a testnet: it is not a real carbon registry.</p>
      </footer>
    </>
  );
}
