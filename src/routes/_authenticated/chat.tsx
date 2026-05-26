import { createFileRoute, Outlet, useNavigate, useParams, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listConversations, createConversation, deleteConversation } from "@/lib/stolas.functions";
import { Button } from "@/components/ui/button";
import { StolasLogo } from "@/components/stolas-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Plus, MessageSquare, GraduationCap, Trash2, LogOut, Menu, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/chat")({ component: ChatLayout });

function ChatLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useServerFn(listConversations);
  const create = useServerFn(createConversation);
  const del = useServerFn(deleteConversation);
  const { threadId } = useParams({ strict: false }) as { threadId?: string };
  const [open, setOpen] = useState(false);

  const { data } = useQuery({ queryKey: ["conversations"], queryFn: () => list() });
  const items = data?.items ?? [];

  // Auto-create or redirect on root /chat
  useEffect(() => {
    if (!threadId && data) {
      if (items.length) navigate({ to: "/chat/$threadId", params: { threadId: items[0].id }, replace: true });
    }
  }, [threadId, data, items, navigate]);

  const handleNew = async (mode: "chat" | "abnt") => {
    const conv = await create({ data: { mode } });
    qc.invalidateQueries({ queryKey: ["conversations"] });
    navigate({ to: "/chat/$threadId", params: { threadId: conv.id } });
    setOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta conversa?")) return;
    await del({ data: { id } });
    qc.invalidateQueries({ queryKey: ["conversations"] });
    if (threadId === id) navigate({ to: "/chat" });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Sessão encerrada");
    navigate({ to: "/login" });
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className={`${open ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 fixed md:static z-40 inset-y-0 left-0 w-72 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col transition-transform`}>
        <div className="p-4 flex items-center justify-between border-b border-sidebar-border">
          <StolasLogo />
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button>
        </div>
        <div className="p-3 space-y-2">
          <Button onClick={() => handleNew("chat")} className="w-full justify-start" variant="default">
            <Plus className="h-4 w-4 mr-2" /> Novo chat
          </Button>
          <Button onClick={() => handleNew("abnt")} className="w-full justify-start" variant="outline">
            <GraduationCap className="h-4 w-4 mr-2" /> Trabalho ABNT
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground px-2 py-2">Conversas</p>
          {items.map((c) => (
            <div key={c.id} className={`group flex items-center rounded-md ${threadId === c.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50"}`}>
              <Link
                to="/chat/$threadId"
                params={{ threadId: c.id }}
                className="flex-1 flex items-center gap-2 px-3 py-2 text-sm truncate"
                onClick={() => setOpen(false)}
              >
                {c.mode === "abnt" ? <GraduationCap className="h-3.5 w-3.5 shrink-0" /> : <MessageSquare className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{c.title}</span>
              </Link>
              <button onClick={() => handleDelete(c.id)} className="opacity-0 group-hover:opacity-100 p-2"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          {!items.length && <p className="text-xs text-muted-foreground px-3 py-4">Sem conversas ainda.</p>}
        </div>
        <div className="p-3 border-t border-sidebar-border flex items-center justify-between">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={handleLogout}><LogOut className="h-4 w-4 mr-2" /> Sair</Button>
        </div>
      </aside>
      {open && <div className="md:hidden fixed inset-0 bg-black/40 z-30" onClick={() => setOpen(false)} />}

      <main className="flex-1 flex flex-col min-w-0">
        <div className="md:hidden p-3 border-b flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)}><Menu className="h-4 w-4" /></Button>
          <StolasLogo />
        </div>
        <Outlet />
      </main>
    </div>
  );
}
