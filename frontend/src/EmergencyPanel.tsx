import { useEffect, useRef, useState } from "react";
import "./EmergencyPanel.css";

export type EmergencyTrip = {
  start: string;
  destination: string;
  distanceKm: number;
  estimatedMinutes: number;
  routeId: number;
};

type TrustedContact = {
  id: string;
  name: string;
  phone: string;
};

type EmergencyPanelProps = {
  trip: EmergencyTrip | null;
};

type LocationData = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

const STORAGE_KEY = "sheguard_trusted_contacts";
const BACKEND_URL = "http://127.0.0.1:8000";
export default function EmergencyPanel({
  trip,
}: EmergencyPanelProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);

  const [contacts, setContacts] = useState<TrustedContact[]>([]);

  const [countdown, setCountdown] = useState<number | null>(null);
  const [sosActive, setSosActive] = useState(false);

  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [trackingUrl, setTrackingUrl] = useState<string | null>(null);

  const [location, setLocation] =
    useState<LocationData | null>(null);

  const [locationLoading, setLocationLoading] =
    useState(false);

  const [error, setError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);

  // Version 2: Camera recording
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  // Version 2: Automatic video sharing
  const [sharingConsent, setSharingConsent] = useState(false);

  const [, setIsUploadingVideo] = useState(false);
  const [, setVideoShareStatus] = useState("");
  const [sosSmsStatus, setSosSmsStatus] = useState("");
  const [sosVideoStatus, setSosVideoStatus] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

    const videoRef =
    useRef<HTMLVideoElement | null>(null);

    const cameraStreamRef =
    useRef<MediaStream | null>(null);
    // Stores browser GPS watch ID so we can stop tracking later.
    const watchIdRef = useRef<number | null>(null);

  // Keeps the latest tracking URL immediately available
  // even before React state finishes updating.
  const trackingUrlRef = useRef<string | null>(null);

  // Prevents duplicate SOS activation.
  const activatingRef = useRef(false);
  const [recordedVideoBlob, setRecordedVideoBlob] =
  useState<Blob | null>(null);

  // Load saved trusted contacts.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);

      if (saved) {
        const parsed = JSON.parse(saved);

        if (Array.isArray(parsed)) {
          setContacts(parsed);
        }
      }
    } catch {
      console.error("Could not load trusted contacts.");
    }
  }, []);
  useEffect(() => {
  if (cameraOpen && videoRef.current) {
    videoRef.current.srcObject =
      cameraStreamRef.current;
  }
}, [cameraOpen]);
  // Save contacts.
  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(contacts)
    );
  }, [contacts]);

  // Stop GPS watcher when component unmounts.
  useEffect(() => {
  return () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(
        watchIdRef.current
      );
    }

    if (cameraStreamRef.current) {
      cameraStreamRef.current
        .getTracks()
        .forEach((track) => track.stop());

      cameraStreamRef.current = null;
    }
  };
}, []);

  // 5-second countdown.
  useEffect(() => {
    if (countdown === null) {
      return;
    }

    if (countdown === 0) {
      activateSOS();
      return;
    }

    const timer = window.setTimeout(() => {
      setCountdown((current) =>
        current === null ? null : current - 1
      );
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [countdown]);

  function cleanPhoneNumber(value: string) {
    let cleaned = value.replace(/[\s()-]/g, "");

    if (cleaned.startsWith("+91")) {
      cleaned = cleaned.substring(3);
    }

    if (
      cleaned.startsWith("91") &&
      cleaned.length === 12
    ) {
      cleaned = cleaned.substring(2);
    }

    return cleaned;
  }

  function saveContact(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");

    const cleanName = name.trim();
    const cleanPhone = cleanPhoneNumber(phone);

    if (!cleanName) {
      setError(
        "Please enter your trusted contact's name."
      );
      return;
    }

    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      setError(
        "Enter a valid Indian 10-digit mobile number."
      );
      return;
    }

    if (!consent) {
      setError(
        "Please confirm consent before saving this contact."
      );
      return;
    }

    if (contacts.length >= 10) {
      setError(
        "You can save up to 10 trusted contacts."
      );
      return;
    }

    const alreadyExists = contacts.some(
      (contact) => contact.phone === cleanPhone
    );

    if (alreadyExists) {
      setError(
        "This phone number is already saved."
      );
      return;
    }

    const newContact: TrustedContact = {
      id: crypto.randomUUID(),
      name: cleanName,
      phone: cleanPhone,
    };

    setContacts((current) => [
      ...current,
      newContact,
    ]);

    setName("");
    setPhone("");
    setConsent(false);
  }

  function removeContact(id: string) {
    setContacts((current) =>
      current.filter(
        (contact) => contact.id !== id
      )
    );
  }

  function getCurrentLocation(): Promise<LocationData> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(
          new Error(
            "Location services are not supported by this browser."
          )
        );
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        () => {
          reject(
            new Error(
              "Unable to get your current location. Please allow location permission."
            )
          );
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    });
  }

  // Start continuous GPS tracking.
  function startLocationTracking(id: string) {
    if (!navigator.geolocation) {
      setError(
        "Your browser does not support live location."
      );
      return;
    }

    // Clear previous watcher if one exists.
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(
        watchIdRef.current
      );
    }

    const watchId =
      navigator.geolocation.watchPosition(
        async (position) => {
          const updatedLocation: LocationData = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          };

          setLocation(updatedLocation);

          try {
            await fetch(
              `${BACKEND_URL}/api/live-tracking/${id}/update`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(
                  updatedLocation
                ),
              }
            );
          } catch {
            console.error(
              "Live location update failed."
            );
          }
        },
        () => {
          setError(
            "Live location permission was denied."
          );
        },
        {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout: 10000,
        }
      );

    watchIdRef.current = watchId;
  }

