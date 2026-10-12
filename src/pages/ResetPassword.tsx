import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save } from 'lucide-react';
import guimsLogo from '@/assets/guims-logo.png';

export default function ResetPassword() {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const { toast } = useToast();
    const navigate = useNavigate();

    useEffect(() => {
        // Vérification: l'utilisateur doit avoir cliqué sur un lien de récupération
        // Supabase va récupérer le token dans l'URL et créer une session temporaire.
        const checkSession = async () => {
            const { data } = await supabase.auth.getSession();
            if (!data.session) {
                toast({
                    title: 'Erreur',
                    description: 'Lien de réinitialisation invalide ou expiré.',
                    variant: 'destructive',
                });
                navigate('/login');
            }
        };
        checkSession();
    }, [navigate, toast]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password.trim() || password.length < 6) {
            toast({
                title: 'Erreur',
                description: 'Le mot de passe doit contenir au moins 6 caractères.',
                variant: 'destructive',
            });
            return;
        }
        if (password !== confirmPassword) {
            toast({
                title: 'Erreur',
                description: 'Les mots de passe ne correspondent pas.',
                variant: 'destructive',
            });
            return;
        }

        setSubmitting(true);
        try {
            const { error } = await supabase.auth.updateUser({ password });

            if (error) {
                throw error;
            }

            toast({
                title: 'Succès',
                description: 'Votre mot de passe a été réinitialisé avec succès.',
            });
            // Déconnecter l'utilisateur pour qu'il se reconnecte avec le nouveau mdp ou le laisser co. 
            // Supabase recommande souvent de le rediriger.
            navigate('/dashboard');
        } catch (error: any) {
            console.error('Erreur lors de la mise à jour:', error);
            toast({
                title: 'Erreur',
                description: error.message || 'Une erreur est survenue lors de la mise à jour du mot de passe.',
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

                    <h2 className="font-display text-2xl font-bold">Nouveau mot de passe</h2>
                    <p className="text-sm text-muted-foreground mt-2">
                        Veuillez entrer votre nouveau mot de passe ci-dessous.
                    </p>
                </CardHeader>

                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="password">Nouveau mot de passe</Label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                                minLength={6}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="confirmPassword">Confirmer le mot de passe</Label>
                            <Input
                                id="confirmPassword"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                                minLength={6}
                            />
                        </div>

                        <Button type="submit" className="w-full" disabled={submitting}>
                            {submitting ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Enregistrer
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
