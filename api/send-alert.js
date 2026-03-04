// /api/send-alert.js
//
// Called by Adalo when a new Feedback record is created.
// Looks up Contacts linked to that Restroom and sends SMS to each.
//
// YOUR ADALO STRUCTURE:
//   Sites → Restrooms → Feedbacks
//   Restrooms → Contacts (each contact has Name, Phone, linked Restroom)
//   Feedback → Feedback (text), Date, Restroom (text + relationship),
//              Completed? (boolean), Time Completed, User
//
// ADALO SETUP:
//   On each feedback button action (after "Create Feedback"):
//   Custom Action → POST to: https://your-app.vercel.app/api/send-alert
//   Body:
//     id         → new feedback record ID
//     feedback   → feedback type text (e.g. "Toilet is Clogged")
//     restroom   → restroom name/number
//     restroomId → restroom record ID (for looking up contacts)
//     site       → site name

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { id, feedback, restroom, restroomId, site } = req.body;

    if (!id || !feedback || !restroom) {
      return res.status(400).json({ error: "Missing required fields: id, feedback, restroom" });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
    const adaloAppId = process.env.ADALO_APP_ID;
    const adaloApiKey = process.env.ADALO_API_KEY;
    const contactsCollectionId = process.env.ADALO_CONTACTS_COLLECTION_ID;

    if (!accountSid || !authToken || !twilioPhone) {
      return res.status(500).json({ error: "Missing Twilio env vars" });
    }

    // ── Look up contacts from Adalo ──
    let phoneNumbers = [];

    if (adaloAppId && adaloApiKey && contactsCollectionId && restroomId) {
      try {
        const url = `https://api.adalo.com/v0/apps/${adaloAppId}/collections/${contactsCollectionId}`;
        const resp = await fetch(url, {
          headers: {
            "Authorization": `Bearer ${adaloApiKey}`,
            "Content-Type": "application/json",
          },
        });

        if (resp.ok) {
          const data = await resp.json();
          for (const contact of (data.records || [])) {
            const linked = contact.Restroom || [];
            const match = Array.isArray(linked)
              ? linked.includes(Number(restroomId)) || linked.includes(restroomId)
              : linked == restroomId;

            if (match && contact.Phone) {
              phoneNumbers.push(contact.Phone);
            }
          }
          console.log(`Found ${phoneNumbers.length} contacts for restroom ${restroomId}`);
        }
      } catch (e) {
        console.error("Contact lookup error:", e);
      }
    }

    // Fallback to env variable
    if (phoneNumbers.length === 0 && process.env.WORKER_PHONE) {
      phoneNumbers = process.env.WORKER_PHONE.split(",").map(p => p.trim());
    }

    if (phoneNumbers.length === 0) {
      return res.status(200).json({ success: false, message: "No contacts to notify" });
    }

    // ── Send SMS ──
    const siteText = site ? ` at ${site}` : "";
    const message = [
      `🚨 MaidSmart Alert`,
      ``,
      `${feedback}`,
      `Restroom: ${restroom}${siteText}`,
      ``,
      `Reply "Y ${id}" when resolved.`,
    ].join("\n");

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    let sent = 0;
    for (const phone of phoneNumbers) {
      try {
        const r = await fetch(twilioUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": `Basic ${auth}`,
          },
          body: new URLSearchParams({ To: phone, From: twilioPhone, Body: message }),
        });
        if (r.ok) { sent++; console.log(`SMS sent to ${phone}`); }
        else { console.error(`SMS failed to ${phone}:`, await r.text()); }
      } catch (e) {
        console.error(`SMS error to ${phone}:`, e);
      }
    }

    return res.status(200).json({ success: true, sent, total: phoneNumbers.length });

  } catch (error) {
    console.error("Send alert error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
