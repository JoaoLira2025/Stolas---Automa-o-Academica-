import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import crypto from "crypto";
import { isRateLimited, incrementRateLimit, resetRateLimit } from "@/lib/rateLimiter";
import { sendMail } from "@/lib/mailer";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chatCompletion, type ChatMessage } from "./ai-gateway.server";
import { extractFromBuffer, extractFromUrl } from "./extract.server";
import { generateAbntPdf } from "./abnt-pdf.server";

function cleanFileTitle(name: string) {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim() || "Documento ABNT"
  );
}

function safePathPart(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "documento-abnt"
  );
}

// --- Conversations ---
export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("conversations")
      .select("id, title, mode, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

export const createConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({ title: z.string().optional(), mode: z.enum(["chat", "abnt"]).default("chat") })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("conversations")
      .insert({ user_id: context.userId, title: data.title ?? "Nova conversa", mode: data.mode })
      .select("id, title, mode")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("conversations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const renameConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ id: z.string().uuid(), title: z.string().min(1).max(200) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("conversations")
      .update({ title: data.title })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// --- Messages ---
export const getMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ conversationId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("messages")
      .select("id, role, content, attachments, created_at")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });

export const getDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ conversationId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("documents")
      .select("id, source_type, source_name, mime_type, created_at")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });

// --- Add document from upload (already uploaded to storage) ---
export const ingestFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        conversationId: z.string().uuid(),
        storagePath: z.string(),
        sourceName: z.string(),
        mimeType: z.string().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: file, error: dErr } = await context.supabase.storage
      .from("stolas-uploads")
      .download(data.storagePath);
    if (dErr || !file) throw new Error(dErr?.message ?? "Falha ao baixar arquivo");
    const buf = await file.arrayBuffer();
    const text = await extractFromBuffer(buf, data.mimeType ?? file.type ?? "", data.sourceName);
    const { data: row, error } = await context.supabase
      .from("documents")
      .insert({
        user_id: context.userId,
        conversation_id: data.conversationId,
        source_type: "file",
        source_name: data.sourceName,
        mime_type: data.mimeType,
        storage_path: data.storagePath,
        extracted_text: text,
      })
      .select("id, source_name")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const ingestUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        conversationId: z.string().uuid(),
        url: z.string().url(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const isYt = /youtube\.com|youtu\.be/.test(data.url);
    const isTikTok = /tiktok\.com/.test(data.url);
    const text = await extractFromUrl(data.url);
    const { data: row, error } = await context.supabase
      .from("documents")
      .insert({
        user_id: context.userId,
        conversation_id: data.conversationId,
        source_type: isYt ? "youtube" : isTikTok ? "tiktok" : "url",
        source_name: data.url,
        extracted_text: text,
      })
      .select("id, source_name, source_type")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: doc } = await context.supabase
      .from("documents")
      .select("storage_path")
      .eq("id", data.id)
      .single();
    if (doc?.storage_path)
      await context.supabase.storage.from("stolas-uploads").remove([doc.storage_path]);
    const { error } = await context.supabase.from("documents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// --- Chat (send message + AI response) ---
function buildContextBlock(docs: { source_name: string; extracted_text: string | null }[]): string {
  if (!docs.length) return "";
  return (
    "\n\n=== BASE DE CONHECIMENTO FORNECIDA PELO USUÁRIO ===\n" +
    docs
      .map(
        (d, i) =>
          `--- Documento ${i + 1}: ${d.source_name} ---\n${d.extracted_text ?? "(sem texto extraído)"}`,
      )
      .join("\n\n") +
    "\n=== FIM DA BASE DE CONHECIMENTO ===\n"
  );
}

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        conversationId: z.string().uuid(),
        content: z.string().min(1).max(8000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Persist user message
    const { error: uErr } = await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "user",
      content: data.content,
    });
    if (uErr) throw new Error(uErr.message);

    // Load conversation, history, docs
    const [{ data: conv }, { data: history }, { data: docs }] = await Promise.all([
      supabase.from("conversations").select("title, mode").eq("id", data.conversationId).single(),
      supabase
        .from("messages")
        .select("role, content")
        .eq("conversation_id", data.conversationId)
        .order("created_at", { ascending: true }),
      supabase
        .from("documents")
        .select("source_name, extracted_text")
        .eq("conversation_id", data.conversationId),
    ]);

    const sysBase =
      conv?.mode === "abnt"
        ? "Você é o Stolas, assistente acadêmico especialista em normas ABNT. Responda em português do Brasil. Quando o usuário pedir para gerar um trabalho acadêmico, oriente-o a clicar no botão 'Gerar PDF ABNT' que aparecerá. Em respostas comuns, use linguagem clara, baseando-se SOMENTE na base de conhecimento fornecida quando ela existir, citando os documentos pelo nome."
        : "Você é o Stolas, um assistente de IA inteligente, claro e útil. Responda em português do Brasil. Quando o usuário fornecer documentos, baseie-se neles e cite o nome dos arquivos ao referenciar informações. Se não houver base de conhecimento, responda com conhecimento geral.";

    const system = sysBase + buildContextBlock(docs ?? []);

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...(history ?? []).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ];

    const reply = await chatCompletion({ messages, model: "google/gemini-2.5-flash" });

    const { data: aRow, error: aErr } = await supabase
      .from("messages")
      .insert({
        conversation_id: data.conversationId,
        user_id: userId,
        role: "assistant",
        content: reply,
      })
      .select("id, role, content, created_at")
      .single();
    if (aErr) throw new Error(aErr.message);

    // Update conversation timestamp + auto-title if first
    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", data.conversationId);
    if (conv && (conv.title === "Nova conversa" || !conv.title)) {
      const newTitle = data.content.slice(0, 60);
      await supabase
        .from("conversations")
        .update({ title: newTitle })
        .eq("id", data.conversationId);
    }

    return aRow;
  });

