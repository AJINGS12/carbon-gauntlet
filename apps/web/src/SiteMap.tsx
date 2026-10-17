import { Fragment, useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { latLngBounds, type LatLngExpression, type LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ArenaInfo, PublicProject } from "./api";
import type { Market } from "./useArena";
import { countryOf, METHODS, nameOf, tonnes } from "./text";

type SiteStatus = "approved" | "fraud" | "blocked" | "waiting";
interface Site { project: PublicProject; status: SiteStatus; variantOf?: string; label: string }

const COLORS: Record<SiteStatus, string> = { approved: "#1D7563", fraud: "#B42318", blocked: "#B42318", waiting: "#7C8A82" };
const STATUS_LABEL: Record<SiteStatus, string> = {
  approved: "Registered and approved",
  fraud: "Fraud accepted",
  blocked: "Blocked",
  waiting: "Not submitted yet",
};

// GeoJSON is [lon, lat]; Leaflet wants [lat, lon].
const ring = (p: PublicProject): LatLngTuple[] => p.boundary.coordinates[0].map(([lon, lat]) => [lat, lon]);
const centre = (p: PublicProject): LatLngTuple => {
  const r = ring(p).slice(0, -1);
  return [r.reduce((t, c) => t + c[0], 0) / r.length, r.reduce((t, c) => t + c[1], 0) / r.length];
};

function sitesFor(info: ArenaInfo, market: Market): Site[] {
  const out = new Map<string, Site>();
  for (const p of info.projects) {
    const preseeded = info.preseeded.includes(p.projectId);
    out.set(p.projectId, { project: p, status: preseeded ? "approved" : "waiting", label: preseeded ? "Registered before the run" : STATUS_LABEL.waiting });
  }
  for (const s of Object.values(market.submissions)) {
    const status: SiteStatus = s.accepted === undefined ? "waiting" : s.accepted ? (s.attack ? "fraud" : "approved") : "blocked";
    const label = s.accepted === undefined ? "Under review" : `${STATUS_LABEL[status]} in round ${s.round}`;
    out.set(s.project.projectId, { project: s.project, status, variantOf: s.variantOf, label });
  }
  return [...out.values()];
}

function FitTo({ bounds }: { bounds: LatLngTuple[] }) {
  const map = useMap();
  useEffect(() => {
    if (bounds.length) map.fitBounds(latLngBounds(bounds), { padding: [36, 36], maxZoom: 12 });
  }, [map, JSON.stringify(bounds)]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function SiteMap({ info, market }: { info: ArenaInfo; market: Market }) {
  const sites = useMemo(() => sitesFor(info, market), [info, market]);
  const countries = ["TR", "KE", "BR"].filter((c) => sites.some((s) => s.project.hostCountry === c));
  const [country, setCountry] = useState("TR");
  const here = sites.filter((s) => s.project.hostCountry === country);
  const byId = new Map(sites.map((s) => [s.project.projectId, s]));

  return (
    <div className="sitemap">
      <div className="tabs" role="tablist" aria-label="Country">
        {countries.map((c) => (
          <button key={c} role="tab" aria-selected={country === c} className={country === c ? "on" : ""} onClick={() => setCountry(c)}>
            {countryOf(c)} <span className="count">{sites.filter((s) => s.project.hostCountry === c).length}</span>
          </button>
        ))}
      </div>
      <MapContainer className="map" center={[20, 10]} zoom={3} scrollWheelZoom={false} aria-label={`Project sites in ${countryOf(country)}`}>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        <FitTo bounds={here.flatMap((s) => ring(s.project))} />
        {here.map((s) => {
          const color = COLORS[s.status];
          const source = s.variantOf ? byId.get(s.variantOf) : undefined;
          const tip = (
            <Tooltip sticky>
              <strong>{s.project.projectId}</strong><br />
              {METHODS[s.project.methodology]} by {nameOf(s.project.developerId)}, claims {tonnes(s.project.claimedReduction)}<br />
              {s.variantOf ? `Paperwork copied from ${s.variantOf}. ` : ""}{s.label}
            </Tooltip>
          );
          return (
            <Fragment key={s.project.projectId}>
              {source && (
                <Polyline positions={[centre(source.project), centre(s.project)] as LatLngExpression[]} pathOptions={{ color: "#B42318", weight: 1.5, dashArray: "4 6" }} />
              )}
              <Polygon
                positions={ring(s.project)}
                pathOptions={{
                  color, weight: 2,
                  dashArray: s.variantOf || s.status === "blocked" ? "6 5" : undefined,
                  fillColor: color, fillOpacity: s.status === "approved" || s.status === "fraud" ? 0.35 : 0.06,
                }}
              >{tip}</Polygon>
              <CircleMarker center={centre(s.project)} radius={6} pathOptions={{ color, weight: 2, fillColor: s.status === "blocked" || s.status === "waiting" ? "#fff" : color, fillOpacity: 1 }}>
                {tip}
              </CircleMarker>
            </Fragment>
          );
        })}
      </MapContainer>
      <ul className="map-key">
        <li><i style={{ background: COLORS.approved }} />Approved</li>
        <li><i style={{ background: COLORS.fraud }} />Fraud accepted</li>
        <li><i className="hollow" style={{ borderColor: COLORS.blocked }} />Blocked</li>
        <li><i className="dash" />Clone of another project, linked to the original</li>
        <li><i className="hollow" style={{ borderColor: COLORS.waiting }} />Not submitted yet</li>
      </ul>
    </div>
  );
}
