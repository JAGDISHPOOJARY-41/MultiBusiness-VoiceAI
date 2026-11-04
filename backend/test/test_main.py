from main import WORKFLOWS, extract_fields, missing_fields, normalize_phone, priority_for


def test_pre_captured_phone_is_normalized():
    assert normalize_phone("98765 43210") == "+919876543210"


def test_clinic_synonyms_fill_next_fields():
    workflow = WORKFLOWS["clinic-appointment"]
    data = extract_fields("I need a dentist appointment tomorrow at 4 pm", workflow, {"patient_name": "Rahul", "phone_number": "+919876543210"}, None)
    assert data["doctor_or_specialty"] == "dentist"
    assert data["preferred_date"] == "tomorrow"
    assert data["preferred_time"] == "4pm"
    assert missing_fields(workflow, data) == []


def test_cake_order_extracts_weight_flavor_and_urgent_priority():
    workflow = WORKFLOWS["cake-order"]
    data = extract_fields("2kg chocolate birthday cake for tomorrow, pickup", workflow, {"phone_number": "+919876543210"}, None)
    assert data["weight_kg"] == 2.0
    assert data["cake_flavor"] == "chocolate"
    assert data["delivery_method"] == "pickup"
    assert priority_for({**data, "required_date": "tomorrow"}) == "URGENT"
