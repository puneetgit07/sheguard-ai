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

type SafetySegment = {
  start: {
    latitude: number;
    longitude: number;
  };
  end: {
    latitude: number;
    longitude: number;
  };
  distance_km: number;
  district: string | null;
  risk_indicator: number | null;
  risk_level: string;
};

type RouteMapProps = {
  coordinates: number[][];
  startLabel: string;
  destinationLabel: string;

  riskIndicator?: number | null;
  riskLevel?: string;

  segments?: SafetySegment[];
};

function FitRoute({
  coordinates,
}: {
  coordinates: number[][];
}) {
  const map = useMap();

  useEffect(() => {
    if (coordinates.length > 0) {
      const positions = coordinates.map(
        ([lon, lat]) =>
          [lat, lon] as [number, number]
      );

      map.fitBounds(
        L.latLngBounds(positions),
        {
          padding: [35, 35],
        }
      );
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

  if (
    level === "higher" ||
    riskIndicator >= 66.67
  ) {
    return "#dc2626";
  }

  if (
    level === "moderate" ||
    riskIndicator >= 33.33
  ) {
    return "#f59e0b";
  }

  return "#16a34a";
}

function getSegmentPositions(
  segment: SafetySegment
): [number, number][] {
  return [
    [
      segment.start.latitude,
      segment.start.longitude,
    ],
    [
      segment.end.latitude,
      segment.end.longitude,
    ],
  ];
}

export default function RouteMap({
  coordinates,
  startLabel,
  destinationLabel,
  riskIndicator,
  riskLevel,
  segments = [],
}: RouteMapProps) {
  if (coordinates.length === 0) {
    return (
      <p>
        No route coordinates are available.
      </p>
    );
  }

  const positions = coordinates.map(
    ([lon, lat]) =>
      [lat, lon] as [number, number]
  );

  const start = positions[0];

  const destination =
    positions[positions.length - 1];

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

        {/* -------------------------------- */}
        {/* District-wise safety segments */}
        {/* -------------------------------- */}

        {segments.length > 0 ? (
          segments.map(
            (segment, index) => {
              const segmentPositions =
                getSegmentPositions(segment);

              const color =
                getRiskColor(
                  segment.risk_indicator,
                  segment.risk_level
                );

              return (
                <Polyline
                  key={`safety-segment-${index}`}
                  positions={segmentPositions}
                  pathOptions={{
                    color,
                    weight: 7,
                    opacity: 0.95,
                    lineCap: "round",
                    lineJoin: "round",
                  }}
                >
                  <Popup>
                    <strong>
                      {segment.district ??
                        "Safety data unavailable"}
                    </strong>

                    <br />

                    Distance:{" "}
                    {segment.distance_km} km

                    <br />

                    Risk indicator:{" "}
                    {segment.risk_indicator ??
                      "Unavailable"}

                    {segment.risk_indicator !=
                      null && "/100"}

                    <br />

                    Risk level:{" "}
                    {segment.risk_level}
                  </Popup>
                </Polyline>
              );
            }
          )
        ) : (
          /* -------------------------------- */
          /* Fallback if segment data missing */
          /* -------------------------------- */

          <Polyline
            positions={positions}
            pathOptions={{
              color: getRiskColor(
                riskIndicator,
                riskLevel
              ),
              weight: 6,
              opacity: 0.95,
            }}
          />
        )}

        {/* -------------------------------- */}
        {/* Start marker */}
        {/* -------------------------------- */}

        <Marker position={start}>
          <Popup>
            <strong>Start</strong>

            <br />

            {startLabel}
          </Popup>
        </Marker>

        {/* -------------------------------- */}
        {/* Destination marker */}
        {/* -------------------------------- */}

        <Marker position={destination}>
          <Popup>
            <strong>
              Destination
            </strong>

            <br />

            {destinationLabel}
          </Popup>
        </Marker>

        <FitRoute
          coordinates={coordinates}
        />
      </MapContainer>
    </div>
  );
}