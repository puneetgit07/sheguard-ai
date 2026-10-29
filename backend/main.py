import uuid
import asyncio
import os
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import re
from html import unescape
from urllib.parse import urlparse
# Reference sources for SHEGUARD AI.
# These are general emergency resources, not live route-safety evidence.


async def fetch_official_source(source_url: str) -> dict[str, Any]:
    allowed_hosts = {
        "www.mha.gov.in",
        "wcd.gov.in",
    }

    parsed_url = urlparse(source_url)

    if (
        parsed_url.scheme != "https"
        or parsed_url.hostname not in allowed_hosts
        or parsed_url.username is not None
        or parsed_url.password is not None
    ):
        return {
            "success": False,
            "status": "blocked_url",
            "text": None,
            "reason": "URL is not on the approved official-source list.",
        }

    try:
        async with httpx.AsyncClient(
            timeout=8.0,
            follow_redirects=False,
        ) as client:
            response = await client.get(
                source_url,
                headers={
                    "User-Agent": "SHEGUARD-AI-Prototype/1.0"
                },
            )

        if response.status_code != 200:
            return {
                "success": False,
                "status": "http_error",
                "text": None,
                "reason": f"Official website returned HTTP {response.status_code}.",
            }

        content_type = response.headers.get("content-type", "").lower()

        if "text/html" not in content_type:
            return {
                "success": False,
                "status": "unsupported_content",
                "text": None,
                "reason": "Response was not an HTML page.",
            }

        html = response.text

        html = re.sub(
            r"<(script|style|noscript)\b[^>]*>.*?</\1>",
            " ",
            html,
            flags=re.IGNORECASE | re.DOTALL,
        )

        html = re.sub(r"<[^>]+>", " ", html)
        html = unescape(html)
        text_content = re.sub(r"\s+", " ", html).strip()

        return {
            "success": True,
            "status": "content_fetched",
            "text": text_content[:12000],
            "reason": "Content retrieved; the claim has not been verified.",
        }

    except httpx.HTTPError as exc:
        return {
            "success": False,
            "status": "fetch_failed",
            "text": None,
            "reason": f"Could not retrieve source: {type(exc).__name__}.",
        }

OFFICIAL_REFERENCE_SOURCES = [
    {
        "title": "Emergency Response Support System (112)",
        "url": "https://www.mha.gov.in/nirbhayaerss-section",
        "source_type": "official_government",
        "topics": [
            "112",
            "emergency",
            "police",
            "sos",
            "emergency response",
        ],
        "scope": "General emergency response services in India",
        "status": "official_reference",
        "route_specific": False,
    },
    {
        "title": "Women Helpline (181)",
        "url": "https://wcd.gov.in/women/help",
        "source_type": "official_government",
        "topics": [
            "181",
            "women helpline",
            "women support",
            "referrals",
            "women assistance",
        ],
        "scope": "Women helpline support and referral services",
        "status": "official_reference",
        "route_specific": False,
    },
]


