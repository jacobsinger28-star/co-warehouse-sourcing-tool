# VLM Site Assessment — Prompt Spec

Run once per property (top 200 by provisional score only). Inputs: up to 2 Street View
images (different headings) + 1 aerial image, plus parcel context (address, building SF,
year built). Cache results on disk keyed by apn — never re-call for the same images.

## Rules for the engineer
- Constrain output with the JSON schema below (use structured output / tool-use, not freeform).
- Reject and log any schema-invalid response. Never write a partial/invalid result to the DB.
- The model MUST be allowed to answer "not_visible" — a guess labeled as fact is worse
  than no answer. Every field carries its own confidence.
- Store the full raw JSON in site_observations.vlm_json alongside extracted columns.
- Include model_version on every row so audits can be tied to a prompt/model revision.

## System prompt (template)

You are assessing an industrial property from street-level and aerial photographs for an
acquisitions analyst. Report only what is visually observable in THESE images. If something
is not visible or you are unsure, answer "not_visible" — do not guess. Counting rule:
count only doors you can actually see; if part of the building is out of frame, set the
corresponding confidence to "low".

Context: {address}, reported building size {building_sf} SF, built {year_built}.

Definitions:
- dock-high door: loading door raised ~4 feet above grade, often with rubber bumpers or a
  metal leveler plate, designed so a semi-trailer floor meets the building floor.
- drive-in door: ground-level garage/roll-up door a vehicle can drive through.
- parking_fullness: share of marked/visible parking occupied by vehicles.
- divisibility: visual cues that the building could host multiple separate tenants —
  multiple entrances, separate door clusters, existing demising walls, multiple addresses.
- truck_access: whether a full-size semi-truck appears able to maneuver to the loading
  doors (look for apron/yard depth in the aerial; ~120 ft is comfortable).

Return ONLY JSON matching the schema.

## JSON schema

{
  "type": "object",
  "additionalProperties": false,
  "required": ["dock_doors_est","drive_ins_est","parking_fullness","signage_present",
               "condition","divisibility","truck_access","eave_height_band","notes"],
  "properties": {
    "dock_doors_est":   {"type":"object","properties":{
        "value":{"type":["integer","string"],"description":"count or 'not_visible'"},
        "confidence":{"enum":["high","medium","low"]}},
        "required":["value","confidence"]},
    "drive_ins_est":    {"type":"object","properties":{
        "value":{"type":["integer","string"]},
        "confidence":{"enum":["high","medium","low"]}},
        "required":["value","confidence"]},
    "parking_fullness": {"type":"object","properties":{
        "value":{"enum":["empty","sparse","moderate","full","not_visible"]},
        "confidence":{"enum":["high","medium","low"]}},
        "required":["value","confidence"]},
    "signage_present":  {"type":"object","properties":{
        "value":{"enum":["yes","no","not_visible"]},
        "confidence":{"enum":["high","medium","low"]}},
        "required":["value","confidence"]},
    "condition":        {"type":"object","properties":{
        "value":{"enum":["good","fair","poor","not_visible"]},
        "evidence":{"type":"string","description":"what you saw: roof patching, faded paint, broken pavement..."},
        "confidence":{"enum":["high","medium","low"]}},
        "required":["value","confidence"]},
    "divisibility":     {"type":"object","properties":{
        "value":{"enum":["single_box","some_separation","multi_entry","not_visible"]},
        "evidence":{"type":"string"},
        "confidence":{"enum":["high","medium","low"]}},
        "required":["value","confidence"]},
    "truck_access":     {"type":"object","properties":{
        "value":{"enum":["easy","tight","bad","not_visible"]},
        "confidence":{"enum":["high","medium","low"]}},
        "required":["value","confidence"]},
    "eave_height_band": {"type":"object","properties":{
        "value":{"enum":["under_16ft_likely","16ft_plus_likely","not_visible"]},
        "confidence":{"enum":["high","medium","low"]},
        "evidence":{"type":"string","description":"e.g. door height relative to people/vehicles, visible roofline"}},
        "required":["value","confidence"]},
    "notes": {"type":"string","description":"anything else acquisition-relevant: boarded windows, fencing damage, trailers parked long-term, adjacent vacancy"}
  }
}

## Audit protocol (day 7)
Founder + engineer review 25 random outputs against the source images. Track per-field
error rate (especially dock counts — the hallucination-prone field). One prompt iteration
allowed during the sprint. Record results in DATA_NOTES.md. Weekly 10% sample thereafter.
