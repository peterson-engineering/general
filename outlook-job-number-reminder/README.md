# Job Number Reminder (Outlook add-in)

When a user clicks Send, the add-in checks the subject line for a job number (a standalone 5-digit number such as 22124 or 25080). If none is found, Outlook shows a prompt with **Don't Send** and **Send Anyway**. No macros are used.

If the add-in ever fails, the email sends normally.

Works in classic Outlook for Windows, the new Outlook, Outlook on the web, and Outlook for Mac (requires a Microsoft 365 mailbox).

## For IT: deployment

1. **Host the files.** Put `src/launchevent.html`, `src/launchevent.js`, and the two icons in `assets/` on any secure (HTTPS) web address the company controls, such as an Azure Static Web App. Keep the layout the manifest expects: `launchevent.html` and `launchevent.js` in the site root, icons in `/assets/`.
2. **Edit `manifest.xml`.** Replace every `YOUR-HOST` with the host name from step 1.
3. **Pilot.** In the Microsoft 365 admin center, go to **Settings > Integrated apps > Upload custom apps**, choose **Office Add-in**, upload `manifest.xml`, and assign it to one or two test users only.
4. **Test** (below), then widen the assignment. Deployment can take up to 24 hours to appear in Outlook.

## Test

- Send a draft with the subject `25080 Test`. It should send with no prompt.
- Send a draft with the subject `Test`. A prompt should appear. **Don't Send** returns to the draft. **Send Anyway** sends it.
- Subjects like `Invoice 1234` or `Ref 251234` should also prompt, because those are not 5-digit job numbers.

## Settings

In `src/launchevent.js`, set `skipIfAllRecipientsInDomain` to `petersoneng.com` to skip the reminder when every recipient is internal. It is blank by default, which checks every sent email.

## Known limits

- Any standalone 5-digit number counts, including a zip code. The user can still choose Send Anyway.
- The add-in does not check the email body, only the subject.

## Run the logic tests

```
node --test tests/launchevent.test.js
```
