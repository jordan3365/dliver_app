const fetch = require('node-fetch');

const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxWQWVVT9mu2PivCu9lQNzNYGv6RjLuNPavpmomlanIsF9rvTrF8Rgqih0-YEHaIO5a5Q/exec";

async function run() {
  const res = await fetch(GAS_WEB_APP_URL, {
    method: 'POST',
    body: JSON.stringify({ action: "getDrivers", data: {} })
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

run().catch(console.error);
