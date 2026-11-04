# Firebase schema

## Firestore

Every top-level document includes `userId` and `createdAt`/`updatedAt` timestamps. Core collections:

- `businesses/{businessId}`: name, type, contact, hours, language, assistant configuration.
- `workflows/{workflowId}`: businessId, trigger, questions, conditions, actions, published.
- `conversations/{conversationId}`: businessId, customerId, transcript, extractedFields, priority, status.
- `customers/{customerId}`: businessId, phone, name, email, interactionCount.
- `followups/{followupId}`: businessId, conversationId, dueAt, priority, status.
- `calendarTokens/{tokenId}`: businessId, encrypted OAuth refresh token and provider metadata.
- `appointments/{appointmentId}`: businessId, patient/customer details, date, time, status, workflowId.
- `cakeOrders/{orderId}`: businessId, cake details, delivery details, priority, status, workflowId.
- `voiceCalls/{callId}`: Exotel provider identifiers, business/caller phones, status, direction, workflow state, collectedData, completedFields, missingFields, transcript, summary, recordingUrl, calendarEventId, and lifecycle timestamps.
- `missedCalls/{missedCallId}`: businessId, callerPhone, timestamp, providerCallId, reason, customerId, callbackStatus, and notes.
- `callbackSettings/{businessId}`: enabled, mode (`after_hours`, `during_hours`, or `always`), business-hours start/end, timezone, and updatedAt.

Each conversation also keeps `workflowId`, `currentFieldKey`, `collectedData`, `completedFields`, `missingFields`, `state`, `actionStatus`, `priority`, `summary`, and a `messages` subcollection. The workflow engine saves this state before generating the next question.

Callers are normalized before customer lookup. Customer IDs are scoped by `businessId` and normalized caller phone, and the business ExoPhone is stored separately as `businessPhone`.

Browser simulator sessions pre-capture the caller phone before the first workflow turn. The AI must preserve that value unless the user explicitly requests a phone-number change.
