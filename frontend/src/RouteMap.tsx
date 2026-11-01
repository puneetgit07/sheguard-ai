import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { useEffect } from "react";
import "leaflet/dist/leaflet.css";

type RouteMapProps = {
  coordinates: number[][];
  startLabel: string;
  destinationLabel: string;

  // Safety assessment data
  riskIndicator?: number | null;
  riskLevel?: string;
};

function FitRoute({ coordinates }: { coordinates: number[][] }) {
  const map = useMap();

  useEffect(() => {
    if (coordinates.length > 0) {
      const positions = coordinates.map(
        ([lon, lat]) => [lat, lon] as [number, number]
      );

      map.fitBounds(L.latLngBounds(positions), {
        padding: [35, 35],
      });
    }
  }, [coordinates, map]);

  return null;
}

function getRiskColor(
  riskIndicator: number | null | undefined,
  riskLevel?: string
) {
  if (riskIndicator == null) {
    return "#64748b";
  }

  const level = riskLevel?.toLowerCase();

  if (level === "higher" || riskIndicator >= 66.67) {
    return "#dc2626";
  }

  if (level === "moderate" || riskIndicator >= 33.33) {
    return "#f59e0b";
  }

  return "#16a34a";
}

function SafetyHeatmap({
  positions,
  riskIndicator,
  riskLevel,
}: {
  positions: [number, number][];
  riskIndicator?: number | null;
  riskLevel?: string;
}) {
  if (positions.length < 2 || riskIndicator == null) {
    return null;
  }

  const color = getRiskColor(riskIndicator, riskLevel);

  return (
    <>
      {/* Wide transparent layer = heatmap/glow */}
      <Polyline
        positions={positions}
        pathOptions={{
          color,
          weight: 28,
          opacity: 0.14,
          lineCap: "round",
          lineJoin: "round",
        }}
      />

      <Polyline
        positions={positions}
        pathOptions={{
          color,
          weight: 18,
          opacity: 0.20,
          lineCap: "round",
          lineJoin: "round",
        }}
      />
    </>
  );
}

export default function RouteMap({
  coordinates,
  startLabel,
  destinationLabel,
  riskIndicator,
  riskLevel,
}: RouteMapProps) {
  if (coordinates.length === 0) {
    return <p>No route coordinates are available.</p>;
  }

  // OSRM GeoJSON uses [longitude, latitude].
  // Leaflet expects [latitude, longitude].
  const positions = coordinates.map(
    ([lon, lat]) => [lat, lon] as [number, number]
  );

  const start = positions[0];
  const destination = positions[positions.length - 1];

  const safetyColor = getRiskColor(
    riskIndicator,
    riskLevel
  );

  return (
    <div className="route-map">
      <MapContainer
        center={start}
        zoom={12}
        scrollWheelZoom={true}
        className="leaflet-map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* =========================
            SAFETY HEATMAP
           ========================= */}
        <SafetyHeatmap
          positions={positions}
          riskIndicator={riskIndicator}
          riskLevel={riskLevel}
        />

        {/* Main route */}
        <Polyline
          positions={positions}
          pathOptions={{
            color: safetyColor,
            weight: 6,
            opacity: 0.95,
          }}
        />

        <Marker position={start}>
          <Popup>
            <strong>Start</strong>
            <br />
            {startLabel}
          </Popup>
        </Marker>

        <Marker position={destination}>
          <Popup>
            <strong>Destination</strong>
            <br />
            {destinationLabel}
          </Popup>
        </Marker>

        {/* Safety information popup */}
        {riskIndicator != null && (
          <Marker
            position={positions[Math.floor(positions.length / 2)]}
            opacity={0}
          >
            <Popup>
              <strong>Historical Safety Indicator</strong>
              <br />
              Risk: {riskIndicator}/100
              <br />
              Level: {riskLevel ?? "Unavailable"}
            </Popup>
          </Marker>
        )}

        <FitRoute coordinates={coordinates} />
      </MapContainer>
    </div>
  );
}