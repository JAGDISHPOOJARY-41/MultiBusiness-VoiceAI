const monthNames = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

const businessInfo = {
  clinic: { id: 'clinic', name: 'Mangalore Smile Clinic', type: 'Clinic', phone: '+91 824 222 4567', address: '18, MG Road, Mangalore, Karnataka 575001', hours: 'Monday to Saturday, 9:00 AM to 6:00 PM', specialties: ['General Dentistry', 'Dentist', 'Orthodontics', 'Implants'] },
  cake: { id: 'cake', name: 'Sweet Crumbs Cake Shop', type: 'Cake Shop', phone: '+91 824 222 7788', address: '12, Market Road, Mangalore, Karnataka 575001', hours: 'Monday to Sunday, 10:00 AM to 8:00 PM', flavors: ['Chocolate', 'Vanilla', 'Strawberry', 'Red Velvet', 'Butterscotch', 'Black Forest'] },
};

const workflows = {
  'clinic-appointment': { id: 'clinic-appointment', businessId: 'clinic', businessName: businessInfo.clinic.name, name: 'Clinic - Book Appointment', assistant: 'Maya', intent: 'book_appointment', fields: [
    ['patient_name', 'Patient name', 'May I know your name?', 'text', true], ['phone_number', 'Phone number', 'May I have your phone number?', 'phone', true], ['doctor_specialty', 'Doctor / specialty', 'Which doctor or specialty would you like to see?', 'text', true], ['appointment_date', 'Appointment date', 'What date would you prefer for the appointment?', 'date', true], ['appointment_time', 'Appointment time', 'What time would you prefer?', 'time', true], ['reason_for_visit', 'Reason for visit', 'Would you like to briefly tell me the reason for your visit?', 'text', false],
  ] },
  'clinic-reschedule': { id: 'clinic-reschedule', businessId: 'clinic', businessName: businessInfo.clinic.name, name: 'Clinic - Reschedule Appointment', assistant: 'Maya', intent: 'reschedule_appointment', fields: [
    ['patient_name', 'Patient name', 'May I know your name?', 'text', true], ['phone_number', 'Phone number', 'May I have your phone number?', 'phone', true], ['existing_date', 'Current appointment date', 'What date is your current appointment?', 'date', true], ['existing_time', 'Current appointment time', 'What time is your current appointment?', 'time', true], ['new_date', 'New date', 'What new date would you prefer?', 'date', true], ['new_time', 'New time', 'What new time would you prefer?', 'time', true],
  ] },
  'clinic-cancel': { id: 'clinic-cancel', businessId: 'clinic', businessName: businessInfo.clinic.name, name: 'Clinic - Cancel Appointment', assistant: 'Maya', intent: 'cancel_appointment', fields: [
    ['patient_name', 'Patient name', 'May I know your name?', 'text', true], ['phone_number', 'Phone number', 'May I have your phone number?', 'phone', true], ['appointment_date', 'Appointment date', 'What date is your appointment?', 'date', true], ['appointment_time', 'Appointment time', 'What time is your appointment?', 'time', true],
  ] },
  'clinic-enquiry': { id: 'clinic-enquiry', businessId: 'clinic', businessName: businessInfo.clinic.name, name: 'Clinic - Appointment Enquiry', assistant: 'Maya', intent: 'appointment_enquiry', fields: [] },
  'cake-order': { id: 'cake-order', businessId: 'cake', businessName: businessInfo.cake.name, name: 'Cake Shop - Place Cake Order', assistant: 'Maya', intent: 'cake_order', fields: [
    ['customer_name', 'Customer name', 'May I know your name?', 'text', true], ['phone_number', 'Phone number', 'May I have your phone number?', 'phone', true], ['cake_type', 'Cake type', 'What type of cake would you like?', 'text', true], ['cake_flavour', 'Cake flavour', 'Which flavour would you like?', 'text', true], ['cake_weight', 'Cake weight', 'What cake weight would you like?', 'text', true], ['required_date', 'Required date', 'When do you need the cake?', 'date', true], ['custom_message', 'Cake message', 'Would you like any message written on the cake?', 'text', false], ['delivery_method', 'Delivery or pickup', 'Would you like delivery or pickup?', 'select', true], ['delivery_address', 'Delivery address', 'What address should we deliver the cake to?', 'address', false], ['budget', 'Budget', 'Do you have a preferred budget?', 'number', false],
  ] },
  'cake-custom': { id: 'cake-custom', businessId: 'cake', businessName: businessInfo.cake.name, name: 'Cake Shop - Custom Cake Enquiry', assistant: 'Maya', intent: 'custom_cake_enquiry', fields: [
    ['customer_name', 'Customer name', 'May I know your name?', 'text', true], ['phone_number', 'Phone number', 'May I have your phone number?', 'phone', true], ['cake_theme', 'Cake theme', 'What theme would you like?', 'text', true], ['cake_flavour', 'Cake flavour', 'Which flavour would you like?', 'text', true], ['cake_weight', 'Cake weight', 'What cake weight would you like?', 'text', false], ['required_date', 'Required date', 'When do you need the cake?', 'date', true], ['custom_design_description', 'Design description', 'Please describe the custom design.', 'text', true], ['budget', 'Budget', 'Do you have a preferred budget?', 'number', false], ['delivery_method', 'Delivery or pickup', 'Would you like delivery or pickup?', 'select', true], ['delivery_address', 'Delivery address', 'What address should we deliver the cake to?', 'address', false],
  ] },
  'cake-status': { id: 'cake-status', businessId: 'cake', businessName: businessInfo.cake.name, name: 'Cake Shop - Order Status', assistant: 'Maya', intent: 'order_status', fields: [['phone_number', 'Phone number', 'May I have the phone number used for the order?', 'phone', true], ['order_id', 'Order ID', 'What is your order ID?', 'text', true], ['customer_name', 'Customer name', 'May I know your name?', 'text', true]] },
  'cake-enquiry': { id: 'cake-enquiry', businessId: 'cake', businessName: businessInfo.cake.name, name: 'Cake Shop - Availability Enquiry', assistant: 'Maya', intent: 'cake_enquiry', fields: [] },
};