app = FastAPI(title="SHEGUARD AI - Route API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5175",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5175",
        "https://sheguard-ai-1.onrender.com",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
HEADERS = {
    "User-Agent": "SHEGUARD-AI-Prototype/1.0"
}


class RouteRequest(BaseModel):
    start_location: str | None = None
    start_lat: float | None = Field(default=None, ge=-90, le=90)
    start_lon: float | None = Field(default=None, ge=-180, le=180)

    destination: str = Field(min_length=2, max_length=200)
    dest_lat: float | None = Field(default=None, ge=-90, le=90)
    dest_lon: float | None = Field(default=None, ge=-180, le=180)

class LiveLocationRequest(BaseModel):
    latitude: float
    longitude: float
    accuracy: float | None = None


class TrackingSession(BaseModel):
    tracking_id: str
    latitude: float
    longitude: float
    accuracy: float | None = None
    updated_at: str
    active: bool = True
live_tracking_sessions: dict[str, TrackingSession] = {}

async def geocode(
    client: httpx.AsyncClient,
    address: str,
) -> dict[str, Any]:

    address = address.strip()

    if not address:
        raise HTTPException(
            status_code=400,
            detail="Location cannot be empty.",
        )

    for attempt in range(3):
        try:
            response = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": address,
                    "format": "jsonv2",
                    "limit": 1,
                    "countrycodes": "in",
                },
                headers={
                    "User-Agent": (
                        "SHEGUARD-AI/1.0 "
                        "(hackathon safety application)"
                    ),
                    "Accept": "application/json",
                },
                timeout=httpx.Timeout(
                    connect=10.0,
                    read=20.0,
                    write=10.0,
                    pool=10.0,
                ),
            )

            print(
                f"Nominatim attempt {attempt + 1}: "
                f"status={response.status_code}, "
                f"address={address}"
            )

            if response.status_code == 429:
                if attempt < 2:
                    await asyncio.sleep(3)
                    continue

                raise HTTPException(
                    status_code=502,
                    detail=(
                        "Location service rate limit reached. "
                        "Please try again in a moment."
                    ),
                )

            if response.status_code in (500, 502, 503, 504):
                if attempt < 2:
                    await asyncio.sleep(2)
                    continue

                raise HTTPException(
                    status_code=502,
                    detail=(
                        "Location service is temporarily unavailable. "
                        "Please try again."
                    ),
                )

            response.raise_for_status()

            results = response.json()

            if not results:
                raise HTTPException(
                    status_code=404,
                    detail=f"Could not find this location: {address}",
                )

            result = results[0]

            return {
                "lat": float(result["lat"]),
                "lon": float(result["lon"]),
                "label": result.get(
                    "display_name",
                    address,
                ),
            }

        except HTTPException:
            raise

        except httpx.TimeoutException as error:
            print(
                f"Nominatim timeout on attempt "
                f"{attempt + 1}: {error}"
            )

            if attempt < 2:
                await asyncio.sleep(2)
                continue

            raise HTTPException(
                status_code=502,
                detail=(
                    "Location service timed out. "
                    "Please try again."
                ),
            )

        except httpx.HTTPError as error:
            print(
                f"Nominatim HTTP error on attempt "
                f"{attempt + 1}: {error}"
            )

            if attempt < 2:
                await asyncio.sleep(2)
                continue

            raise HTTPException(
                status_code=502,
                detail=(
                    "Location service could not be reached. "
                    "Please try again."
                ),
            )

        except Exception as error:
            print(
                f"Unexpected geocoding error: {error}"
            )

            raise HTTPException(
                status_code=502,
                detail=(
                    "An unexpected location service error "
                    "occurred."
                ),
            )

    raise HTTPException(
        status_code=502,
        detail="Location service is temporarily unavailable.",
    )
async def send_textbee_sms(
    recipients: list[str],
    message: str,
) -> dict[str, Any]:

    api_key = os.getenv("TEXTBEE_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="TextBee API key is not configured.",
        )

    url = "https://api.textbee.dev/api/v1/gateway/send-sms"

    headers = {
        "x-api-key": api_key,
        "Content-Type": "application/json",
    }

    payload = {
        "recipients": recipients,
        "message": message,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                url,
                headers=headers,
                json=payload,
            )

        if response.status_code >= 400:
            print(
                "TextBee error:",
                response.status_code,
                response.text[:1000],
            )

            raise HTTPException(
                status_code=502,
                detail="TextBee could not send the SMS.",
            )

        return response.json()

    except httpx.HTTPError as error:
        print(f"TextBee HTTP error: {error}")

        raise HTTPException(
            status_code=502,
            detail="Could not connect to TextBee.",
        )
@app.post("/api/test-textbee")
async def test_textbee():
    result = await send_textbee_sms(
        recipients=["+917571037033git add backend/main.py"],
        message=(
            "SHEGUARD AI test alert 🚨\n"
            "TextBee integration is working successfully."
        ),
    )

    return {
        "success": True,
        "message": "Test SMS request sent to TextBee.",
        "textbee_response": result,
    }    
def has_pair(lat: float | None, lon: float | None) -> bool:
    return lat is not None and lon is not None


@app.get("/")
def home():
    return {
        "project": "SHEGUARD AI",
        "status": "running",
    }


@app.get("/api/health")
def health():
    return {
        "success": True,
        "message": "SHEGUARD AI backend is connected",
    }


