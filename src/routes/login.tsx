import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import { signupProtected } from "@/lib/stolas.functions";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StolasLogo } from "@/components/stolas-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Entrar — Stolas" },
      { name: "description", content: "Acesse sua conta Stolas." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const recaptchaContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<number | null>(null);
  const [activeTab, setActiveTab] = useState("login");
  const SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY || "";
  const supabaseConfigured = isSupabaseConfigured();

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getUser().then(({ data, error }) => {
      if (!error && data.user) navigate({ to: "/chat", replace: true });
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => {
      if (session) navigate({ to: "/chat", replace: true });
    });
    return () => subscription.unsubscribe();
  }, [navigate, supabaseConfigured]);

  useEffect(() => {
    if (!SITE_KEY || activeTab !== "signup") return;
    // Load grecaptcha script if not present
    if (!(window as any).grecaptcha) {
      const hasScript = !!document.querySelector('script[src*="recaptcha"]');
      if (!hasScript) {
        const s = document.createElement("script");
        s.src = "https://www.google.com/recaptcha/api.js?render=explicit";
        s.async = true;
        s.defer = true;
        document.head.appendChild(s);
        s.onload = () => {
          tryRender();
        };
      }
    } else {
      tryRender();
    }

    function tryRender() {
      try {
        if ((window as any).grecaptcha && recaptchaContainerRef.current && widgetIdRef.current == null) {
          widgetIdRef.current = (window as any).grecaptcha.render(recaptchaContainerRef.current, {
            sitekey: SITE_KEY,
          });
        }
      } catch (e) {
        // ignore
      }
    }
  }, [SITE_KEY, activeTab]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabaseConfigured) {
      toast.error("Configure as variáveis do Supabase no arquivo .env para entrar.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error(error.message);
      else toast.success("Bem-vindo!");
    } catch (error) {
      toast.error(
        error instanceof TypeError && error.message === "Failed to fetch"
          ? "Não foi possível conectar ao Supabase. Verifique a URL e as variáveis da Vercel."
          : error instanceof Error
            ? error.message
            : "Não foi possível entrar agora.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabaseConfigured) {
      toast.error("Configure as variáveis do Supabase no arquivo .env para cadastrar.");
      return;
    }
    setLoading(true);
    try {
      // Get reCAPTCHA response
      const widgetId = widgetIdRef.current;
      const grecaptcha = (window as any).grecaptcha;
      const token = widgetId != null && grecaptcha ? grecaptcha.getResponse(widgetId) : null;
      const recaptchaConfigured = Boolean(SITE_KEY && !SITE_KEY.includes("REDACTED"));
      if (recaptchaConfigured && !token) {
        setLoading(false);
        toast.error("Por favor, conclua o reCAPTCHA antes de continuar.");
        return;
      }

      // Call protected signup endpoint (includes recaptcha verification + rate-limiting)
      const res = await signupProtected({ data: { email, password, name, token: token || undefined } });
      setLoading(false);
      if (res?.user) {
        toast.success("Cadastro criado! Verifique seu email para confirmar.");
      } else {
        toast.success("Cadastro criado!");
      }

      // reset widget
      try {
        if (grecaptcha && widgetId != null) grecaptcha.reset(widgetId);
      } catch (e) {
        /* ignore */
      }
    } catch (err: any) {
      setLoading(false);
      toast.error(err?.message || "Falha ao verificar reCAPTCHA");
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error(result.error.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="flex items-center justify-between p-4 border-b">
        <StolasLogo />
        <ThemeToggle />
      </header>
      <main className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8 shadow-xl">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold tracking-tight">Bem-vindo ao Stolas</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Seu assistente acadêmico inteligente
            </p>
            {!supabaseConfigured && (
              <p className="mt-3 text-sm text-destructive">
                Configure o Supabase no arquivo .env para habilitar o acesso.
              </p>
            )}
          </div>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="login">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Cadastrar</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4 mt-4">
                <div>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Senha</Label>
                  <Input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrar"}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4 mt-4">
                <div>
                  <Label>Nome completo</Label>
                  <Input required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Senha (mín. 6 caracteres)</Label>
                  <Input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div>
                  <div ref={recaptchaContainerRef} />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar conta"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Enviaremos um email de confirmação.
                </p>
              </form>
            </TabsContent>
          </Tabs>
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-card px-2 text-muted-foreground">ou</span>
            </div>
          </div>
          <Button variant="outline" className="w-full" onClick={handleGoogle} disabled={loading}>
            <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continuar com Google
          </Button>
          <p className="text-xs text-muted-foreground text-center mt-4">
            Ao continuar você concorda com nossos{" "}
            <Dialog>
              <DialogTrigger asChild>
                <button type="button" className="underline cursor-pointer hover:text-foreground">
                  termos de uso e privacidade (LGPD)
                </button>
              </DialogTrigger>
              <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Termos de Uso e Privacidade</DialogTitle>
                  <DialogDescription>
                    Conformidade com a Lei Geral de Proteção de Dados (LGPD)
                  </DialogDescription>
                </DialogHeader>
                <div className="text-xs text-muted-foreground space-y-3 mt-2 pr-1 text-left">
                  <p>
                    O <strong>Stolas</strong> tem o compromisso de proteger a sua privacidade e
                    garantir a segurança dos seus dados pessoais, em estrita conformidade com a Lei
                    Geral de Proteção de Dados (Lei nº 13.709/2018 - LGPD).
                  </p>
                  <h4 className="font-semibold text-foreground mt-2 text-sm">
                    1. Coleta de Informações
                  </h4>
                  <p>
                    Coletamos apenas os dados necessários para o fornecimento do serviço: seu nome
                    completo e endereço de e-mail (para autenticação e contato), bem como os
                    conteúdos das conversas e documentos (PDFs, textos, planilhas, links de
                    YouTube/TikTok) que você insere voluntariamente no sistema.
                  </p>
                  <h4 className="font-semibold text-foreground mt-2 text-sm">
                    2. Finalidade do Tratamento
                  </h4>
                  <p>Os dados coletados são utilizados exclusivamente para:</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>
                      Processar e analisar os materiais anexados para gerar respostas personalizadas
                      e relatórios de conformidade ABNT;
                    </li>
                    <li>Autenticar seu acesso à plataforma com segurança;</li>
                    <li>Melhorar sua experiência no uso do assistente.</li>
                  </ul>
                  <p>
                    <strong>Atenção:</strong> Seus dados e arquivos não são compartilhados com
                    terceiros para fins comerciais e não são utilizados para o treinamento público
                    de modelos de inteligência artificial de forma exposta.
                  </p>
                  <h4 className="font-semibold text-foreground mt-2 text-sm">
                    3. Seus Direitos sob a LGPD (Art. 18)
                  </h4>
                  <p>
                    Você possui controle total sobre suas informações na plataforma. A qualquer
                    momento, você pode:
                  </p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>Confirmar a existência de tratamento e acessar seus dados;</li>
                    <li>Solicitar a correção de dados incompletos, inexatos ou desatualizados;</li>
                    <li>
                      Excluir definitivamente seus arquivos, conversas ou a conta completa. A
                      exclusão de um documento ou chat apaga as informações de forma permanente de
                      nossos servidores.
                    </li>
                  </ul>
                  <h4 className="font-semibold text-foreground mt-2 text-sm">
                    4. Segurança da Informação
                  </h4>
                  <p>
                    Empregamos medidas técnicas e organizacionais adequadas para proteger seus dados
                    contra acessos não autorizados, perda, destruição ou alteração acidental,
                    utilizando criptografia no trânsito e em repouso.
                  </p>
                  <p className="mt-4 pt-2 border-t text-[10px] text-center">
                    Última atualização: Maio de 2026. Ao utilizar a plataforma, você declara estar
                    ciente e de acordo com estas práticas.
                  </p>
                </div>
              </DialogContent>
            </Dialog>
            .
          </p>
        </Card>
      </main>
    </div>
  );
}
