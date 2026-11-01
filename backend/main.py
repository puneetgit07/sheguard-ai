import uuid
import asyncio
import os
import math
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import re
from html import unescape
from urllib.parse import urlparse
from safety.safety_data import UP_SAFETY_DATA
from safety.safety_score import (
    build_rate_table,
    calculate_normalized_indicators,
    calculate_route_indicator,
)
from safety.geographic import (
    identify_route_districts,
    build_route_segments,
)
SAFETY_RATE_TABLE = build_rate_table(
    UP_SAFETY_DATA
)

SAFETY_DISTRICT_SCORES = calculate_normalized_indicators(
    SAFETY_RATE_TABLE
)
from dotenv import load_dotenv

load_dotenv()
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
        "http://localhost:5174",
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

    for attempt in range(2):
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
                    connect=5.0,
                    read=10.0,
                    write=5.0,
                    pool=5.0,
                ),
            )

            print(
                f"Nominatim attempt {attempt + 1}: "
                f"status={response.status_code}, "
                f"address={address}"
            )

            if response.status_code == 429:
                if attempt == 0:
                    await asyncio.sleep(1)
                    continue

                raise HTTPException(
                    status_code=502,
                    detail=(
                        "Location service rate limit reached. "
                        "Please try again in a moment."
                    ),
                )

            if response.status_code in (500, 502, 503, 504):
                if attempt == 0:
                    await asyncio.sleep(1)
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

            if attempt == 0:
                await asyncio.sleep(1)
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

            if attempt == 0:
                await asyncio.sleep(1)
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
async def get_tomtom_incidents(
    client: httpx.AsyncClient,
    min_lon: float,
    min_lat: float,
    max_lon: float,
    max_lat: float,
) -> list[dict[str, Any]]:

    api_key = os.getenv("TOMTOM_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="TomTom API key is not configured.",
        )

    url = (
        "https://api.tomtom.com/"
        "maps/orbis/traffic/incidents/details"
    )

    headers = {
        "TomTom-Api-Key": api_key,
        "TomTom-Api-Version": "2",
        "Accept": "application/json",
        "Attributes": (
            "incidents("
            "geometry(type,coordinates),"
            "properties("
            "id,"
            "iconCategory,"
            "magnitudeOfDelay,"
            "events,"
            "startTime,"
            "endTime,"
            "from,"
            "to,"
            "lengthInMeters,"
            "delayInSeconds,"
            "roadNumbers,"
            "timeValidity,"
            "probabilityOfOccurrence,"
            "numberOfReports,"
            "lastReportTime"
            ")"
            ")"
        ),
    }

    # ---------------------------------------------------------
    # TomTom allows a maximum bbox area of 10,000 km².
    # Long routes can have a much larger bounding box, so
    # divide the requested area into smaller tiles.
    # ---------------------------------------------------------

    center_lat = (min_lat + max_lat) / 2

    km_per_lat = 111.0
    km_per_lon = 111.0 * max(
        0.2,
        math.cos(math.radians(center_lat)),
    )

    width_km = (max_lon - min_lon) * km_per_lon
    height_km = (max_lat - min_lat) * km_per_lat

    # Keep each tile comfortably below TomTom's 10,000 km² limit.
    target_tile_km = 70.0

    columns = max(
        1,
        math.ceil(width_km / target_tile_km),
    )

    rows = max(
        1,
        math.ceil(height_km / target_tile_km),
    )

    # Avoid an excessive number of API requests.
    columns = min(columns, 8)
    rows = min(rows, 8)

    lon_step = (max_lon - min_lon) / columns
    lat_step = (max_lat - min_lat) / rows

    all_incidents: list[dict[str, Any]] = []

    for row in range(rows):
        for column in range(columns):

            tile_min_lon = min_lon + column * lon_step
            tile_max_lon = min_lon + (column + 1) * lon_step

            tile_min_lat = min_lat + row * lat_step
            tile_max_lat = min_lat + (row + 1) * lat_step

            params = {
                "apiVersion": 2,
                "bbox": (
                    f"{tile_min_lon},{tile_min_lat},"
                    f"{tile_max_lon},{tile_max_lat}"
                ),
                "timeValidity": "present",
            }

            try:
                response = await client.get(
                    url,
                    params=params,
                    headers=headers,
                    timeout=httpx.Timeout(
                        connect=5.0,
                        read=10.0,
                        write=5.0,
                        pool=5.0,
                    ),
                )

                print(
                    "TomTom incident tile:",
                    row,
                    column,
                    response.status_code,
                )

                response.raise_for_status()

                data = response.json()

                incidents = data.get(
                    "incidents",
                    [],
                )

                all_incidents.extend(incidents)

            except httpx.HTTPError as error:
                print(
                    f"TomTom tile error "
                    f"({row},{column}): {error}"
                )

                # Continue checking the remaining tiles
                # instead of failing the complete route.
                continue

    # ---------------------------------------------------------
    # Remove duplicate incidents.
    # The same incident can appear in neighboring tiles.
    # ---------------------------------------------------------

    unique_incidents: dict[str, dict[str, Any]] = {}

    for incident in all_incidents:

        properties = incident.get(
            "properties",
            {},
        )

        incident_id = properties.get("id")

        if incident_id is not None:
            unique_incidents[str(incident_id)] = incident
        else:
            # Keep incidents without an ID as well.
            unique_incidents[
                f"anonymous-{len(unique_incidents)}"
            ] = incident

    print(
        "TomTom total unique incidents:",
        len(unique_incidents),
    )

    return list(unique_incidents.values())