function fieldsFor(workflow) { return workflow.fields.map(([key, label, question, type, required]) => ({ key, label, question, type, required })); }
function publicWorkflow(workflow) { return { ...workflow, fields: fieldsFor(workflow) }; }

function detectWorkflow(message, requested = 'auto', history = []) {
  if (requested && requested !== 'auto' && workflows[requested]) return requested;
  const context = [message, ...(history || []).slice(-8).map((item) => item.text)].join(' ').toLowerCase();
  const cake = /cake|flavou?r|icing|bake|bakery|pickup|pick up|delivery|kg|kilo|order id|red velvet/.test(context);
  if (cake) {
    if (/status|where is|track|order id|prepared|ready/.test(context)) return 'cake-status';
    if (/custom|theme|design|barbie|fondant/.test(context)) return 'cake-custom';
    if (/available|availability|price|flavours|sizes|timing|location|do you have|is .* available/.test(context) && !/want|need|order|buy/.test(context)) return 'cake-enquiry';
    return 'cake-order';
  }
  if (/reschedule|change.*appointment|move.*appointment/.test(context)) return 'clinic-reschedule';
  if (/cancel.*appointment|cancel my/.test(context)) return 'clinic-cancel';
  if (/timing|hours|specialties|where|location|do you have a dentist|how can i book/.test(context) && !/book|appointment/.test(context)) return 'clinic-enquiry';
  return 'clinic-appointment';
}

function normalizeDate(value) {
  const text = String(value).trim().toLowerCase();
  const now = new Date();
  if (text === 'today') return now.toISOString().slice(0, 10);
  if (text === 'tomorrow') { const date = new Date(now); date.setDate(date.getDate() + 1); return date.toISOString().slice(0, 10); }
  const numeric = text.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
  if (numeric) { const year = Number(numeric[3] || now.getFullYear()); const fullYear = year < 100 ? 2000 + year : year; return `${fullYear}-${String(numeric[2]).padStart(2, '0')}-${String(numeric[1]).padStart(2, '0')}`; }
  const named = text.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{2,4}))?$/);
  if (named && monthNames[named[2]] !== undefined) { const year = Number(named[3] || now.getFullYear()); const fullYear = year < 100 ? 2000 + year : year; return `${fullYear}-${String(monthNames[named[2]] + 1).padStart(2, '0')}-${String(named[1]).padStart(2, '0')}`; }
  const reverseNamed = text.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{2,4}))?$/);
  if (reverseNamed && monthNames[reverseNamed[1]] !== undefined) { const year = Number(reverseNamed[3] || now.getFullYear()); const fullYear = year < 100 ? 2000 + year : year; return `${fullYear}-${String(monthNames[reverseNamed[1]] + 1).padStart(2, '0')}-${String(reverseNamed[2]).padStart(2, '0')}`; }
  return value;
}

