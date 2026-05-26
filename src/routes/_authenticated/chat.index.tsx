import { createFileRoute } from "@tanstack/react-router";
import { StolasLogo } from "@/components/stolas-logo";

export const Route = createFileRoute("/_authenticated/chat/")({ component: Empty });

function Empty() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <StolasLogo className="scale-150 mb-6" />
      <h1 className="text-2xl font-bold tracking-tight">Olá, sou o Stolas</h1>
      <p className="text-muted-foreground mt-2 max-w-md">
        Crie uma nova conversa para começar. No modo <b>Trabalho ABNT</b>, posso gerar PDFs acadêmicos completos a partir dos seus materiais.
      </p>
    </div>
  );
}