// --- ABNT formatter check ---
export const checkAbntFormatting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ conversationId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: docs } = await context.supabase
      .from("documents")
      .select("source_name, extracted_text")
      .eq("conversation_id", data.conversationId);
    if (!docs?.length) throw new Error("Anexe ao menos um documento para análise.");
    const sys =
      "Você é um especialista em normas ABNT (NBR 14724, 6023, 10520, 6024). Analise o documento fornecido e produza um RELATÓRIO DE CONFORMIDADE em markdown contendo: 1) ✅ O que está em conformidade, 2) ⚠️ Não conformidades encontradas (com citações), 3) 🛠️ Sugestões de correção específicas. Seja preciso e objetivo.";
    const userPrompt = `Documentos analisados:\n\n${docs.map((d, i) => `--- Doc ${i + 1}: ${d.source_name} ---\n${d.extracted_text ?? ""}`).join("\n\n")}`;
    const [reply, correctedContent] = await Promise.all([
      chatCompletion({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userPrompt },
        ],
        model: "google/gemini-2.5-flash",
      }),
      chatCompletion({
        messages: [
          {
            role: "system",
            content: `Você é um revisor acadêmico especialista em ABNT. Reescreva e organize o documento em markdown para uma versão corrigida, mantendo o conteúdo original e aplicando: títulos numerados, linguagem acadêmica, citações no corpo conforme NBR 10520 quando já houver dados, seções coerentes e referências conforme NBR 6023 quando existirem no texto. Não invente autores, anos, dados, citações ou referências. Se algum elemento obrigatório não existir no material, crie um marcador claro como [INFORMAR AUTOR] ou [INFORMAR INSTITUIÇÃO]. Não inclua capa.`,
          },
          { role: "user", content: userPrompt },
        ],
        model: "google/gemini-2.5-flash",
        temperature: 0.35,
      }),
    ]);

    const firstDoc = docs[0];
    const correctedTitle = `${cleanFileTitle(firstDoc.source_name)} - corrigido ABNT`;
    const correctedPdf = await generateAbntPdf({
      title: correctedTitle,
      author: "[INFORMAR AUTOR]",
      institution: "[INFORMAR INSTITUIÇÃO]",
      city: "[INFORMAR CIDADE]",
      year: String(new Date().getFullYear()),
      content: correctedContent,
    });
    const path = `${context.userId}/abnt-corrigidos/${Date.now()}-${safePathPart(correctedTitle)}.pdf`;
    const { error: upErr } = await context.supabase.storage
      .from("stolas-uploads")
      .upload(path, correctedPdf, { contentType: "application/pdf", upsert: false });
    if (upErr) throw new Error(upErr.message);
    const { data: signed } = await context.supabase.storage
      .from("stolas-uploads")
      .createSignedUrl(path, 3600);

    const { error } = await context.supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: context.userId,
      role: "assistant",
      content: `## Relatório de Conformidade ABNT\n\n${reply}\n\n---\n\n📄 **Versão corrigida em ABNT:** [Baixar PDF corrigido](${signed?.signedUrl ?? "#"})\n\n> Revise os campos marcados como [INFORMAR ...] antes de entregar.`,
      attachments: [{ type: "pdf", url: signed?.signedUrl, name: `${correctedTitle}.pdf` }],
    });
    if (error) throw new Error(error.message);
    await context.supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", data.conversationId);

    return { report: reply, correctedUrl: signed?.signedUrl, path };
  });