function normalizeTime(value) {
  const match = String(value).toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!match) return value;
  let hours = Number(match[1]); const minutes = match[2] || '00';
  if (match[3] === 'pm' && hours < 12) hours += 12;
  if (match[3] === 'am' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${minutes}`;
}

function extractData(text, current, workflow, currentFieldKey, history = []) {
  const value = String(text || '').trim(); const lower = value.toLowerCase(); const data = { ...(current || {}) };
  const assign = (key, val) => { if (workflow.fields.some(([field]) => field === key) && val !== undefined && val !== '') data[key] = val; };
  const name = value.match(/(?:my name is|i am|i'm|this is)\s+([a-z][a-z .'-]{1,40}?)(?=,|\.|!|\?|\s+and\s+|\s+i want|\s+i need|\s+on\s+|\s+for\s+|\s+at\s+|$)/i);
  if (name) assign(workflow.businessId === 'cake' ? 'customer_name' : 'patient_name', name[1].trim().replace(/[.,]$/, ''));
  const phone = value.match(/(?:\+?\d[\d\s().-]{8,}\d)/); if (phone) assign('phone_number', phone[0].replace(/\s+/g, ' ').trim());
  const dateMatch = lower.match(/\b(?:today|tomorrow|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?|\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{2,4})?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{2,4})?)\b/);
  if (dateMatch) { assign('appointment_date', normalizeDate(dateMatch[0])); assign('existing_date', normalizeDate(dateMatch[0])); assign('new_date', normalizeDate(dateMatch[0])); assign('required_date', normalizeDate(dateMatch[0])); }
  const timeMatch = lower.match(/(?:at|around|by|for)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/) || lower.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/); if (timeMatch) { assign('appointment_time', normalizeTime(timeMatch[1])); assign('existing_time', normalizeTime(timeMatch[1])); assign('new_time', normalizeTime(timeMatch[1])); }
  if (/dentist|doctor|orthodontist|implant|general dentistry|cleaning/.test(lower)) assign('doctor_specialty', (lower.match(/dentist|doctor|orthodontist|implant specialist|general dentistry|cleaning/) || [])[0]);
  const flavor = lower.match(/\b(chocolate|vanilla|strawberry|red velvet|butterscotch|black forest|pineapple|fruit)\b/); if (flavor) assign('cake_flavour', flavor[1]);
  const type = lower.match(/\b(birthday cake|wedding cake|anniversary cake|photo cake|custom cake|theme cake)\b/); if (type) assign('cake_type', type[1]);
  const weight = lower.match(/(\d+(?:\.\d+)?)\s*(kg|kilo|kilos|kilogram|kilograms|lb|pound|pounds)/); if (weight) assign('cake_weight', `${weight[1]} ${weight[2]}`);
  const order = value.match(/(?:order\s*(?:id|no|number)?|#)\s*([A-Za-z0-9-]{3,})/i); if (order) assign('order_id', order[1]);
  if (/pick\s*up|pickup/.test(lower)) assign('delivery_method', 'pickup'); else if (/delivery|deliver|home/.test(lower)) assign('delivery_method', 'delivery');
  const theme = lower.match(/(?:theme|themed|design)\s*(?:is|:)?\s*([a-z][a-z -]{2,30})/); if (theme) assign('cake_theme', theme[1].trim());
  if (currentFieldKey && workflow.fields.some(([key]) => key === currentFieldKey) && !data[currentFieldKey]) {
    const field = workflow.fields.find(([key]) => key === currentFieldKey);
    if (field[3] === 'date') data[currentFieldKey] = normalizeDate(value);
    else if (field[3] === 'time') data[currentFieldKey] = normalizeTime(value);
    else if (field[3] === 'phone') data[currentFieldKey] = value.replace(/\s+/g, ' ').trim();
    else if (field[3] === 'select' && /delivery|pickup|pick up/i.test(value)) data[currentFieldKey] = /delivery/i.test(value) ? 'delivery' : 'pickup';
    else if (field[3] !== 'number' || /\d/.test(value)) data[currentFieldKey] = value;
  }
  const reason = value.match(/(?:because|reason is|for)\s+(.{3,80})$/i);
  if (reason) assign('reason_for_visit', reason[1].trim().replace(/[.!?]$/, ''));
  const lastAssistant = [...history].reverse().find((item) => item.from === 'ai');
  if (lastAssistant) {
    const question = (lastAssistant.text || '').toLowerCase();
    const nameKey = workflow.businessId === 'cake' ? 'customer_name' : 'patient_name';
    if (!data[nameKey] && /your name|know your name/.test(question) && /^[a-z][a-z .'-]{1,40}$/i.test(value)) assign(nameKey, value);
    if (!data.doctor_specialty && /specialty|doctor/.test(question) && value.length < 50) assign('doctor_specialty', value);
    if (!data.cake_flavour && /flavou?r/.test(question) && value.length < 40) assign('cake_flavour', value);
    if (!data.delivery_method && /delivery or pickup|pickup or delivery/.test(question)) assign('delivery_method', /delivery/i.test(value) ? 'delivery' : 'pickup');
    if (!data.delivery_address && /address/.test(question) && value.length > 5) assign('delivery_address', value);
  }
  return data;
}

function buildState(workflow, data, currentFieldKey) {
  const required = workflow.fields.filter(([, , , , isRequired]) => isRequired);
  const requiredKeys = required.map(([key]) => key);
  if (workflow.businessId === 'cake' && data.delivery_method === 'delivery' && workflow.fields.some(([key]) => key === 'delivery_address')) requiredKeys.push('delivery_address');
  const completedFields = Object.keys(data).filter((key) => data[key] !== undefined && data[key] !== '');
  const missingFields = requiredKeys.filter((key) => !data[key]);
  const next = missingFields[0] || null;
  return { completedFields, missingFields, currentFieldKey: next || currentFieldKey || null };
}

function replyFor(workflow, data, state, intent) {
  if (workflow.id === 'clinic-enquiry') return { reply: `Here is what I can confirm for ${businessInfo.clinic.name}: we are open ${businessInfo.clinic.hours}. We offer ${businessInfo.clinic.specialties.join(', ')}. We are at ${businessInfo.clinic.address}. Would you like to book an appointment?`, action: 'answer_business_question', state: 'completed', actionStatus: 'answered' };
  if (workflow.id === 'cake-enquiry') return { reply: `Here is what I can confirm for ${businessInfo.cake.name}: available flavours include ${businessInfo.cake.flavors.join(', ')}. We are open ${businessInfo.cake.hours} at ${businessInfo.cake.address}. Would you like to place an order?`, action: 'answer_business_question', state: 'completed', actionStatus: 'answered' };
  if (workflow.id === 'cake-status') return { reply: 'I can check that order. Please share your phone number, order ID, and name so I can find it.', action: 'find_order', state: 'collecting', actionStatus: 'pending' };
  if (!state.missingFields.length) return { reply: workflow.businessId === 'cake' ? `Let me confirm your ${data.cake_weight} ${data.cake_flavour} ${data.cake_type || 'cake'} for ${data.required_date}, with ${data.delivery_method}. Is that correct?` : `I found all the details for ${data.doctor_specialty} on ${data.appointment_date} at ${data.appointment_time}. Would you like me to confirm this appointment?`, action: 'ask_confirmation', state: 'awaiting_confirmation', actionStatus: 'pending_confirmation' };
  const field = workflow.fields.find(([key]) => key === state.missingFields[0]);
  return { reply: field ? field[2] : 'What else can I help you with?', action: 'ask_for_field', state: 'collecting', actionStatus: 'collecting' };
}

module.exports = { workflows, businessInfo, fieldsFor, publicWorkflow, detectWorkflow, extractData, buildState, replyFor, normalizeDate, normalizeTime };
