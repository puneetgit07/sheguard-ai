
import { useState } from "react";
import "./App.css";
import RouteMap from "./RouteMap";
import EmergencyPanel from "./EmergencyPanel";
import SafetyScene from "./SafetyScene";
import {
  ShieldCheck,
  Sparkles,
} from "lucide-react";
type RouteOption = {
  id: number;
  distance_km: number;
  estimated_minutes: number;
  geometry: {
    type: string;
    coordinates: number[][];
  };
};

type RouteResult = {
  success: boolean;
  source: string;
  start: { label: string; lat: number; lon: number };
  destination: { label: string; lat: number; lon: number };
  routes: RouteOption[];
  safety_status: string;
  safety_note: string;
  attribution: string;
};

type VerificationResult = {
  success: boolean;
  agent: string;
  overall_status: string;
  journey: {
    start: string;
    destination: string;
  };
  checks: {
    name: string;
    status: string;
    details: string;
  }[];
  sources: {
    title: string;
    url: string;
    claim: string;
    source_type: string;
    status: string;
  }[];
  limitations: string[];
};
type RiskFinding = {
  label: string;
  claim: string;
  details: string;
};

type RiskAssessmentResult = {
  success: boolean;
  agent: string;
  overall_status: string;
  journey: {
    start: string;
    destination: string;
  };
  findings: RiskFinding[];
  limitations: string[];
    evidence_sources: {
    title: string;
    url: string;
    source_type: string;
    scope: string;
    status: string;
    route_specific: boolean;
  }[];

};

type EvidenceClassification = {
  label: string;
  definition: string;
};

type EvidenceClassificationResult = {
  success: boolean;
  agent: string;
  status: string;
  classifications: EvidenceClassification[];
  limitations: string[];
};

type ClaimClassificationResult = {
  official_sources?: {
  title: string;
  url: string;
  source_type: string;
  scope: string;
  status: string;
  route_specific: boolean;
  fetch_status?: string;
  fetch_reason?: string;
  content_preview?: string | null;
  text_match_status?: string;
  matching_terms?: string[];
}[];
  success: boolean;
  agent: string;
  claim: string;
  claim_type?: string;
  classification: string;
  verification_status: string;
  reason: string;
  evidence_needed: string[];
  limitations: string[];
};


export default function App() {
  const [startLocation, setStartLocation] = useState("");
  const [destination, setDestination] = useState("");
  const [gps, setGps] = useState<{ lat: number; lon: number } | null>(
    null
  );
  const [useGPS, setUseGPS] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [routeResult, setRouteResult] = useState<RouteResult | null>(
    null
  );
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [verification, setVerification] =
  useState<VerificationResult | null>(null);

const [verifying, setVerifying] = useState(false);
  function getCurrentLocation() {
    setMessage("");
    setRouteResult(null);

    if (!navigator.geolocation) {
      setMessage("GPS location is not supported by this browser.");
      return;
    }

    setMessage("Requesting location permission...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGps({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
        setUseGPS(true);
        setMessage("Current location obtained successfully.");
      },
      (error) => {
        setUseGPS(false);
        const errors: Record<number, string> = {
          1: "Location permission denied. You can enter your starting point manually.",
          2: "Current location is unavailable. Try manual entry.",
          3: "Location request timed out. Please try again.",
        };
        setMessage(errors[error.code] ?? "Could not obtain your location.");
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 60000,
      }
    );
  }
const [riskAssessment, setRiskAssessment] =
  useState<RiskAssessmentResult | null>(null);

const [assessingRisk, setAssessingRisk] = useState(false);
  async function prepareTrip() {
    if (!useGPS && !startLocation.trim()) {
      setMessage("Enter your starting location or use GPS.");
      return;
    }

    if (!destination.trim()) {
      setMessage("Please enter your destination.");
      return;
    }

    setLoading(true);
    setMessage("Finding a road route...");
    setRouteResult(null);

    const requestBody = useGPS && gps
      ? {
          start_lat: gps.lat,
          start_lon: gps.lon,
          destination: destination.trim(),
        }
      : {
          start_location: startLocation.trim(),
          destination: destination.trim(),
        };

    try {
      const response = await fetch("https://sheguard-ai-sedv.onrender.com/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Could not calculate the route."
        );
      }
      setSelectedRouteId(null);
      setRouteResult(data as RouteResult);
      setMessage("Route received successfully.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Backend connection failed. Check that the server is running."
      );
    } finally {
      setLoading(false);
    }
  }
  
