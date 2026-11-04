const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../workflows');
const workflowEngine = require('../services/ai/workflowEngine');
const { normalizePhoneNumber } = require('../utils/phone');

test('normalizes Indian phone numbers without confusing business and caller numbers', () => {
  assert.equal(normalizePhoneNumber('08012345678'), '+918012345678');
  assert.equal(normalizePhoneNumber('+919876543210'), '+919876543210');
});

test('extracts clinic details from one sentence', () => {
  const workflow = engine.workflows['clinic-appointment'];
  const data = engine.extractData('Hi, I am Rahul, I need a dentist appointment tomorrow at 4 PM because my tooth is hurting.', {}, workflow, null, []);
  assert.equal(data.patient_name, 'Rahul');
  assert.equal(data.doctor_specialty, 'dentist');
  assert.equal(data.appointment_time, '16:00');
  assert.ok(data.appointment_date);
  assert.equal(data.reason_for_visit, 'my tooth is hurting');
});

test('moves to the next missing field instead of repeating a completed field', () => {
  const first = workflowEngine.processMessage({ message: 'My name is Rahul', workflowId: 'clinic-appointment', fields: {}, currentFieldKey: 'patient_name', history: [{ from: 'ai', text: 'What is your name?' }] });
  assert.equal(first.collectedData.patient_name, 'Rahul');
  assert.equal(first.currentField, 'phone_number');
  const second = workflowEngine.processMessage({ message: 'Dentist tomorrow at 5 PM', workflowId: first.workflowId, fields: first.collectedData, currentFieldKey: first.currentField, history: [{ from: 'ai', text: first.response }] });
  assert.equal(second.collectedData.patient_name, 'Rahul');
  assert.equal(second.collectedData.doctor_specialty, 'dentist');
  assert.equal(second.collectedData.appointment_time, '17:00');
  assert.notEqual(second.currentField, 'patient_name');
});

test('caller phone automatically satisfies clinic phone field', () => {
  const result = workflowEngine.processMessage({ message: 'I want a dentist appointment tomorrow at 4 PM', workflowId: 'clinic-appointment', callerPhone: '9876543210', fields: {}, history: [] });
  assert.equal(result.collectedData.phone_number, '+919876543210');
  assert.notEqual(result.currentField, 'phone_number');
});
