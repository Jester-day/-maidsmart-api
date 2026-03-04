// /api/send-pushover.js
//
// Alternative to send-alert.js — uses Pushover instead of Twilio.
// Sends a push notification with a "Mark Complete" action button.
//
// When the worker taps "Mark Complete", it opens the resolve endpoint
// which marks the record as completed in Adalo.
//
// ENV VARIABLES:
//   PUSHOVER_TOKEN  = your Pushover application API token
//   PUSHOVER_USER   = your Pushover user key (or group key for multiple workers)
//
// ADALO SETUP:
//   Same as send-alert.js — POST to this endpoint when feedback is created.
//   URL: https://maidsmart-api.vercel.app/api/send-pushover

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { id, feedback, restroom, restroomId, site } = req.body;

    if (!id || !feedback || !restroom) {
      return res.status(400).json({ error: "Missing required fields: id, feedback, restroom" });
    }

    const pushoverToken = process.env.PUSHOVER_TOKEN;
    const pushoverUser = process.env.PUSHOVER_USER;

    if (!pushoverToken || !pushoverUser) {
      return res.status(500).json({ error: "Missing Pushover env vars" });
    }

    // Build the resolve URL
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://maidsmart-api.vercel.app";
    const resolveUrl = `${baseUrl}/api/resolve?id=${id}&confirm=true`;

    // Build the message
    const siteText = site ? ` at ${site}` : "";
    const message = `${feedback}\nRestroom: ${restroom}${siteText}`;

    // Send via Pushover API
    const pushoverRes = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: pushoverToken,
        user: pushoverUser,
        title: "🚨 MaidSmart Alert",
        message: message,
        priority: 1,           // High priority — shows on lock screen
        sound: "siren",        // Urgent sound
        url: resolveUrl,
        url_title: "✅ Mark Complete",
      }),
    });

    const pushoverData = await pushoverRes.json();

    if (pushoverData.status === 1) {
      console.log(`Pushover sent for ${restroom} — ID: ${id}`);
      return res.status(200).json({ success: true, message: `Alert sent for ${restroom}` });
    } else {
      console.error("Pushover error:", pushoverData);
      return res.status(500).json({ error: "Pushover failed", details: pushoverData });
    }

  } catch (error) {
    console.error("Send pushover error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
