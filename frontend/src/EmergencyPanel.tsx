
import { useState } from "react";
export type EmergencyTrip = {
  start: string;
  destination: string;
  distanceKm: number;
  estimatedMinutes: number;
  routeId: number;
};
import "./EmergencyPanel.css";

type TrustedContact = {
  name: string;
  phone: string;
};

type EmergencyPanelProps = {
  trip: EmergencyTrip | null;
};

export default function EmergencyPanel({ trip }: EmergencyPanelProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [contact, setContact] = useState<TrustedContact | null>(null);
  const [confirmSOS, setConfirmSOS] = useState(false);
  const [demoAlert, setDemoAlert] = useState(false);
  const [error, setError] = useState("");

  function saveContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const cleanName = name.trim();
    const cleanPhone = phone.replace(/[\s()-]/g, "");

    // Accept an Indian 10-digit number, optionally with +91.
    const validPhone = /^(?:\+91)?[6-9]\d{9}$/.test(cleanPhone);

    if (!cleanName) {
      setError("Please enter your trusted contact's name.");
      return;
    }

    if (!validPhone) {
      setError("Enter a valid Indian mobile number.");
      return;
    }

    if (!consent) {
      setError("Please confirm consent before saving this contact.");
      return;
    }

    setContact({ name: cleanName, phone: cleanPhone });
    setDemoAlert(false);
    setConfirmSOS(false);
  }

  function prepareSOS() {
    setError("");
    setDemoAlert(false);

    if (!contact) {
      setError("Please add and save a trusted contact first.");
      return;
    }

    if (!consent) {
      setError("Please confirm consent before using this demo workflow.");
      return;
    }

    setConfirmSOS(true);
  }

  function confirmDemoSOS() {
    setConfirmSOS(false);
    setDemoAlert(true);
  }

  function resetContact() {
    setContact(null);
    setDemoAlert(false);
    setConfirmSOS(false);
    setName("");
    setPhone("");
    setConsent(false);
    setError("");
  }

  return (
    <section className="panel emergency-panel">
      <div className="emergency-heading">
        <div>
          <span className="emergency-eyebrow">
            PERSONAL SAFETY
          </span>
          <h2>Emergency Assistance</h2>
          <p>
            Set up a trusted contact and preview the emergency
            assistance workflow.
          </p>
        </div>

        <div className="emergency-status">
          <span className="status-dot" />
          DEMO MODE
        </div>
      </div>

      {!contact ? (
        <form className="contact-form" onSubmit={saveContact}>
          <h3>Trusted Contact</h3>

          <label htmlFor="trusted-name">Contact name</label>
          <input
            id="trusted-name"
            type="text"
            placeholder="e.g. Mom"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
          />

          <label htmlFor="trusted-phone">Mobile number</label>
          <input
            id="trusted-phone"
            type="tel"
            placeholder="e.g. 9876543210"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel"
            required
          />

          <label className="consent-row">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              I consent to using these details in this local prototype
              and understand that no alert will be sent.
            </span>
          </label>

          <button className="save-contact-button" type="submit">
            Save Trusted Contact
          </button>
        </form>
      ) : (
        <div className="trusted-contact-card">
          <span className="contact-avatar">
            {contact.name.charAt(0).toUpperCase()}
          </span>

          <div className="contact-details">
            <span className="contact-label">TRUSTED CONTACT</span>
            <strong>{contact.name}</strong>
            <span>{contact.phone}</span>
            <span className="contact-saved">
              Contact saved for this session
            </span>
          </div>

          <button
            className="edit-contact-button"
            type="button"
            onClick={resetContact}
          >
            Edit
          </button>
        </div>
      )}

      {error && (
        <p className="emergency-error" role="alert">
          {error}
        </p>
      )}
      <div className="emergency-trip-summary">
  <div className="trip-summary-heading">
    <span className="contact-label">JOURNEY CONTEXT</span>
    <span className="trip-live-badge">
      {trip ? "TRIP READY" : "NO ACTIVE TRIP"}
    </span>
  </div>

  {trip ? (
    <>
      <div className="trip-location">
        <span className="trip-location-dot start-dot" />
        <div>
          <small>STARTING POINT</small>
          <strong>{trip.start}</strong>
        </div>
      </div>

      <div className="trip-location">
        <span className="trip-location-dot destination-dot" />
        <div>
          <small>DESTINATION</small>
          <strong>{trip.destination}</strong>
        </div>
      </div>

      <div className="trip-metrics">
        <div>
          <strong>{trip.distanceKm.toFixed(1)} km</strong>
          <small>Distance</small>
        </div>
        <div>
          <strong>{trip.estimatedMinutes} min</strong>
          <small>Estimated time</small>
        </div>
        <div>
          <strong>Route {trip.routeId}</strong>
          <small>Selected route</small>
        </div>
      </div>
    </>
  ) : (
    <p>
      No calculated trip is available. Prepare a trip first;
      no journey details will be invented.
    </p>
  )}
</div>

      <div className="sos-action-area">
        <div className="sos-explainer">
          <strong>Need emergency assistance?</strong>
          <p>
            The button below demonstrates the confirmation flow.
            It does not send messages or contact the police.
          </p>
        </div>

        <button
          className="sos-demo-button"
          type="button"
          onClick={prepareSOS}
        >
          <span className="sos-pulse" />
          PREPARE SOS
        </button>
      </div>

      {confirmSOS && contact && (
        <div className="sos-confirm-card" role="alert">
          <h3>Confirm demo SOS</h3>
          <p>
            The prototype will display a simulated alert for{" "}
            <strong>{contact.name}</strong>.
          </p>{trip && (
  <div className="sos-trip-context">
    <strong>Trip details</strong>
    <p>From: {trip.start}</p>
    <p>To: {trip.destination}</p>
    <p>
      Route {trip.routeId} · {trip.distanceKm.toFixed(1)} km ·{" "}
      {trip.estimatedMinutes} min estimated
    </p>
  </div>
)}
          <p className="demo-warning">
            No SMS, call, or external notification will be sent.
          </p>

          <div className="sos-confirm-actions">
            <button
              type="button"
              className="cancel-sos-button"
              onClick={() => setConfirmSOS(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="confirm-sos-button"
              onClick={confirmDemoSOS}
            >
              Confirm Demo
            </button>
          </div>
        </div>
      )}

      {demoAlert && contact && (
        <div className="demo-alert-card" role="status">
          <span className="demo-alert-icon">✓</span>
          <div>
            <h3>Demo SOS workflow completed</h3>
            <p>
              Simulated recipient: <strong>{contact.name}</strong>
            </p>
            <p>
              Contact number: <strong>{contact.phone}</strong>
            </p>
            <p className="demo-warning">
              Demo only — no alert was actually delivered.
            </p>
          </div>
        </div>
      )}

      <div className="emergency-footer">
        <div>
          <strong>Real emergency in India?</strong>
          <p>Use the official emergency service if you need urgent help.</p>
        </div>

        <a className="call-emergency-button" href="tel:112">
          Call 112
        </a>
      </div>

      <p className="emergency-disclaimer">
        This prototype is not an emergency service. The contact is held
        in component memory only and is cleared when the page is reloaded.
        The call link opens the device dialer where supported; it does
        not place a call automatically.
      </p>
    </section>
  );
}