@app.post("/api/route")
async def get_route(request: RouteRequest):
    if (request.start_lat is None) != (request.start_lon is None):
        raise HTTPException(
            status_code=400,
            detail="Provide both start_lat and start_lon for GPS mode.",
        )

    if (request.dest_lat is None) != (request.dest_lon is None):
        raise HTTPException(
            status_code=400,
            detail="Provide both dest_lat and dest_lon, or neither.",
        )

    if not has_pair(request.start_lat, request.start_lon):
        if (
            not request.start_location
            or not request.start_location.strip()
        ):
            raise HTTPException(
                status_code=400,
                detail="Provide GPS coordinates or a starting address.",
            )

    try:
        headers = {
            "User-Agent": (
                "SHEGUARD-AI/1.0 "
                "(hackathon safety application)"
            ),
            "Accept": "application/json",
        }

        async with httpx.AsyncClient(
            headers=headers,
            timeout=httpx.Timeout(20.0),
            follow_redirects=True,
        ) as client:

            # Resolve starting point
            if has_pair(
                request.start_lat,
                request.start_lon,
            ):
                start = {
                    "lat": request.start_lat,
                    "lon": request.start_lon,
                    "label": "GPS current location",
                }
            else:
                start = await geocode(
                    client,
                    request.start_location.strip(),
                )

            # Resolve destination
            if has_pair(
                request.dest_lat,
                request.dest_lon,
            ):
                end = {
                    "lat": request.dest_lat,
                    "lon": request.dest_lon,
                    "label": request.destination,
                }
            else:
                end = await geocode(
                    client,
                    request.destination.strip(),
                )

            # OSRM route request with retry
            route_data = None

            for attempt in range(3):
                try:
                    route_response = await client.get(
                        "https://router.project-osrm.org/"
                        "route/v1/driving/"
                        f"{start['lon']},{start['lat']};"
                        f"{end['lon']},{end['lat']}",
                        params={
                            "overview": "full",
                            "geometries": "geojson",
                            "steps": "false",
                            "alternatives": "2",
                        },
                        headers={
                            "User-Agent": (
                                "SHEGUARD-AI/1.0 "
                                "(hackathon safety application)"
                            ),
                            "Accept": "application/json",
                        },
                        timeout=httpx.Timeout(
                            connect=10.0,
                            read=30.0,
                            write=10.0,
                            pool=10.0,
                        ),
                    )

                    print(
                        f"OSRM attempt {attempt + 1}: "
                        f"status={route_response.status_code}"
                    )

                    if route_response.status_code >= 500:
                        print(
                            "OSRM server error:",
                            route_response.text[:500],
                        )

                        if attempt < 2:
                            await asyncio.sleep(2)
                            continue

                        raise HTTPException(
                            status_code=502,
                            detail=(
                                "The routing service is temporarily "
                                "unavailable. Please try again."
                            ),
                        )

                    route_response.raise_for_status()

                    route_data = route_response.json()

                    print(
                        "OSRM response code:",
                        route_data.get("code"),
                    )

                    break

                except httpx.TimeoutException as error:
                    print(
                        f"OSRM timeout on attempt "
                        f"{attempt + 1}: {error}"
                    )

                    if attempt < 2:
                        await asyncio.sleep(2)
                        continue

                    raise HTTPException(
                        status_code=502,
                        detail=(
                            "The routing service timed out. "
                            "Please try again."
                        ),
                    )

                except httpx.HTTPError as error:
                    print(
                        f"OSRM HTTP error on attempt "
                        f"{attempt + 1}: {error}"
                    )

                    if attempt < 2:
                        await asyncio.sleep(2)
                        continue

                    raise HTTPException(
                        status_code=502,
                        detail=(
                            "The routing service is temporarily "
                            "unavailable. Please try again."
                        ),
                    )

    except HTTPException:
        raise

    except httpx.HTTPError as error:
        print(f"Route HTTP error: {error}")

        raise HTTPException(
            status_code=502,
            detail=(
                "A map service could not be reached. "
                "Please try again."
            ),
        )

    except Exception as error:
        print(f"Unexpected route error: {error}")

        raise HTTPException(
            status_code=500,
            detail="An unexpected route error occurred.",
        )

    if not route_data:
        raise HTTPException(
            status_code=502,
            detail="No response was received from the routing service.",
        )

    if (
        route_data.get("code") != "Ok"
        or not route_data.get("routes")
    ):
        raise HTTPException(
            status_code=404,
            detail="No driving route was found for these locations.",
        )

    routes = []

    for index, route in enumerate(
        route_data["routes"]
    ):
        routes.append(
            {
                "id": index + 1,
                "distance_km": round(
                    route["distance"] / 1000,
                    2,
                ),
                "estimated_minutes": round(
                    route["duration"] / 60
                ),
                "geometry": route["geometry"],
            }
        )

    return {
        "success": True,
        "source": "OpenStreetMap / OSRM",
        "checked_at": datetime.now(
            timezone.utc
        ).isoformat(),
        "start": start,
        "destination": end,
        "routes": routes,
        "safety_status": "unverified",
        "safety_note": (
            "These are road-route estimates, not safety "
            "assessments. Live traffic, incidents and area "
            "safety have not been verified."
        ),
        "attribution": (
            "© OpenStreetMap contributors; routing by OSRM"
        ),
    }
    

