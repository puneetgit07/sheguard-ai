from typing import Any


def calculate_district_indicator(
    district_data: dict[str, Any],
) -> dict[str, Any]:

    incidence = district_data["incidence"]

    female_population_lakh = (
        district_data["female_population_lakh"]
    )

    if female_population_lakh <= 0:
        return {
            "available": False,
            "reason": "Invalid population data",
        }

    rate = incidence / female_population_lakh

    return {
        "available": True,
        "incidence": incidence,
        "female_population_lakh": female_population_lakh,
        "rate_per_lakh_women": round(rate, 2),
        "source_year": district_data["source_year"],
    }


def build_rate_table(
    safety_data: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:

    result = {}

    for district, data in safety_data.items():

        indicator = calculate_district_indicator(
            data
        )

        if indicator["available"]:
            result[district] = indicator

    return result


def calculate_normalized_indicators(
    rate_table: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:

    if not rate_table:
        return {}

    rates = [
        item["rate_per_lakh_women"]
        for item in rate_table.values()
    ]

    min_rate = min(rates)
    max_rate = max(rates)

    result = {}

    for district, item in rate_table.items():

        rate = item["rate_per_lakh_women"]

        if max_rate == min_rate:
            score = 50.0

        else:
            score = (
                (rate - min_rate)
                / (max_rate - min_rate)
            ) * 100

        score = round(score, 2)

        if score < 33.33:
            level = "lower"

        elif score < 66.67:
            level = "moderate"

        else:
            level = "higher"

        result[district] = {
            **item,
            "risk_indicator": score,
            "risk_level": level,
        }

    return result
def calculate_route_indicator(
    route_segments: list[dict],
    district_scores: dict[str, dict],
) -> dict:

    total_distance = 0.0

    weighted_score = 0.0

    available_distance = 0.0

    matched_districts = []

    for segment in route_segments:

        distance = segment.get(
            "distance_km",
            0,
        )

        district = segment.get(
            "district"
        )

        if not district:
            continue

        district_data = district_scores.get(
            district
        )

        if not district_data:
            continue

        score = district_data[
            "risk_indicator"
        ]

        total_distance += distance

        weighted_score += (
            distance * score
        )

        available_distance += distance

        matched_districts.append(
            {
                "district": district,
                "distance_km": distance,
                "risk_indicator": score,
                "risk_level": district_data[
                    "risk_level"
                ],
            }
        )

    if available_distance == 0:

        return {
            "available": False,
            "risk_indicator": None,
            "risk_level": "insufficient_data",
            "coverage_percent": 0,
            "districts": [],
        }

    route_score = (
        weighted_score
        / available_distance
    )

    coverage = (
        available_distance
        / total_distance
        * 100
        if total_distance > 0
        else 0
    )

    if route_score < 33.33:
        level = "lower"

    elif route_score < 66.67:
        level = "moderate"

    else:
        level = "higher"

    return {
        "available": True,
        "risk_indicator": round(
            route_score,
            2,
        ),
        "risk_level": level,
        "coverage_percent": round(
            coverage,
            2,
        ),
        "districts": matched_districts,
    }