import process from 'process';

const to = process.argv[2] || process.env.TEST_TO;
const from = process.argv[3] || process.env.TEST_FROM || `"No Reply Stolas" <no-reply@stolas.local>`;
const subject = process.argv[4] || process.env.TEST_SUBJECT || 'Teste de envio — Stolas';
const html = process.argv[5] || process.env.TEST_HTML || '<p>Este é um e-mail de teste do Stolas.</p>';

if (!to) {
  console.error('Usage: node scripts/send-test-email.mjs recipient@example.com ["From Name <email@domain>"] [subject] [html]');
  process.exit(1);
}

async function main() {
  const nodemailer = await import('nodemailer');
  const testAccount = await nodemailer.createTestAccount();
  const transporter = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });

  const info = await transporter.sendMail({ from, to, subject, html });
  const preview = nodemailer.getTestMessageUrl(info);
  console.log('Message sent. Preview URL (Ethereal):', preview);
}

main().catch((e) => {
  console.error('Failed to send test email:', e);
  process.exit(1);
});