async function activateSOS() {
  if (activatingRef.current) {
    return;
  }

  activatingRef.current = true;

  setCountdown(null);
  setError("");
  setLocationLoading(true);

  try {
    // 1. Get current GPS location
    const currentLocation =
      await getCurrentLocation();

    setLocation(currentLocation);

    // 2. Start backend tracking session
    const response = await fetch(
      `${BACKEND_URL}/api/live-tracking/start`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `Could not start live tracking. Server returned ${response.status}.`
      );
    }

    const data = await response.json();

    if (
      !data.tracking_id ||
      !data.tracking_url
    ) {
      throw new Error(
        "Backend started incorrectly: tracking ID or tracking URL is missing."
      );
    }

    console.log(
      "Tracking ID:",
      data.tracking_id
    );

    console.log(
      "Tracking URL:",
      data.tracking_url
    );

    // 3. Save tracking information
    setTrackingId(data.tracking_id);
    setTrackingUrl(data.tracking_url);

    trackingUrlRef.current =
      data.tracking_url;

    // 4. Send first location immediately
    const updateResponse =
      await fetch(
        `${BACKEND_URL}/api/live-tracking/${data.tracking_id}/update`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            latitude:
              currentLocation.latitude,
            longitude:
              currentLocation.longitude,
            accuracy:
              currentLocation.accuracy,
          }),
        }
      );

    if (!updateResponse.ok) {
      throw new Error(
        "Tracking started, but initial location could not be sent."
      );
    }

    // 5. Start continuous GPS updates
    startLocationTracking(
      data.tracking_id
    );

        // 6. Activate SOS
    setSosActive(true);

    // 7. Open camera preview
    // Camera failure will NOT stop the SOS workflow.
    await startCamera();

    // 8. Automatically send SMS
   // 8. Send SMS separately.
// SMS failure must NOT deactivate SOS or stop live tracking.
try {
  const smsResult = await sendSOSAlerts(
    currentLocation,
    data.tracking_url
  );

  console.log("SOS SMS result:", smsResult);
  if (data.success) {
  setSosSmsStatus(
    `✓ SOS SMS sent to ${data.sent_count} trusted contact(s).`
  );
} else {
  setSosSmsStatus(
    "⚠ SOS SMS could not be sent to trusted contacts."
  );
}
  setError("");
} catch (smsError) {
  console.error("SOS SMS sending failed:", smsError);

  setError(
    smsError instanceof Error
      ? `SOS is active, but SMS could not be sent: ${smsError.message}`
      : "SOS is active, but SMS could not be sent."
  );
}

  } catch (activationError) {

    console.error(
      "SOS activation error:",
      activationError
    );

    setSosActive(false);

    trackingUrlRef.current = null;

    setTrackingId(null);
    setTrackingUrl(null);

    stopLocationWatcher();

    setError(
      activationError instanceof Error
        ? activationError.message
        : "Could not activate SOS."
    );

  } finally {
    activatingRef.current = false;
    setLocationLoading(false);
  }
}
  async function stopBackendTracking() {
    if (!trackingId) {
      return;
    }

    try {
      await fetch(
        `${BACKEND_URL}/api/live-tracking/${trackingId}/stop`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    } catch {
      console.error(
        "Could not stop backend tracking."
      );
    }
  }

  function stopLocationWatcher() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(
        watchIdRef.current
      );

      watchIdRef.current = null;
    }
  }
