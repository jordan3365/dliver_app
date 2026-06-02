const fetch = require('node-fetch');

const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxMmRq0BxdBhb5GGm3EN_UXwyTJItP8ZWurdVlTlSLmeNQdFx1rdyQMFw9WedSfLxKa0w/exec";

async function run() {
  const res = await fetch(GAS_WEB_APP_URL, {
    method: 'POST',
    body: JSON.stringify({ action: "getDrivers", data: {} })
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

run().catch(console.error);