def get_route_bbox(
    geometry: dict[str, Any],
) -> tuple[float, float, float, float]:

    coordinates = geometry.get("coordinates", [])

    if not coordinates:
        raise ValueError(
            "Route geometry does not contain coordinates."
        )

    longitudes = []
    latitudes = []

    for point in coordinates:
        if len(point) < 2:
            continue

        longitude = float(point[0])
        latitude = float(point[1])

        longitudes.append(longitude)
        latitudes.append(latitude)

    if not longitudes or not latitudes:
        raise ValueError(
            "Route geometry contains no valid coordinates."
        )

    return (
        min(longitudes),
        min(latitudes),
        max(longitudes),
        max(latitudes),
    )


def parse_tomtom_incident(
    incident: dict[str, Any],
) -> dict[str, Any]:

    properties = incident.get(
        "properties",
        {},
    )

    events = properties.get(
        "events",
        [],
    )

    event_names = []

    for event in events:
        description = event.get(
            "description"
        )

        if description:
            event_names.append(
                description
            )

    # TomTom returns magnitudeOfDelay
    # as text such as:
    # major, moderate, minor, undefined.
    magnitude = str(
        properties.get(
            "magnitudeOfDelay",
            "undefined",
        )
    ).lower()

    severity_map = {
        "major": 4,
        "moderate": 3,
        "minor": 2,
        "undefined": 1,
    }

    severity = severity_map.get(
        magnitude,
        1,
    )

    return {
        "id": properties.get(
            "id"
        ),

        "category": properties.get(
            "iconCategory",
            "unknown",
        ),

        "severity": severity,

        "description": (
            ", ".join(event_names)
            if event_names
            else "Live traffic incident reported."
        ),

        "road": (
            properties.get("from")
            or properties.get("to")
            or "Unknown road"
        ),

        "delay_seconds": properties.get(
            "delayInSeconds",
            0,
        ),

        "road_closed": properties.get(
            "roadClosed",
            False,
        ),

        "start_time": properties.get(
            "startTime"
        ),

        "end_time": properties.get(
            "endTime"
        ),

        "last_report_time": properties.get(
            "lastReportTime"
        ),
    }