async function cancelSOS() {
  setCountdown(null);

  let finalVideoBlob: Blob | null = null;

  try {
    // 1. Recording ko properly stop karke final Blob wait karo
    finalVideoBlob = await stopRecording();

    // 2. Camera tracks immediately stop karo
    if (cameraStreamRef.current) {
      cameraStreamRef.current
        .getTracks()
        .forEach((track) => track.stop());

      cameraStreamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraOpen(false);

    // 3. GPS tracking immediately stop karo
    stopLocationWatcher();

    // 4. Backend live tracking immediately stop karo
    await stopBackendTracking();

    // 5. SOS UI immediately close karo
    setSosActive(false);
    setLocation(null);
    setTrackingId(null);
    setTrackingUrl(null);
    trackingUrlRef.current = null;
    setError("");

    // ------------------------------------------------
    // 6. Video upload/share background me handle karo
    // ------------------------------------------------

    if (finalVideoBlob && finalVideoBlob.size > 0) {
      setIsUploadingVideo(true);
      setVideoShareStatus("Uploading SOS video...");
      setSosVideoStatus("⏳ Uploading SOS video...");
      try {
        const formData = new FormData();

        // Explicit WebM MIME type
        const uploadBlob = new Blob(
          [finalVideoBlob],
          { type: "video/webm" }
        );

        formData.append(
          "video",
          uploadBlob,
          "sos-video.webm"
        );

        const uploadResponse = await fetch(
          `${BACKEND_URL}/api/upload-sos-video`,
          {
            method: "POST",
            body: formData,
          }
        );

        if (!uploadResponse.ok) {
          let errorMessage = "SOS video upload failed.";

          try {
            const errorData =
              await uploadResponse.json();

            console.error(
              "SOS video upload backend error:",
              errorData
            );

            errorMessage =
              errorData.detail ||
              errorMessage;
          } catch {
            // Backend response JSON nahi tha
          }

          throw new Error(errorMessage);
        }

        const uploadData =
          await uploadResponse.json();

        console.log(
          "SOS video upload response:",
          uploadData
        );
        if (uploadData.success) {
          setSosVideoStatus(
            "✓ SOS video uploaded securely."
          );
        }
        // 7. Agar sharing consent ON hai,
        //    trusted contacts ko video link bhejo
        if (
          sharingConsent &&
          uploadData.success &&
          uploadData.signed_url
        ) {
          setVideoShareStatus(
            "Video uploaded. Sharing with trusted contacts..."
          );

          const shareResponse = await fetch(
            `${BACKEND_URL}/api/share-sos-video`,
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({
                signed_url: uploadData.signed_url,
                contacts: contacts,
                consent_given: sharingConsent,
              }),
            }
          );

          if (!shareResponse.ok) {
            throw new Error(
              "Video sharing request failed."
            );
          }

          const shareData =
            await shareResponse.json();

          console.log(
            "SOS video share response:",
            shareData
          );

          if (shareData.success) {
            setVideoShareStatus(
              `Video link sent to ${shareData.sent_count} trusted contact(s).`
            );
            setSosVideoStatus(
              `✓ Video link sent to ${shareData.sent_count} trusted contact(s).`
            );
          } else {
            setVideoShareStatus(
              "Video uploaded, but the sharing SMS could not be sent."
            );
          }
        } else {
          setVideoShareStatus(
            "SOS video uploaded successfully. It was not shared because sharing consent was not enabled."
          );
        }
      } catch (videoError) {
        console.error(
          "SOS video processing error:",
          videoError
        );

        setVideoShareStatus(
          "SOS ended, but video upload/sharing failed."
        );
      } finally {
        setIsUploadingVideo(false);
      }
    } else {
      setVideoShareStatus("");
    }
  } catch (error) {
    console.error(
      "Error while stopping SOS:",
      error
    );

    // SOS ko kisi bhi condition me close karo
    stopLocationWatcher();

    try {
      await stopBackendTracking();
    } catch (trackingError) {
      console.error(
        "Backend tracking stop error:",
        trackingError
      );
    }

    setSosActive(false);
    setLocation(null);
    setTrackingId(null);
    setTrackingUrl(null);
    trackingUrlRef.current = null;
    setError("");
  }
}
function startRecording(stream: MediaStream) {
  try {
    if (!("MediaRecorder" in window)) {
      setError(
        "Video recording is not supported by this browser. SOS will continue."
      );
      return;
    }

    recordedChunksRef.current = [];

    let mimeType = "";

    const supportedTypes = [
  "video/webm;codecs=vp8",
  "video/webm",
];

    for (const type of supportedTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        break;
      }
    }

    if (!mimeType) {
      setError(
        "Video recording format is not supported by this browser. SOS will continue."
      );
      return;
    }

    console.log("Recording MIME type:", mimeType);
    console.log("Camera stream:", stream);
    console.log("Video tracks:", stream.getVideoTracks());

    const recorder = new MediaRecorder(stream, {
      mimeType,
    });

    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      console.log(
        "Recording data received:",
        event.data.size,
        "bytes"
      );

      if (event.data && event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      console.log(
        "Recorder stopped. Total chunks:",
        recordedChunksRef.current.length
      );

      if (recordingTimerRef.current !== null) {
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      const videoBlob = new Blob(
        recordedChunksRef.current,
        {
          type: recorder.mimeType || "video/webm",
        }
      );

      console.log(
        "Final video blob:",
        videoBlob.size,
        "bytes",
        videoBlob.type
      );

      setRecordedVideoBlob(videoBlob);

      if (videoBlob.size > 0) {
        const videoUrl = URL.createObjectURL(videoBlob);

        setRecordedVideoUrl((previousUrl) => {
          if (previousUrl) {
            URL.revokeObjectURL(previousUrl);
          }

          return videoUrl;
        });
      }

      setIsRecording(false);
      setRecordingTime(0);
      mediaRecorderRef.current = null;
    };

    recorder.onerror = (event) => {
      console.error("MediaRecorder error:", event);

      if (recordingTimerRef.current !== null) {
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      setIsRecording(false);

      setError(
        "Video recording failed. SOS will continue."
      );
    };

    recorder.start(1000);

    console.log("MediaRecorder started:", recorder.state);

    setRecordingTime(0);

    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
    }

    recordingTimerRef.current = window.setInterval(() => {
      setRecordingTime((previous) => previous + 1);
    }, 1000);

    setIsRecording(true);
  } catch (recordingError) {
    console.error(
      "Recording start error:",
      recordingError
    );

    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    setIsRecording(false);

    setError(
      "Could not start video recording. SOS will continue."
    );
  }
}

