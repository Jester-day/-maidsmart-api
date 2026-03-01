// /api/sms-reply.js
//
// Twilio calls this when the EVS worker texts back.
// Worker texts "Y <id>" → marks feedback record as completed in Adalo.
//
// YOUR ADALO FEEDBACK FIELDS:
//   Completed?     → boolean (true/false)
//   Time Completed → date/time
//   Restroom       → text (room name/number)
//
// TWILIO SETUP:
//   Phone Numbers → Your Number → Messaging → "A Message Comes In"
//   Webhook: https://your-app.vercel.app/api/sms-reply (POST)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const incomingMsg = (req.body.Body || "").trim();
    const fromPhone = req.body.From || "";

    console.log(`SMS from ${fromPhone}: "${incomingMsg}"`);

    const adaloAppId = process.env.ADALO_APP_ID;
    const feedbackCollectionId = process.env.ADALO_COLLECTION_ID;
    const adaloApiKey = process.env.ADALO_API_KEY;

    if (!adaloAppId || !feedbackCollectionId || !adaloApiKey) {
      return sendTwiml(res, "System config error. Contact admin.");
    }

    // Check if reply is a resolve command
    const isResolve = /^(y|yes|done|complete|completed|fixed|resolved)\b/i.test(incomingMsg);

    if (!isResolve) {
      return sendTwiml(res,
        `MaidSmart: Reply "Y <id>" to resolve an alert.\nExample: Y abc123\n\nOr reply "Y" to resolve the latest alert.`
      );
    }

    // Extract record ID if provided
    const parts = incomingMsg.trim().split(/\s+/);
    let recordId = parts.length > 1 ? parts.slice(1).join(" ").trim() : null;

    const adaloBase = `https://api.adalo.com/v0/apps/${adaloAppId}/collections/${feedbackCollectionId}`;

    // If no ID provided, find the most recent uncompleted feedback
    if (!recordId) {
      try {
        const listRes = await fetch(`${adaloBase}?limit=20&offset=0`, {
          headers: {
            "Authorization": `Bearer ${adaloApiKey}`,
            "Content-Type": "application/json",
          },
        });

        if (listRes.ok) {
          const listData = await listRes.json();
          const records = listData.records || [];

          // Find most recent where Completed? is false/null
          const openRecord = records.find(r =>
            r["Completed?"] === false || r["Completed?"] === null || r["Completed?"] === undefined
          );

          if (!openRecord) {
            return sendTwiml(res, "All clear! No open alerts found.");
          }
          recordId = openRecord.id;
        } else {
          return sendTwiml(res, "Could not fetch records. Try: Y <id>");
        }
      } catch (e) {
        console.error("List error:", e);
        return sendTwiml(res, "Error looking up alerts. Try: Y <id>");
      }
    }

    // Update the record — set Completed? to true and Time Completed to now
    const updateRes = await fetch(`${adaloBase}/${recordId}`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${adaloApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        "Completed?": true,
        "Time Completed": new Date().toISOString(),
      }),
    });

    if (!updateRes.ok) {
      if (updateRes.status === 404) {
        return sendTwiml(res, `Record "${recordId}" not found. Check the ID.`);
      }
      console.error("Update error:", await updateRes.text());
      return sendTwiml(res, "Could not update record. Try again or use the app.");
    }

    const updated = await updateRes.json();
    const roomName = updated.Restroom || updated.restroom || recordId;

    console.log(`Record ${recordId} resolved by ${fromPhone}`);
    return sendTwiml(res, `✅ ${roomName} marked complete. Nice work!`);

  } catch (error) {
    console.error("Reply error:", error);
    return sendTwiml(res, "Something went wrong. Please try again.");
  }
}

function sendTwiml(res, message) {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(message)}</Message>
</Response>`;
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(twiml);
}

function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
