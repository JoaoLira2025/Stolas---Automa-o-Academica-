import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { confirmEmail } from "@/lib/stolas.functions";

export const Route = createFileRoute("/confirm-email")({
  head: () => ({ meta: [{ title: "Confirmar e-mail — Stolas" }] }),
  component: ConfirmEmailPage,
});

function ConfirmEmailPage() {
  
  const [status, setStatus] = useState<"pending" | "ok" | "error">("pending");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setStatus("error");
      setMessage("Token de confirmação ausente.");
      return;
    }

    (async () => {
      try {
        await confirmEmail({ token } as any);
        setStatus("ok");
        setMessage("E-mail confirmado com sucesso. Você já pode entrar.");
      } catch (e: any) {
        setStatus("error");
        setMessage(e?.message || "Falha ao confirmar e-mail.");
      }
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md p-8 text-center">
        {status === "pending" && <p>Confirmando e-mail...</p>}
        {status === "ok" && (
          <>
            <h2 className="text-lg font-semibold">E-mail confirmado</h2>
            <p className="mt-2 text-sm text-muted-foreground">{message}</p>
            <div className="mt-6">
              <a href="/login">
                <Button>Entrar</Button>
              </a>
            </div>
          </>
        )}
        {status === "error" && (
          <>
            <h2 className="text-lg font-semibold">Erro</h2>
            <p className="mt-2 text-sm text-muted-foreground">{message}</p>
          </>
        )}
      </Card>
    </div>
  );
}