@app.post("/api/plan-trip")
def plan_trip_legacy():
    return {
        "success": False,
        "message": "Use POST /api/route with a starting point and destination.",
    }

class RouteVerificationRequest(BaseModel):
    start_location: str = Field(min_length=2, max_length=200)
    destination: str = Field(min_length=2, max_length=200)

class ClaimClassificationRequest(BaseModel):
    claim: str = Field(min_length=5, max_length=1000)



@app.post("/api/verify-route")
def verify_route(request: RouteVerificationRequest):
    return {
        "success": True,
        "agent": "Route Verification Agent",
        "overall_status": "unverified",
        "journey": {
            "start": request.start_location,
            "destination": request.destination,
        },
        "checks": [
            {
                "name": "Official emergency resources",
                "status": "official_sources_available",
                "details": (
                    "Official government emergency resources are listed "
                    "below. They have not assessed this particular route."
                ),
            },
            {
                "name": "Recent incidents along this route",
                "status": "not_checked",
                "details": (
                    "No live incident feed or official route-specific "
                    "incident data is connected."
                ),
            },
            {
                "name": "Route safety assessment",
                "status": "unverified",
                "details": (
                    "Distance and estimated driving time do not prove "
                    "that a route is safe."
                ),
            },
        ],
        "sources": [
            {
                "title": "Emergency Response Support System (112)",
                "url": "https://112.gov.in/",
                "claim": (
                    "India's official emergency response system provides "
                    "emergency assistance through 112."
                ),
                "source_type": "Official Government of India",
                "status": "official_source_reviewed",
            },
            {
                "title": "Women Helpline (181)",
                "url": "https://wcd.gov.in/women/help",
                "claim": (
                    "The Women Helpline provides support and connects "
                    "women with relevant emergency and support services."
                ),
                "source_type": (
                    "Official Ministry of Women and Child Development"
                ),
                "status": "official_source_reviewed",
            },
        ],
        "limitations": [
            "These resources are general emergency resources, not "
            "route-specific safety findings.",
            "Live incidents and local safety conditions have not been checked.",
            "No police or emergency service has been contacted.",
        ],
    }

@app.post("/api/assess-risk")
def assess_route_risk(request: RouteVerificationRequest):
    return {
        "success": True,
        "agent": "Route Risk Assessment Agent",
        "overall_status": "insufficient_evidence",
        "journey": {
            "start": request.start_location,
            "destination": request.destination,
        },
        
        "findings": [
            {
                "label": "Unknown",
                "claim": "Current local safety conditions",
                "details": (
                    "Live incident reports and verified local "
                    "safety data are not connected. Current "
                    "conditions cannot be determined."
                ),
            },
            {
                "label": "Inference",
                "claim": "Route information alone cannot establish safety",
                "details": (
                    "Distance and estimated travel time describe "
                    "the route, but do not establish whether it "
                    "is safe or unsafe."
                ),
            },
            {
                "label": "Evidence gap",
                "claim": "Route-specific risk has not been verified",
                "details": (
                    "No official, route-specific incident data "
                    "has been checked by this prototype. This is "
                    "a statement about missing verification, not "
                    "proof that the route is safe or unsafe."
                ),
            },
            {
                "label": "Assumption",
                "claim": "The user may benefit from additional safety information",
                "details": (
                    "This is a design assumption that should be "
                    "tested with intended users. It is not yet "
                    "supported by user research in this prototype."
                ),
            },
        ],

        
        "evidence_sources": OFFICIAL_REFERENCE_SOURCES,
        "limitations": [
            "No live incident data is connected.",
            "No route-specific safety assessment has been completed.",
            "Do not interpret this result as a safe or unsafe verdict.",
        ],
    }

