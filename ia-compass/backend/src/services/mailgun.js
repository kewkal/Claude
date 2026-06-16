const Mailgun = require('mailgun.js');
const FormData = require('form-data');

let mg;

function getClient() {
  if (!mg) {
    const mailgun = new Mailgun(FormData);
    mg = mailgun.client({ username: 'api', key: process.env.MAILGUN_API_KEY });
  }
  return mg;
}

async function sendEmail({ to, subject, html }) {
  const client = getClient();
  const result = await client.messages.create(process.env.MAILGUN_DOMAIN, {
    from: process.env.MAILGUN_FROM,
    to,
    subject,
    html,
  });
  return result;
}

module.exports = { sendEmail };
