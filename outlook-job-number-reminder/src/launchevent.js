/*
 * Job Number Reminder: runs when the user clicks Send in Outlook.
 * If the subject has no job number (a standalone 5-digit number such as
 * 22124 or 25080), Outlook shows a prompt with "Don't Send" and "Send Anyway".
 */

// ---- Settings (edit here) -------------------------------------------------
var SETTINGS = {
  // Set to "petersoneng.com" to skip the check when every recipient is internal.
  // Leave as "" to check every sent email.
  skipIfAllRecipientsInDomain: "",
};
// ---------------------------------------------------------------------------

var PROMPT_MESSAGE =
  "There is no job number in the subject line (for example 25080). " +
  "Choose Don't Send to go back and add one, or Send Anyway.";

// A job number is exactly 5 digits that are not part of a longer number.
function hasJobNumber(subject) {
  return /(?<!\d)\d{5}(?!\d)/.test(subject || "");
}

function allRecipientsInDomain(addresses, domain) {
  if (!domain || addresses.length === 0) return false;
  var suffix = "@" + domain.toLowerCase();
  return addresses.every(function (a) {
    return (a || "").toLowerCase().endsWith(suffix);
  });
}

function getAsync(field) {
  return new Promise(function (resolve, reject) {
    field.getAsync(function (result) {
      if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value);
      else reject(result.error);
    });
  });
}

async function onMessageSendHandler(event) {
  try {
    var item = Office.context.mailbox.item;
    var subject = await getAsync(item.subject);

    if (hasJobNumber(subject)) {
      event.completed({ allowEvent: true });
      return;
    }

    if (SETTINGS.skipIfAllRecipientsInDomain) {
      var lists = await Promise.all([getAsync(item.to), getAsync(item.cc), getAsync(item.bcc)]);
      var addresses = [].concat.apply([], lists).map(function (r) { return r.emailAddress; });
      if (allRecipientsInDomain(addresses, SETTINGS.skipIfAllRecipientsInDomain)) {
        event.completed({ allowEvent: true });
        return;
      }
    }

    event.completed({ allowEvent: false, errorMessage: PROMPT_MESSAGE });
  } catch (e) {
    // If anything goes wrong, never block the user from sending.
    event.completed({ allowEvent: true });
  }
}

if (typeof Office !== "undefined") {
  Office.onReady();
  Office.actions.associate("onMessageSendHandler", onMessageSendHandler);
}

if (typeof module !== "undefined") {
  module.exports = { hasJobNumber: hasJobNumber, allRecipientsInDomain: allRecipientsInDomain };
}
