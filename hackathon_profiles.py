"""Generate simulation profiles from real hackathon participants.

Reads ACCEPTED-LIST.csv, optionally scrapes LinkedIn via RapidAPI (cached),
then uses OpenAI GPT to map each person's background into the 39 simulation
attributes.

Usage (standalone):
    python hackathon_profiles.py
"""

from __future__ import annotations

import csv
import json
import os
import random
import re
import time
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

from generate_profiles import _pick_personality, _gen_attributes, save_profiles

# ── CSV Parsing ──────────────────────────────────────────────────────────────

def load_csv_participants(csv_path: str = "ACCEPTED-LIST.csv") -> list[dict]:
    """Parse CSV into [{name, linkedin_url, achievements}]."""
    participants = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)  # skip header
        for row in reader:
            if len(row) < 3:
                continue
            name = row[0].strip()
            raw_url = row[1].strip()
            achievements = row[2].strip()
            linkedin_url = raw_url if "linkedin.com/in/" in raw_url else None
            participants.append({
                "name": name,
                "linkedin_url": linkedin_url,
                "achievements": achievements,
            })
    return participants


# ── LinkedIn Scraping ────────────────────────────────────────────────────────

CACHE_PATH = "linkedin_cache.json"


def _load_cache() -> dict:
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH) as f:
            return json.load(f)
    return {}


def _save_cache(cache: dict) -> None:
    with open(CACHE_PATH, "w") as f:
        json.dump(cache, f, indent=2)


def _slug_from_url(url: str) -> str | None:
    """Extract LinkedIn slug from URL like linkedin.com/in/some-name."""
    m = re.search(r"linkedin\.com/in/([^/?#]+)", url)
    return m.group(1) if m else None


def scrape_linkedin_profile(url: str, api_key: str) -> dict | None:
    """Single RapidAPI call to fresh-linkedin-profile-data."""
    try:
        resp = requests.get(
            "https://fresh-linkedin-profile-data.p.rapidapi.com/enrich-lead",
            params={"linkedin_url": url},
            headers={
                "x-rapidapi-key": api_key,
                "x-rapidapi-host": "fresh-linkedin-profile-data.p.rapidapi.com",
            },
            timeout=30,
        )
        if resp.status_code == 429:
            print(f"  Rate limited, waiting 5s and retrying...")
            time.sleep(5)
            resp = requests.get(
                "https://fresh-linkedin-profile-data.p.rapidapi.com/enrich-lead",
                params={"linkedin_url": url},
                headers={
                    "x-rapidapi-key": api_key,
                    "x-rapidapi-host": "fresh-linkedin-profile-data.p.rapidapi.com",
                },
                timeout=30,
            )
        if resp.status_code == 200:
            return resp.json()
        print(f"  API error {resp.status_code} for {url}")
        return None
    except Exception as e:
        print(f"  Scrape error for {url}: {e}")
        return None


def scrape_all_participants(participants: list[dict]) -> dict:
    """Scrape LinkedIn for all participants, using cache.

    Returns {slug: linkedin_data} for all participants that have URLs.
    """
    api_key = os.getenv("RAPIDAPI_KEY")
    cache = _load_cache()

    if not api_key:
        print("RAPIDAPI_KEY not set — skipping LinkedIn scraping, using achievements only.")
        return cache

    for p in participants:
        url = p.get("linkedin_url")
        if not url:
            continue
        slug = _slug_from_url(url)
        if not slug:
            continue
        if slug in cache:
            print(f"  Cached: {slug}")
            continue

        print(f"  Scraping: {slug} ...")
        data = scrape_linkedin_profile(url, api_key)
        if data:
            cache[slug] = {
                "scraped_at": datetime.now(timezone.utc).isoformat(),
                "data": data,
            }
            _save_cache(cache)
        time.sleep(1.5)

    return cache


# ── LLM Attribute Generation ────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an expert psychologist assessing how individuals would behave \
during a building evacuation. Given a person's professional background and achievements, \
output a JSON object with exactly these 39 attributes, each an integer from 0 to 100.

