import { createFileRoute, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  getMessages,
  sendMessage,
  getDocuments,
  ingestFile,
  ingestUrl,
  deleteDocument,
  checkAbntFormatting,
  generateAbntDocument,
  listConversations,
} from "@/lib/stolas.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Paperclip,
  Send,
  Link2,
  FileText,
  Trash2,
  GraduationCap,
  CheckSquare,
  Loader2,
  FileCheck2,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/chat/$threadId")({ component: ChatThread });

function safeStorageFileName(name: string) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
  const safeBase =
    base
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 120) || "arquivo";
  return `${safeBase}${ext.replace(/[^a-z0-9.]/g, "")}`;
}

function ChatThread() {
  const { threadId } = useParams({ from: "/_authenticated/chat/$threadId" });
  const qc = useQueryClient();
  const _list = useServerFn(listConversations);
  const _msgs = useServerFn(getMessages);
  const _send = useServerFn(sendMessage);
  const _docs = useServerFn(getDocuments);
  const _ingF = useServerFn(ingestFile);
  const _ingU = useServerFn(ingestUrl);
  const _delD = useServerFn(deleteDocument);
  const _check = useServerFn(checkAbntFormatting);
  const _gen = useServerFn(generateAbntDocument);

  const convQ = useQuery({ queryKey: ["conversations"], queryFn: () => _list() });
  const conv = convQ.data?.items.find((c) => c.id === threadId);

  const msgsQ = useQuery({
    queryKey: ["msgs", threadId],
    queryFn: () => _msgs({ data: { conversationId: threadId } }),
  });
  const docsQ = useQuery({
    queryKey: ["docs", threadId],
    queryFn: () => _docs({ data: { conversationId: threadId } }),
  });

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [abntOpen, setAbntOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgsQ.data]);

  const sendM = useMutation({
    mutationFn: (content: string) => _send({ data: { conversationId: threadId, content } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["msgs", threadId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSend = async () => {
    const t = input.trim();
    if (!t || sending) return;
    setInput("");
    setSending(true);
    // optimistic
    qc.setQueryData(["msgs", threadId], (old: any) => ({
      items: [
        ...(old?.items ?? []),
        { id: "tmp", role: "user", content: t, created_at: new Date().toISOString() },
      ],
    }));
    try {
      await sendM.mutateAsync(t);
    } finally {
      setSending(false);
    }
  };

  const handleFile = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) return toast.error("Arquivo muito grande (máx 20MB)");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const safeName = safeStorageFileName(file.name);
    const path = `${u.user.id}/${threadId}/${crypto.randomUUID()}-${safeName}`;
    const contentType =
      file.type || (safeName.endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
    const { error: upErr } = await supabase.storage
      .from("stolas-uploads")
      .upload(path, file, { contentType });
    if (upErr) return toast.error(upErr.message);
    toast.promise(
      _ingF({
        data: {
          conversationId: threadId,
          storagePath: path,
          sourceName: file.name,
          mimeType: contentType,
        },
      }).then(() => qc.invalidateQueries({ queryKey: ["docs", threadId] })),
      {
        loading: `Processando ${file.name}...`,
        success: "Material adicionado!",
        error: (e) => e.message,
      },
    );
  };

  const handleUrl = async () => {
    if (!url) return;
    setUrlOpen(false);
    toast.promise(
      _ingU({ data: { conversationId: threadId, url } }).then(() => {
        qc.invalidateQueries({ queryKey: ["docs", threadId] });
        setUrl("");
      }),
      { loading: "Buscando conteúdo...", success: "Adicionado!", error: (e) => e.message },
    );
  };

  const handleCheck = async () => {
    toast.promise(
      _check({ data: { conversationId: threadId } })
        .then((r) =>
          _send({
            data: {
              conversationId: threadId,
              content: `[Verificação ABNT solicitada]\n\n${r.report}`,
            },
          }),
        )
        .then(() => qc.invalidateQueries({ queryKey: ["msgs", threadId] })),
      {
        loading: "Verificando formatação ABNT...",
        success: "Relatório pronto!",
        error: (e) => e.message,
      },
    );
  };

  return (
    <div className="flex-1 flex min-h-0">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b px-4 py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-semibold truncate">{conv?.title ?? "Conversa"}</h2>
            <p className="text-xs text-muted-foreground">
              {conv?.mode === "abnt" ? "Modo Trabalho ABNT" : "Chat livre"}
            </p>
          </div>
          <div className="flex gap-2">
            {conv?.mode === "abnt" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCheck}
                  disabled={!docsQ.data?.items.length}
                >
                  <CheckSquare className="h-4 w-4 mr-1" /> Verificar ABNT
                </Button>
                <AbntDialog
                  open={abntOpen}
                  setOpen={setAbntOpen}
                  onGenerate={async (vals) => {
                    setAbntOpen(false);
                    toast.promise(
                      _gen({ data: { conversationId: threadId, ...vals } }).then(() =>
                        qc.invalidateQueries({ queryKey: ["msgs", threadId] }),
                      ),
                      {
                        loading: "Gerando trabalho ABNT (pode levar 1 min)...",
                        success: "PDF gerado!",
                        error: (e) => e.message,
                      },
                    );
                  }}
                />
              </>
            )}
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {msgsQ.data?.items.length === 0 && (
              <div className="text-center text-muted-foreground py-12">
                <p className="text-sm">
                  Anexe materiais (PDF, TXT, XLSX, links, vídeos do YouTube) e faça sua pergunta.
                </p>
              </div>
            )}
            {msgsQ.data?.items.map((m) => (
              <MessageBubble key={m.id} role={m.role} content={m.content} />
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Stolas está pensando...
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="border-t p-4">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
              <input
                ref={fileRef}
                type="file"
                hidden
                accept="application/pdf,.pdf,text/plain,.txt,.md,.csv,.json,.html,.xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,.xlsx,.xls,.xlsm,.ods"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileRef.current?.click()}
                title="Anexar arquivo"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Dialog open={urlOpen} onOpenChange={setUrlOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" title="Adicionar link/YouTube">
                    <Link2 className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Adicionar link ou vídeo</DialogTitle>
                  </DialogHeader>
                  <Input
                    placeholder="https://... (página, artigo ou YouTube)"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Vídeos do YouTube precisam de legendas públicas disponíveis.
                  </p>
                  <DialogFooter>
                    <Button onClick={handleUrl}>Adicionar</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Pergunte algo ao Stolas..."
                className="flex-1 border-0 resize-none focus-visible:ring-0 shadow-none min-h-[44px] max-h-40 bg-transparent"
                rows={1}
              />
              <Button onClick={handleSend} disabled={!input.trim() || sending} size="icon">
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Stolas pode cometer erros. Verifique informações importantes.
            </p>
          </div>
        </div>
      </div>

      {/* Right rail: materials */}
      <aside className="hidden lg:flex w-72 border-l flex-col bg-card/30">
        <div className="p-4 border-b">
          <h3 className="font-semibold text-sm">Base de conhecimento</h3>
          <p className="text-xs text-muted-foreground">
            {docsQ.data?.items.length ?? 0} material(is)
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {docsQ.data?.items.map((d) => (
            <Card key={d.id} className="p-3 flex items-start gap-2 text-sm">
              <FileText className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium">{d.source_name}</p>
                <p className="text-xs text-muted-foreground">{d.source_type}</p>
              </div>
              <button
                onClick={async () => {
                  await _delD({ data: { id: d.id } });
                  qc.invalidateQueries({ queryKey: ["docs", threadId] });
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            </Card>
          ))}
          {!docsQ.data?.items.length && (
            <p className="text-xs text-muted-foreground text-center py-8">
              Nenhum material anexado.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function MessageBubble({ role, content }: { role: string; content: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`${isUser ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[80%]" : "max-w-[90%]"} whitespace-pre-wrap text-sm leading-relaxed`}
      >
        {renderMarkdown(content)}
      </div>
    </div>
  );
}

function renderMarkdown(text: string) {
  // Minimal markdown: links, bold
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link)
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline"
        >
          {link[1]}
        </a>
      );
    const bold = p.match(/^\*\*(.+)\*\*$/);
    if (bold) return <strong key={i}>{bold[1]}</strong>;
    return <span key={i}>{p}</span>;
  });
}

function AbntDialog({
  open,
  setOpen,
  onGenerate,
}: {
  open: boolean;
  setOpen: (b: boolean) => void;
  onGenerate: (v: any) => void;
}) {
  const [vals, setVals] = useState({
    title: "",
    author: "",
    institution: "",
    course: "",
    city: "",
    instructions: "",
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <GraduationCap className="h-4 w-4 mr-1" /> Gerar PDF ABNT
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck2 className="h-5 w-5" /> Gerar Trabalho ABNT
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Título do trabalho *</Label>
            <Input
              value={vals.title}
              onChange={(e) => setVals({ ...vals, title: e.target.value })}
            />
          </div>
          <div>
            <Label>Autor *</Label>
            <Input
              value={vals.author}
              onChange={(e) => setVals({ ...vals, author: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Instituição</Label>
              <Input
                value={vals.institution}
                onChange={(e) => setVals({ ...vals, institution: e.target.value })}
              />
            </div>
            <div>
              <Label>Curso</Label>
              <Input
                value={vals.course}
                onChange={(e) => setVals({ ...vals, course: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Cidade</Label>
            <Input value={vals.city} onChange={(e) => setVals({ ...vals, city: e.target.value })} />
          </div>
          <div>
            <Label>Instruções / tema específico *</Label>
            <Textarea
              rows={4}
              value={vals.instructions}
              onChange={(e) => setVals({ ...vals, instructions: e.target.value })}
              placeholder="Descreva o que o trabalho deve abordar, foco, abordagem..."
            />
          </div>
          <p className="text-xs text-muted-foreground">
            A IA usará todos os materiais anexados como base. Mínimo de 10 caracteres nas
            instruções.
          </p>
        </div>
        <DialogFooter>
          <Button
            onClick={() => onGenerate(vals)}
            disabled={!vals.title || !vals.author || vals.instructions.length < 10}
          >
            Gerar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
