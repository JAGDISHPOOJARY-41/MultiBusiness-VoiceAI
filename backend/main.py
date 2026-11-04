"""Voxly FastAPI backend.

The API keeps workflow state server-side and exposes provider-neutral browser
voice endpoints. Firestore is optional for local development; the in-memory
store is deliberately shaped like the documented collections.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Literal
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

load_dotenv()

app = FastAPI(title="Voxly AI API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

NOW = lambda: datetime.now(timezone.utc).isoformat()
STORE: dict[str, dict[str, dict[str, Any]]] = {name: {} for name in ("users", "businesses", "workflows", "customers", "conversations", "followups", "calendar_events", "appointments", "cakeOrders", "voice_calls", "missed_calls", "calendar_tokens")}

BUSINESSES = {
    "clinic": {"id": "clinic", "name": "Mangalore Smile Clinic", "type": "Clinic", "timezone": "Asia/Kolkata"},
    "cake": {"id": "cake", "name": "Sweet Crumbs Cake Shop", "type": "Cake Shop", "timezone": "Asia/Kolkata"},
}

WORKFLOWS: dict[str, dict[str, Any]] = {
    "clinic-appointment": {"id": "clinic-appointment", "business_id": "clinic", "name": "Clinic appointment", "intent": "book_appointment", "fields": [
        {"key": "doctor_or_specialty", "label": "Doctor or specialty", "question": "Which doctor or specialty would you like to see?", "required": True},
        {"key": "preferred_date", "label": "Preferred date", "question": "What date would you prefer?", "required": True},
        {"key": "preferred_time", "label": "Preferred time", "question": "What time would you prefer?", "required": True},
        {"key": "patient_name", "label": "Patient name", "question": "May I have the patient's name?", "required": True},
        {"key": "phone_number", "label": "Phone number", "question": "What phone number should we use for updates?", "required": True},
        {"key": "reason_for_visit", "label": "Reason for visit", "question": "Would you like to briefly share the reason for your visit?", "required": False},
    ]},
    "cake-order": {"id": "cake-order", "business_id": "cake", "name": "Cake order", "intent": "cake_order", "fields": [
        {"key": "cake_flavor", "label": "Cake flavor", "question": "Which cake flavor would you like?", "required": True},
        {"key": "cake_type", "label": "Cake type", "question": "What type of cake is this for?", "required": True},
        {"key": "weight_kg", "label": "Weight in kilograms", "question": "What weight would you like, in kilograms?", "required": True},
        {"key": "delivery_method", "label": "Delivery or pickup", "question": "Would you like delivery or pickup?", "required": True},
        {"key": "delivery_address", "label": "Delivery address", "question": "What address should we deliver it to?", "required": False},
        {"key": "required_date", "label": "Required date", "question": "When do you need the cake?", "required": True},
        {"key": "customer_name", "label": "Customer name", "question": "May I have your name?", "required": True},
        {"key": "phone_number", "label": "Phone number", "question": "What phone number should we use for updates?", "required": True},
    ]},
}

STORE["businesses"].update(BUSINESSES)
STORE["workflows"].update({workflow_id: workflow for workflow_id, workflow in WORKFLOWS.items()})
STORE["customers"].update({
    "customer_clinic_rahul": {"id": "customer_clinic_rahul", "business_id": "clinic", "name": "Rahul Mehta", "phone_number": "+919876543210", "interaction_count": 2},
    "customer_cake_priya": {"id": "customer_cake_priya", "business_id": "cake", "name": "Priya Nair", "phone_number": "+919988776655", "interaction_count": 1},
})


class ChatRequest(BaseModel):
    message: str = ""
    conversation_id: str | None = None
    workflow_id: str = "auto"
    business_id: str = "clinic"
    user_id: str = "demo-user"
    caller_phone: str | None = None
    collected_data: dict[str, Any] = Field(default_factory=dict)
    fields: dict[str, Any] = Field(default_factory=dict)
    current_field_key: str | None = None
    state: str = "collecting"
    history: list[dict[str, Any]] = Field(default_factory=list)
    language: str = "en"
    source: str = "voice"


class VoiceSessionRequest(BaseModel):
    call_id: str | None = None
    conversation_id: str | None = None
    caller_phone: str | None = None
    workflow_id: str = "auto"
    workflow_name: str | None = None
    status: str = "IN_PROGRESS"
    state: str = "collecting"
    collected_data: dict[str, Any] = Field(default_factory=dict)
    transcript: list[dict[str, Any]] = Field(default_factory=list)
    language: str = "en-IN"
    source: str = "browser"


class CallbackSettings(BaseModel):
    enabled: bool = True
    mode: Literal["after_hours", "during_hours", "always"] = "always"
    business_hours_start: str = "09:00"
    business_hours_end: str = "18:00"
    timezone: str = "Asia/Kolkata"


CALLBACK = CallbackSettings()
VOICE_SETTINGS: dict[str, Any] = {"enabled": True, "assistantName": "Maya", "language": "en-IN", "timezone": "Asia/Kolkata", "recordCalls": False, "transcript": True, "providers": {"speechToText": bool(os.getenv("STT_API_KEY")), "textToSpeech": bool(os.getenv("TTS_API_KEY")), "googleCalendar": bool(os.getenv("GOOGLE_CLIENT_ID"))}}


def language_key(language: str | None) -> str:
    return "hi" if str(language or "").lower().startswith("hi") else "en"


QUESTION_TRANSLATIONS = {
    "doctor_or_specialty": "आप किस डॉक्टर या विशेषज्ञ से मिलना चाहते हैं?",
    "preferred_date": "आप किस तारीख को अपॉइंटमेंट लेना चाहेंगे?",
    "preferred_time": "आप किस समय अपॉइंटमेंट लेना चाहेंगे?",
    "patient_name": "मरीज़ का नाम क्या है?",
    "phone_number": "अपडेट के लिए हम किस फ़ोन नंबर का उपयोग करें?",
    "reason_for_visit": "क्या आप अपनी विज़िट का कारण संक्षेप में बता सकते हैं?",
    "cake_flavor": "आपको कौन सा केक फ्लेवर चाहिए?",
    "cake_type": "यह केक किस अवसर के लिए है?",
    "weight_kg": "आपको कितने किलोग्राम का केक चाहिए?",
    "delivery_method": "आप डिलीवरी लेना चाहेंगे या पिकअप?",
    "delivery_address": "केक किस पते पर डिलीवर करना है?",
    "required_date": "आपको केक कब चाहिए?",
    "customer_name": "आपका नाम क्या है?",
}


def localized_question(field: dict[str, Any], language: str) -> str:
    return QUESTION_TRANSLATIONS.get(field["key"], field["question"]) if language_key(language) == "hi" else field["question"]


def init_firestore():
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
        if not firebase_admin._apps:
            if os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
                firebase_admin.initialize_app(credentials.Certificate(os.environ["GOOGLE_APPLICATION_CREDENTIALS"]))
            elif os.getenv("FIREBASE_CLIENT_EMAIL") and os.getenv("FIREBASE_PRIVATE_KEY"):
                firebase_admin.initialize_app(credentials.Certificate({"project_id": os.getenv("FIREBASE_PROJECT_ID"), "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"), "private_key": os.getenv("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")}))
            else:
                return None
        return firestore.client()
    except Exception:
        return None


FIRESTORE = init_firestore()


def persist(collection: str, document_id: str, value: dict[str, Any]) -> None:
    if FIRESTORE is not None:
        FIRESTORE.collection(collection).document(document_id).set(value, merge=True)


def firestore_items(collection: str) -> list[dict[str, Any]]:
    if FIRESTORE is None:
        return []
    return [{"id": document.id, **document.to_dict()} for document in FIRESTORE.collection(collection).stream()]


if FIRESTORE is not None:
    try:
        saved_callback = FIRESTORE.collection("callbackSettings").document("default").get()
        if saved_callback.exists:
            CALLBACK = CallbackSettings(**saved_callback.to_dict())
    except Exception:
        pass


def callback_is_active() -> bool:
    if not CALLBACK.enabled or CALLBACK.mode == "always":
        return CALLBACK.enabled
    try:
        local_now = datetime.now(ZoneInfo(CALLBACK.timezone)).time()
        start = datetime.strptime(CALLBACK.business_hours_start, "%H:%M").time()
        end = datetime.strptime(CALLBACK.business_hours_end, "%H:%M").time()
        during_hours = start <= local_now < end if start <= end else local_now >= start or local_now < end
        return during_hours if CALLBACK.mode == "during_hours" else not during_hours
    except Exception:
        return CALLBACK.enabled


def normalize_phone(value: str | None) -> str | None:
    if not value:
        return None
    digits = re.sub(r"\D", "", value)
    if digits.startswith("91") and len(digits) == 12:
        return f"+{digits}"
    if len(digits) == 10:
        return f"+91{digits}"
    return f"+{digits}" if digits else None


def normalize_workflow_fields(fields: dict[str, Any]) -> dict[str, Any]:
    """Accept field names from the earlier UI while keeping one canonical schema."""
    normalized = dict(fields or {})
    aliases = {
        "doctor_specialty": "doctor_or_specialty",
        "specialty": "doctor_or_specialty",
        "appointment_date": "preferred_date",
        "appointment_time": "preferred_time",
        "cake_flavour": "cake_flavor",
        "cake_weight": "weight_kg",
    }
    for old_key, new_key in aliases.items():
        if not normalized.get(new_key) and normalized.get(old_key):
            normalized[new_key] = normalized[old_key]
    return normalized


def verified_user_id(authorization: str | None) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        try:
            from firebase_admin import auth
            token = auth.verify_id_token(authorization.split(" ", 1)[1])
            return str(token["uid"])
        except Exception:
            pass
    return "demo-user"


def detect_workflow(message: str, requested: str, history: list[dict[str, Any]], business_id: str) -> dict[str, Any] | None:
    if requested in WORKFLOWS:
        return WORKFLOWS[requested]
    context = " ".join([message] + [str(item.get("text", "")) for item in history[-8:] if item.get("from") in ("user", "customer")]).lower()
    # Keep auto-detection broad enough to recognise an answer to the first
    # cake question.  For example, users commonly start with just
    # "chocolate" or "vanilla", which previously fell through to the generic
    # chooser and caused the same question to be repeated forever.
    if re.search(r"cake|flavo|chocolat|vanilla|strawberr|red velvet|butterscotch|black forest|pineapple|fruit|icing|bakery|pickup|delivery|kg|kilo|केक|चॉकलेट|वनीला|डिलीवरी|पिकअप", context):
        return WORKFLOWS["cake-order"]
    if re.search(r"clinic|appointment|doctor|dentist|dermatolog|patient|medical|checkup|क्लिनिक|अपॉइंटमेंट|डॉक्टर|दंत|मरीज़|मरीज|मेडिकल|जाँच", context):
        return WORKFLOWS["clinic-appointment"]
    return None


def extract_fields(text: str, workflow: dict[str, Any], current: dict[str, Any], current_key: str | None) -> dict[str, Any]:
    value = text.strip()
    lower = value.lower()
    data = dict(current)
    keys = {field["key"] for field in workflow["fields"]}

    def assign(key: str, result: Any) -> None:
        if key in keys and result not in (None, ""):
            data[key] = result

    named = re.search(r"(?:my name is|i am|i'm|this is)\s+([A-Za-z][A-Za-z .'-]{1,40}?)(?:[,!.?]|\s+(?:and|i want|i need|for|on|at)\b|$)", value, re.I)
    if named:
        assign("patient_name", named.group(1).strip())
        assign("customer_name", named.group(1).strip())
    phone = re.search(r"(?:\+?\d[\d\s().-]{8,}\d)", value)
    if phone:
        assign("phone_number", normalize_phone(phone.group(0)))
    relative_date = re.search(r"\b(today|tomorrow)\b", lower)
    if relative_date:
        relative_value = relative_date.group(1)
        assign("preferred_date", relative_value if "preferred_date" in keys else None)
        assign("required_date", relative_value if "required_date" in keys else None)
    if re.search(r"आज", value):
        assign("preferred_date", "today" if "preferred_date" in keys else None)
        assign("required_date", "today" if "required_date" in keys else None)
    elif re.search(r"कल", value):
        assign("preferred_date", "tomorrow" if "preferred_date" in keys else None)
        assign("required_date", "tomorrow" if "required_date" in keys else None)
    date = re.search(r"\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b", lower)
    if date:
        assign("preferred_date", date.group(0))
        assign("required_date", date.group(0))
    time = re.search(r"\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b", lower)
    if time:
        assign("preferred_time", time.group(0).replace(" ", ""))
    specialty = re.search(r"\b(dentist|doctor|orthodontist|implant(?:s)?|general dentistry|cleaning)\b", lower)
    if specialty:
        assign("doctor_or_specialty", specialty.group(1))
    flavor = re.search(r"\b(chocolate|vanilla|strawberry|red velvet|butterscotch|black forest|pineapple|fruit)\b", lower)
    if flavor:
        assign("cake_flavor", flavor.group(1))
    hindi_flavor = re.search(r"(चॉकलेट|वनीला|स्ट्रॉबेरी|रेड वेलवेट|बटरस्कॉच|ब्लैक फॉरेस्ट|पाइनएप्पल)", value)
    if hindi_flavor:
        assign("cake_flavor", hindi_flavor.group(1))
    cake_type = re.search(r"\b(birthday|wedding|anniversary|photo|custom|theme)\s*cake\b", lower)
    if cake_type:
        assign("cake_type", cake_type.group(0))
    weight = re.search(r"(\d+(?:\.\d+)?)\s*(?:kg|kilo|kilogram)", lower)
    if weight:
        assign("weight_kg", float(weight.group(1)))
    if re.search(r"\bpick\s*up|pickup\b|पिकअप", lower):
        assign("delivery_method", "pickup")
    elif re.search(r"delivery|deliver|home|डिलीवरी|डिलीवर|घर", lower):
        assign("delivery_method", "delivery")
    if current_key and current_key in keys and current_key not in data:
        field = next(field for field in workflow["fields"] if field["key"] == current_key)
        assign(current_key, value)
    if not any(key in data for key in ("patient_name", "customer_name")) and re.fullmatch(r"[A-Za-z][A-Za-z .'-]{1,40}", value):
        assign("patient_name", value)
        assign("customer_name", value)
    if "delivery_address" in keys and len(value) > 8 and re.search(r"road|street|avenue|layout|mangalore|address|near", lower):
        assign("delivery_address", value)
    if "reason_for_visit" in keys and re.search(r"pain|reason|because|tooth|checkup|visit", lower):
        assign("reason_for_visit", value)
    return data


def missing_fields(workflow: dict[str, Any], data: dict[str, Any]) -> list[str]:
    result = [field["key"] for field in workflow["fields"] if field["required"] and not data.get(field["key"])]
    if workflow["id"] == "cake-order" and data.get("delivery_method") == "delivery" and not data.get("delivery_address"):
        result.insert(0 if not result else result.index("required_date") if "required_date" in result else len(result), "delivery_address")
    return list(dict.fromkeys(result))


def is_yes(value: str) -> bool:
    return bool(re.fullmatch(r"\s*(yes|yeah|yep|okay|ok|confirm|confirmed|sure|please do|हाँ|हां|जी हाँ|जी हां|ठीक है|कर दीजिए)\s*[.!]?\s*", value, re.I))


def is_no(value: str) -> bool:
    return bool(re.fullmatch(r"\s*(no|nope|change|wrong|not now|नहीं|नही|बदलना है|अभी नहीं)\s*[.!]?\s*", value, re.I))


def priority_for(data: dict[str, Any]) -> str:
    return "URGENT" if str(data.get("required_date") or data.get("preferred_date", "")).lower() in {"today", "tomorrow"} else "NORMAL"


async def execute_action(workflow: dict[str, Any], data: dict[str, Any], user_id: str, language: str = "en") -> tuple[str, str]:
    if workflow["id"] == "clinic-appointment":
        appointment_id = f"apt_{uuid.uuid4().hex[:10]}"
        appointment = {"id": appointment_id, "user_id": user_id, "business_id": "clinic", **data, "status": "confirmed", "created_at": NOW(), "calendar_event_id": None}
        STORE["appointments"][appointment_id] = appointment
        persist("appointments", appointment_id, appointment)
        if language_key(language) == "hi":
            return "appointment_created", f"आपका अपॉइंटमेंट {data.get('preferred_date')} को {data.get('preferred_time')} बजे {data.get('doctor_or_specialty')} के साथ कन्फर्म हो गया है।"
        return "appointment_created", f"Your appointment has been confirmed for {data.get('preferred_date')} at {data.get('preferred_time')} with {data.get('doctor_or_specialty')}."
    if workflow["id"] == "cake-order":
        order_id = f"cake_{uuid.uuid4().hex[:10]}"
        order = {"id": order_id, "user_id": user_id, "business_id": "cake", **data, "status": "new", "priority": priority_for(data).lower(), "created_at": NOW()}
        STORE["cakeOrders"][order_id] = order
        persist("cakeOrders", order_id, order)
        if language_key(language) == "hi":
            return "cake_order_created", f"आपका केक ऑर्डर दर्ज हो गया है। आपका ऑर्डर आईडी {order_id} है।"
        return "cake_order_created", f"Your cake order has been recorded. Your order ID is {order_id}."
    return "completed", "काम पूरा हुआ। मैंने आपकी जानकारी सेव कर दी है।" if language_key(language) == "hi" else "Done. I have saved the details."


async def ai_extract_fields(message: str, workflow: dict[str, Any], collected: dict[str, Any]) -> dict[str, Any]:
    """Use OpenAI structured output when configured; deterministic extraction remains the fallback."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return collected
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=api_key)
        properties = {field["key"]: {"type": ["string", "number", "null"]} for field in workflow["fields"]}
        result = await client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o"),
            temperature=0,
            response_format={"type": "json_schema", "json_schema": {"name": "workflow_fields", "strict": True, "schema": {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}}},
            messages=[
                {"role": "system", "content": "Extract only values explicitly stated by the user. Map loose synonyms such as dentist to doctor_or_specialty, tomorrow at 4pm to preferred_date and preferred_time, and 2kg chocolate cake to weight_kg, cake_flavor, and cake_type. Never invent values."},
                {"role": "user", "content": json.dumps({"workflow": workflow["id"], "message": message, "already_collected": collected})},
            ],
        )
        parsed = json.loads(result.choices[0].message.content or "{}")
        return {**collected, **{key: value for key, value in parsed.items() if value not in (None, "")}}
    except Exception:
        return collected


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "service": "voxly-fastapi", "storage": "memory", "callback_enabled": callback_is_active()}