The attributes are grouped into 8 categories:

stress_response:
  - panic_susceptibility: How likely to panic (0=never panics, 100=extreme panic)
  - stress_tolerance: Ability to function under stress (0=collapses, 100=thrives)
  - emotional_volatility: How rapidly emotions shift (0=stable, 100=highly volatile)
  - freeze_tendency: Likelihood of freezing in danger (0=never freezes, 100=always freezes)
  - emotional_recovery_speed: How fast they recover emotionally (0=slow, 100=instant)

decision_making:
  - decision_speed: Speed of making decisions (0=very slow, 100=instant)
  - situational_awareness: Awareness of surroundings (0=oblivious, 100=hyper-aware)
  - risk_taking: Willingness to take risks (0=risk-averse, 100=reckless)
  - analytical_thinking: Logical analysis ability (0=intuitive only, 100=deeply analytical)
  - adaptability: Ability to adjust to new situations (0=rigid, 100=highly flexible)
  - creativity: Creative problem-solving (0=conventional, 100=highly creative)

social_behavior:
  - leadership: Natural leadership tendency (0=pure follower, 100=born leader)
  - altruism: Willingness to help others at own cost (0=selfish, 100=self-sacrificing)
  - compliance: Following rules and authority (0=rebellious, 100=blindly obedient)
  - herding_tendency: Following the crowd (0=independent, 100=always follows crowd)
  - cooperation: Willingness to work with others (0=lone wolf, 100=team player)
  - competitiveness: Drive to outperform others (0=non-competitive, 100=ultra-competitive)

general_personality:
  - introversion: Social energy style (0=extreme extrovert, 100=extreme introvert)
  - agreeableness: Tendency to be accommodating (0=antagonistic, 100=very agreeable)
  - conscientiousness: Organization and diligence (0=careless, 100=meticulous)
  - neuroticism: Emotional instability tendency (0=very stable, 100=very neurotic)
  - openness_to_experience: Openness to new ideas (0=closed, 100=very open)
  - assertiveness: Confidence in expressing views (0=passive, 100=very assertive)
  - stubbornness: Resistance to changing mind (0=easily swayed, 100=immovable)
  - optimism: Positive outlook (0=pessimist, 100=extreme optimist)
  - impulsivity: Acting without thinking (0=deliberate, 100=highly impulsive)

communication:
  - vocal_tendency: How much they speak up (0=silent, 100=very vocal)
  - persuasiveness: Ability to influence others (0=unconvincing, 100=very persuasive)
  - information_sharing: Willingness to share info (0=secretive, 100=shares everything)

emotional_psychological:
  - empathy: Ability to understand others' emotions (0=none, 100=deeply empathetic)
  - self_preservation_drive: Instinct to protect self (0=reckless, 100=self-preservation first)
  - authority_trust: Trust in authority figures (0=distrusts, 100=trusts completely)
  - claustrophobia: Fear of confined spaces (0=none, 100=severe)
  - prior_trauma: Impact of past trauma (0=none, 100=severely affected)
  - denial_tendency: Tendency to deny danger (0=faces reality, 100=total denial)

physical:
  - mobility: Physical movement ability (0=immobile, 100=athletic)
  - strength: Physical strength (0=very weak, 100=very strong)
  - pain_tolerance: Ability to endure pain (0=very sensitive, 100=high tolerance)

knowledge_preparation:
  - environment_familiarity: Knowledge of the building (0=first time, 100=knows every corner)
  - emergency_training: Formal emergency training (0=none, 100=expert)
  - general_knowledge: General awareness and education (0=uninformed, 100=very knowledgeable)

Guidelines for hackathon participants:
- environment_familiarity should be LOW (10-35) — they're at an unfamiliar event venue
- emergency_training should be LOW (5-25) — tech people rarely have formal emergency training
- Competitive programmers → high analytical_thinking, decision_speed, competitiveness
- Founders/entrepreneurs → high leadership, assertiveness, risk_taking, optimism
- Researchers/academics → high analytical_thinking, conscientiousness, moderate introversion
- Young tech workers → generally high adaptability, openness_to_experience, creativity

