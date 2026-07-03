import '../src/config.js';

const endpoint = process.env.TEST_ENDPOINT || 'http://localhost:3000/api/print-label';
const orderId = process.argv[2] || `TEST-${Date.now()}`;
const buyerUsername = process.argv[3] || 'buyer123';

const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ orderId, buyerUsername })
});

const body = await response.json();
console.log(JSON.stringify(body, null, 2));

if (!response.ok) {
  process.exitCode = 1;
}