@app.get("/api/workflows")
async def list_workflows() -> list[dict[str, Any]]:
    return list(WORKFLOWS.values())


@app.post("/api/ai/chat")
async def chat(request: ChatRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    request.user_id = verified_user_id(authorization) if authorization else request.user_id
    language = language_key(request.language)
    workflow = detect_workflow(request.message, request.workflow_id, request.history, request.business_id)
    if workflow is None:
        conversation_id = request.conversation_id or f"conv_{uuid.uuid4().hex[:10]}"
        transcript = [{"speaker": "assistant" if item.get("from") == "ai" else "customer", "text": str(item.get("text", "")), "timestamp": item.get("timestamp") or NOW()} for item in request.history if item.get("text")]
        if request.message.strip() and (not transcript or transcript[-1]["text"].strip() != request.message.strip()):
            transcript.append({"speaker": "customer", "text": request.message.strip(), "timestamp": NOW()})
        reply = "नमस्ते! मैं क्लिनिक अपॉइंटमेंट बुक करने या केक ऑर्डर करने में आपकी मदद कर सकती हूँ। आप क्या करना चाहेंगे?" if language == "hi" else "Hello! I can help you book a clinic appointment or place a cake order. Which would you like to do?"
        transcript.append({"speaker": "assistant", "text": reply, "timestamp": NOW()})
        existing_record = STORE["conversations"].get(conversation_id, {})
        record = {"id": conversation_id, "user_id": request.user_id, "business_id": request.business_id, "service": "general", "source": request.source, "workflow_id": "auto", "workflow_name": "Choose a service", "collected_data": {}, "missing_fields": [], "current_field_key": None, "state": "collecting", "action_status": "choose_workflow", "priority": "NORMAL", "summary": reply, "transcript": transcript, "started_at": existing_record.get("started_at", NOW()), "updated_at": NOW()}
        STORE["conversations"][conversation_id] = {**existing_record, **record}
        persist("conversations", conversation_id, STORE["conversations"][conversation_id])
        return {"conversation_id": conversation_id, "workflow_id": "auto", "workflow_name": "Choose a service", "workflow_fields": [], "intent": "choose_service", "assistant_reply": reply, "extracted_fields": {}, "collected_data": {}, "missing_fields": [], "current_field_key": None, "completed_fields": [], "state": "collecting", "action_required": "choose_workflow", "action_status": "choose_workflow", "is_complete": False, "priority": "NORMAL"}
    collected = normalize_workflow_fields(request.collected_data or request.fields)
    captured = normalize_phone(request.caller_phone)
    if captured and not collected.get("phone_number"):
        collected["phone_number"] = captured
    collected = extract_fields(request.message, workflow, collected, request.current_field_key)
    collected = await ai_extract_fields(request.message, workflow, collected)
    missing = missing_fields(workflow, collected)
    action = "ask_for_field"
    status = "collecting"
    action_status = "collecting"
    if request.state == "awaiting_confirmation" and is_yes(request.message):
        action_status, reply = await execute_action(workflow, collected, request.user_id, language)
        status, action = "completed", "perform_action"
        missing = []
    elif request.state == "awaiting_confirmation" and is_no(request.message):
        reply, status, action, action_status = ("कोई बात नहीं। आप कौन सी जानकारी बदलना चाहते हैं?" if language == "hi" else "No problem. Which detail would you like to change?"), "collecting", "edit_details", "editing"
    elif missing:
        next_field = next(field for field in workflow["fields"] if field["key"] == missing[0])
        reply, action, action_status = localized_question(next_field, language), "ask_for_field", "collecting"
    else:
        summary = ", ".join(f"{key.replace('_', ' ')}: {value}" for key, value in collected.items() if key != "phone_number")
        reply, status, action, action_status = ((f"मेरे पास ये जानकारी है: {summary}। क्या मैं इसकी पुष्टि कर दूँ?" if language == "hi" else f"I have these details: {summary}. Should I confirm this?"), "awaiting_confirmation", "ask_confirmation", "pending_confirmation")
    conversation_id = request.conversation_id or f"conv_{uuid.uuid4().hex[:10]}"
    transcript = [{"speaker": "assistant" if item.get("from") == "ai" else "customer", "text": str(item.get("text", "")), "timestamp": item.get("timestamp") or NOW()} for item in request.history if item.get("text")]
    if request.message.strip() and (not transcript or transcript[-1]["text"].strip() != request.message.strip()):
        transcript.append({"speaker": "customer", "text": request.message.strip(), "timestamp": NOW()})
    transcript.append({"speaker": "assistant", "text": reply, "timestamp": NOW()})
    existing_record = STORE["conversations"].get(conversation_id, {})
    record = {"id": conversation_id, "user_id": request.user_id, "business_id": workflow["business_id"], "service": "clinic" if workflow["id"] == "clinic-appointment" else "cake_shop", "source": request.source, "workflow_id": workflow["id"], "workflow_name": workflow["name"], "collected_data": collected, "missing_fields": missing, "current_field_key": missing[0] if missing else None, "state": status, "action_status": action_status, "priority": priority_for(collected), "summary": reply, "transcript": transcript, "started_at": existing_record.get("started_at", NOW()), "ended_at": NOW() if status == "completed" else existing_record.get("ended_at"), "updated_at": NOW()}
    STORE["conversations"][conversation_id] = {**existing_record, **record}
    persist("conversations", conversation_id, STORE["conversations"][conversation_id])
    return {"conversation_id": conversation_id, "workflow_id": workflow["id"], "workflow_name": workflow["name"], "workflow_fields": workflow["fields"], "intent": workflow["intent"], "assistant_reply": reply, "extracted_fields": collected, "collected_data": collected, "missing_fields": missing, "current_field_key": record["current_field_key"], "completed_fields": [key for key, value in collected.items() if value], "state": status, "action_required": action, "action_status": action_status, "is_complete": status == "completed", "priority": priority_for(collected)}


@app.get("/api/callback-settings")
async def get_callback_settings() -> CallbackSettings:
    return CALLBACK


@app.get("/api/voice/settings")
async def get_voice_settings() -> dict[str, Any]:
    return VOICE_SETTINGS


@app.put("/api/voice/settings")
async def update_voice_settings(payload: dict[str, Any]) -> dict[str, Any]:
    VOICE_SETTINGS.update({key: value for key, value in payload.items() if key != "providers"})
    return VOICE_SETTINGS


@app.put("/api/callback-settings")
async def update_callback_settings(settings: CallbackSettings) -> CallbackSettings:
    global CALLBACK
    CALLBACK = settings
    persist("callbackSettings", "default", settings.model_dump())
    return CALLBACK


@app.get("/api/analytics")
async def analytics() -> dict[str, Any]:
    conversations = list(STORE["conversations"].values())
    return {"total_conversations": len(conversations), "completed_workflows": sum(item.get("state") == "completed" for item in conversations), "urgent_requests": sum(item.get("priority") == "URGENT" for item in conversations), "generated_at": NOW()}


@app.get("/api/calendar/availability")
async def calendar_availability(start: str = "", end: str = "") -> dict[str, Any]:
    return {"available": True, "busy": [], "start": start, "end": end, "mode": "local_simulation"}


@app.post("/api/calendar/availability")
async def calendar_availability_post(payload: dict[str, Any]) -> dict[str, Any]:
    return await calendar_availability(str(payload.get("start", "")), str(payload.get("end", "")))


@app.post("/api/calendar/events")
async def create_calendar_event(payload: dict[str, Any]) -> dict[str, Any]:
    return await create_collection_item("calendar_events", {**payload, "source": "local_simulation"})


@app.get("/api/calendar/auth-url")
async def calendar_auth_url() -> dict[str, str]:
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI")
    if not client_id or not redirect_uri:
        raise HTTPException(503, "Set GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI before connecting Google Calendar")
    query = urlencode({"client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code", "access_type": "offline", "prompt": "consent", "scope": "https://www.googleapis.com/auth/calendar"})
    return {"url": f"https://accounts.google.com/o/oauth2/v2/auth?{query}"}


@app.get("/api/calendar/oauth/callback")
async def calendar_oauth_callback(code: str = "") -> dict[str, Any]:
    if not code or not os.getenv("GOOGLE_CLIENT_ID") or not os.getenv("GOOGLE_CLIENT_SECRET") or not os.getenv("GOOGLE_REDIRECT_URI"):
        raise HTTPException(400, "Google Calendar OAuth is not configured")
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post("https://oauth2.googleapis.com/token", data={"code": code, "client_id": os.environ["GOOGLE_CLIENT_ID"], "client_secret": os.environ["GOOGLE_CLIENT_SECRET"], "redirect_uri": os.environ["GOOGLE_REDIRECT_URI"], "grant_type": "authorization_code"})
    if response.status_code >= 400:
        raise HTTPException(502, "Google OAuth token exchange failed")
    token_data = response.json()
    token_id = "default"
    STORE["calendar_tokens"][token_id] = {"id": token_id, "refresh_token": token_data.get("refresh_token"), "scope": token_data.get("scope"), "created_at": NOW()}
    persist("calendarTokens", token_id, STORE["calendar_tokens"][token_id])
    return {"connected": True, "has_refresh_token": bool(token_data.get("refresh_token")), "message": "Google Calendar connected for this backend session."}


def collection_route(name: str):
    async def list_items() -> list[dict[str, Any]]:
        return firestore_items(name) or list(STORE[name].values())
    return list_items


async def create_collection_item(name: str, payload: dict[str, Any]) -> dict[str, Any]:
    item_id = payload.get("id") or f"{name.rstrip('s')}_{uuid.uuid4().hex[:10]}"
    item = {"id": item_id, **payload, "created_at": payload.get("created_at", NOW()), "updated_at": NOW()}
    STORE[name][item_id] = item
    persist(name, item_id, item)
    return item


def create_collection_route(name: str):
    async def handler(payload: dict[str, Any]) -> dict[str, Any]:
        return await create_collection_item(name, payload)
    return handler


for _name in ("businesses", "workflows", "customers", "conversations", "followups", "calendar_events", "appointments", "cakeOrders"):
    app.add_api_route(f"/api/{_name}", collection_route(_name), methods=["GET"], name=f"list_{_name}")
    app.add_api_route(f"/api/{_name}", create_collection_route(_name), methods=["POST"], name=f"create_{_name}", response_model=dict[str, Any])


@app.get("/api/{collection}/{item_id}")
async def get_collection_item(collection: str, item_id: str) -> Any:
    if collection == "voice" and item_id == "calls":
        return list(STORE["voice_calls"].values())
    if collection == "voice" and item_id == "missed-calls":
        return list(STORE["missed_calls"].values())
    if collection not in STORE:
        raise HTTPException(404, "Collection not found")
    item = STORE[collection].get(item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    return item


@app.put("/api/{collection}/{item_id}")
async def update_collection_item(collection: str, item_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if collection not in STORE:
        raise HTTPException(404, "Collection not found")
    item = {**STORE[collection].get(item_id, {"id": item_id}), **payload, "id": item_id, "updated_at": NOW()}
    STORE[collection][item_id] = item
    return item


@app.delete("/api/{collection}/{item_id}")
async def delete_collection_item(collection: str, item_id: str) -> dict[str, bool]:
    if collection not in STORE:
        raise HTTPException(404, "Collection not found")
    STORE[collection].pop(item_id, None)
    return {"ok": True}


@app.get("/api/voice/calls")
async def voice_calls() -> list[dict[str, Any]]:
    return list(STORE["voice_calls"].values())


@app.get("/api/voice/missed-calls")
async def missed_calls() -> list[dict[str, Any]]:
    return list(STORE["missed_calls"].values())


@app.post("/api/voice/sessions")
async def create_voice_session(payload: VoiceSessionRequest) -> dict[str, Any]:
    call_id = payload.call_id or f"browser_{uuid.uuid4().hex[:10]}"
    session = {
        "id": call_id,
        "call_id": call_id,
        "source": payload.source,
        "caller_phone": normalize_phone(payload.caller_phone),
        "conversation_id": payload.conversation_id,
        "workflow_id": payload.workflow_id,
        "workflow_name": payload.workflow_name,
        "status": payload.status,
        "current_state": payload.state,
        "language": payload.language,
        "collected_data": payload.collected_data,
        "transcript": payload.transcript,
        "started_at": NOW(),
        "updated_at": NOW(),
    }
    STORE["voice_calls"][call_id] = session
    persist("voiceCalls", call_id, session)
    return session


@app.put("/api/voice/sessions/{call_id}")
async def update_voice_session(call_id: str, payload: VoiceSessionRequest) -> dict[str, Any]:
    current = STORE["voice_calls"].get(call_id, {"id": call_id, "call_id": call_id, "source": "browser", "started_at": NOW()})
    update = payload.model_dump(exclude_none=True)
    update.pop("call_id", None)
    update["caller_phone"] = normalize_phone(payload.caller_phone) if payload.caller_phone else current.get("caller_phone")
    update["current_state"] = payload.state
    update["updated_at"] = NOW()
    current.update(update)
    STORE["voice_calls"][call_id] = current
    persist("voiceCalls", call_id, current)
    return current


@app.post("/api/voice/incoming")
async def voice_incoming(payload: dict[str, Any]) -> dict[str, Any]:
    call_id = str(payload.get("call_id") or f"call_{uuid.uuid4().hex[:10]}")
    call = {"id": call_id, **payload, "status": "RINGING", "started_at": NOW(), "callback_enabled": callback_is_active()}
    STORE["voice_calls"][call_id] = call
    persist("voiceCalls", call_id, call)
    return {"ok": True, "call_id": call_id, "callback_enabled": callback_is_active()}


@app.post("/api/voice/status")
async def voice_status(payload: dict[str, Any]) -> dict[str, Any]:
    call_id = str(payload.get("call_id") or payload.get("id") or "")
    status = str(payload.get("status") or "IN_PROGRESS").upper()
    current = STORE["voice_calls"].get(call_id, {"id": call_id})
    current.update(payload, status=status, updated_at=NOW())
    STORE["voice_calls"][call_id] = current
    persist("voiceCalls", call_id, current)
    if status in {"MISSED", "NOANSWER", "NO_ANSWER"}:
        active = callback_is_active()
        missed = {"id": f"missed_{uuid.uuid4().hex[:10]}", "call_id": call_id, "caller_phone": current.get("caller_phone") or payload.get("from"), "status": "MISSED", "callback_status": "queued" if active else "paused", "created_at": NOW()}
        STORE["missed_calls"][missed["id"]] = missed
        persist("missedCalls", missed["id"], missed)
    return {"ok": True, "call_id": call_id, "status": status, "callback_triggered": status in {"MISSED", "NOANSWER", "NO_ANSWER"} and callback_is_active()}


@app.post("/api/voice/simulate")
async def simulate_voice(audio: UploadFile = File(...), conversation_id: str | None = Form(None), workflow_id: str = Form("auto"), fields: str = Form("{}"), state: str = Form("collecting"), caller_phone: str = Form(""), language: str = Form("en-IN")) -> dict[str, Any]:
    """Transcribe browser-recorded audio server-side and run one workflow turn."""
    provider = os.getenv("STT_PROVIDER", "").lower()
    api_key = os.getenv("STT_API_KEY", "")
    if provider != "deepgram" or not api_key:
        raise HTTPException(503, "Server-side STT is not configured. Set STT_PROVIDER=deepgram and STT_API_KEY.")
    content = await audio.read()
    async with httpx.AsyncClient(timeout=60) as client:
        stt_language = "hi" if language_key(language) == "hi" else "en-IN"
        response = await client.post(f"https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&language={stt_language}", headers={"Authorization": f"Token {api_key}", "Content-Type": audio.content_type or "audio/webm"}, content=content)
    if response.status_code >= 400:
        raise HTTPException(502, "Speech-to-text provider failed")
    transcript = response.json().get("results", {}).get("channels", [{}])[0].get("alternatives", [{}])[0].get("transcript", "").strip()
    if not transcript:
        raise HTTPException(422, "No speech was detected")
    import json
    try:
        submitted_fields = json.loads(fields)
    except json.JSONDecodeError as error:
        raise HTTPException(422, "Voice session fields must be valid JSON") from error
    result = await chat(ChatRequest(message=transcript, conversation_id=conversation_id, workflow_id=workflow_id, fields=submitted_fields, state=state, caller_phone=caller_phone or None, language=language))
    result["transcript"] = transcript
    return result


@app.post("/api/voice/synthesize")
async def synthesize_voice(text: str = Form(...), language: str = Form("en-IN")) -> Response:
    if os.getenv("TTS_PROVIDER", "").lower() != "elevenlabs" or not os.getenv("TTS_API_KEY"):
        raise HTTPException(503, "Server-side TTS is not configured. Set TTS_PROVIDER=elevenlabs and TTS_API_KEY.")
    voice_id = os.getenv("TTS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128", headers={"xi-api-key": os.environ["TTS_API_KEY"], "Content-Type": "application/json"}, json={"text": text, "model_id": os.getenv("TTS_MODEL", "eleven_multilingual_v2")})
    if response.status_code >= 400:
        raise HTTPException(502, "Text-to-speech provider failed")
    return Response(content=response.content, media_type="audio/mpeg")
