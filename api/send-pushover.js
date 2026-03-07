// /api/send-pushover.js
//
// Sends Pushover alerts to all contacts assigned to a restroom.
// Looks up workers (via contact_restrooms junction table) and
// managers/dispatch (via site_id on contacts table).
//
// Called by the feedback form after saving to Supabase.
//
// ENV VARIABLES:
//   PUSHOVER_TOKEN  = your Pushover application API token
//   PUSHOVER_USER   = fallback Pushover user key (your personal key)
//   SUPABASE_URL    = https://lidntffmgtctjgiusgww.supabase.co
//   SUPABASE_KEY    = your Supabase anon key

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { id, feedback, restroom, restroomId, site } = req.body;

    if (!feedback || !restroom) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const pushoverToken = process.env.PUSHOVER_TOKEN;
    const pushoverFallback = process.env.PUSHOVER_USER;
    const supabaseUrl = process.env.SUPABASE_URL || "https://lidntffmgtctjgiusgww.supabase.co";
    const supabaseKey = process.env.SUPABASE_KEY || "";

    if (!pushoverToken) {
      return res.status(500).json({ error: "Missing PUSHOVER_TOKEN" });
    }

    // Build resolve URL
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://maidsmart-api.vercel.app";

    // Find the feedback record ID (most recent for this restroom)
    let feedbackId = id;
    if (!feedbackId && restroomId && supabaseKey) {
      try {
        const fbRes = await fetch(
          `${supabaseUrl}/rest/v1/feedback?restroom_id=eq.${restroomId}&completed=eq.false&order=created_at.desc&limit=1`,
          { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        );
        const fbData = await fbRes.json();
        if (fbData && fbData.length > 0) feedbackId = fbData[0].id;
      } catch (e) { console.log("Could not find feedback ID:", e); }
    }

    const resolveUrl = feedbackId
      ? `${baseUrl}/api/resolve?id=${feedbackId}&confirm=true`
      : baseUrl;

    // Build message
    const siteText = site ? ` at ${site}` : "";
    const message = `${feedback}\nRestroom: ${restroom}${siteText}`;

    // Collect all Pushover user keys to notify
    let pushoverUsers = [];

    if (supabaseKey && restroomId) {
      // 1. Get workers assigned to this restroom via junction table
      try {
        const crRes = await fetch(
          `${supabaseUrl}/rest/v1/contact_restrooms?restroom_id=eq.${restroomId}&select=contact_id`,
          { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        );
        const crData = await crRes.json();
        
        if (crData && crData.length > 0) {
          const contactIds = crData.map(cr => cr.contact_id);
          // Get contact details
          for (const cid of contactIds) {
            const cRes = await fetch(
              `${supabaseUrl}/rest/v1/contacts?id=eq.${cid}&select=phone,role`,
              { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
            );
            const cData = await cRes.json();
            if (cData && cData.length > 0 && cData[0].phone) {
              pushoverUsers.push(cData[0].phone);
            }
          }
        }
      } catch (e) { console.log("Error looking up workers:", e); }

      // 2. Get the site_id for this restroom
      try {
        const rrRes = await fetch(
          `${supabaseUrl}/rest/v1/restrooms?id=eq.${restroomId}&select=site_id`,
          { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
        );
        const rrData = await rrRes.json();

        if (rrData && rrData.length > 0 && rrData[0].site_id) {
          // Get managers and dispatch for this site
          const mgrRes = await fetch(
            `${supabaseUrl}/rest/v1/contacts?site_id=eq.${rrData[0].site_id}&role=in.(manager,dispatch)&select=phone`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
          );
          const mgrData = await mgrRes.json();
          if (mgrData && mgrData.length > 0) {
            mgrData.forEach(m => {
              if (m.phone && !pushoverUsers.includes(m.phone)) {
                pushoverUsers.push(m.phone);
              }
            });
          }
        }
      } catch (e) { console.log("Error looking up managers:", e); }
    }

    // Fallback to PUSHOVER_USER if no contacts found
    if (pushoverUsers.length === 0 && pushoverFallback) {
      pushoverUsers.push(pushoverFallback);
    }

    if (pushoverUsers.length === 0) {
      console.log("No contacts found for restroom:", restroomId);
      return res.status(200).json({ success: true, sent: 0, message: "No contacts to notify" });
    }

    // Send to all users
    let sent = 0;
    let failed = 0;

    for (const userKey of pushoverUsers) {
      try {
        const pushRes = await fetch("https://api.pushover.net/1/messages.json", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: pushoverToken,
            user: userKey,
            title: "🚨 MaidSmart Alert",
            message: message,
            priority: 1,
            sound: "siren",
            url: resolveUrl,
            url_title: "✅ Mark Complete",
          }),
        });

        const pushData = await pushRes.json();
        if (pushData.status === 1) {
          sent++;
          console.log(`Pushover sent to ${userKey} for ${restroom}`);
        } else {
          failed++;
          console.log(`Pushover failed for ${userKey}:`, pushData);
        }
      } catch (e) {
        failed++;
        console.log(`Pushover error for ${userKey}:`, e);
      }
    }

    return res.status(200).json({
      success: true,
      sent,
      failed,
      total: pushoverUsers.length,
      message: `Alert sent to ${sent} contact(s)`,
    });

  } catch (error) {
    console.error("Send pushover error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
