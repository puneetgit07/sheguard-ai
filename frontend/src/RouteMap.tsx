
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect } from "react";
import "leaflet/dist/leaflet.css";

type RouteMapProps = {
  coordinates: number[][];
  startLabel: string;
  destinationLabel: string;
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

export default function RouteMap({
  coordinates,
  startLabel,
  destinationLabel,
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

        <Polyline
          positions={positions}
          pathOptions={{ color: "#0d9488", weight: 6 }}
        />

        <Marker position={start}>
          <Popup>Start: {startLabel}</Popup>
        </Marker>

        <Marker position={destination}>
          <Popup>Destination: {destinationLabel}</Popup>
        </Marker>

        <FitRoute coordinates={coordinates} />
      </MapContainer>
    </div>
  );
}