// --- Generate ABNT PDF ---
export const generateAbntDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        conversationId: z.string().uuid(),
        title: z.string().min(1).max(200),
        author: z.string().min(1).max(150),
        institution: z.string().optional(),
        course: z.string().optional(),
        city: z.string().optional(),
        instructions: z.string().min(10).max(2000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: docs } = await context.supabase
      .from("documents")
      .select("source_name, extracted_text")
      .eq("conversation_id", data.conversationId);
    if (!docs?.length)
      throw new Error("Anexe ao menos um material de referência antes de gerar o trabalho.");

    const sys = `Você é um redator acadêmico especialista em normas ABNT. Produza um trabalho acadêmico COMPLETO em português do Brasil, em markdown, com a seguinte estrutura OBRIGATÓRIA usando # para títulos:

# RESUMO
(parágrafo único, 150-250 palavras, com palavras-chave ao final)

# 1 INTRODUÇÃO
(contextualização, problema, objetivos, justificativa, metodologia, ~3 parágrafos)

# 2 DESENVOLVIMENTO
## 2.1 Subtítulo relevante
(conteúdo aprofundado baseado nos materiais; use citações diretas com > para citações longas (>3 linhas) e (AUTOR, ano) para citações curtas; mínimo 4 subseções)
## 2.2 ...
## 2.3 ...
## 2.4 ...

# 3 CONCLUSÃO
(síntese, contribuições, limitações, sugestões)

REGRAS:
- Baseie-se EXCLUSIVAMENTE no conteúdo dos documentos fornecidos.
- Cite os documentos no texto: (Doc: nome_do_arquivo).
- Linguagem formal, impessoal, científica.
- NÃO inclua capa nem referências aqui — serão geradas automaticamente.
- Mínimo 1500 palavras no total.`;

    const userPrompt = `Tema: ${data.title}\n\nInstruções do aluno: ${data.instructions}\n\n=== MATERIAIS DE REFERÊNCIA ===\n\n${docs.map((d, i) => `--- Material ${i + 1}: ${d.source_name} ---\n${d.extracted_text ?? ""}`).join("\n\n")}`;

    const content = await chatCompletion({
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userPrompt },
      ],
      model: "google/gemini-2.5-flash",
      temperature: 0.5,
    });

    // Generate references
    const refsReply = await chatCompletion({
      messages: [
        {
          role: "system",
          content:
            "Gere referências bibliográficas no padrão ABNT NBR 6023, uma por linha, baseando-se nos materiais fornecidos. Se forem documentos sem autor explícito, use o nome do arquivo. Saída APENAS as referências, uma por linha, sem numeração nem markdown.",
        },
        {
          role: "user",
          content: `Materiais: ${docs.map((d) => d.source_name).join(", ")}\n\nConteúdos resumidos:\n${docs.map((d) => `${d.source_name}: ${(d.extracted_text ?? "").slice(0, 500)}`).join("\n\n")}`,
        },
      ],
      model: "google/gemini-2.5-flash",
      temperature: 0.3,
    });
    const references = refsReply
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const pdf = await generateAbntPdf({
      title: data.title,
      author: data.author,
      institution: data.institution,
      course: data.course,
      city: data.city,
      year: String(new Date().getFullYear()),
      content,
      references,
    });

    // Upload to storage
    const path = `${context.userId}/abnt/${Date.now()}-${data.title.replace(/[^\w]/g, "_").slice(0, 40)}.pdf`;
    const { error: upErr } = await context.supabase.storage
      .from("stolas-uploads")
      .upload(path, pdf, { contentType: "application/pdf", upsert: false });
    if (upErr) throw new Error(upErr.message);
    const { data: signed } = await context.supabase.storage
      .from("stolas-uploads")
      .createSignedUrl(path, 3600);

    // Save as a system message in the conversation
    await context.supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: context.userId,
      role: "assistant",
      content: `📄 **Trabalho ABNT gerado:** [Baixar PDF](${signed?.signedUrl ?? "#"})\n\n**Título:** ${data.title}\n**Autor:** ${data.author}`,
      attachments: [{ type: "pdf", url: signed?.signedUrl, name: `${data.title}.pdf` }],
    });

    return { url: signed?.signedUrl, path };
  });