function stopRecording(): Promise<Blob | null> {
  return new Promise((resolve) => {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state === "inactive") {
      setIsRecording(false);
      resolve(recordedVideoBlob);
      return;
    }

    const handleStop = () => {
      if (recordingTimerRef.current !== null) {
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      const videoBlob = new Blob(
        recordedChunksRef.current,
        {
          type: recorder.mimeType || "video/webm",
        }
      );

      setRecordedVideoBlob(videoBlob);

      if (videoBlob.size > 0) {
        const videoUrl = URL.createObjectURL(videoBlob);

        setRecordedVideoUrl((previousUrl) => {
          if (previousUrl) {
            URL.revokeObjectURL(previousUrl);
          }

          return videoUrl;
        });

        resolve(videoBlob);
      } else {
        resolve(null);
      }

      setIsRecording(false);
      setRecordingTime(0);
      mediaRecorderRef.current = null;

      recorder.removeEventListener(
        "stop",
        handleStop
      );
    };

    recorder.addEventListener(
      "stop",
      handleStop,
      { once: true }
    );

    recorder.stop();
  });
}
function deleteRecording() {
  if (recordedVideoUrl) {
    URL.revokeObjectURL(recordedVideoUrl);
  }

  setRecordedVideoUrl(null);
  setRecordedVideoBlob(null);
  recordedChunksRef.current = [];
  setRecordingTime(0);
}
async function startCamera() {
  try {
    if (
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      throw new Error("Camera is not supported.");
    }

    const stream =
      await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

    cameraStreamRef.current = stream;

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }

    setCameraOpen(true);

    // Start recording only with explicit consent.
    if (recordingConsent) {
      startRecording(stream);
    }

  } catch (cameraError) {
    console.error("Camera access error:", cameraError);

    setCameraOpen(false);

    setError(
      "Camera access was unavailable. SOS will continue without camera."
    );
  }
}

