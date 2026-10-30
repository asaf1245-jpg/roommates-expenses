# Local WhatsApp worker (experimental)

**Not deployed, disabled by default.** Runs locally on Windows. The user already has an authenticated personal project session at `C:\\AK-AI-LABS\\Roommates-WhatsApp-Bot\\private-session`; use the files as examples, but DO NOT overwrite it.

IMPORTANT: The configured auth session path assumes this repository's local-bot folder is copied to `C:\\AK-AI-LABS\\Roommates-WhatsApp-Bot\\notifications\\local-bot`, not executed from a different directory.

Setup:
1. Stop currently running bot.js and back up private-session locally.
2. Install dependencies using `$env:PUPPETEER_SKIP_DOWNLOAD="true"; npm.cmd install`.
3. Create restricted Firebase service account credentials with minimum possible permissions; set `GOOGLE_APPLICATION_CREDENTIALS` to private JSON local path, never put secret on GitHub or in a browser.
4. Ensure server-side triggers from parent notifications are deployed only after fixing duplicate send strategy, review Firestore rules, enable billing and scheduler as needed.
5. Keep `notificationSettings/whatsapp.enabled=false`. Dry run prints pending entries, does not send.
6. After security review and explicit consent of group members, enable deliberately. The worker has no retries after ambiguous send; marks `needs_review`, inspect WhatsApp before marking sent.

Known limitations:
- whatsapp-web.js 1.34.7 currently has outstanding npm audit vulnerabilities and a local compatibility patch may be required for getChats; the worker is not production safe.
- Current default mode is DRY RUN. `AK_WA_MODE=live` alone is insufficient; Firestore settings must be enabled.
- Group name is a temporary selector; production should pin immutable group ID after verification.
- Cloud dispatcher in ../index.js must NOT run concurrently with this worker; choose one transport.
- The worker requires machine uptime to deliver; use an approved provider for more reliability.
- Avoid queuing any data before explicit rollout consent.
