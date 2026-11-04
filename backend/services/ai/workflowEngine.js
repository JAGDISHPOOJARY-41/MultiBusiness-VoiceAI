const baseEngine = require('../../workflows');
const { normalizePhoneNumber, isValidPhone } = require('../../utils/phone');

function processMessage({ message, workflowId = 'auto', fields = {}, currentFieldKey = null, state = 'collecting', history = [], callerPhone = null }) {
  const selectedId = baseEngine.detectWorkflow(message || '', workflowId, history);
  const workflow = baseEngine.workflows[selectedId];
  const startingFields = { ...(fields || {}) };
  if (!startingFields.phone_number && callerPhone && isValidPhone(callerPhone) && workflow.fields.some(([key]) => key === 'phone_number')) startingFields.phone_number = normalizePhoneNumber(callerPhone);
  const collectedData = baseEngine.extractData(message || '', startingFields, workflow, currentFieldKey, history);
  const workflowState = baseEngine.buildState(workflow, collectedData, currentFieldKey);
  const result = baseEngine.replyFor(workflow, collectedData, workflowState, workflow.intent);
  return { response: result.reply, intent: workflow.intent, workflowId: workflow.id, workflow, extractedData: collectedData, collectedData, completedFields: workflowState.completedFields, missingFields: workflowState.missingFields, currentField: workflowState.currentFieldKey, requiresConfirmation: result.state === 'awaiting_confirmation', action: result.action, actionStatus: result.actionStatus, state: result.state, callerPhone: startingFields.phone_number || null };
}

module.exports = { processMessage };