async function stopCamera() {
  await stopRecording();

  if (cameraStreamRef.current) {
    cameraStreamRef.current
      .getTracks()
      .forEach((track) => track.stop());

    cameraStreamRef.current = null;
  }

  if (videoRef.current) {
    videoRef.current.srcObject = null;
  }

  setCameraOpen(false);
}
  function prepareSOS() {
    setError("");

    if (contacts.length === 0) {
      setError(
        "Please add at least one trusted contact before activating SOS."
      );
      return;
    }

    if (!consent) {
      setError(
        "Please confirm consent before activating SOS."
      );
      return;
    }

    setCountdown(5);
  }
  async function sendSOSAlerts(
  currentLocation: LocationData,
  currentTrackingUrl: string
) {
  if (contacts.length === 0) {
    throw new Error(
      "No trusted contacts are available."
    );
  }

  const response = await fetch(
    `${BACKEND_URL}/api/send-sos`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contacts,
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        tracking_url: currentTrackingUrl,
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.detail?.message ||
        data?.detail ||
        "Could not send SOS alerts."
    );
  }

  return data;
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
            Save trusted contacts and activate an
            emergency location-sharing workflow.
          </p>
        </div>

        <div className="emergency-status">
          <span className="status-dot" />

          {sosActive
            ? "SOS ACTIVE"
            : "READY"}
        </div>
      </div>

      {/* TRUSTED CONTACT FORM */}

      <form
        className="contact-form"
        onSubmit={saveContact}
      >
        <h3>
          Trusted Contacts ({contacts.length}/10)
        </h3>

        <label htmlFor="trusted-name">
          Contact name
        </label>

        <input
          id="trusted-name"
          type="text"
          placeholder="e.g. Mom"
          value={name}
          onChange={(event) =>
            setName(event.target.value)
          }
          autoComplete="name"
          disabled={contacts.length >= 10}
        />

        <label htmlFor="trusted-phone">
          Mobile number
        </label>

        <input
          id="trusted-phone"
          type="tel"
          placeholder="e.g. 9876543210"
          value={phone}
          onChange={(event) =>
            setPhone(event.target.value)
          }
          autoComplete="tel"
          disabled={contacts.length >= 10}
        />

        <label className="consent-row">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) =>
              setConsent(event.target.checked)
            }
          />

          <span>
            I consent to using these trusted-contact
            details for the SHEGUARD AI emergency
            workflow.
          </span>
        </label>
        {/* Recording Consent */}
            <label className="consent-row">
              <input
                type="checkbox"
                checked={recordingConsent}
                onChange={(event) =>
                  setRecordingConsent(event.target.checked)
                }
              />

              <span>
                I explicitly consent to video recording during SOS.
                Recording will remain local until I choose to share it.
              </span>
            </label>
        <button
          className="save-contact-button"
          type="submit"
          disabled={contacts.length >= 10}
        >
          {contacts.length >= 10
            ? "10 Contacts Saved"
            : "Add Trusted Contact"}
        </button>
      </form>
    {/* Automatic Video Sharing Consent */}

    <label className="consent-row">
      <input
        type="checkbox"
        checked={sharingConsent}
        onChange={(event) =>
          setSharingConsent(event.target.checked)
        }
      />

      <span>
        I explicitly consent to automatically sharing
        my SOS video with my selected trusted contacts
        when I stop SOS.
      </span>
    </label>
      {/* TRUSTED CONTACT LIST */}

      {contacts.length > 0 && (
        <div className="trusted-contacts-list">
          {contacts.map(
            (contact, index) => (
              <div
                className="trusted-contact-card"
                key={contact.id}
              >
                <span className="contact-avatar">
                  {contact.name
                    .charAt(0)
                    .toUpperCase()}
                </span>

                <div className="contact-details">
                  <span className="contact-label">
                    TRUSTED CONTACT #{index + 1}
                  </span>

                  <strong>
                    {contact.name}
                  </strong>

                  <span>
                    +91 {contact.phone}
                  </span>

                  <span className="contact-saved">
                    Ready for SOS alert
                  </span>
                </div>

                <button
                  className="edit-contact-button"
                  type="button"
                  onClick={() =>
                    removeContact(
                      contact.id
                    )
                  }
                >
                  Remove
                </button>
              </div>
            )
          )}
        </div>
      )}

      {error && (
        <p
          className="emergency-error"
          role="alert"
        >
          {error}
        </p>
      )}

      {/* JOURNEY CONTEXT */}

      <div className="emergency-trip-summary">
        <div className="trip-summary-heading">
          <span className="contact-label">
            JOURNEY CONTEXT
          </span>

          <span className="trip-live-badge">
            {trip
              ? "TRIP READY"
              : "NO ACTIVE TRIP"}
          </span>
        </div>

        {trip ? (
          <>
            <div className="trip-location">
              <span className="trip-location-dot start-dot" />

              <div>
                <small>
                  STARTING POINT
                </small>

                <strong>
                  {trip.start}
                </strong>
              </div>
            </div>

            <div className="trip-location">
              <span className="trip-location-dot destination-dot" />

              <div>
                <small>
                  DESTINATION
                </small>

                <strong>
                  {trip.destination}
                </strong>
              </div>
            </div>

            <div className="trip-metrics">
              <div>
                <strong>
                  {trip.distanceKm.toFixed(1)} km
                </strong>

                <small>
                  Distance
                </small>
              </div>

              <div>
                <strong>
                  {trip.estimatedMinutes} min
                </strong>

                <small>
                  Estimated time
                </small>
              </div>

              <div>
                <strong>
                  Route {trip.routeId}
                </strong>

                <small>
                  Selected route
                </small>
              </div>
            </div>
          </>
        ) : (
          <p>
            No calculated trip is available.
            Prepare a trip first.
          </p>
        )}
      </div>

      {/* SOS BUTTON */}

      <div className="sos-action-area">
        <div className="sos-explainer">
          <strong>
            Need emergency assistance?
          </strong>

          <p>
            SOS automatically activates after
            a 5-second countdown if you do not
            cancel it.
          </p>
        </div>

        {!sosActive &&
          countdown === null && (
            <button
              id="main-sos-button"
              className="sos-demo-button"
              type="button"
              onClick={prepareSOS}
            >
              <span className="sos-pulse" />
              ACTIVATE SOS
            </button>
          )}

        {countdown !== null && (
          <div className="sos-countdown-area">
            <strong>
              SOS activating in
            </strong>

            <span className="sos-countdown-number">
              {countdown}
            </span>

            <button
              type="button"
              className="cancel-sos-button"
              onClick={() => {
                setCountdown(null);
              }}
            >
              Cancel SOS
            </button>
          </div>
        )}
      </div>
        {/* MINI CAMERA WINDOW */}

