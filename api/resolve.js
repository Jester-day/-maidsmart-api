// /api/resolve.js
//
// Called when a worker taps "Mark Complete" from a Pushover notification
// or clicks the resolve link.
//
// URL: https://maidsmart-api.vercel.app/api/resolve?id=FEEDBACK_UUID
//
// GET with ?confirm=true — auto-resolves (for Pushover action buttons)
// GET without confirm — shows confirmation page with big green button
// POST — resolves the record
//
// ENV VARIABLES:
//   SUPABASE_URL
//   SUPABASE_KEY

module.exports = async function handler(req, res) {
  const id = req.query.id;

  if (!id) {
    return res.status(400).send(page("Error", "Missing feedback ID.", false));
  }

  const supabaseUrl = process.env.SUPABASE_URL || "https://lidntffmgtctjgiusgww.supabase.co";
  const supabaseKey = process.env.SUPABASE_KEY || "";

  // GET with confirm=true — auto-resolve (Pushover tap)
  if (req.method === "GET" && req.query.confirm === "true") {
    const result = await resolveRecord(supabaseUrl, supabaseKey, id);
    if (result.success) {
      return res.status(200).send(page("Resolved!", `✅ ${result.room} marked complete.\nResponse time: ${result.responseTime}`, false));
    } else {
      return res.status(500).send(page("Error", result.error, false));
    }
  }

  // GET — show confirmation page
  if (req.method === "GET") {
    return res.status(200).send(page("MaidSmart", `Mark feedback as complete?`, true, id));
  }

  // POST — resolve
  if (req.method === "POST") {
    const result = await resolveRecord(supabaseUrl, supabaseKey, id);
    if (result.success) {
      return res.status(200).send(page("Resolved!", `✅ ${result.room} marked complete.\nResponse time: ${result.responseTime}`, false));
    } else {
      return res.status(500).send(page("Error", result.error, true, id));
    }
  }

  return res.status(405).send("Method not allowed");
};

async function resolveRecord(supabaseUrl, supabaseKey, id) {
  if (!supabaseKey) {
    return { success: false, error: "System not configured." };
  }

  try {
    const now = new Date().toISOString();

    // First get the record to calculate response time
    const getRes = await fetch(
      `${supabaseUrl}/rest/v1/feedback?id=eq.${id}&select=*`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    const getData = await getRes.json();

    if (!getData || getData.length === 0) {
      return { success: false, error: "Feedback record not found." };
    }

    const record = getData[0];

    if (record.completed) {
      const room = record.restroom_name || id;
      return { success: true, room, responseTime: "Already resolved" };
    }

    // Update the record
    const updateRes = await fetch(
      `${supabaseUrl}/rest/v1/feedback?id=eq.${id}`,
      {
        method: "PATCH",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          completed: true,
          time_completed: now,
        }),
      }
    );

    if (!updateRes.ok) {
      return { success: false, error: "Could not update record." };
    }

    // Calculate response time
    const created = new Date(record.created_at);
    const completed = new Date(now);
    const diffMs = completed - created;
    const diffMins = Math.round(diffMs / 60000);
    let responseTime = "";
    if (diffMins < 60) {
      responseTime = diffMins + " minutes";
    } else {
      const hrs = Math.floor(diffMins / 60);
      const mins = diffMins % 60;
      responseTime = hrs + "h " + mins + "m";
    }

    const room = record.restroom_name || id;
    return { success: true, room, responseTime };

  } catch (e) {
    console.error("Resolve error:", e);
    return { success: false, error: "Something went wrong." };
  }
}

function page(title, message, showButton, id) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MaidSmart</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Outfit', sans-serif;
      background: #f8f9fb;
      display: flex; justify-content: center; align-items: center;
      min-height: 100vh; padding: 20px;
    }
    .card {
      background: white; border-radius: 20px; padding: 44px;
      max-width: 400px; width: 100%; text-align: center;
      box-shadow: 0 8px 40px rgba(0,0,0,0.08);
    }
    .logo { font-size: 24px; font-weight: 800; margin-bottom: 28px; }
    .logo-m { color: #1a1a2e; }
    .logo-s { color: #E8922A; }
    .icon { font-size: 56px; margin-bottom: 16px; }
    .message { font-size: 18px; color: #334155; margin-bottom: 28px; line-height: 1.5; white-space: pre-line; }
    .btn {
      display: block; width: 100%;
      background: linear-gradient(135deg, #22c55e, #16a34a);
      color: white; font-size: 18px; font-weight: 700;
      padding: 16px; border: none; border-radius: 14px;
      cursor: pointer; font-family: 'Outfit', sans-serif;
      box-shadow: 0 4px 14px rgba(34,197,94,0.3);
      transition: all 0.2s;
    }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(34,197,94,0.4); }
    .response-badge {
      display: inline-block; background: #f0fdf4; color: #22c55e;
      padding: 6px 16px; border-radius: 8px; font-size: 14px; font-weight: 600;
      margin-top: 8px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo"><span class="logo-m">Maid</span><span class="logo-s">Smart</span></div>
    ${title === "Resolved!" ? '<div class="icon">✅</div>' : ''}
    ${title === "Error" ? '<div class="icon">⚠️</div>' : ''}
    ${title === "MaidSmart" ? '<div class="icon">📋</div>' : ''}
    <div class="message">${message}</div>
    ${showButton ? `
    <form method="POST" action="/api/resolve?id=${id}">
      <button type="submit" class="btn">✅ Mark Complete</button>
    </form>
    ` : ''}
  </div>
</body>
</html>`;
}
