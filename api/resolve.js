// /api/resolve.js
//
// Called when a worker taps "Mark Complete" from a Pushover notification
// or clicks the resolve link in an SMS.
//
// URL: https://maidsmart-api.vercel.app/api/resolve?id=FEEDBACK_RECORD_ID
//
// GET request — shows a confirmation page with a big green button
// POST request — actually marks the record as complete in Adalo

module.exports = async function handler(req, res) {
  const id = req.query.id;

  if (!id) {
    return res.status(400).send(page("Error", "Missing feedback ID.", false));
  }

  const adaloAppId = process.env.ADALO_APP_ID;
  const feedbackCollectionId = process.env.ADALO_COLLECTION_ID;
  const adaloApiKey = process.env.ADALO_API_KEY;

  // GET — show confirmation page
  if (req.method === "GET") {
    // If ?confirm=true, go ahead and resolve it (for Pushover action buttons)
    if (req.query.confirm === "true") {
      const result = await resolveRecord(adaloAppId, feedbackCollectionId, adaloApiKey, id);
      if (result.success) {
        return res.status(200).send(page(
          "Resolved!",
          `✅ ${result.room} marked complete.`,
          false
        ));
      } else {
        return res.status(500).send(page("Error", result.error, false));
      }
    }

    // Otherwise show the confirmation page with a button
    return res.status(200).send(page(
      "MaidSmart",
      `Mark feedback #${id} as complete?`,
      true,
      id
    ));
  }

  // POST — resolve the record
  if (req.method === "POST") {
    const result = await resolveRecord(adaloAppId, feedbackCollectionId, adaloApiKey, id);
    if (result.success) {
      return res.status(200).send(page(
        "Resolved!",
        `✅ ${result.room} marked complete. Nice work!`,
        false
      ));
    } else {
      return res.status(500).send(page("Error", result.error, true, id));
    }
  }

  return res.status(405).send("Method not allowed");
};

async function resolveRecord(appId, collectionId, apiKey, id) {
  if (!appId || !collectionId || !apiKey) {
    return { success: false, error: "System not configured. Contact admin." };
  }

  try {
    const url = `https://api.adalo.com/v0/apps/${appId}/collections/${collectionId}/${id}`;
    const resp = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        "Completed?": true,
        "Time Completed": new Date().toISOString(),
      }),
    });

    if (!resp.ok) {
      if (resp.status === 404) {
        return { success: false, error: `Record "${id}" not found.` };
      }
      return { success: false, error: "Could not update record. Try again." };
    }

    const updated = await resp.json();
    const room = updated.Restroom || updated.restroom || id;
    return { success: true, room };

  } catch (e) {
    console.error("Resolve error:", e);
    return { success: false, error: "Something went wrong. Try again." };
  }
}

function page(title, message, showButton, id) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MaidSmart - ${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f1f5f9;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 40px;
      max-width: 400px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.1);
    }
    .logo {
      font-size: 24px;
      font-weight: 800;
      margin-bottom: 24px;
    }
    .logo span:first-child { color: #1e293b; }
    .logo span:last-child { color: #2D7DD2; }
    .message {
      font-size: 18px;
      color: #334155;
      margin-bottom: 32px;
      line-height: 1.5;
    }
    .btn {
      display: inline-block;
      background: #16a34a;
      color: white;
      font-size: 18px;
      font-weight: 700;
      padding: 16px 48px;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      text-decoration: none;
      width: 100%;
    }
    .btn:hover { background: #15803d; }
    .success { color: #16a34a; font-size: 48px; margin-bottom: 16px; }
    .error { color: #dc2626; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo"><span>MAID</span><span>SMART</span></div>
    ${title === "Resolved!" ? '<div class="success">✅</div>' : ''}
    ${title === "Error" ? '<div class="success error">⚠️</div>' : ''}
    <div class="message">${message}</div>
    ${showButton ? `
    <form method="POST" action="/api/resolve?id=${id}">
      <button type="submit" class="btn">Mark Complete</button>
    </form>
    ` : ''}
  </div>
</body>
</html>`;
}