{cameraOpen && (
  <div className="sos-camera-window">
    <div className="sos-camera-header">
      <strong>🚨 SOS CAMERA</strong>

      <button
        type="button"
        className="close-camera-button"
        onClick={stopCamera}
        aria-label="Close camera"
      >
        ✕
      </button>
    </div>

    <div className="sos-camera-preview">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
      />
    </div>

    <div className="sos-camera-footer">
  {isRecording ? (
    <span>
      🔴 RECORDING{" "}
      {Math.floor(recordingTime / 60)
        .toString()
        .padStart(2, "0")}
      :
      {(recordingTime % 60)
        .toString()
        .padStart(2, "0")}
    </span>
  ) : (
    <span>📷 Live camera preview</span>
  )}
</div>
    {isRecording && (
      <button
        type="button"
        className="stop-recording-button"
        onClick={stopRecording}
      >
        ⏹ Stop Recording
      </button>
    )}
  </div>
)}

{/* RECORDED VIDEO PREVIEW */}

{recordedVideoUrl && (
  <div className="recorded-video-card">
    <h3>📹 SOS Video Recording</h3>

    <p>
      Your recording is ready. You can preview
      or download it to your device.
    </p>

    <video
      src={recordedVideoUrl}
      controls
      playsInline
      className="recorded-video-preview"
    />

    <a
      href={recordedVideoUrl}
      download="sheguard-sos-recording.webm"
      className="download-recording-button"
    >
      ⬇ Download Recording
    </a>
        <button
      type="button"
      className="delete-recording-button"
      onClick={deleteRecording}
    >
      🗑 Delete Recording
    </button>   
  </div>
)}

      {/* ACTIVE SOS */}

      {sosActive && (
        <div className="demo-alert-card">
          <span className="demo-alert-icon">
            !
          </span>

          <div>
            <h3>SOS ACTIVE</h3>

            {locationLoading ? (
              <p>
                Getting your current location...
              </p>
            ) : location ? (
              <>
                <p>
                  Your current location has been
                  captured successfully.
                </p>

                <p>
                  Accuracy:{" "}
                  <strong>
                    {Math.round(
                      location.accuracy
                    )}{" "}
                    m
                  </strong>
                </p>
              </>
            ) : (
              <p>
                SOS is active, but your location
                could not be obtained.
              </p>
            )}

            {/* LIVE TRACKING LINK */}

            {trackingUrl && (
              <div className="sos-trip-context">
                <strong>
                  📍 Live location tracking is active
                </strong>

                <p>
                  Share this tracking link with
                  your trusted contacts:
                </p>

                <a
                  href={trackingUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open SHEGUARD Live Tracking
                </a>

                <button
                  type="button"
                  className="confirm-sos-button"
                  onClick={() =>
                    navigator.clipboard.writeText(
                      trackingUrl
                    )
                  }
                >
                  Copy Tracking Link
                </button>
              </div>
            )}

            <div className="sos-trip-context">
  <strong>
    Emergency message
  </strong>

  <p>
    Your trusted contacts have been
    notified automatically by SMS with
    your current location and live
    tracking link.
  </p>
</div>

{/* SOS SECURITY STATUS */}

{(sosSmsStatus || sosVideoStatus) && (
  <div className="sos-status-card">
    <div className="sos-status-header">
      <span className="sos-status-icon">
        🛡️
      </span>

      <div>
        <strong>SOS Security Status</strong>
        <p>
          Emergency actions and video protection
        </p>
      </div>
    </div>

    <div className="sos-status-list">
      {sosSmsStatus && (
        <div className="sos-status-item">
          <span className="sos-status-check">
            ✓
          </span>

          <span>
            {sosSmsStatus.replace("✓ ", "")}
          </span>
        </div>
      )}

      {sosVideoStatus && (
        <div className="sos-status-item">
          <span className="sos-status-check">
            ✓
          </span>

          <span>
            {sosVideoStatus.replace("✓ ", "")}
          </span>
        </div>
      )}
    </div>
  </div>
)}

<div className="sos-confirm-actions">
  <div className="sms-sent-status">
    📱 SMS alerts sent to your trusted contacts.
  </div>

  <button
    type="button"
    className="cancel-sos-button"
    onClick={cancelSOS}
  >
    Stop SOS
  </button>
</div>
          </div>
        </div>
      )}

      {/* EMERGENCY FOOTER */}

      <div className="emergency-footer">
        <div>
          <strong>
            Real emergency in India?
          </strong>

          <p>
            Use the official emergency service
            if you need urgent help.
          </p>
        </div>

        <a
          className="call-emergency-button"
          href="tel:112"
        >
          Call 112
        </a>
      </div>

      <p className="emergency-disclaimer">
  SHEGUARD AI is not an emergency service.
  Location access requires browser permission.
  SOS alerts are sent to saved trusted contacts
  through SMS using the configured TextBee gateway.
</p>
    </section>
  );
}