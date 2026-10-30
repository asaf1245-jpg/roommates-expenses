# Roommates Expenses — WhatsApp Notifications V1

## Status
Prepared only. NOT DEPLOYED. Sending is DISABLED by default. Nothing is sent to WhatsApp until a group gateway is configured, authorized, and explicitly enabled.

## Settings
Firestore document `notificationSettings/whatsapp`:
```json
{"enabled":false,"task_created":true,"task_completed":true,"expense_created":true,"shopping_added":true,"task_reminder":true}
```
Reminder: 09:00 every day in **Asia/Jerusalem**, only for incomplete tasks due that day. Dates use `YYYY-MM-DD`.

## Events
- `tasks_bar_ilan/{id}` create and first transition to done
- `expenses/{id}` create
- `shoppingList_bar_ilan/{id}` create (not initial list population unless enabled)
- Scheduled morning task reminders

## Before deploy
1. Confirm the existing group members consent and choose a sending phone already in the group.
2. Choose a trusted always-on gateway. Existing-group messaging typically requires an unofficial WhatsApp Web bridge, which carries account suspension and session stability risks. Official Meta group API is not a general bridge into existing personal groups.
3. Host gateway **outside** GitHub Pages, behind HTTPS, auth and rate limits. It must implement `POST /` accepting `{groupId,text,eventId}`, verify Bearer token and persist eventId for idempotency; return 2xx only on confirmed send.
4. Deploy Firestore functions in the correct Firebase project `roommates-expenses-bar-ilan` using Firebase CLI with the functions source folder configured to `notifications`. Set Secret Manager secrets AK_WA_GATEWAY_URL, AK_WA_GATEWAY_TOKEN, AK_WA_GROUP_ID before deployment.
5. Restrict `whatsappOutbox` and `notificationSettings/whatsapp` with Firebase security rules (clients must not write them). Use admin service identities for writes.
6. Run a controlled test with a test group. Verify duplicate prevention, failed sends, timing, and permissions.
7. Switch enabled to true only after approval and successful tests.

## Operational notes
- Existing documents will not generate notifications upon deployment; created triggers act on new docs.
- Pending outbox is only for enabled events. Failed messages require deliberate retry handling; no blind infinite retries.
- In-flight `sending` messages require an operator recovery process after gateway timeout or function crash. Do not reset without checking gateway's idempotency log.
- Cloud Function deployment, Scheduler, Firestore and gateway hosting may incur costs.
- Existing tasks UI and expense/kitchen logic are not changed by this package.