async def verify_single_route(
    client: httpx.AsyncClient,
    route: dict[str, Any],
) -> dict[str, Any]:

    try:
        bbox = get_route_bbox(
            route["geometry"]
        )

        incidents = await get_tomtom_incidents(
            client=client,
            min_lon=bbox[0],
            min_lat=bbox[1],
            max_lon=bbox[2],
            max_lat=bbox[3],
        )

        parsed_incidents = [
            parse_tomtom_incident(incident)
            for incident in incidents
        ]

        # Traffic conditions are NOT automatically treated
        # as personal-safety risks.
        #
        # Heavy traffic, slow traffic, stationary traffic
        # and queuing traffic do not automatically mean
        # that a route is unsafe.
        #
        # Therefore, the current prototype keeps the
        # personal-safety risk score at 0 while still
        # reporting live traffic incidents.

        risk_score = 0

        if risk_score == 0:
            status = "lower_risk"
            recommendation = (
                "No personal-safety risk signal was identified "
                "from the available verification data."
            )
        else:
            status = "caution"
            recommendation = (
                "Some safety signals require additional review."
            )

        return {
            "route_id": route["id"],
            "distance_km": route["distance_km"],
            "estimated_minutes": route["estimated_minutes"],
            "status": status,
            "recommendation": recommendation,
            "risk_score": risk_score,
            "incident_count": len(parsed_incidents),
            "incidents": parsed_incidents,
        }

    except Exception as error:

        print(
            f"Route {route.get('id')} "
            f"verification error: {error}"
        )

        return {
            "route_id": route.get("id"),
            "distance_km": route.get(
                "distance_km"
            ),
            "estimated_minutes": route.get(
                "estimated_minutes"
            ),
            "status": "verification_failed",
            "recommendation": (
                "Live verification unavailable."
            ),
            "risk_score": None,
            "incident_count": 0,
            "incidents": [],
        }
class SOSContact(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=10, max_length=15)


class SOSRequest(BaseModel):
    contacts: list[SOSContact] = Field(min_length=1, max_length=10)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    tracking_url: str = Field(min_length=1, max_length=500)


