"""Random profile generator for the evacuation simulator.

Generates N coherent agent profiles with attributes, plus matching agent
configs for the simulation.  Works standalone or from the Streamlit UI.

Usage (standalone):
    python generate_profiles.py --n 5
    python generate_profiles.py --n 10 --grid-width 15 --grid-height 15
"""

from __future__ import annotations

import argparse
import json
import random

# ── Name pools ────────────────────────────────────────────────────────────────

FIRST_NAMES = [
    "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael",
    "Linda", "David", "Elizabeth", "William", "Barbara", "Richard", "Susan",
    "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen", "Daniel",
    "Lisa", "Matthew", "Nancy", "Anthony", "Betty", "Mark", "Margaret",
    "Donald", "Sandra", "Steven", "Ashley", "Andrew", "Dorothy", "Paul",
    "Kimberly", "Joshua", "Emily", "Kenneth", "Donna", "Kevin", "Michelle",
    "Brian", "Carol", "George", "Amanda", "Timothy", "Melissa", "Ronald",
    "Deborah",
]

LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
    "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
    "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
    "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark",
    "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King",
    "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green",
    "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell",
    "Carter", "Roberts",
]

ROLES = [
    "office worker", "security guard", "student", "nurse", "tourist",
    "janitor", "engineer", "teacher", "delivery driver", "receptionist",
    "construction worker", "firefighter", "retail clerk", "accountant",
    "chef", "paramedic", "librarian", "electrician", "professor",
    "event staff",
]

# ── Personality trait templates ───────────────────────────────────────────────

_TRAIT_SNIPPETS: dict[str, list[str]] = {
    "high_assertiveness": [
        "Takes charge in group settings",
        "Speaks up without hesitation",
        "Naturally commanding presence",
    ],
    "low_assertiveness": [
        "Prefers to follow rather than lead",
        "Quiet and deferential",
        "Avoids confrontation",
    ],
    "high_agreeableness": [
        "Warm and cooperative",
        "Eager to help others",
        "Goes along with the group",
    ],
    "low_agreeableness": [
        "Blunt and self-focused",
        "Rarely compromises",
        "Prioritises own interests",
    ],
    "high_neuroticism": [
        "Prone to anxiety under pressure",
        "Easily overwhelmed by stress",
        "Worries about worst-case outcomes",
    ],
    "low_neuroticism": [
        "Calm and emotionally stable",
        "Keeps composure in a crisis",
        "Hard to rattle",
    ],
    "high_impulsivity": [
        "Acts first, thinks later",
        "Quick to react without planning",
        "Restless and impatient",
    ],
    "low_impulsivity": [
        "Methodical and deliberate",
        "Thinks carefully before acting",
        "Patient and measured",
    ],
}


def _pick_personality(attrs: dict) -> str:
    """Build a 1-sentence personality from the top dominant traits."""
    gp = attrs["general_personality"]
    trait_scores: list[tuple[str, int]] = [
        ("high_assertiveness" if gp["assertiveness"] >= 60 else "low_assertiveness",
         abs(gp["assertiveness"] - 50)),
        ("high_agreeableness" if gp["agreeableness"] >= 60 else "low_agreeableness",
         abs(gp["agreeableness"] - 50)),
        ("high_neuroticism" if gp["neuroticism"] >= 60 else "low_neuroticism",
         abs(gp["neuroticism"] - 50)),
        ("high_impulsivity" if gp["impulsivity"] >= 60 else "low_impulsivity",
         abs(gp["impulsivity"] - 50)),
    ]
    # Pick top-2 most extreme traits
    trait_scores.sort(key=lambda t: t[1], reverse=True)
    parts = [random.choice(_TRAIT_SNIPPETS[trait_scores[0][0]]),
             random.choice(_TRAIT_SNIPPETS[trait_scores[1][0]])]
    return f"{parts[0].rstrip('.')}; {parts[1][0].lower()}{parts[1][1:].rstrip('.')}."