@app.post("/api/classify-evidence")
def classify_evidence():
    return {
        "success": True,
        "agent": "Evidence Classification Agent",
        "status": "prototype",
        "classifications": [
            {
                "label": "Verified evidence",
                "definition": (
                    "A claim supported by a relevant, reliable source "
                    "that has actually been checked."
                ),
            },
            {
                "label": "Inference",
                "definition": (
                    "A conclusion drawn from available evidence; "
                    "it should not be presented as a directly verified fact."
                ),
            },
            {
                "label": "Assumption",
                "definition": (
                    "A proposition accepted temporarily that needs "
                    "testing or supporting evidence."
                ),
            },
            {
                "label": "Unknown",
                "definition": (
                    "Information that is currently unavailable "
                    "or insufficient to reach a conclusion."
                ),
            },
            {
                "label": "Evidence gap",
                "definition": (
                    "Required evidence has not yet been collected "
                    "or checked."
                ),
            },
        ],
        "limitations": [
            "This endpoint returns predefined definitions.",
            "It does not automatically classify user claims.",
            "It does not independently verify sources.",
        ],
    }


def find_relevant_official_sources(claim: str):
    normalized_claim = claim.lower()
    relevant_sources = []

    for source in OFFICIAL_REFERENCE_SOURCES:
        topics = source.get("topics", [])

        if any(topic.lower() in normalized_claim for topic in topics):
            relevant_sources.append({
                "title": source["title"],
                "url": source["url"],
                "source_type": source["source_type"],
                "scope": source["scope"],
                "status": source["status"],
                "route_specific": source["route_specific"],
            })

    return relevant_sources
@app.post("/api/classify-claim")
async def classify_claim(request: ClaimClassificationRequest):
    
    claim = request.claim.strip()
    relevant_sources = find_relevant_official_sources(claim)
    normalized_claim = claim.lower()

    
    for source in relevant_sources:
        fetch_result = await fetch_official_source(source["url"])

        source["fetch_status"] = fetch_result["status"]
        source["fetch_reason"] = fetch_result["reason"]
        source["text_match_status"] = "not_assessed"
        source["matching_terms"] = []

        if fetch_result["success"]:
            fetched_text = fetch_result["text"] or ""
            source["content_preview"] = fetched_text[:500]

            # Extract meaningful words from the submitted claim.
            stopwords = {
                "the", "is", "are", "was", "were",
                "a", "an", "and", "or", "of", "to",
                "in", "on", "for", "by", "this",
                "that", "with", "through", "provide",
                "provides", "does", "do",
            }

            claim_terms = {
                word
                for word in re.findall(
                    r"\b[a-zA-Z0-9]+\b",
                    claim.lower(),
                )
                if len(word) > 2 and word not in stopwords
            }

            page_terms = set(
                re.findall(
                    r"\b[a-zA-Z0-9]+\b",
                    fetched_text.lower(),
                )
            )

            matching_terms = sorted(claim_terms & page_terms)

            source["matching_terms"] = matching_terms

            if matching_terms:
                source["text_match_status"] = "possible_text_match"
            else:
                source["text_match_status"] = "no_matching_terms_found"

        else:
            source["content_preview"] = None



    
    # Classify claim type separately from evidence status.
    category = "General factual claim"
    classification = "Assumption"

    reason = (
        "The claim has not been independently verified. "
        "This label is a preliminary review tag, not proof that "
        "the claim is false."
    )

    evidence_needed = [
        "A relevant and reliable source",
        "The source publication or update date",
        "Evidence directly supporting the claim",
    ]

    normalized_claim = claim.lower()

    hypothesis_phrases = [
        "we hypothesize",
        "hypothesis",
        "we predict",
        "could improve",
        "might improve",
        "will test",
        "to be tested",
        "untested",
    ]

    inference_phrases = [
        "therefore",
        "suggests that",
        "implies that",
        "we infer",
        "likely indicates",
    ]

    safety_phrases = [
        "route is safe",
        "route is unsafe",
        "currently safe",
        "safe right now",
        "unsafe right now",
        "safety incident",
        "harassment",
        "dangerous route",
        "current crime risk",
        "real-time safety",
    ]

    emergency_keywords = [
        "112",
        "181",
        "police",
        "helpline",
        "emergency service",
        "emergency number",
        "sos",
    ]

    absolute_keywords = [
        "always",
        "never",
        "guaranteed",
        "guarantees",
        "proves",
        "all routes are safe",
        "no risk",
    ]

    if any(phrase in normalized_claim for phrase in hypothesis_phrases):
        category = "Proposed or testable claim"
        classification = "Untested Hypothesis"
        reason = (
            "The wording suggests a proposed idea that needs testing. "
            "The wording alone does not establish whether testing occurred."
        )
        evidence_needed = [
            "A clearly defined test or experiment",
            "A measurable outcome and success criterion",
            "Recorded results and limitations",
        ]

    elif any(phrase in normalized_claim for phrase in inference_phrases):
        category = "Reasoned conclusion"
        classification = "Inference"
        reason = (
            "The wording suggests a conclusion drawn from other information. "
            "Its supporting premises and reasoning need assessment."
        )
        evidence_needed = [
            "Evidence supporting the underlying premises",
            "A clear explanation of the reasoning",
            "Alternative explanations or contradictory evidence",
        ]

    elif any(phrase in normalized_claim for phrase in safety_phrases):
        category = "Time-sensitive or route-safety claim"
        classification = "Assumption"
        reason = (
            "This claim may depend on changing local conditions. "
            "This check has not established route-specific evidence."
        )
        evidence_needed = [
            "Recent information for the specific location and route",
            "Source publication or update timestamp",
            "Reliable official incident data, if available",
            "Evidence covering the relevant time period",
        ]

    elif any(word in normalized_claim for word in emergency_keywords):
        category = "Emergency-service claim"
        classification = "Assumption"
        reason = (
            "This concerns an emergency service. An official source "
            "must support the specific details being claimed."
        )
        evidence_needed = [
            "An appropriate official government or service-provider source",
            "The service's stated purpose and coverage",
            "Current operating details, where relevant",
        ]

    elif any(word in normalized_claim for word in absolute_keywords):
        category = "Broad or absolute claim"
        classification = "Assumption"
        reason = (
            "The claim uses broad or absolute wording that needs "
            "evidence covering its full scope and exceptions."
        )
        evidence_needed = [
            "A precise definition of the claim's scope",
            "Reliable evidence covering that scope",
            "Relevant exceptions or contradictory evidence",
        ]



    return {
        "success": True,
        "agent": "Claim Classification Agent",
        "claim": claim,
        "claim_type": category,
        "classification": classification,
        "verification_status": "not_checked",
        "reason": reason,
        "evidence_needed": evidence_needed,
        "official_sources": relevant_sources,
        "limitations": [
            "Classification is based on simple keyword rules.",
            "The endpoint does not search external sources.",
            "The claim has not been independently verified.",
            "This result is not a real-time safety assessment.",
            "The fetched page content has not been independently verified.",
            "Website availability and fetched text do not prove the claim is true.",
        ],
    }