Return ONLY a valid JSON object with the nested structure shown above. No markdown, no explanation."""


def _format_linkedin_data(linkedin_data: dict | None) -> str:
    """Format LinkedIn data into a readable summary for the LLM."""
    if not linkedin_data:
        return "No LinkedIn data available."

    data = linkedin_data.get("data", linkedin_data)
    parts = []

    headline = data.get("headline") or data.get("title")
    if headline:
        parts.append(f"Headline: {headline}")

    about = data.get("about") or data.get("summary")
    if about:
        parts.append(f"About: {about[:500]}")

    # Current position
    positions = data.get("experiences") or data.get("positions") or []
    if positions and isinstance(positions, list):
        pos = positions[0] if isinstance(positions[0], dict) else {}
        title = pos.get("title", "")
        company = pos.get("company", "") or pos.get("company_name", "")
        if title or company:
            parts.append(f"Current position: {title} at {company}")

    # Education
    education = data.get("education") or []
    if education and isinstance(education, list):
        for edu in education[:2]:
            if isinstance(edu, dict):
                school = edu.get("school", "") or edu.get("school_name", "")
                degree = edu.get("degree", "") or edu.get("field_of_study", "")
                if school:
                    parts.append(f"Education: {degree} from {school}")

    return "\n".join(parts) if parts else "No LinkedIn data available."


def _estimate_age(linkedin_data: dict | None) -> int:
    """Estimate age from LinkedIn education graduation year, or default 25."""
    if not linkedin_data:
        return 25

    data = linkedin_data.get("data", linkedin_data)
    education = data.get("education") or []
    for edu in education:
        if not isinstance(edu, dict):
            continue
        end_year = edu.get("end_year") or edu.get("end_date")
        if end_year:
            try:
                year = int(str(end_year)[:4])
                # Assume bachelor's at ~22
                estimated = 2026 - year + 22
                if 18 <= estimated <= 65:
                    return estimated
            except (ValueError, TypeError):
                continue
    return 25


ALL_ATTRIBUTE_KEYS = {
    "stress_response": [
        "panic_susceptibility", "stress_tolerance", "emotional_volatility",
        "freeze_tendency", "emotional_recovery_speed",
    ],
    "decision_making": [
        "decision_speed", "situational_awareness", "risk_taking",
        "analytical_thinking", "adaptability", "creativity",
    ],
    "social_behavior": [
        "leadership", "altruism", "compliance", "herding_tendency",
        "cooperation", "competitiveness",
    ],
    "general_personality": [
        "introversion", "agreeableness", "conscientiousness", "neuroticism",
        "openness_to_experience", "assertiveness", "stubbornness", "optimism",
        "impulsivity",
    ],
    "communication": [
        "vocal_tendency", "persuasiveness", "information_sharing",
    ],
    "emotional_psychological": [
        "empathy", "self_preservation_drive", "authority_trust",
        "claustrophobia", "prior_trauma", "denial_tendency",
    ],
    "physical": [
        "mobility", "strength", "pain_tolerance",
    ],
    "knowledge_preparation": [
        "environment_familiarity", "emergency_training", "general_knowledge",
    ],
}


def generate_attributes_with_llm(
    name: str,
    linkedin_data: dict | None,
    achievements: str,
) -> dict:
    """Call OpenAI to produce all 39 attributes as integers 0-100."""
    linkedin_summary = _format_linkedin_data(linkedin_data)

    user_prompt = f"""Person: {name}

LinkedIn Profile:
{linkedin_summary}

Achievements and background:
{achievements if achievements else 'No specific achievements listed.'}