export const signupAndAutoConfirm = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(6),
        name: z.string(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    // Security guard: auto-confirm signups must be explicitly enabled via env var.
    // This prevents public clients from creating confirmed accounts unless the deployer opts in.
    if (process.env.ALLOW_AUTO_CONFIRM_SIGNUP !== "true") {
      throw new Error("Signup disabled: auto-confirm signup is not allowed in this environment.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: userRow, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.name },
    });
    if (error) throw new Error(error.message);
    return { user: userRow };
  });

// Verify Google reCAPTCHA v2 token server-side
export const verifyRecaptcha = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ token: z.string().min(1) }).parse(i))
  .handler(async ({ data }) => {
    const secret = process.env.RECAPTCHA_SECRET;
    if (!secret) throw new Error("reCAPTCHA secret is not configured on the server");

    const params = new URLSearchParams();
    params.append("secret", secret);
    params.append("response", data.token);

    const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = (await res.json()) as { success?: boolean; [k: string]: any };
    if (!json.success) {
      throw new Error("reCAPTCHA verification failed");
    }
    return { ok: true };
  });

// Rate limiting is delegated to src/lib/rateLimiter which uses Redis when available
// and falls back to an in-memory Map. Use async helpers below.

export const signupProtected = createServerFn({ method: "POST" })
  .inputValidator((i) =>
    z
      .object({ email: z.string().email(), password: z.string().min(6), name: z.string(), token: z.string().min(1).optional() })
      .parse(i),
  )
  .handler(async ({ data }) => {
    // Rate limit by IP and email
    const req = getRequest();
    const ip = (req?.headers.get("x-forwarded-for") || req?.headers.get("cf-connecting-ip") || "unknown") as string;
    const emailKey = `email:${data.email.toLowerCase()}`;
    const ipKey = `ip:${ip}`;

    if ((await isRateLimited(emailKey)) || (await isRateLimited(ipKey))) {
      throw new Error("Too many signup attempts. Please try again later.");
    }

    // Require reCAPTCHA in production; allow local testing before its keys exist.
    const secret = process.env.RECAPTCHA_SECRET;
    const isProduction = process.env.NODE_ENV === "production";
    const recaptchaConfigured = Boolean(secret && !secret.includes("REDACTED"));
    if (isProduction && !recaptchaConfigured) throw new Error("reCAPTCHA secret is not configured on the server");

    if (recaptchaConfigured) {
      if (!data.token) throw new Error("reCAPTCHA token is required");
      const params = new URLSearchParams();
      params.append("secret", secret!);
      params.append("response", data.token);

      const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const json = (await res.json()) as { success?: boolean; [k: string]: any };
      if (!json.success) {
        // Increment attempts on failure
        await incrementRateLimit(emailKey);
        await incrementRateLimit(ipKey);
        throw new Error("reCAPTCHA verification failed");
      }
    }

    // Normal signup only needs the public Supabase key. The service role key
    // remains reserved for administrative operations.
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseUrl = process.env.SUPABASE_URL;
    const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !publishableKey) throw new Error("Supabase is not configured on the server");
    const supabase = createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userRow, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: { full_name: data.name },
        emailRedirectTo: `${process.env.APP_URL || "http://localhost:8080"}/confirm-email`,
      },
    });
    if (error) {
      // On failure, increment rate counters to slow down abuses
      await incrementRateLimit(emailKey);
      await incrementRateLimit(ipKey);
      throw new Error(error.message);
    }

    // Success: reset counters for this email (optional)
    await resetRateLimit(emailKey);

    // Send confirmation email (best-effort). If sending fails, still return user but log error.
    try {
      const newUserId = (userRow as any)?.id ?? (userRow as any)?.user?.id;
      await sendConfirmationEmailToUser(newUserId, data.email, data.name);
    } catch (e) {
      // Use centralized logger to avoid leaking stack traces in production
      try {
        const { error: logError } = await import("@/lib/logger");
        logError("Failed to send confirmation email:", e);
      } catch {
        // fallback
        console.error("Failed to send confirmation email:", e);
      }
    }

    return { user: userRow };
  });