@app.post("/api/live-tracking/start")
async def start_live_tracking():
    tracking_id = str(uuid.uuid4())

    session = TrackingSession(
        tracking_id=tracking_id,
        latitude=0,
        longitude=0,
        accuracy=None,
        updated_at=datetime.now(timezone.utc).isoformat(),
        active=True,
    )

    live_tracking_sessions[tracking_id] = session

    return {
        "success": True,
        "tracking_id": tracking_id,
        "tracking_url": (
            "https://sheguard-ai-1.onrender.com"
            f"/?tracking={tracking_id}"
        ),
    }


@app.post("/api/live-tracking/{tracking_id}/update")
async def update_live_tracking(
    tracking_id: str,
    request: LiveLocationRequest,
):
    session = live_tracking_sessions.get(tracking_id)

    if not session:
        raise HTTPException(
            status_code=404,
            detail="Tracking session not found.",
        )

    session.latitude = request.latitude
    session.longitude = request.longitude
    session.accuracy = request.accuracy
    session.updated_at = datetime.now(
        timezone.utc
    ).isoformat()

    return {
        "success": True,
        "tracking_id": tracking_id,
        "updated_at": session.updated_at,
    }


@app.get("/api/live-tracking/{tracking_id}")
async def get_live_tracking(tracking_id: str):
    session = live_tracking_sessions.get(tracking_id)

    if not session:
        raise HTTPException(
            status_code=404,
            detail="Tracking session not found.",
        )

    return {
        "success": True,
        "tracking_id": session.tracking_id,
        "latitude": session.latitude,
        "longitude": session.longitude,
        "accuracy": session.accuracy,
        "updated_at": session.updated_at,
        "active": session.active,
    }


@app.post("/api/live-tracking/{tracking_id}/stop")
async def stop_live_tracking(tracking_id: str):
    session = live_tracking_sessions.get(tracking_id)

    if not session:
        raise HTTPException(
            status_code=404,
            detail="Tracking session not found.",
        )

    session.active = False

    return {
        "success": True,
        "message": "Live tracking stopped.",
    }