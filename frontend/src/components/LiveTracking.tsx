import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./LiveTracking.css";
delete (L.Icon.Default.prototype as any)._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});
const BACKEND_URL = "https://sheguard-ai-sedv.onrender.com";

interface TrackingData {
  success: boolean;
  tracking_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  updated_at: string;
  active: boolean;
}
function MapUpdater({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}) {
  const map = useMap();

  useEffect(() => {
    map.setView([latitude, longitude], 15);
  }, [latitude, longitude, map]);

  return null;
}
export default function LiveTracking() {
  const [trackingData, setTrackingData] =
    useState<TrackingData | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const trackingId =
    new URLSearchParams(window.location.search).get("tracking");

  async function fetchTrackingData() {
    if (!trackingId) {
      setError("Tracking ID is missing.");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/live-tracking/${trackingId}`
      );

      if (!response.ok) {
        throw new Error("Tracking session not found.");
      }

      const data = await response.json();

      setTrackingData(data);
      setError("");
    } catch (err) {
      console.error(err);
      setError("Unable to load live tracking.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTrackingData();

    const interval = setInterval(() => {
      fetchTrackingData();
    }, 3000);

    return () => clearInterval(interval);
  }, [trackingId]);

  if (loading) {
    return (
      <div className="live-tracking-page">
        <div className="tracking-card">
          <div className="tracking-loader">
            Loading live location...
          </div>
        </div>
      </div>
    );
  }

  if (error || !trackingData) {
    return (
      <div className="live-tracking-page">
        <div className="tracking-card">
          <div className="tracking-icon">⚠️</div>

          <h1>Tracking Unavailable</h1>

          <p>
            {error ||
              "This tracking session could not be found."}
          </p>
        </div>
      </div>
    );
  }

  const mapUrl =
    `https://www.google.com/maps?q=` +
    `${trackingData.latitude},${trackingData.longitude}`;

  const updatedTime = new Date(
    trackingData.updated_at
  ).toLocaleString();

  return (
    <div className="live-tracking-page">

      <div className="tracking-header">
        <div>
          <p className="tracking-brand">
            SHEGUARD AI
          </p>

          <h1>Live Location Tracking</h1>
        </div>

        <div
          className={
            trackingData.active
              ? "tracking-status active"
              : "tracking-status inactive"
          }
        >
          <span></span>

          {trackingData.active
            ? "LIVE"
            : "STOPPED"}
        </div>
      </div>

      <div className="tracking-grid">

        <div className="tracking-card location-card">

          <div className="location-top">
            <div>
              <p className="card-label">
                CURRENT LOCATION
              </p>

              <h2>
                📍 Location received
              </h2>
            </div>

            <div className="gps-icon">
              📡
            </div>
          </div>

          <div className="coordinates">

            <div>
              <span>Latitude</span>
              <strong>
                {trackingData.latitude.toFixed(6)}
              </strong>
            </div>

            <div>
              <span>Longitude</span>
              <strong>
                {trackingData.longitude.toFixed(6)}
              </strong>
            </div>

          </div>

          {trackingData.accuracy !== null && (
            <div className="accuracy">
              GPS Accuracy: ±
              {Math.round(trackingData.accuracy)}
              m
            </div>
          )}

          <div className="updated">
            <span>Last updated</span>
            <strong>{updatedTime}</strong>
          </div>

          <a
            href={mapUrl}
            target="_blank"
            rel="noreferrer"
            className="open-map-button"
          >
            🗺️ Open in Google Maps
          </a>

        </div>

        <div className="tracking-card map-card">
  <MapContainer
    center={[
      trackingData.latitude,
      trackingData.longitude,
    ]}
    zoom={15}
    scrollWheelZoom={true}
    className="live-map"
  >
    <TileLayer
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    />

    <MapUpdater
      latitude={trackingData.latitude}
      longitude={trackingData.longitude}
    />

    <Marker
      position={[
        trackingData.latitude,
        trackingData.longitude,
      ]}
    >
      <Popup>
        <strong>SHEGUARD AI</strong>
        <br />
        Live Location
        <br />
        {trackingData.latitude.toFixed(6)},{" "}
        {trackingData.longitude.toFixed(6)}
      </Popup>
    </Marker>
  </MapContainer>
</div>

      </div>

      <div className="tracking-info">

        <div>
          <span>🔄</span>

          <div>
            <strong>Automatic Updates</strong>
            <p>
              Location refreshes every 3 seconds.
            </p>
          </div>
        </div>

        <div>
          <span>🔐</span>

          <div>
            <strong>Tracking ID</strong>
            <p>
              {trackingData.tracking_id}
            </p>
          </div>
        </div>

      </div>

      <p className="tracking-footer">
        Powered by SHEGUARD AI • Emergency Location
        Sharing
      </p>

    </div>
  );
}