const [evidenceClassification, setEvidenceClassification] =
  useState<EvidenceClassificationResult | null>(null);

const [classifyingEvidence, setClassifyingEvidence] = useState(false);

const [claimText, setClaimText] = useState("");

const [claimResult, setClaimResult] =
  useState<ClaimClassificationResult | null>(null);

const [classifyingClaim, setClassifyingClaim] = useState(false);

  
async function verifyRoute() {
  if (!routeResult) {
    setMessage("Please calculate a route first.");
    return;
  }

  setVerifying(true);
  setVerification(null);
  setMessage("Checking route verification information...");

  try {
    const response = await fetch(
      "https://sheguard-ai-sedv.onrender.com/api/verify-route",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_location: routeResult.start.label,
          destination: routeResult.destination.label,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        typeof data.detail === "string"
          ? data.detail
          : "Route verification request failed."
      );
    }

    setVerification(data as VerificationResult);
    setMessage("Verification checks loaded.");
  } catch (error) {
    setMessage(
      error instanceof Error
        ? error.message
        : "Could not connect to the verification service."
    );
  } finally {
    setVerifying(false);
  }
}
async function assessRouteRisk() {
  if (!routeResult) {
    setMessage("Please find a route first.");
    return;
  }

  setAssessingRisk(true);
  setRiskAssessment(null);
  setMessage("");

  try {
    const response = await fetch(
      "https://sheguard-ai-sedv.onrender.com/api/assess-risk",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          start_location: startLocation,
          destination: destination,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    const data: RiskAssessmentResult = await response.json();
    setRiskAssessment(data);
  } catch (error) {
    console.error("Risk assessment error:", error);
    setMessage("Risk assessment failed. Please check the backend.");
  } finally {
    setAssessingRisk(false);
  }
}

const classifyEvidence = async () => {
  setClassifyingEvidence(true);

  try {
    const response = await fetch(
      "https://sheguard-ai-sedv.onrender.com/api/classify-evidence",
      {
        method: "POST",
      }
    );

    if (!response.ok) {
      throw new Error("Evidence classification request failed.");
    }

    const data: EvidenceClassificationResult = await response.json();

    setEvidenceClassification(data);
  } catch (error) {
    console.error("Evidence classification error:", error);
    setMessage("Could not load evidence classifications. Please try again.");
  } finally {
    setClassifyingEvidence(false);
  }
};

const classifyClaim = async () => {
  const trimmedClaim = claimText.trim();

  if (trimmedClaim.length < 5) {
    setMessage("Please enter a claim with at least 5 characters.");
    return;
  }

  setClassifyingClaim(true);
  setClaimResult(null);
  setMessage("");

  try {
    const response = await fetch(
      "https://sheguard-ai-sedv.onrender.com/api/classify-claim",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          claim: trimmedClaim,
        }),
      }
    );

    if (!response.ok) {
      throw new Error("Claim classification request failed.");
    }

    const data: ClaimClassificationResult = await response.json();
    setClaimResult(data);
  } catch (error) {
    console.error("Claim classification error:", error);
    setMessage(
      "Could not classify the claim. Please check that the backend is running."
    );
  } finally {
    setClassifyingClaim(false);
  }
};
const selectedRoute =
  routeResult?.routes.find(
    (route) => route.id === selectedRouteId
  ) ?? routeResult?.routes[0] ?? null;

const activeTrip = routeResult && selectedRoute
  ? {
      start: routeResult.start.label,
      destination: routeResult.destination.label,
      distanceKm: selectedRoute.distance_km,
      estimatedMinutes: selectedRoute.estimated_minutes,
      routeId: selectedRoute.id,
    }
  : null;
  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">SHEGUARD <span>AI</span></div>
        <div className="demo">AGENTIC AI PROTOTYPE</div>
      </header>

      
