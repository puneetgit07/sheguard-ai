import re


DISTRICT_ALIASES = {
    "gautam buddh nagar": "Gautambudh Nagar",
    "gautam buddha nagar": "Gautambudh Nagar",
    "gautam budh nagar": "Gautambudh Nagar",
    "gb nagar": "Gautambudh Nagar",

    "kanpur nagar": "Kanpur Nagar",
    "kanpur": "Kanpur Nagar",

    "rae bareli": "Raibareilly",
    "rae bareilly": "Raibareilly",

    "st ravidas nagar": "St.Ravidasnagar",
    "sant ravidas nagar": "St.Ravidasnagar",

    "siddharth nagar": "Sidharthnagar",

    "lakhimpur kheri": "Khiri",
    "kheri": "Khiri",

    "kasganj": "Kasganj",

    "firozabad": "Firozabad",
}


def normalize_location_name(
    value: str,
) -> str:

    value = value.lower().strip()

    value = re.sub(
        r"[^a-z0-9\s]",
        " ",
        value,
    )

    value = re.sub(
        r"\s+",
        " ",
        value,
    )

    return value


def match_district(
    district_name: str,
    safety_data: dict,
) -> str | None:

    normalized = normalize_location_name(
        district_name
    )

    if normalized in DISTRICT_ALIASES:
        return DISTRICT_ALIASES[normalized]

    for district in safety_data:

        district_normalized = (
            normalize_location_name(district)
        )

        if normalized == district_normalized:
            return district

    return None
import httpx


async def reverse_geocode_point(
    client: httpx.AsyncClient,
    latitude: float,
    longitude: float,
) -> dict:

    url = (
        "https://nominatim.openstreetmap.org/reverse"
    )

    params = {
        "lat": latitude,
        "lon": longitude,
        "format": "jsonv2",
        "zoom": 10,
        "addressdetails": 1,
    }

    response = await client.get(
        url,
        params=params,
    )

    response.raise_for_status()

    return response.json()
def extract_district(
    geocode_result: dict,
) -> str | None:

    address = geocode_result.get(
        "address",
        {},
    )

    possible_fields = [
        "state_district",
        "district",
        "county",
    ]

    for field in possible_fields:

        value = address.get(field)

        if value:
            return value

    return None
import math


def haversine_km(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
) -> float:

    radius = 6371.0

    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)

    dlat = math.radians(
        lat2 - lat1
    )

    dlon = math.radians(
        lon2 - lon1
    )

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1_rad)
        * math.cos(lat2_rad)
        * math.sin(dlon / 2) ** 2
    )

    c = 2 * math.atan2(
        math.sqrt(a),
        math.sqrt(1 - a),
    )

    return radius * c


def sample_route_coordinates(
    coordinates: list[list[float]],
    interval_km: float = 25.0,
) -> list[list[float]]:

    if not coordinates:
        return []

    samples = [
        coordinates[0]
    ]

    accumulated = 0.0

    previous = coordinates[0]

    for coordinate in coordinates[1:]:

        lon1, lat1 = previous
        lon2, lat2 = coordinate

        distance = haversine_km(
            lat1,
            lon1,
            lat2,
            lon2,
        )

        accumulated += distance

        if accumulated >= interval_km:

            samples.append(coordinate)

            accumulated = 0.0

        previous = coordinate

    if samples[-1] != coordinates[-1]:
        samples.append(coordinates[-1])

    return samples
async def identify_route_districts(
    client: httpx.AsyncClient,
    coordinates: list[list[float]],
    safety_data: dict,
) -> list[dict]:

    samples = sample_route_coordinates(
        coordinates,
        interval_km=25.0,
    )

    results = []

    for coordinate in samples:

        lon, lat = coordinate

        try:

            geocode_result = (
                await reverse_geocode_point(
                    client,
                    lat,
                    lon,
                )
            )

            district_name = extract_district(
                geocode_result
            )

            matched_district = None

            if district_name:

                matched_district = match_district(
                    district_name,
                    safety_data,
                )

            results.append(
                {
                    "latitude": lat,
                    "longitude": lon,
                    "district_from_geocoder": (
                        district_name
                    ),
                    "matched_district": (
                        matched_district
                    ),
                }
            )

        except Exception as error:

            print(
                f"Reverse geocoding failed: {error}"
            )

            results.append(
                {
                    "latitude": lat,
                    "longitude": lon,
                    "district_from_geocoder": None,
                    "matched_district": None,
                }
            )

    return results
def build_route_segments(
    coordinates: list[list[float]],
    district_points: list[dict],
) -> list[dict]:
    segments = []

    if len(coordinates) < 2:
        return segments

    if not district_points:
        return segments

    # Map each route coordinate to the nearest
    # reverse-geocoded district sample.
    for i in range(len(coordinates) - 1):
        start = coordinates[i]
        end = coordinates[i + 1]

        lon1, lat1 = start
        lon2, lat2 = end

        distance = haversine_km(
            lat1,
            lon1,
            lat2,
            lon2,
        )

        # Find the closest sampled district point
        midpoint_lon = (lon1 + lon2) / 2
        midpoint_lat = (lat1 + lat2) / 2

        closest_point = min(
            district_points,
            key=lambda point: haversine_km(
                midpoint_lat,
                midpoint_lon,
                point["latitude"],
                point["longitude"],
            ),
        )

        district = closest_point.get("matched_district")

        segments.append({
            "start": {
                "latitude": lat1,
                "longitude": lon1,
            },
            "end": {
                "latitude": lat2,
                "longitude": lon2,
            },
            "distance_km": round(distance, 4),
            "district": district,
        })

    return segments