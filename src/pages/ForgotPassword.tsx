import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Mail, ArrowLeft } from 'lucide-react';
import guimsLogo from '@/assets/guims-logo.png';

export default function ForgotPassword() {
    const [email, setEmail] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const { toast } = useToast();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.trim()) return;

        setSubmitting(true);
        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
                redirectTo: `${window.location.origin}/reset-password`,
            });

            if (error) {
                throw error;
            }

            setSuccess(true);
            toast({
                title: 'Email envoyé',
                description: 'Veuillez vérifier votre boîte de réception pour réinitialiser votre mot de passe.',
            });
        } catch (error: any) {
            console.error('Erreur lors de la réinitialisation:', error);
            toast({
                title: 'Erreur',
                description: error.message || 'Une erreur est survenue lors de la demande de réinitialisation.',
                variant: 'destructive',
            });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className="flex min-h-screen items-center justify-center p-6"
            style={{ background: 'var(--gradient-hero)' }}
        >
            <Card className="w-full max-w-md animate-fade-in border-0 shadow-xl">
                <CardHeader className="text-center pb-2">
                    <div className="flex flex-col items-center mb-4">
                        <img src={guimsLogo} alt="Guims Group" className="w-16 h-16 mb-2" />
                        <span className="font-display text-xl font-bold text-primary">
                            Das-Sarl / MAGISTERE
                        </span>
                    </div>

                    <h2 className="font-display text-2xl font-bold">Mot de passe oublié</h2>
                    <p className="text-sm text-muted-foreground mt-2">
                        Entrez votre adresse email pour recevoir un lien de réinitialisation.
                    </p>
                </CardHeader>

                <CardContent>
                    {success ? (
                        <div className="text-center space-y-4">
                            <div className="bg-primary/10 text-primary p-4 rounded-xl flex items-center justify-center mb-4">
                                <Mail className="h-8 w-8" />
                            </div>
                            <p className="text-sm font-medium">
                                Si un compte correspond à cet email, un lien de réinitialisation a été envoyé.
                            </p>
                            <Button onClick={() => navigate('/login')} className="w-full mt-4">
                                Retour à la connexion
                            </Button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="nom@gmail.com"
                                    required
                                />
                            </div>

                            <Button type="submit" className="w-full" disabled={submitting || !email.trim()}>
                                {submitting ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                ) : (
                                    <Mail className="h-4 w-4 mr-2" />
                                )}
                                Envoyer le lien
                            </Button>

                            <div className="mt-4 text-center">
                                <Link
                                    to="/login"
                                    className="inline-flex items-center text-sm text-muted-foreground hover:text-primary transition-colors"
                                >
                                    <ArrowLeft className="h-4 w-4 mr-2" />
                                    Retour à la connexion
                                </Link>
                            </div>
                        </form>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