// Email confirmation helpers (stateless token + SMTP send)
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function base64url(input: Buffer) {
  return input.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signPayload(payload: object) {
  const secret = process.env.EMAIL_CONFIRM_SECRET || "";
  if (!secret) throw new Error("EMAIL_CONFIRM_SECRET not set");
  const payloadStr = JSON.stringify(payload);
  const payloadB = Buffer.from(payloadStr, "utf8");
  const sig = crypto.createHmac("sha256", secret).update(payloadB).digest();
  return `${base64url(payloadB)}.${base64url(sig)}`;
}

function verifySignedPayload(token: string) {
  const secret = process.env.EMAIL_CONFIRM_SECRET || "";
  if (!secret) throw new Error("EMAIL_CONFIRM_SECRET not set");
  const [payloadPart, sigPart] = token.split(".");
  if (!payloadPart || !sigPart) throw new Error("Invalid token format");
  const payloadBuf = Buffer.from(payloadPart.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const expectedSig = crypto.createHmac("sha256", secret).update(payloadBuf).digest();
  const sigBuf = Buffer.from(sigPart.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (!crypto.timingSafeEqual(expectedSig, sigBuf)) throw new Error("Invalid token signature");
  const payload = JSON.parse(payloadBuf.toString("utf8")) as { uid: string; exp: number };
  if (Date.now() > payload.exp) throw new Error("Token expired");
  return payload;
}

async function sendConfirmationEmailToUser(userId: string, email: string, fullName: string) {
  const token = signPayload({ uid: userId, exp: Date.now() + EMAIL_TOKEN_TTL_MS });
  const appUrl = process.env.APP_URL || "http://localhost:5173";
  const confirmUrl = `${appUrl.replace(/\/$/, "")}/confirm-email?token=${encodeURIComponent(token)}`;

  const html = `<p>Olá ${fullName || "usuário"},</p>
  <p>Obrigado por se cadastrar no Stolas. Clique no link abaixo para confirmar seu e-mail:</p>
  <p><a href="${confirmUrl}">Confirmar e-mail</a></p>
  <p>Se você não pediu este e-mail, ignore-o.</p>`;

  await sendMail({ to: email, subject: "Confirme seu e-mail — Stolas", html });
  return { ok: true, confirmUrl };
}

export const confirmEmail = createServerFn({ method: "POST" })
  .inputValidator((i) => z.object({ token: z.string().min(1) }).parse(i))
  .handler(async ({ data }) => {
    const payload = verifySignedPayload(data.token);
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase not configured for admin updates");

    // Call Supabase Admin REST API to set email_confirm true
    const url = `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/admin/users/${encodeURIComponent(payload.uid)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email_confirm: true }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to confirm email: ${res.status} ${text}`);
    }
    return { ok: true };
  });