def normalize_indian_phone(phone: str) -> str:
    cleaned = re.sub(r"[^\d+]", "", phone)

    if cleaned.startswith("+91"):
        number = cleaned[3:]
    elif cleaned.startswith("91") and len(cleaned) == 12:
        number = cleaned[2:]
    else:
        number = cleaned

    if not re.fullmatch(r"[6-9]\d{9}", number):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid Indian mobile number: {phone}",
        )

    return f"+91{number}"
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
        recipients=["+917571037033"],
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
@app.post("/api/send-sos")
async def send_sos(request: SOSRequest):

    maps_url = (
        "https://www.google.com/maps?q="
        f"{request.latitude},{request.longitude}"
    )

    results = []

    for contact in request.contacts:
        phone = normalize_indian_phone(contact.phone)

        message = (
            "🚨 SheGuard AI – SOS Alert\n\n"
            f"Hi, {contact.name}—maine SheGuard AI par "
            "apna emergency alert trigger kiya hai aur "
            "mujhe shayad madad ki zaroorat hai.\n\n"
            "Please mujhe turant call karo ya mera status check karo:\n"
            f"📍 Location: {maps_url}\n"
            f"🗺️ Live Tracking: {request.tracking_url}\n\n"
            "— Sent via SheGuard AI"
        )

        try:
            textbee_response = await send_textbee_sms(
                recipients=[phone],
                message=message,
            )

            results.append(
                {
                    "name": contact.name,
                    "phone": phone,
                    "success": True,
                    "textbee_response": textbee_response,
                }
            )

        except HTTPException as error:
            print(
                f"SOS SMS failed for {contact.name}: "
                f"{error.detail}"
            )

            results.append(
                {
                    "name": contact.name,
                    "phone": phone,
                    "success": False,
                    "error": error.detail,
                }
            )

    successful = [
        result
        for result in results
        if result["success"]
    ]

    failed = [
        result
        for result in results
        if not result["success"]
    ]

    if not successful:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "SOS was activated, but no SMS could be sent.",
                "results": results,
            },
        )

    return {
        "success": True,
        "message": (
            f"SOS SMS sent to {len(successful)} "
            f"of {len(results)} trusted contacts."
        ),
        "sent_count": len(successful),
        "failed_count": len(failed),
        "results": results,
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
                            "overview": "simplified",
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
                            read=12.0,
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
    start_location: str = Field(
        min_length=2,
        max_length=200,
    )

    destination: str = Field(
        min_length=2,
        max_length=200,
    )

    routes: list[dict[str, Any]] = Field(
        min_length=1,
        max_length=5,
    )



class ClaimClassificationRequest(BaseModel):
    claim: str = Field(
        min_length=5,
        max_length=1000,
    )


def evaluate_route_safety(
    route: dict[str, Any],
) -> dict[str, Any]:

    """
    SHEGUARD AI personal-safety evaluation.

    Important:
    Traffic conditions are intentionally NOT used here.

    The current prototype does not have a verified,
    route-specific women-safety/crime dataset connected.

    Therefore we do not invent a numerical safety score.
    """

    return {
        "route_id": route.get("id"),
        "distance_km": route.get("distance_km"),
        "estimated_minutes": route.get(
            "estimated_minutes"
        ),

        # No fake safety score.
        "risk_score": None,

        "status": "insufficient_safety_data",

        "recommendation": (
            "Route-specific personal-safety risk "
            "could not be verified with the available data."
        ),

        # Traffic incidents are completely removed.
        "incident_count": 0,
        "incidents": [],
    }


@app.post("/api/verify-route")
async def verify_route(
    request: RouteVerificationRequest,
):

    try:

        route_results = []

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=5.0,
                read=15.0,
                write=5.0,
                pool=5.0,
            ),
            headers={
                "User-Agent": (
                    "SHEGUARD-AI/1.0 "
                    "(hackathon safety application)"
                )
            },
        ) as client:

            for route in request.routes:

                raw_geometry = route.get("geometry", [])

                if isinstance(raw_geometry, dict):
                    coordinates = raw_geometry.get("coordinates", [])
                else:
                    coordinates = raw_geometry

                if not coordinates:

                    route_results.append(
                        {
                            "route_id": route.get("id"),
                            "risk_indicator": None,
                            "risk_level": "insufficient_data",
                            "coverage_percent": 0,
                            "districts": [],
                            "message": (
                                "Route geometry is unavailable."
                            ),
                        }
                    )

                    continue

                # -----------------------------------
                # 1. Find districts along the route
                # -----------------------------------

                district_points = (
                    await identify_route_districts(
                        client=client,
                        coordinates=coordinates,
                        safety_data=UP_SAFETY_DATA,
                    )
                )

                # -----------------------------------
                # 2. Convert points into segments
                # -----------------------------------

                route_segments = build_route_segments(
                    coordinates=coordinates,
                    district_points=district_points,
                )

                # -----------------------------------
                # 3. Calculate weighted route risk
                # -----------------------------------

                safety_result = calculate_route_indicator(
                    route_segments=route_segments,
                    district_scores=SAFETY_DISTRICT_SCORES,
                )

                route_results.append(
                    {
                        "route_id": route.get("id"),

                        "distance_km": route.get(
                            "distance_km"
                        ),

                        "estimated_minutes": route.get(
                            "estimated_minutes"
                        ),

                        "risk_indicator": safety_result[
                            "risk_indicator"
                        ],

                        "risk_level": safety_result[
                            "risk_level"
                        ],

                        "coverage_percent": safety_result[
                            "coverage_percent"
                        ],

                        "districts": safety_result[
                            "districts"
                        ],

                        "data_type": (
                            "Historical reported-crime "
                            "indicator"
                        ),

                        "source_year": 2015,

                        "traffic_used": False,
                    }
                )

        # -----------------------------------
        # 4. Select recommended route
        # -----------------------------------

        valid_routes = [
            route
            for route in route_results
            if route.get("risk_indicator") is not None
        ]

        recommended_route_id = None

        if valid_routes:

            recommended_route = min(
                valid_routes,
                key=lambda route: route[
                    "risk_indicator"
                ],
            )

            recommended_route_id = (
                recommended_route["route_id"]
            )

        # -----------------------------------
        # 5. Overall status
        # -----------------------------------

        if not valid_routes:

            overall_status = (
                "insufficient_data"
            )

        else:

            highest_risk = max(
                route["risk_indicator"]
                for route in valid_routes
            )

            if highest_risk < 33.33:
                overall_status = "lower"

            elif highest_risk < 66.67:
                overall_status = "moderate"

            else:
                overall_status = "higher"

        return {
            "success": True,

            "agent": (
                "SHEGUARD AI Personal Safety "
                "Route Assessment Agent"
            ),

            "overall_status": overall_status,

            "journey": {
                "start": request.start_location,
                "destination": request.destination,
            },

            "recommended_route_id": (
                recommended_route_id
            ),

            "live_data": {
                "provider": "None",
                "status": "not_used",
                "description": (
                    "Traffic conditions are not "
                    "used for women-safety scoring."
                ),
            },

            "routes": route_results,

            "checks": [
                {
                    "name": (
                        "Historical women-safety "
                        "indicator"
                    ),
                    "status": (
                        "available"
                        if valid_routes
                        else "insufficient_data"
                    ),
                    "details": (
                        "Route segments are mapped "
                        "to available district-level "
                        "historical data."
                    ),
                },
                {
                    "name": "Traffic data",
                    "status": "excluded",
                    "details": (
                        "Traffic conditions are "
                        "intentionally excluded from "
                        "personal-safety assessment."
                    ),
                },
            ],

            "sources": OFFICIAL_REFERENCE_SOURCES,

            "limitations": [
                (
                    "The indicator is based on "
                    "historical reported-crime data."
                ),
                (
                    "Historical reported crime does "
                    "not guarantee present-day safety."
                ),
                (
                    "District boundaries and "
                    "geocoding may not perfectly "
                    "match police jurisdictions."
                ),
                (
                    "Segments without matching "
                    "district data are excluded from "
                    "the weighted score."
                ),
                (
                    "Traffic conditions are not "
                    "treated as women-safety risk."
                ),
            ],
        }

    except Exception as error:

        print(
            f"Route safety verification error: {error}"
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Personal-safety route verification "
                "could not be completed."
            ),
        )
    
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

@app.get("/api/test-tomtom")
async def test_tomtom():
    api_key = os.getenv("TOMTOM_API_KEY")

    if not api_key:
        return {
            "success": False,
            "message": "TOMTOM_API_KEY is not loaded."
        }

    return {
        "success": True,
        "message": "TomTom API key is loaded successfully."
    }
@app.get("/api/test-tomtom-incidents")
async def test_tomtom_incidents():

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(15.0)
        ) as client:

            incidents = await get_tomtom_incidents(
                client=client,
                min_lon=77.18,
                min_lat=28.60,
                max_lon=77.25,
                max_lat=28.66,
            )

        return {
            "success": True,
            "incident_count": len(incidents),
            "incidents": incidents,
        }

    except HTTPException:
        raise

    except Exception as error:

        print(
            f"Unexpected TomTom test error: {error}"
        )

        raise HTTPException(
            status_code=500,
            detail="Unexpected TomTom test error.",
        )

@app.get("/api/test-safety-data")
async def test_safety_data():

    return {
        "success": True,
        "coverage": "Uttar Pradesh",
        "district_count": len(
            SAFETY_DISTRICT_SCORES
        ),
        "districts": SAFETY_DISTRICT_SCORES,
    }