def _pick_description(name: str, age: int, role: str, attrs: dict) -> str:
    """Build a short background sentence."""
    phys = attrs["physical"]
    kp = attrs["knowledge_preparation"]

    if age < 12:
        return f"{name} is a {age}-year-old child, dependent on adults during emergencies."
    if age > 65:
        fitness = "limited mobility" if phys["mobility"] < 40 else "reasonably mobile for their age"
        return f"{name} is a {age}-year-old retiree with {fitness} and life experience."

    fitness_word = "fit" if phys["mobility"] >= 65 else "average fitness"
    training = "trained in emergencies" if kp["emergency_training"] >= 60 else "no formal emergency training"
    return f"{name} is a {age}-year-old {role} who is {fitness_word} with {training}."


# ── Attribute generation ──────────────────────────────────────────────────────

def _gauss_attr() -> int:
    return max(0, min(100, int(random.gauss(50, 18))))


def _gen_attributes(age: int) -> dict:
    """Generate all 8 attribute categories with age-based modifiers."""
    attrs = {
        "stress_response": {
            "panic_susceptibility": _gauss_attr(),
            "stress_tolerance": _gauss_attr(),
            "emotional_volatility": _gauss_attr(),
            "freeze_tendency": _gauss_attr(),
            "emotional_recovery_speed": _gauss_attr(),
        },
        "decision_making": {
            "decision_speed": _gauss_attr(),
            "situational_awareness": _gauss_attr(),
            "risk_taking": _gauss_attr(),
            "analytical_thinking": _gauss_attr(),
            "adaptability": _gauss_attr(),
            "creativity": _gauss_attr(),
        },
        "social_behavior": {
            "leadership": _gauss_attr(),
            "altruism": _gauss_attr(),
            "compliance": _gauss_attr(),
            "herding_tendency": _gauss_attr(),
            "cooperation": _gauss_attr(),
            "competitiveness": _gauss_attr(),
        },
        "general_personality": {
            "introversion": _gauss_attr(),
            "agreeableness": _gauss_attr(),
            "conscientiousness": _gauss_attr(),
            "neuroticism": _gauss_attr(),
            "openness_to_experience": _gauss_attr(),
            "assertiveness": _gauss_attr(),
            "stubbornness": _gauss_attr(),
            "optimism": _gauss_attr(),
            "impulsivity": _gauss_attr(),
        },
        "communication": {
            "vocal_tendency": _gauss_attr(),
            "persuasiveness": _gauss_attr(),
            "information_sharing": _gauss_attr(),
        },
        "emotional_psychological": {
            "empathy": _gauss_attr(),
            "self_preservation_drive": _gauss_attr(),
            "authority_trust": _gauss_attr(),
            "claustrophobia": _gauss_attr(),
            "prior_trauma": _gauss_attr(),
            "denial_tendency": _gauss_attr(),
        },
        "physical": {
            "mobility": _gauss_attr(),
            "strength": _gauss_attr(),
            "pain_tolerance": _gauss_attr(),
        },
        "knowledge_preparation": {
            "environment_familiarity": _gauss_attr(),
            "emergency_training": _gauss_attr(),
            "general_knowledge": _gauss_attr(),
        },
    }

    # ── Age-based modifiers ──
    def _clamp(v: float) -> int:
        return max(0, min(100, int(v)))

    if age < 12:
        attrs["physical"]["strength"] = _clamp(attrs["physical"]["strength"] * 0.2)
        attrs["physical"]["mobility"] = _clamp(attrs["physical"]["mobility"] * 0.8)
        attrs["social_behavior"]["leadership"] = _clamp(attrs["social_behavior"]["leadership"] * 0.15)
        attrs["social_behavior"]["compliance"] = _clamp(min(100, attrs["social_behavior"]["compliance"] * 1.4))
        attrs["social_behavior"]["herding_tendency"] = _clamp(min(100, attrs["social_behavior"]["herding_tendency"] * 1.3))
        attrs["knowledge_preparation"]["emergency_training"] = _clamp(attrs["knowledge_preparation"]["emergency_training"] * 0.1)
        attrs["knowledge_preparation"]["general_knowledge"] = _clamp(attrs["knowledge_preparation"]["general_knowledge"] * 0.2)
        attrs["decision_making"]["decision_speed"] = _clamp(attrs["decision_making"]["decision_speed"] * 0.3)
        attrs["decision_making"]["situational_awareness"] = _clamp(attrs["decision_making"]["situational_awareness"] * 0.3)
        attrs["stress_response"]["panic_susceptibility"] = _clamp(min(100, attrs["stress_response"]["panic_susceptibility"] * 1.5))
        attrs["stress_response"]["emotional_volatility"] = _clamp(min(100, attrs["stress_response"]["emotional_volatility"] * 1.5))

    elif age > 65:
        attrs["physical"]["mobility"] = _clamp(attrs["physical"]["mobility"] * 0.4)
        attrs["physical"]["strength"] = _clamp(attrs["physical"]["strength"] * 0.3)
        attrs["knowledge_preparation"]["general_knowledge"] = _clamp(min(100, attrs["knowledge_preparation"]["general_knowledge"] * 1.3))
        attrs["knowledge_preparation"]["environment_familiarity"] = _clamp(min(100, attrs["knowledge_preparation"]["environment_familiarity"] * 1.2))
        attrs["decision_making"]["analytical_thinking"] = _clamp(min(100, attrs["decision_making"]["analytical_thinking"] * 1.2))
        attrs["general_personality"]["conscientiousness"] = _clamp(min(100, attrs["general_personality"]["conscientiousness"] * 1.2))

    return attrs


