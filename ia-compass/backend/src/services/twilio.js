const twilio = require('twilio');

let client;

function getClient() {
  if (!client) {
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return client;
}

async function sendSMS(to, body) {
  const c = getClient();
  const message = await c.messages.create({
    body,
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
  });
  return message;
}

module.exports = { sendSMS };