<section className="hero hero-premium">
  <div className="hero-premium-grid">
    <div className="hero-copy">
      <p className="eyebrow">
        <Sparkles size={15} /> YOUR AI TRAVEL SAFETY ASSISTANT
      </p>

      <h1>
        Your journey.
        <br />
        <span>Your safety.</span>
      </h1>

      <p className="subtitle">
        Plan your journey, review available evidence, and prepare
        a user-controlled emergency workflow — all in one place.
      </p>

      <div className="hero-trust">
        <ShieldCheck size={18} />
        <span>Evidence-aware · User-controlled · Privacy-conscious</span>
      </div>
    </div>

    <SafetyScene />
  </div>
</section>

      <section className="panel">
        <h2>Plan your journey</h2>

        <button className="primary" onClick={getCurrentLocation}>
          Use My Current Location
        </button>

        {gps && useGPS && (
          <p className="message">
            GPS coordinates: {gps.lat.toFixed(5)}, {gps.lon.toFixed(5)}
          </p>
        )}

        <p className="notice">
          GPS is optional. Your browser will ask permission before
          sharing your location with this page.
        </p>

        <div className="agent">
          <div>
            <strong>Or enter your starting point manually</strong>
            <input
              id="startLocation"
              value={startLocation}
              onChange={(event) => {
                setStartLocation(event.target.value);
                setUseGPS(false);
              }}
              placeholder="e.g. GL Bajaj, Greater Noida"
            />
          </div>
        </div>

        <label htmlFor="destination">Destination</label>
        <input
          id="destination"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          placeholder="e.g. India Gate, New Delhi"
        />

        <button
          className="primary"
          onClick={prepareTrip}
          disabled={loading}
        >
          {loading ? "Finding Route..." : "Prepare My Trip"}
        </button>

        {message && <p className="message">{message}</p>}

        
{routeResult && (
  <div className="results">
    <h3>Compare Your Routes</h3>

    <p><strong>From:</strong> {routeResult.start.label}</p>
    <p><strong>To:</strong> {routeResult.destination.label}</p>

    {routeResult.routes.length === 0 && (
      <p>No routes were returned. Please try again.</p>
    )}

    <div className="route-options">
      {routeResult.routes.map((route) => (
        <button
          key={route.id}
          type="button"
          className={
            selectedRouteId === route.id
              ? "route-card selected"
              : "route-card"
          }
          onClick={() => setSelectedRouteId(route.id)}
        >
          <strong>Route {route.id}</strong>
          <span>{route.distance_km} km</span>
          <span>{route.estimated_minutes} min estimated</span>
          <small>
            {selectedRouteId === route.id
              ? "Selected"
              : "Select this route"}
          </small>
        </button>
      ))}
    </div>

    {routeResult.routes.length > 0 && (
      <>
        <h4>Selected route on map</h4>
        <RouteMap
          coordinates={
            routeResult.routes.find(
              (route) => route.id === selectedRouteId
            )?.geometry.coordinates ??
            routeResult.routes[0].geometry.coordinates
          }
          startLabel={routeResult.start.label}
          destinationLabel={routeResult.destination.label}
        />

        <p>
          <strong>Safety status:</strong>{" "}
          {routeResult.safety_status}
        </p>
        <p className="notice">{routeResult.safety_note}</p>
        <p className="notice">{routeResult.attribution}</p>
        
<button
  className="primary"
  onClick={verifyRoute}
  disabled={verifying || !routeResult}
>
  {verifying ? "Checking..." : "Verify Route Information"}
</button>
<button
  onClick={assessRouteRisk}
  disabled={assessingRisk || !routeResult}
>
  {assessingRisk
    ? "Assessing Risk..."
    : "Assess Route Risk"}
</button>

<button
  type="button"
  onClick={classifyEvidence}
  disabled={classifyingEvidence}
>
  {classifyingEvidence
    ? "Loading Classifications..."
    : "View Evidence Classifications"}
</button>

{evidenceClassification && (
  <div className="verification-panel">
    <h3>{evidenceClassification.agent}</h3>

    <p>
      <strong>Status:</strong> {evidenceClassification.status}
    </p>

    <h4>Classification Guide</h4>

    {evidenceClassification.classifications.map((item) => (
      <div className="agent finding-card" key={item.label}>
        <p>
          <strong>{item.label}</strong>
        </p>
        <p>{item.definition}</p>
      </div>
    ))}

    <h4>Limitations</h4>

    <ul>
      {evidenceClassification.limitations.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  </div>
)}

{verification && (
  <div className="verification-panel">
    <h3>{verification.agent}</h3>

    <p>
      <strong>Overall status:</strong>{" "}
      {verification.overall_status}
    </p>

    {verification.checks.map((check) => (
      <div className="agent" key={check.name}>
        <div>
          <strong>{check.name}</strong>
          <p>
            <strong>Status:</strong> {check.status}
          </p>
          <p>{check.details}</p>
        </div>
      </div>
    ))}
    <h4>Official Reference Sources</h4>

    {verification.sources?.map((source, index) => (
      <div className="source-card" key={index}>
        <h4>
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
          >
            {source.title}
          </a>
        </h4>

        <p>{source.claim}</p>

        <p>
          <strong>Source type:</strong> {source.source_type}
        </p>

        <p>
          <strong>Status:</strong> {source.status}
        </p>
      </div>
    ))}
    <h4>Limitations</h4>
    <ul>
      {verification.limitations.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  </div>
)}

      </>
    )}
    
{riskAssessment && (
  <div className="verification-panel risk-panel">
    <h3>{riskAssessment.agent}</h3>

    <p>
      <strong>Overall status:</strong>{" "}
      {riskAssessment.overall_status}
    </p>

    <h4>Assessment Findings</h4>

    {riskAssessment.findings.map((finding, index) => (
      <div
  className={`agent finding-card finding-${finding.label
    .toLowerCase()
    .replace(/\s+/g, "-")}`}
  key={`${finding.label}-${index}`}
>
        <p>
          <strong>Classification:</strong> {finding.label}
        </p>
        <p>
          <strong>{finding.claim}</strong>
        </p>
        <p>{finding.details}</p>
      </div>
    ))}

    <h4>Evidence Sources (General References)</h4>

    <ul>
      {riskAssessment.evidence_sources.map((source) => (
        <li key={source.url}>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {source.title}
          </a>
          <p>
            <strong>Status:</strong> {source.status}
          </p>
          <p>
            <strong>Scope:</strong> {source.scope}
          </p>
          <p>
            <strong>Route-specific:</strong>{" "}
            {source.route_specific ? "Yes" : "No"}
          </p>
        </li>
      ))}
    </ul>

    <h4>Limitations</h4>

    <ul>
      {riskAssessment.limitations.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  </div>
)}

  </div>
)}

      </section>
      
      <section className="panel">
        <h2>Claim Checker</h2>
        <p>
          Enter a claim to identify what evidence is needed
          before it can be verified.
        </p>

        <textarea
          value={claimText}
          onChange={(event) => setClaimText(event.target.value)}
          placeholder="Example: There are no safety incidents on this route right now."
          rows={4}
          maxLength={1000}
        />

        <p>{claimText.length}/1000 characters</p>

        <button
          className="primary"
          type="button"
          onClick={classifyClaim}
          disabled={classifyingClaim || claimText.trim().length < 5}
        >
          {classifyingClaim ? "Checking Claim..." : "Classify Claim"}
        </button>

        {claimResult && (
          <div className="verification-panel">
            <h3>{claimResult.agent}</h3>

            <p>
              <strong>Submitted claim:</strong> {claimResult.claim}
            </p>

            
            <p>
              <strong>Claim Type:</strong>{" "}
              {claimResult.claim_type ?? "Not categorized"}
            </p>

            
<p>
  <strong>Evidence Classification:</strong>{" "}
  <span
    className={`classification-badge ${
      claimResult.classification === "Assumption"
        ? "assumption"
        : claimResult.classification === "Inference"
          ? "inference"
          : claimResult.classification === "Untested Hypothesis"
            ? "untested-hypothesis"
            : claimResult.classification === "Verified Evidence"
              ? "verified-evidence"
              : "unverified"
    }`}
  >
    {claimResult.classification}
  </span>
</p>



            <p>
              <strong>Verification status:</strong>{" "}
              {claimResult.verification_status}
            </p>

            <h4>Reason</h4>
            <p>{claimResult.reason}</p>

            <h4>Evidence Needed</h4>
            <ul>
              {claimResult.evidence_needed.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
              

            <h4>Official Sources Checked</h4>

            {claimResult.official_sources?.length ? (
              claimResult.official_sources.map((source) => (
                <div key={source.url} className="finding-card">
                  <h4>{source.title}</h4>

                  <p>
                    <strong>Source type:</strong>{" "}
                    {source.source_type}
                  </p>

                  <p>
                    <strong>Scope:</strong> {source.scope}
                  </p>

                  <p>
                    <strong>Fetch status:</strong>{" "}
                    {source.fetch_status ?? "not_checked"}
                  </p>

                  <p>
                    <strong>Text match status:</strong>{" "}
                    {source.text_match_status === "possible_text_match"
                      ? "Possible keyword match — manual review needed"
                      : source.text_match_status ===
                          "no_matching_terms_found"
                        ? "No matching keywords found"
                        : source.text_match_status ?? "Not assessed"}
                  </p>

                  <p>
                    <strong>Matching terms:</strong>{" "}
                    {source.matching_terms?.length
                      ? source.matching_terms.join(", ")
                      : "No matching terms recorded"}
                  </p>

                  {source.fetch_reason && (
                    <p>
                      <strong>Fetch details:</strong>{" "}
                      {source.fetch_reason}
                    </p>
                  )}

                  {source.content_preview && (
                    <details>
                      <summary>View fetched text preview</summary>
                      <p>{source.content_preview}</p>
                    </details>
                  )}

                  <p>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open official source
                    </a>
                  </p>

                  <p>
                    <small>
                      A source being available or sharing keywords with a
                      claim does not prove the claim. Check the original
                      context, publication date, scope, and supporting evidence.
                    </small>
                  </p>
                </div>
              ))
            ) : (
              <p>
                No matching official source was found in the registry.
                This does not mean that no relevant evidence exists elsewhere.
              </p>
            )}

            <div className="finding-card">
              <h4>Evidence review status</h4>
              <p>
                <strong>Claim verification:</strong>{" "}
                {claimResult.verification_status}
              </p>
              <p>
                The Claim Classification Agent categorizes the wording
                and performs limited source checks. It does not independently
                establish whether the submitted claim is true.
              </p>
            </div>


            <h4>Limitations</h4>
            <ul>
              {claimResult.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="panel">
        
{/* AI Safety Agents */}

<div className="agent">
  <div className="agent-icon">R</div>
  <div>
    <strong>Route Agent</strong>
    <p>
      Retrieves route options, estimated distance, and travel time
      from the routing service. Route estimates do not guarantee
      that a road is safe.
    </p>
  </div>
</div>

<div className="agent">
  <div className="agent-icon">V</div>
  <div>
    <strong>Verification Agent</strong>
    <p>
      Organizes available reference sources and communicates
      evidence gaps and uncertainty. Official reference links do
      not independently verify live or route-specific safety.
    </p>
  </div>
</div>

<div className="agent">
  <div className="agent-icon">A</div>
  <div>
    <strong>Risk Assessment Agent</strong>
    <p>
      Classifies available findings as verified evidence, inference,
      or unknown. Live incident feeds and verified route-specific
      incident data are not currently available.
    </p>
  </div>
</div>

<div className="agent">
  <div className="agent-icon">C</div>
  <div>
    <strong>Claim Checker</strong>
    <p>
      Classifies submitted claims and displays relevant reference
      sources, matching terms, and evidence limitations. Its
      classifications are preliminary and require human review.
    </p>
  </div>
</div>

<div className="agent">
  <div className="agent-icon">S</div>
  <div>
    <strong>SOS Assistant</strong>
    <p>
      Supports a user-confirmed emergency demo workflow with
      trusted-contact details and available trip context. The
      prototype does not send SMS messages or police alerts.
    </p>
  </div>
</div>

      </section>

      <EmergencyPanel trip={activeTrip} />

      <footer>SHEGUARD AI · Safety through responsible AI</footer>
    </main>
  );
}