Generate the 39 evacuation behavior attributes for this person as a JSON object."""

    client = OpenAI()

    for attempt in range(2):
        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.7,
            )
            raw = json.loads(response.choices[0].message.content)
            return _validate_attributes(raw)
        except Exception as e:
            print(f"  LLM error for {name} (attempt {attempt + 1}): {e}")
            if attempt == 0:
                continue
            # Fall back to random attributes
            print(f"  Falling back to random attributes for {name}")
            return _gen_attributes(25)

    return _gen_attributes(25)


def _validate_attributes(raw: dict) -> dict:
    """Validate and fix LLM-generated attributes: clamp values, fill missing keys."""
    result = {}
    for category, keys in ALL_ATTRIBUTE_KEYS.items():
        cat_data = raw.get(category, {})
        if not isinstance(cat_data, dict):
            cat_data = {}
        result[category] = {}
        for key in keys:
            val = cat_data.get(key)
            if val is not None:
                try:
                    result[category][key] = max(0, min(100, int(val)))
                except (ValueError, TypeError):
                    result[category][key] = random.randint(30, 70)
            else:
                result[category][key] = random.randint(30, 70)
    return result


# ── Full Pipeline ────────────────────────────────────────────────────────────

def generate_hackathon_profiles(
    grid_width: int = 10,
    grid_height: int = 10,
    door_position: tuple[int, int] = (9, 5),
    obstacles: list[tuple[int, int]] | None = None,
) -> tuple[list[dict], list[dict]]:
    """Full pipeline: CSV → LinkedIn → LLM → (profiles, agent_configs).

    Returns same signature as generate_profiles.generate_profiles().
    """
    if obstacles is None:
        obstacles = []

    blocked: set[tuple[int, int]] = {door_position} | set(obstacles)

    # 1. Load CSV
    print("Loading participants from CSV...")
    participants = load_csv_participants()
    print(f"  Found {len(participants)} participants")

    # 2. Scrape LinkedIn (cached)
    print("Scraping LinkedIn profiles...")
    cache = scrape_all_participants(participants)

    # 3. Build unique positions
    all_cells = [
        (x, y)
        for x in range(grid_width)
        for y in range(grid_height)
        if (x, y) not in blocked
    ]
    random.shuffle(all_cells)

    profiles: list[dict] = []
    agent_configs: list[dict] = []

    for i, p in enumerate(participants):
        name = p["name"]
        print(f"Generating attributes for {name} ({i + 1}/{len(participants)})...")

        # Get cached LinkedIn data
        linkedin_data = None
        if p.get("linkedin_url"):
            slug = _slug_from_url(p["linkedin_url"])
            if slug and slug in cache:
                linkedin_data = cache[slug]

        # 4. Generate attributes with LLM
        attrs = generate_attributes_with_llm(name, linkedin_data, p["achievements"])

        # Build personality and description
        personality = _pick_personality(attrs)
        age = _estimate_age(linkedin_data)

        # Role from LinkedIn headline or fallback
        role = "hackathon participant"
        if linkedin_data:
            data = linkedin_data.get("data", linkedin_data)
            headline = data.get("headline") or data.get("title")
            if headline:
                role = headline[:60]

        # Position
        pos = all_cells[i % len(all_cells)]

        agent_id = f"agent_{i + 1:02d}"

        # Description
        fitness_word = "fit" if attrs["physical"]["mobility"] >= 65 else "average fitness"
        description = f"{name} is a {age}-year-old {role} who is {fitness_word}."

        profiles.append({
            "id": agent_id,
            "name": name,
            "age": age,
            "description": description,
            "attributes": attrs,
        })

        agent_configs.append({
            "name": name,
            "role": role,
            "personality": personality,
            "position": list(pos),
        })

    return profiles, agent_configs


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    profiles, agent_configs = generate_hackathon_profiles()
    save_profiles(profiles, path="profiles_hackathon.json")
    print(f"\nGenerated {len(profiles)} profiles → profiles_hackathon.json")
    for ac in agent_configs:
        print(f"  {ac['name']:30s}  {ac['role'][:40]:40s}  pos={ac['position']}")


if __name__ == "__main__":
    main()