# ── Main generator ────────────────────────────────────────────────────────────

def generate_profiles(
    n: int,
    grid_width: int = 10,
    grid_height: int = 10,
    door_position: tuple[int, int] = (9, 5),
    obstacles: list[tuple[int, int]] | None = None,
) -> tuple[list[dict], list[dict]]:
    """Generate *n* random but coherent profiles and matching agent configs.

    Returns:
        (profiles, agent_configs)
        - profiles: list of dicts matching ``profiles.json`` structure
        - agent_configs: list of dicts matching ``agents.yaml`` agent entries
    """
    if obstacles is None:
        obstacles = []

    blocked: set[tuple[int, int]] = {door_position} | set(obstacles)

    # Build unique names
    firsts = list(FIRST_NAMES)
    lasts = list(LAST_NAMES)
    random.shuffle(firsts)
    random.shuffle(lasts)
    names = [f"{firsts[i % len(firsts)]} {lasts[i % len(lasts)]}" for i in range(n)]

    # Build unique positions
    all_cells = [
        (x, y)
        for x in range(grid_width)
        for y in range(grid_height)
        if (x, y) not in blocked
    ]
    random.shuffle(all_cells)
    positions = all_cells[:n]

    roles = [random.choice(ROLES) for _ in range(n)]
    ages = [random.randint(8, 75) for _ in range(n)]

    profiles: list[dict] = []
    agent_configs: list[dict] = []

    for i in range(n):
        agent_id = f"agent_{i + 1:02d}"
        age = ages[i]
        role = roles[i]
        name = names[i]
        pos = positions[i]
        attrs = _gen_attributes(age)
        personality = _pick_personality(attrs)
        description = _pick_description(name, age, role, attrs)

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


def save_profiles(profiles: list[dict], path: str = "profiles.json") -> None:
    """Write profiles to disk in the expected ``{"profiles": [...]}`` format."""
    with open(path, "w") as f:
        json.dump({"profiles": profiles}, f, indent=2)


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Generate random agent profiles")
    parser.add_argument("--n", type=int, default=5, help="Number of agents")
    parser.add_argument("--grid-width", type=int, default=10)
    parser.add_argument("--grid-height", type=int, default=10)
    parser.add_argument("--door-x", type=int, default=9)
    parser.add_argument("--door-y", type=int, default=5)
    parser.add_argument("--output", default="profiles.json")
    args = parser.parse_args()

    profiles, agent_configs = generate_profiles(
        n=args.n,
        grid_width=args.grid_width,
        grid_height=args.grid_height,
        door_position=(args.door_x, args.door_y),
    )
    save_profiles(profiles, args.output)
    print(f"Generated {len(profiles)} profiles → {args.output}")
    for ac in agent_configs:
        print(f"  {ac['name']:20s}  {ac['role']:20s}  pos={ac['position']}")


if __name__ == "__main__":
    main()
