import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sendMail } from "./mailer";

export const sendTestEmail = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({
        to: z.string().email(),
        from: z.string().optional(),
        subject: z.string().optional(),
        html: z.string().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    // Safety: only allow in non-production environments
    if (process.env.NODE_ENV === "production") {
      throw new Error("sendTestEmail is disabled in production");
    }

    const res = await sendMail({
      to: data.to,
      from: data.from,
      subject: data.subject || "Teste de e-mail — Stolas",
      html: data.html || "<p>Teste de e-mail do Stolas</p>",
    });

    return res as any;
  });
