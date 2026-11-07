const test = require("node:test");
const assert = require("node:assert");
const { hasJobNumber, allRecipientsInDomain } = require("../src/launchevent.js");

test("finds job numbers", () => {
  for (const s of ["22124 Site Visit", "RE: 25080 - RFI 12", "Meeting re 25080", "FW: Job#22124", "(25080)"]) {
    assert.ok(hasJobNumber(s), s);
  }
});
test("flags missing job numbers", () => {
  for (const s of ["", "Site visit", "RFI 12", "Invoice 1234", "Call 303-555-1234", "Ref 251234", "Ref 2508A"]) {
    assert.ok(!hasJobNumber(s), s);
  }
});
test("handles empty subject", () => {
  assert.ok(!hasJobNumber(undefined));
  assert.ok(!hasJobNumber(null));
});
test("internal recipient check", () => {
  assert.ok(allRecipientsInDomain(["a@petersoneng.com", "B@PetersonEng.com"], "petersoneng.com"));
  assert.ok(!allRecipientsInDomain(["a@petersoneng.com", "c@client.com"], "petersoneng.com"));
  assert.ok(!allRecipientsInDomain([], "petersoneng.com"));
  assert.ok(!allRecipientsInDomain(["a@petersoneng.com"], ""));
});
