export async function sendMail({ to, subject, html, from }: { to: string; subject: string; html: string; from?: string }) {
  const sendgridKey = process.env.SENDGRID_API_KEY;
  const postmarkKey = process.env.POSTMARK_TOKEN;
  const fromAddress = from || process.env.SMTP_FROM || `no-reply@${new URL(process.env.SUPABASE_URL || "https://example.com").hostname}`;

  if (sendgridKey) {
    try {
      const sgModule: any = await import("@sendgrid/mail");
      const sg = sgModule.default ?? sgModule;
      sg.setApiKey(sendgridKey);
      await sg.send({ to, from: fromAddress, subject, html });
      return { ok: true, provider: "sendgrid" };
    } catch (e) {
      // try next fallback
    }
  }

  if (postmarkKey) {
    try {
      const postmarkModule: any = await import("postmark");
      const ServerClient = postmarkModule.ServerClient ?? postmarkModule.default?.ServerClient;
      const client = new ServerClient(postmarkKey);
      await client.sendEmail({ From: fromAddress, To: to, Subject: subject, HtmlBody: html });
      return { ok: true, provider: "postmark" };
    } catch (e) {
      // try next fallback
    }
  }

  // Mailgun API support (free tier available) — prefer when configured
  const mailgunKey = process.env.MAILGUN_API_KEY;
  const mailgunDomain = process.env.MAILGUN_DOMAIN;
  if (mailgunKey && mailgunDomain) {
    try {
      const form = new URLSearchParams();
      form.append("from", fromAddress);
      form.append("to", to);
      form.append("subject", subject);
      form.append("html", html);

      const resp = await fetch(`https://api.mailgun.net/v3/${encodeURIComponent(mailgunDomain)}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${mailgunKey}`).toString("base64")}`,
        },
        body: form,
      });
      if (!resp.ok) throw new Error(`Mailgun error ${resp.status}`);
      return { ok: true, provider: "mailgun" };
    } catch (e) {
      // fallback to next provider
    }
  }

  // If no provider configured and in development, create an Ethereal account for testing
  if (!process.env.SMTP_HOST && process.env.NODE_ENV !== "production") {
    try {
      const nodemailerModule: any = await import("nodemailer");
      const testAccount = await nodemailerModule.createTestAccount();
      const transporter = nodemailerModule.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: { user: testAccount.user, pass: testAccount.pass },
      });
      const info = await transporter.sendMail({ from: fromAddress, to, subject, html });
      // Return preview URL when available (Ethereal)
      try {
        const preview = nodemailerModule.getTestMessageUrl(info);
        if (preview) return { ok: true, provider: "ethereal", previewUrl: preview };
      } catch {}
      return { ok: true, provider: "ethereal" };
    } catch (e) {
      // fallthrough to SMTP check
    }
  }

  // Fallback to nodemailer using SMTP_* env vars
  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) throw new Error("No mail provider configured (SENDGRID_API_KEY, POSTMARK_TOKEN or SMTP_HOST required)");

  const nodemailerModule: any = await import("nodemailer");
  const transporter = nodemailerModule.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" } : undefined,
  });

  await transporter.sendMail({ from: fromAddress, to, subject, html });
  return { ok: true, provider: "smtp" };
}
